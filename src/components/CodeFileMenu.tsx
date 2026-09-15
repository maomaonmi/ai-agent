'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronRight, FilePlus2, FolderOpen, Monitor } from 'lucide-react';

export interface CodeFileMenuProps {
  onNewTextFile: () => void;
  onNewFile: () => void;
  onNewWindow: () => void;
  onOpenFile: () => void;
  onOpenFolder: () => void;
  onOpenWorkspace: () => void;
  onOpenRecent: () => void;
  onAddFolderToWorkspace: () => void;
  onSaveWorkspaceAs: () => void;
  onCopyWorkspace: () => void;
}

type MenuItemProps = {
  label: string;
  shortcut?: string;
  icon?: React.ReactNode;
  trailing?: React.ReactNode;
  onClick?: () => void;
};

function MenuItem({ label, shortcut, icon, trailing, onClick }: MenuItemProps) {
  return (
    <li>
      <button
        type="button"
        role="menuitem"
        onClick={onClick}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-slate-700 transition-colors hover:bg-slate-100 focus-visible:bg-slate-100 focus-visible:outline-none"
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center text-slate-500">{icon}</span>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {shortcut && <kbd className="shrink-0 rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] text-slate-500">{shortcut}</kbd>}
        {trailing}
      </button>
    </li>
  );
}

export default function CodeFileMenu({
  onNewTextFile,
  onNewFile,
  onNewWindow,
  onOpenFile,
  onOpenFolder,
  onOpenWorkspace,
  onOpenRecent,
  onAddFolderToWorkspace,
  onSaveWorkspaceAs,
  onCopyWorkspace,
}: CodeFileMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const run = (action: () => void) => {
    setIsOpen(false);
    action();
  };

  return (
    <div ref={menuRef} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((value) => !value)}
        className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${isOpen ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}
      >
        文件(F)
      </button>
      {isOpen && (
        <div role="menu" aria-label="文件菜单" className="absolute left-0 top-full z-[80] mt-1 w-[342px] overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-xl">
          <MenuItem label="新建文本文档" shortcut="Alt + Insert" icon={<FilePlus2 className="h-4 w-4" />} onClick={() => run(onNewTextFile)} />
          <MenuItem label="新建文件..." shortcut="Ctrl + Alt + Windows + N" icon={<FilePlus2 className="h-4 w-4" />} onClick={() => run(onNewFile)} />
          <MenuItem label="新建窗口" icon={<Monitor className="h-4 w-4" />} onClick={() => run(onNewWindow)} />
          <li aria-hidden="true" className="my-1 h-px bg-slate-100" />
          <MenuItem label="使用配置文件新建窗口" trailing={<ChevronRight className="h-4 w-4 text-slate-400" />} />
          <li aria-hidden="true" className="my-1 h-px bg-slate-100" />
          <MenuItem label="打开文件..." shortcut="Ctrl + O" icon={<FolderOpen className="h-4 w-4" />} onClick={() => run(onOpenFile)} />
          <MenuItem label="打开文件夹..." shortcut="Ctrl + K  Ctrl + O" icon={<FolderOpen className="h-4 w-4" />} onClick={() => run(onOpenFolder)} />
          <MenuItem label="从文件打开工作区..." icon={<FolderOpen className="h-4 w-4" />} onClick={() => run(onOpenWorkspace)} />
          <MenuItem label="打开最近的文件" trailing={<ChevronRight className="h-4 w-4 text-slate-400" />} onClick={() => run(onOpenRecent)} />
          <li aria-hidden="true" className="my-1 h-px bg-slate-100" />
          <MenuItem label="将文件夹添加到工作区..." icon={<FolderOpen className="h-4 w-4" />} onClick={() => run(onAddFolderToWorkspace)} />
          <MenuItem label="将工作区另存为..." onClick={() => run(onSaveWorkspaceAs)} />
          <MenuItem label="复制工作区" onClick={() => run(onCopyWorkspace)} />
        </div>
      )}
    </div>
  );
}
