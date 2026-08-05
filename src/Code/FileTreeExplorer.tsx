import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Folder, FolderOpen, FileCode, ChevronRight, ChevronDown,
  FilePlus, FolderPlus, Pencil, Trash2, X,
} from 'lucide-react';
import type { VirtualFileSystem } from './vfsBundler';

export interface TreeNode {
  name: string;
  path: string;       // 文件夹时末尾统一带 '/'
  isFolder: boolean;
  children?: TreeNode[];
}

/** Why: 右键菜单4个动作——新建文件/文件夹、重命名、删除。空节点 path='' 表示在根目录操作。 */
export type FileTreeAction =
  | { type: 'create-file'; atFolderPath: string; fileName: string }
  | { type: 'create-folder'; atFolderPath: string; folderName: string }
  | { type: 'rename'; oldPath: string; newName: string }
  | { type: 'delete'; path: string };

export interface ContextMenuState {
  targetPath: string;
  isFolder: boolean;
  /** Why: 直接存 clientX/clientY + position:fixed 渲染菜单，避免被外层 overflow-y:auto 容器裁剪。 */
  x: number;
  y: number;
}

interface FileTreeExplorerProps {
  treeData: TreeNode[];
  activeFile: string;
  onSelectFile: (path: string) => void;
  /** Why: 用户在 UI 上完成 4 种文件系统操作后，把意图抛给上层修改 VFS。 */
  onAction?: (action: FileTreeAction) => void;
}

export const FileTreeExplorer: React.FC<FileTreeExplorerProps> = ({
  treeData,
  activeFile,
  onSelectFile,
  onAction,
}) => {
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  /** Why: 当前处于"等待用户输入新名称"的操作——新建文件/文件夹或重命名。 */
  const [pending, setPending] = useState<{
    kind: 'create-file' | 'create-folder' | 'rename';
    atPath: string;   // 新建时=目录path；重命名时=被重命名的完整path
    defaultValue?: string;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // Why: 把"右键弹出菜单"和"点击外部关闭菜单/Esc取消"合并到一个生命周期里，
  // 用原生事件直接监听 containerRef，彻底绕开 React 合成事件在嵌套组件里被 stopPropagation 截断的坑。
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleContextMenu = (event: MouseEvent) => {
      if (!onAction) return;
      const el = (event.target as Element | null)?.closest?.(
        '[data-node-path]'
      ) as HTMLElement | null;
      event.preventDefault();
      event.stopPropagation();
      const targetPath = el?.dataset.nodePath ?? '';
      const isFolder = el?.dataset.nodeKind === 'folder' || targetPath === '';
      // Why: 防止 fixed + portal 到 body 后，按视口边界自动防溢出：
      // 右侧不足则左移，底部不足则翻到光标上方（避免菜单跑出视口下方看不见）。
      const MENU_W = 180;
      const MENU_H = 200;
      const PAD = 4;
      let x = event.clientX;
      let y = event.clientY;
      if (typeof window !== 'undefined') {
        x = Math.min(x, window.innerWidth - MENU_W - PAD);
        x = Math.max(PAD, x);
        if (event.clientY + MENU_H > window.innerHeight - PAD) {
          // 翻到光标上方
          y = Math.max(PAD, event.clientY - MENU_H);
        }
      }
      setMenu({ targetPath, isFolder, x, y });
    };

    const handleClickOutside = (event: MouseEvent) => {
      setMenu((currentMenu) => {
        if (!currentMenu) return currentMenu;
        const node = event.target as Node | null;
        if (container.contains(node)) return currentMenu;
        // 点击菜单项本身（fixed 定位在 container 外）不能关，下次 click 再关
        if ((node as HTMLElement | null)?.closest?.('[data-role="tree-ctx-menu"]')) return currentMenu;
        return null;
      });
    };

    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setMenu(null); setPending(null); }
    };

    container.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      container.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onAction]);

  const submitPending = (inputValue: string) => {
    if (!pending) return;
    const name = inputValue.trim();
    if (!name) { setPending(null); return; }
    switch (pending.kind) {
      case 'create-file':
        onAction?.({ type: 'create-file', atFolderPath: pending.atPath, fileName: name });
        break;
      case 'create-folder':
        onAction?.({ type: 'create-folder', atFolderPath: pending.atPath, folderName: name });
        break;
      case 'rename':
        onAction?.({ type: 'rename', oldPath: pending.atPath, newName: name });
        break;
    }
    setPending(null);
  };

  const menuAction = (type: 'create-file' | 'create-folder' | 'rename' | 'delete') => {
    if (!menu) return;
    const atFolderPath = menu.isFolder
      ? menu.targetPath
      : (menu.targetPath.includes('/')
        ? menu.targetPath.split('/').slice(0, -1).join('/') + '/'
        : '');
    setMenu(null);
    if (type === 'delete') {
      onAction?.({ type: 'delete', path: menu.targetPath });
      return;
    }
    if (type === 'rename') {
      if (!menu.targetPath) return; // 根目录不能重命名
      setPending({
        kind: 'rename',
        atPath: menu.targetPath,
        defaultValue: menu.isFolder
          ? menu.targetPath.split('/').filter(Boolean).pop() ?? menu.targetPath
          : menu.targetPath.split('/').pop() ?? menu.targetPath,
      });
      return;
    }
    // 新建：文件/文件夹
    setPending({
      kind: type,
      atPath: atFolderPath,
      defaultValue: type === 'create-file' ? '未命名.js' : '新文件夹',
    });
  };

  return (
    <div
      ref={containerRef}
      data-role="tree-root"
      className="relative w-full h-full min-h-[180px] max-h-full overflow-y-auto select-none text-xs font-mono space-y-0.5"
    >
      <div>
        {treeData.length === 0 && (
          <div className="py-2 text-center text-[11px] text-slate-400">
            在空白处右键可新建文件 / 文件夹
          </div>
        )}
        {treeData.map((node) => (
          <TreeItem
            key={node.path}
            node={node}
            activeFile={activeFile}
            onSelectFile={onSelectFile}
            pending={pending}
            setPending={setPending}
            submitPending={submitPending}
          />
        ))}
        {/* 根级"新建"——根目录没有外层文件夹，这里兜底渲染输入框 */}
        {pending != null && pending.atPath === '' && (pending.kind === 'create-file' || pending.kind === 'create-folder') && (
          <div className="pl-2 py-1">
            <InlineNameInput
              autoFocus
              isFile={pending.kind === 'create-file'}
              initialValue={pending.defaultValue ?? ''}
              onCancel={() => setPending(null)}
              onConfirm={submitPending}
              prefixIcon={pending.kind === 'create-file'
                ? <FileCode className="w-3.5 h-3.5 text-slate-400 mr-2" />
                : <Folder className="w-3.5 h-3.5 text-amber-500 mr-2" />}
            />
          </div>
        )}
      </div>

      {menu && onAction && typeof document !== 'undefined' && document.body && createPortal(
        <ul
          data-role="tree-ctx-menu"
          role="menu"
          style={{ top: menu.y, left: menu.x }}
          className="fixed z-[9999] min-w-[172px] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-2xl"
          onMouseDown={(e) => e.stopPropagation()}
        >
          <MenuItem icon={<FilePlus className="h-3.5 w-3.5" />} label="新建文件" onClick={() => menuAction('create-file')} />
          <MenuItem icon={<FolderPlus className="h-3.5 w-3.5" />} label="新建文件夹" onClick={() => menuAction('create-folder')} />
          <li className="my-1 h-px bg-slate-100" />
          <MenuItem
            icon={<Pencil className="h-3.5 w-3.5" />}
            label="重命名"
            disabled={!menu.targetPath}
            onClick={() => menuAction('rename')}
          />
          <MenuItem
            icon={<Trash2 className="h-3.5 w-3.5" />}
            label="删除"
            danger
            disabled={!menu.targetPath}
            onClick={() => menuAction('delete')}
          />
        </ul>,
        document.body,
      )}
    </div>
  );
};

const MenuItem: React.FC<{
  icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean; disabled?: boolean;
}> = ({ icon, label, onClick, danger, disabled }) => (
  <li>
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors ${
        disabled
          ? 'cursor-not-allowed text-slate-300'
          : danger
            ? 'text-red-600 hover:bg-red-50'
            : 'text-slate-700 hover:bg-slate-100'
      }`}
    >
      <span className={`${disabled ? '' : 'text-slate-500'}`} aria-hidden>{icon}</span>
      <span className="text-xs">{label}</span>
    </button>
  </li>
);

interface TreeItemActionProps {
  pending: {
    kind: 'create-file' | 'create-folder' | 'rename';
    atPath: string;
    defaultValue?: string;
  } | null;
  setPending: React.Dispatch<React.SetStateAction<TreeItemActionProps['pending']>>;
  submitPending: (inputValue: string) => void;
}

const TreeItem: React.FC<{
  node: TreeNode;
  activeFile: string;
  onSelectFile: (path: string) => void;
} & TreeItemActionProps> = ({
  node, activeFile, onSelectFile, pending, setPending, submitPending,
}) => {
  const [isOpen, setIsOpen] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);
  // Why: 新建项立即插入后，此处 pending.atPath 与当前路径匹配则展示内联输入框。
  const isThisPendingRename = pending?.kind === 'rename' && pending.atPath === node.path;

  useEffect(() => {
    // 进入重命名态：自动选中扩展名之前（文件）或全选（文件夹）
    if (isThisPendingRename && inputRef.current) {
      inputRef.current.focus();
      if (node.isFolder) inputRef.current.select();
      else {
        const idx = node.name.lastIndexOf('.');
        inputRef.current.setSelectionRange(0, idx > 0 ? idx : node.name.length);
      }
    }
  }, [isThisPendingRename, node.isFolder, node.name.length]);

  const handleDragStart = (e: React.DragEvent) => {
    const pathData = node.isFolder && !node.path.endsWith('/')
      ? `${node.path}/`
      : node.path;
    e.dataTransfer.setData('text/plain', pathData);
    e.dataTransfer.setData('isFolder', node.isFolder ? 'true' : 'false');
  };

  // 节点是否包含"等待输入新建项的挂起输入框"（仅文件夹）
  const needsNewChildInput = node.isFolder && pending != null
    && (pending.kind === 'create-file' || pending.kind === 'create-folder')
    && (pending.atPath === (node.path.endsWith('/') ? node.path : `${node.path}/`));
  // 根级"新建"项的特殊判断——在根节点空白子项里渲染
  const isRootFolderSlot = node.path === '';

  if (node.isFolder) {
    return (
      <div className="space-y-0.5">
        <div
          data-node-path={node.path}
          data-node-kind="folder"
          draggable
          onDragStart={handleDragStart}
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center justify-between px-2 py-1.5 rounded-md hover:bg-slate-100 cursor-grab text-slate-700 transition group"
        >
          <div className="flex items-center gap-1.5 truncate">
            {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-slate-400" /> : <ChevronRight className="w-3.5 h-3.5 text-slate-400" />}
            {isOpen ? <FolderOpen className="w-3.5 h-3.5 text-amber-500" /> : <Folder className="w-3.5 h-3.5 text-amber-500" />}
            {isThisPendingRename ? (
              <InlineNameInput
                ref={inputRef}
                initialValue={pending?.defaultValue ?? node.name}
                onCancel={() => setPending(null)}
                onConfirm={submitPending}
              />
            ) : <span className="font-semibold text-slate-800">{node.name}</span>}
          </div>
          <span className="opacity-0 group-hover:opacity-100 text-[10px] text-slate-400 italic">右键</span>
        </div>

        {isOpen && node.children && (
          <div className="pl-3.5 border-l border-slate-200 ml-2 space-y-0.5">
            {node.children.map((child) => (
              <TreeItem
                key={child.path}
                node={child}
                activeFile={activeFile}
                onSelectFile={onSelectFile}
                pending={pending}
                setPending={setPending}
                submitPending={submitPending}
              />
            ))}
            {/* 在文件夹内部"新建"时，插入到 children 列表末尾 */}
            {needsNewChildInput && (
              <InlineNameInput
                autoFocus
                isFile={pending.kind === 'create-file'}
                initialValue={pending.defaultValue ?? ''}
                onCancel={() => setPending(null)}
                onConfirm={submitPending}
                prefixIcon={pending.kind === 'create-file'
                  ? <FileCode className="w-3.5 h-3.5 text-slate-400 mr-2" />
                  : <Folder className="w-3.5 h-3.5 text-amber-500 mr-2" />}
              />
            )}
          </div>
        )}

        {/* 根级"新建"：根目录没有外层容器，直接挂在第一个顶层节点下会有视觉问题，改为在容器里处理——此处忽略 */}
        {isRootFolderSlot && null}
      </div>
    );
  }

  // 文件节点
  const isActive = activeFile === node.path;
  return (
    <div
      data-node-path={node.path}
      data-node-kind="file"
      draggable
      onDragStart={handleDragStart}
      onClick={() => onSelectFile(node.path)}
      className={`flex items-center justify-between px-2 py-1.5 rounded-md cursor-grab transition ${
        isActive
          ? 'bg-blue-100 text-blue-800 font-semibold'
          : 'hover:bg-slate-100 text-slate-600'
      }`}
    >
      <div className="flex items-center gap-2 truncate min-w-0">
        <FileCode className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        {isThisPendingRename ? (
          <InlineNameInput
            ref={inputRef}
            initialValue={pending?.defaultValue ?? node.name}
            onCancel={() => setPending(null)}
            onConfirm={submitPending}
          />
        ) : <span className="truncate">{node.name}</span>}
      </div>
    </div>
  );
};

/** Why: 新建或重命名——内联 input 组件，统一处理 Enter 确认 / Esc 取消 / blur 自动确认。 */
interface InlineNameInputProps {
  initialValue: string;
  isFile?: boolean;
  prefixIcon?: React.ReactNode;
  autoFocus?: boolean;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

const InlineNameInput = React.forwardRef<HTMLInputElement, InlineNameInputProps>(function InlineNameInput({
  initialValue,
  prefixIcon,
  autoFocus,
  onConfirm,
  onCancel,
}, ref) {
  const [value, setValue] = useState(initialValue);
  return (
    <label className="flex flex-1 items-center gap-1 min-w-0">
      {prefixIcon}
      <input
        ref={ref}
        type="text"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onConfirm(value); }
          else if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
        }}
        onBlur={() => onConfirm(value)}
        onClick={(e) => e.stopPropagation()}
        className="flex-1 rounded border border-blue-400 bg-white px-1.5 py-0.5 text-xs font-mono outline-none focus:ring-2 focus:ring-blue-300"
      />
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onCancel(); }}
        aria-label="取消"
        className="rounded p-0.5 text-slate-400 hover:bg-slate-200 hover:text-slate-700"
      >
        <X className="h-3 w-3" />
      </button>
    </label>
  );
});

/**
 * Why: 根级新建项没有 TreeItem 对应，所以单独在 FileTreeExplorer 里渲染一层。
 * 在 FileTreeExplorer 出口通过 props.driledown 注入会过深；改为在 FileTreeExplorer 组件内部处理。
 * 这是一个独立的渲染辅助 hook：给定 pending 状态，如果是根级新建，就渲染 InlineNameInput。
 */
export const RootLevelNewItem: React.FC<TreeItemActionProps & { isRootEmpty: boolean }> = ({
  pending, setPending, submitPending, isRootEmpty,
}) => {
  if (!pending || pending.atPath !== '' || pending.kind === 'rename') return null;
  return (
    <div className="pl-2 py-1">
      <InlineNameInput
        autoFocus
        isFile={pending.kind === 'create-file'}
        initialValue={pending.defaultValue ?? ''}
        onCancel={() => setPending(null)}
        onConfirm={submitPending}
        prefixIcon={pending.kind === 'create-file'
          ? <FileCode className="w-3.5 h-3.5 text-slate-400 mr-2" />
          : <Folder className="w-3.5 h-3.5 text-amber-500 mr-2" />}
      />
    </div>
  );
};

/**
 * Why: VFS 是扁平的 path→content 映射，需要按路径分层构建嵌套 TreeNode 供树形渲染。
 * 空 VFS 返回空数组。文件夹 path 末尾统一带 '/'。
 */
export function buildTreeFromVFS(vfs: VirtualFileSystem): TreeNode[] {
  const root: Record<string, TreeNode> = {};
  const folderMap = new Map<string, TreeNode>();

  const ensureFolder = (folderPath: string): TreeNode => {
    if (folderMap.has(folderPath)) return folderMap.get(folderPath)!;

    const parts = folderPath.split('/').filter(Boolean);
    let currentPath = '';
    let parent: TreeNode | null = null;

    for (let i = 0; i < parts.length; i++) {
      currentPath += `${parts[i]}/`;
      if (folderMap.has(currentPath)) {
        parent = folderMap.get(currentPath)!;
        continue;
      }
      const node: TreeNode = {
        name: parts[i],
        path: currentPath,
        isFolder: true,
        children: [],
      };
      folderMap.set(currentPath, node);
      if (parent) {
        parent.children!.push(node);
      } else {
        root[parts[i]] = node;
      }
      parent = node;
    }
    return parent!;
  };

  Object.keys(vfs).forEach((filePath) => {
    const parts = filePath.split('/');
    if (parts.length === 1) {
      root[filePath] = {
        name: filePath,
        path: filePath,
        isFolder: false,
      };
      return;
    }
    const fileName = parts.pop()!;
    const folderPath = `${parts.join('/')}/`;
    const folderNode = ensureFolder(folderPath);
    folderNode.children!.push({
      name: fileName,
      path: filePath,
      isFolder: false,
    });
  });

  const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
    nodes.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((n) => {
      if (n.children) sortNodes(n.children);
    });
    return nodes;
  };

  return sortNodes(Object.values(root));
}
