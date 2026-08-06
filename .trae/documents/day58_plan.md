# Day 58 实施方案：树状资源管理器 + 拖拽上下文 + 目录级剪枝

## 1. 现状分析

### 1.1 用户截图标注位置

```
Header 顶部工具栏 (L765-L893)
├── 左侧标题："网页沙盒 · iframe 隔离渲染"
└── 右侧按钮区 ←【箭头指向的位置】：把"树形/列表"切换按钮放这里
    ├── 状态文字 (正在生成...)
    ├── 终止自动修复按钮
    ├── 📜 版本历史按钮
    ├── 前端/全栈切换
    ├── 预览/源代码切换
    ├── 📦 导出ZIP / 保存到workspace
    └── 全屏 / 检查元素

左侧面板 aside (L899-L1430)
├── 项目文件区 ←【红框位置】：扁平列表直接移除，换成树状视图（默认树形，不需要保留列表视图）
│   └── {Object.keys(vfs).map(...)} —— 旧平铺按钮列表（删除！）
├── 用户需求历史区 (保持不变)
├── Python测试子Agent区 (保持不变)
├── 自动修复记录区 (保持不变)
└── 底部输入表单 form (增强拖拽和@folder)
```

***

## 2. 架构设计

### 2.1 整体数据流

```mermaid
flowchart LR
    A[用户点击顶部Header按钮] --> B{视图模式}
    B -->|树形| C[FileTreeExplorer渲染<br/>替换红框位置]
    B -->|列表| D[旧扁平列表<br/>仅作为兼容保留]
    
    C -->|拖拽文件/文件夹| E[表单区域DragOver高亮]
    E -->|Drop释放| F[生成Badge 📄/📁]
    
    G[输入框输入@] --> H[@file/@folder混合下拉]
    H -->|选中| F
    
    F --> I[mentionedPaths状态更新]
    I --> J[POST /api/modify_selective]
    
    J --> K[后端 is_file_in_mentioned_paths 前缀匹配]
    K -->|目录内文件| L[全量代码保留]
    K -->|其他文件| M[路径占位符剪枝 90%]
```

### 2.2 模块职责

| 模块             | 文件                                           | 关键改动                                      |
| -------------- | -------------------------------------------- | ----------------------------------------- |
| **切换按钮**       | `CodeWorkspace.tsx` Header区                  | 新增"🌳 文件树"开关按钮，放在【箭头位置】                   |
| **文件树渲染**      | `CodeWorkspace.tsx` + `FileTreeExplorer.tsx` | 红框位置直接替换为 FileTreeExplorer，**默认树形不显示旧列表** |
| **拖拽目标**       | `CodeWorkspace.tsx` 表单form外层                 | onDragOver高亮 + onDrop生成Badge              |
| **@folder 补全** | `CodeWorkspace.tsx` @浮层                      | 候选列表混合文件+文件夹路径                            |
| **状态层**        | `ChatInterface.tsx`                          | mentionedFiles 变量名不变，承载文件+文件夹             |
| **后端剪枝**       | `App.py`                                     | 升级 build\_pruned\_vfs，支持目录前缀匹配            |

***

## 3. 具体修改方案

### 3.1 前端：CodeWorkspace.tsx 顶部 Header 增加切换按钮（箭头位置）

**位置：L892 之前（header闭合标签** **`</header>`** **前，按钮区最左侧或合适位置）**

```typescript
// === 新增状态：是否启用树状文件视图 ===
const [useFileTreeView, setUseFileTreeView] = useState(true); // 默认true = 树形

// === 在 header 右侧按钮区 (大约 L770-L892 之间)，与其他按钮同排 ===
// 推荐放在 "📜 版本历史" 按钮之前或者之后：
<header className="flex min-h-12 flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2">
  <h2>网页沙盒...</h2>
  
  <div className="flex flex-wrap items-center justify-end gap-2">
    {/* ====== 【箭头位置】新增：树状视图切换按钮 ====== */}
    <button
      type="button"
      aria-pressed={useFileTreeView}
      onClick={() => setUseFileTreeView((v) => !v)}
      className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
        useFileTreeView
          ? 'border-emerald-500 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
          : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100'
      }`}
    >
      {useFileTreeView ? '🌳 树形文件' : '📋 列表文件'}
    </button>

    {/* ... 原有状态文字、终止按钮、版本历史、前端/全栈、预览/源码... 保持不变 ... */}
  </div>
</header>
```

### 3.2 前端：项目文件区（红框 L904-L934）直接替换为树

**删除旧的扁平列表（Object.keys(vfs).map 那整块），替换为：**

```typescript
<div className="mb-5">
  <div className="mb-2 flex items-center justify-between">
    <h3 className="text-sm font-semibold text-slate-800">项目文件</h3>
    <span className="text-xs text-slate-400">{Object.keys(vfs).length} 个</span>
  </div>

  {status.state === 'generating' && !hasProject ? (
    <div className="rounded-lg border border-dashed border-blue-300 bg-blue-50 px-4 py-6 text-center">
      <p className="text-xs font-medium text-blue-700">正在生成文件…</p>
    </div>
  ) : hasProject ? (
    /* ===== 红框位置：根据 useFileTreeView 条件渲染 ===== */
    useFileTreeView ? (
      // 默认：树状视图（FileTreeExplorer）
      <FileTreeExplorer
        treeData={buildTreeFromVFS(vfs)}
        activeFile={activeFile}
        onSelectFile={(path) => { setActiveFile(path); setActiveView('source'); }}
      />
    ) : (
      // 兼容回退：旧扁平列表（用户说"不需要了"，这里作为保底可后续删除）
      <div className="space-y-1">
        {Object.keys(vfs).map((file) => (
          <button
            key={file}
            type="button"
            onClick={() => { setActiveFile(file); setActiveView('source'); }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left font-mono text-xs hover:bg-slate-200 text-slate-600"
          >
            <span>{file.endsWith('.css') ? '🎨' : file.endsWith('.js') ? '⚡' : '📄'}</span>
            <span className="truncate">{file}</span>
          </button>
        ))}
      </div>
    )
  ) : (
    <p className="text-xs leading-5 text-slate-500">生成网页后会自动拆分为 HTML、CSS 与 JS 文件。</p>
  )}
  {archiveState && <p role="status" className="mt-2 break-all text-xs text-slate-500">{archiveState}</p>}
</div>
```

### 3.3 前端：表单区域增强拖拽（L1276-L1429 form 外层）

```typescript
// === 新增 isDragOver 状态 ===
const [isDragOver, setIsDragOver] = useState(false);
const mentionedPaths = mentionedFiles; // 语义扩展：文件 + 文件夹路径

// === form 外层包裹一个 div 处理拖拽事件 ===
<div
  onDragOver={(e) => {
    e.preventDefault();
    if (!isDragOver) setIsDragOver(true);
  }}
  onDragLeave={(e) => {
    // 避免子元素冒泡导致频繁切换：检查 relatedTarget 是否在容器内
    const target = e.currentTarget;
    const related = e.relatedTarget as Node | null;
    if (related && target.contains(related)) return;
    setIsDragOver(false);
  }}
  onDrop={(e) => {
    e.preventDefault();
    setIsDragOver(false);
    const path = e.dataTransfer.getData('text/plain');
    if (path && !mentionedPaths.includes(path) && onMentionedFilesChange) {
      onMentionedFilesChange([...mentionedPaths, path]);
    }
  }}
  className={`border-t border-slate-200 bg-white p-3 transition-all duration-150 ${
    isDragOver ? 'ring-2 ring-emerald-500 bg-emerald-50/60' : ''
  }`}
>
  {/* 拖拽悬浮遮罩提示 */}
  {isDragOver && (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-lg border-2 border-dashed border-emerald-500 bg-emerald-100/70 backdrop-blur-[1px]">
      <div className="flex items-center gap-2 text-emerald-700 font-semibold text-sm">
        <span className="text-xl animate-bounce">📥</span>
        松开鼠标挂载到聚焦上下文
      </div>
    </div>
  )}

  {/* === Badge 区升级为文件夹/文件双图标 === */}
  {hasProject && mentionedPaths.length > 0 && (
    <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] text-slate-500 font-medium">修改范围:</span>
      {mentionedPaths.map((p) => {
        const lastSeg = p.split('/').pop() ?? '';
        const isFolder = p.endsWith('/') || !lastSeg.includes('.');
        return (
          <div
            key={p}
            className="flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 font-mono text-xs text-blue-700"
          >
            {/* 文件夹用 📁 amber，文件用 📄 blue */}
            {isFolder ? <Folder className="h-3 w-3 text-amber-500" /> : <FileCode className="h-3 w-3 text-blue-500" />}
            <span>{p}</span>
            <button type="button" onClick={() => removeMentionedFile(p)} aria-label={`移除 ${p}`}>
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  )}

  {/* === @ 浮层升级：候选包含文件 + 文件夹 === */}
  {/* ... 见 3.4 ... */}

  <form onSubmit={onSubmit}>
    {/* === 原有 modelControl、选中元素、textarea、提交按钮保持不变 === */}
    {/* textarea 的 placeholder 更新提示："(敲 @ 或从上方拖拽 可指定文件/文件夹)" */}
  </form>
</div>
```

**注意**：上面拖拽容器是 relative 吗？需要给包裹 div 加 `relative` 以便绝对定位悬浮提示。

### 3.4 前端：@ 下拉升级为文件+文件夹混合

```typescript
// 替换 L213-L219 的 allVfsFiles / filteredVfsFiles：

// === allVfsPaths = 所有文件路径 + 推导出来的中间目录 ===
const allVfsPaths = useMemo<string[]>(() => {
  const files = Object.keys(vfs);
  const folders = new Set<string>();
  files.forEach((f) => {
    const parts = f.split('/');
    // frontend/index.html → frontend/ 目录
    // src/components/Button.tsx → src/, src/components/
    for (let i = 1; i < parts.length; i++) {
      folders.add(`${parts.slice(0, i).join('/')}/`);
    }
  });
  // 目录在前，文件在后，都按字典序排
  return [...Array.from(folders).sort(), ...files.sort()];
}, [vfs]);

// === 过滤：排除已选 + 关键词匹配 ===
const filteredVfsPaths = useMemo(
  () => allVfsPaths.filter(
    (p) => p.toLowerCase().includes(fileFilterText.toLowerCase())
          && !mentionedFiles.includes(p)
  ),
  [allVfsPaths, fileFilterText, mentionedFiles],
);

// === L1367-L1391 的浮层渲染，每个候选项判断文件夹图标 ===
{showFileDropdown && hasProject && filteredVfsPaths.length > 0 && (
  <div className="absolute bottom-full left-0 z-30 mb-2 w-80 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
    <div className="flex items-center justify-between border-b border-slate-100 px-2 py-1.5 text-[11px] font-semibold text-slate-500">
      <span>选择聚焦路径 (↑↓ Enter/Tab 确认)</span>
      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px]">@file / @folder</span>
    </div>
    <div className="max-h-48 overflow-y-auto p-1">
      {filteredVfsPaths.map((p, idx) => {
        const lastSeg = p.split('/').pop() ?? '';
        const isFolder = p.endsWith('/') || !lastSeg.includes('.');
        return (
          <button
            key={p}
            type="button"
            onClick={() => selectMentionedFile(p)}
            className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left font-mono text-xs transition-colors ${
              idx === fileDropdownIndex
                ? 'bg-blue-100 font-semibold text-blue-800'
                : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            {/* 文件夹图标区分 */}
            {isFolder
              ? <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              : <FileCode className="h-3.5 w-3.5 shrink-0 text-slate-400" />}
            <span className="truncate">{p}</span>
          </button>
        );
      })}
    </div>
  </div>
)}
```

### 3.5 前端：FileTreeExplorer.tsx 适配 light theme + 导出 buildTreeFromVFS

```typescript
// 样式调整：背景从 slate-900 → 透明/白色（因为父容器已经有 bg）
export const FileTreeExplorer: React.FC<FileTreeExplorerProps> = ({...}) => {
  return (
    <div className="w-full max-h-80 overflow-y-auto select-none text-xs font-mono space-y-0.5">
      {/* 去掉 bg-slate-900 border-slate-800；与 CodeWorkspace light 风格统一 */}
    </div>
  );
};

// TreeItem 样式：文件夹 node hover 从 hover:bg-slate-800/80 → hover:bg-slate-100
// 文件 node active 从 bg-emerald-500/20 → bg-blue-100 text-blue-800（与 CodeWorkspace 其他高亮一致）

// === 【新增导出】 VFS 对象 → TreeNode 树结构 ===
import type { VirtualFileSystem } from './vfsBundler';

export interface TreeNode {
  name: string;
  path: string;       // 文件夹时末尾统一带 '/'
  isFolder: boolean;
  children?: TreeNode[];
}

/**
 * Why: 路径分层构建树，前端渲染可展开/收起。
 * 空 VFS 返回空数组。重复路径自动去重。
 */
export function buildTreeFromVFS(vfs: VirtualFileSystem): TreeNode[] {
  const root: Record<string, TreeNode> = {};
  const folderMap = new Map<string, TreeNode>();

  const ensureFolder = (folderPath: string): TreeNode => {
    // folderPath: 例如 "frontend/" 或 "src/components/"
    if (folderMap.has(folderPath)) return folderMap.get(folderPath)!;

    const parts = folderPath.split('/').filter(Boolean); // ['frontend'] 或 ['src','components']
    let currentPath = '';
    let parent: TreeNode | null = null;
    let container = root;

    for (let i = 0; i < parts.length; i++) {
      currentPath += `${parts[i]}/`;
      if (folderMap.has(currentPath)) {
        parent = folderMap.get(currentPath)!;
        container = Object.fromEntries(
          (parent.children ?? []).map((c) => [c.name, c])
        ) as unknown as Record<string, TreeNode>;
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
      container = {};
    }
    return parent!;
  };

  Object.keys(vfs).forEach((filePath) => {
    const parts = filePath.split('/');
    if (parts.length === 1) {
      // 根级文件：index.html
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

  return Object.values(root).sort((a, b) => {
    // 文件夹在前，文件在后；同类型按 name 排序
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
```

### 3.6 后端：App.py 升级 build\_pruned\_vfs 支持目录前缀匹配

```python
# 在 App.py 中找到 Day57 已有的 build_pruned_vfs，替换判断逻辑：

from typing import List

def is_file_in_mentioned_paths(filepath: str, mentioned_paths: List[str]) -> bool:
    """
    Day58 核心判断：文件是否属于被选中的路径范围。
    - mentioned_paths 为空 → 全部保留 (不剪枝)
    - 精确匹配文件路径 → 保留
    - 属于 mentioned 文件夹的子路径 → 保留
      (规范化为末尾带 '/' 后 startswith，避免 src/ 误匹配 src2/)
    """
    if not mentioned_paths:
        return True
    for p in mentioned_paths:
        # 规范化：确保目录路径末尾带 '/'
        normalized = p if p.endswith("/") else f"{p}/"
        if filepath == p or filepath.startswith(normalized):
            return True
    return False


# 原来的 build_pruned_vfs 中把精确匹配改成上面的函数：
def build_pruned_vfs(vfs: dict, mentioned_files: List[str] | None = None) -> str:
    """
    VFS + mentioned_paths → 剪枝后的 JSON 字符串。
    mentioned_paths 中可含文件路径或文件夹路径 (如 'src/components/')。
    未命中的文件保留占位注释，命中的发送全量 content。
    """
    targets = mentioned_files or []
    if not targets:
        return json.dumps(vfs, ensure_ascii=False, indent=2)

    pruned: dict[str, str] = {}
    for filepath, content in vfs.items():
        if is_file_in_mentioned_paths(filepath, targets):
            pruned[filepath] = content
        else:
            # 占位符：避免模型看到占位就不输出，但又不消耗 token
            ext = filepath.rsplit(".", 1)[-1]
            comment_prefix = "//" if ext in {"js", "ts", "tsx", "jsx", "css", "java", "c", "cpp", "h"} else "#"
            if ext.startswith("htm"):
                pruned[filepath] = f"<!-- [已剪枝的非聚焦文件] {filepath} -->"
            elif ext == "py":
                pruned[filepath] = f"# [已剪枝的非聚焦文件]: {filepath}"
            else:
                pruned[filepath] = f"{comment_prefix} [已剪枝的非聚焦文件]: {filepath}"
    return json.dumps(pruned, ensure_ascii=False, indent=2)
```

**提示**：同时在 prompt 里把 mentioned\_paths 注入 focus\_rule，明确告诉模型"只修改这些路径下的文件"。

***

## 4. 风险与应对

| 风险                              | 概率 | 影响 | 应对                                                              |
| ------------------------------- | -- | -- | --------------------------------------------------------------- |
| `src/` 前缀匹配误伤 `src2/`           | 中  | 高  | 规范化强制末尾 `/` 再 startswith                                        |
| 拖拽 drop 与 textarea 粘贴事件冲突       | 低  | 中  | drop 只在外层 div 处理；textarea 自身不监听 drop                            |
| buildTreeFromVFS 路径分割跨平台        | 中  | 中  | 只按 `/` 分割，VFS key 内部就是 POSIX 风格                                 |
| 空目录下没有文件时，树里看不到该目录              | 低  | 低  | VFS 中只有 file key，空目录本来就不存在，合理                                   |
| Header 按钮过多换行影响美观               | 中  | 低  | `flex-wrap` 已开；必要时合并"版本历史+导出ZIP"的间距                             |
| Day57 mentioned\_files 纯文件语义被破坏 | 中  | 中  | 后端用 `is_file_in_mentioned_paths` 兼容——纯文件路径也是精确匹配，无 break change |

***

## 5. 实施步骤（6 步）

1. **FileTreeExplorer.tsx 升级**

   * 样式改为 light theme

   * 导出 `buildTreeFromVFS` + 路径规范化 `/` 结尾

   * DoD: tsc 通过；单元验证 buildTreeFromVFS({frontend/index.html, frontend/app.js}) 产出 1 个 folder + 2 个 file 节点

2. **CodeWorkspace.tsx Header 按钮区**

   * 新增 `useFileTreeView` 状态

   * 顶部新增 "🌳 树形文件 / 📋 列表文件" 切换按钮（【箭头位置】）

   * DoD: 按钮可点击切换 aria-pressed

3. **CodeWorkspace.tsx 项目文件区（红框）替换**

   * 删除旧平铺列表，改为根据 `useFileTreeView` 渲染 FileTreeExplorer

   * 默认 `useFileTreeView = true`（用户要求红框列表不需要了）

   * DoD: 生成全栈项目后，frontend/backend 目录树正确展开/收起

4. **CodeWorkspace.tsx 表单拖拽增强**

   * 外层 div onDragOver/onDragLeave/onDrop

   * Badge 区 📁/📄 图标区分

   * DoD: 从树拖 `frontend/`、`frontend/app.js` 到输入框，分别生成文件夹/文件 Badge

5. **CodeWorkspace.tsx @ 下拉升级**

   * allVfsPaths 推导目录 + 文件

   * 每项渲染 Folder/FileCode 图标

   * DoD: 输入 @ 能看到 `frontend/` 等目录候选项，选中正确生成 Badge

6. **App.py 剪枝升级**

   * `is_file_in_mentioned_paths` 替换原精确匹配

   * build\_pruned\_vfs 根据扩展名生成占位注释

   * prompt 中注入 mentioned\_paths

   * DoD: Python 单元测试：给定 `['src/components/']`，验证 `src/components/Button.tsx` 全量，`src/utils.ts` 占位

最后：`tsc --noEmit` + `python -c "import App"` 过。
