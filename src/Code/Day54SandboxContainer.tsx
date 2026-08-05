import React, { useState, useRef } from 'react';
import { 
  FolderTree, Eye, Code2, Terminal, MousePointerClick, 
  Download, Sparkles, X, RefreshCw, History
} from 'lucide-react';
import { bundleVFS, exportSingleFile, VirtualFileSystem } from './vfsBundler';
import { 
  VersionSnapshot, createSnapshot, deepCopyVFS 
} from './versionManager';
import { VersionTimelineDrawer } from './VersionTimelineDrawer';

const INITIAL_VFS: VirtualFileSystem = {
  "index.html": `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>版本控制沙盒</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div className="hero">
    <h1>✦ 宇宙背景 (v1) ✦</h1>
    <p>支持版本快照与无损时光倒流</p>
  </div>
  <script src="main.js"></script>
</body>
</html>`,
  "styles.css": `body { margin:0; background:#090d16; color:#f8fafc; font-family:sans-serif; }
.hero { text-align:center; padding:5rem 2rem; }`,
  "main.js": `console.log("✅ v1 初始版本加载成功");`
};

export const Day54SandboxContainer: React.FC = () => {
  // VFS 状态
  const [vfs, setVfs] = useState<VirtualFileSystem>(INITIAL_VFS);
  const [activeFile, setActiveFile] = useState<string>('index.html');
  const [activeTab, setActiveTab] = useState<'preview' | 'code' | 'console'>('preview');

  // 第 54 天核心：版本快照历史栈
  const [snapshots, setSnapshots] = useState<VersionSnapshot[]>([
    createSnapshot(1, '需求1: 初始制作宇宙背景', INITIAL_VFS)
  ]);
  const [activeVersionId, setActiveVersionId] = useState<string>('v1');
  const [isTimelineOpen, setIsTimelineOpen] = useState<boolean>(false);

  // Inspector & Console 状态
  const [isInspectMode, setIsInspectMode] = useState<boolean>(false);
  const [selectedElement, setSelectedElement] = useState<Record<string, string> | null>(null);
  const [consoleLogs] = useState<Array<{ id: string; level: string; args: string[] }>>([]);
  const [instruction, setInstruction] = useState<string>('');
  const [isModifying, setIsModifying] = useState<boolean>(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);

  // 1. 自动拍摄快照辅助函数
  const pushNewSnapshot = (summary: string, newVfs: VirtualFileSystem) => {
    const nextVerNum = snapshots.length + 1;
    const newSnap = createSnapshot(nextVerNum, summary, newVfs);
    setSnapshots(prev => [...prev, newSnap]);
    setActiveVersionId(newSnap.versionId);
  };

  // 2. 触发时光倒流回滚
  const handleRollback = (targetSnap: VersionSnapshot) => {
    setVfs(deepCopyVFS(targetSnap.vfs));
    setActiveVersionId(targetSnap.versionId);
    setSelectedElement(null);
    console.log(`✅ 已成功时光倒流回滚至版本: ${targetSnap.versionId} (${targetSnap.summary})`);
  };

  // 3. 增量修改代码并自动拍摄快照
  const handleModifyVFS = async () => {
    if (!instruction.trim()) return;
    setIsModifying(true);

    try {
      const response = await fetch('http://localhost:8000/api/modify_vfs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vfs: vfs,
          instruction: instruction,
          target_element: selectedElement,
          active_file: activeFile
        })
      });

      const data = await response.json();
      if (data.updated_vfs) {
        const newVfs = data.updated_vfs;
        setVfs(newVfs);
        
        // 【核心】：修改成功后自动拍摄版本快照！
        pushNewSnapshot(instruction, newVfs);

        setInstruction('');
        setSelectedElement(null);
      }
    } catch (err) {
      console.error('修改代码失败:', err);
    } finally {
      setIsModifying(false);
    }
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      
      {/* 左侧文件树面板 */}
      <div className="w-56 bg-slate-900 border-r border-slate-800 flex flex-col">
        <div className="p-3 border-b border-slate-800 flex items-center justify-between text-xs text-slate-300 font-semibold">
          <span className="flex items-center gap-1.5">
            <FolderTree className="w-4 h-4 text-emerald-400" /> 项目文件树
          </span>
          <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded font-mono">
            {Object.keys(vfs).length} 个文件
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {Object.keys(vfs).map(filePath => (
            <button
              key={filePath}
              onClick={() => { setActiveFile(filePath); setActiveTab('code'); }}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-mono transition text-left ${
                activeFile === filePath && activeTab === 'code'
                  ? 'bg-emerald-500/20 text-emerald-300 font-semibold border border-emerald-500/30'
                  : 'hover:bg-slate-800/60 text-slate-400'
              }`}
            >
              <span className="truncate">{filePath}</span>
            </button>
          ))}
        </div>

        <div className="p-3 border-t border-slate-800 space-y-2">
          <button
            onClick={() => exportSingleFile(`${activeVersionId}_project.html`, bundleVFS(vfs))}
            className="w-full flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-2 rounded-lg text-xs transition font-medium"
          >
            <Download className="w-3.5 h-3.5" /> 打包导出 (.html)
          </button>
        </div>
      </div>

      {/* 右侧主工作区 */}
      <div className="flex-1 flex flex-col min-w-0">
        
        {/* 工具栏 Header */}
        <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-800">
          <div className="flex items-center gap-2">
            {/* 第 54 天核心入口：版本历史与时光倒流按钮 */}
            <button
              onClick={() => setIsTimelineOpen(true)}
              className="flex items-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-emerald-400 border border-emerald-500/30 px-3 py-1 rounded-lg text-xs font-medium transition"
            >
              <History className="w-3.5 h-3.5" />
              版本历史 <span className="font-mono font-bold bg-emerald-500/20 px-1.5 rounded text-[10px]">{activeVersionId}</span>
            </button>

            <span className="text-slate-800">|</span>

            {/* 检查元素与视图切换 */}
            <button
              onClick={() => setIsInspectMode(!isInspectMode)}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition border ${
                isInspectMode ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50' : 'bg-slate-800 text-slate-300 border-slate-700'
              }`}
            >
              <MousePointerClick className="w-3.5 h-3.5" />
              {isInspectMode ? '选择 DOM 元素...' : '🎯 检查元素'}
            </button>

            <button
              onClick={() => setActiveTab('preview')}
              className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs ${activeTab === 'preview' ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400'}`}
            >
              <Eye className="w-3.5 h-3.5" /> 预览
            </button>
            <button
              onClick={() => setActiveTab('code')}
              className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs ${activeTab === 'code' ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400'}`}
            >
              <Code2 className="w-3.5 h-3.5" /> 源码 ({activeFile})
            </button>
            <button
              onClick={() => setActiveTab('console')}
              className={`flex items-center gap-1 px-3 py-1 rounded-lg text-xs ${activeTab === 'console' ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400'}`}
            >
              <Terminal className="w-3.5 h-3.5" /> 控制台
            </button>
          </div>

          <span className="text-[11px] font-mono text-slate-500">
            当前应用版本: <span className="text-slate-300 font-bold">{activeVersionId}</span>
          </span>
        </div>

        {/* 内容平铺区 */}
        <div className="flex-1 bg-slate-950 relative overflow-hidden">
          <div className={`w-full h-full ${activeTab === 'preview' ? 'block' : 'hidden'}`}>
            <iframe
              ref={iframeRef}
              srcDoc={bundleVFS(vfs)}
              title="Version Sandbox"
              className="w-full h-full border-none"
              sandbox="allow-scripts allow-modals allow-same-origin"
            />
          </div>

          {activeTab === 'code' && (
            <textarea
              value={vfs[activeFile] || ''}
              onChange={e => {
                const newVfs = { ...vfs, [activeFile]: e.target.value };
                setVfs(newVfs);
              }}
              className="w-full h-full bg-slate-950 p-4 font-mono text-xs text-slate-200 resize-none focus:outline-none"
            />
          )}

          {activeTab === 'console' && (
            <div className="w-full h-full p-4 overflow-auto font-mono text-xs space-y-1">
              {consoleLogs.map(log => (
                <div key={log.id} className="text-slate-300 border-b border-slate-900 pb-1">
                  <span className="text-emerald-400">[{log.level}]</span> {log.args.join(' ')}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 底栏增量修改输入框 */}
        <div className="p-3 bg-slate-900 border-t border-slate-800 space-y-2">
          {selectedElement && (
            <div className="flex items-center justify-between px-3 py-1 bg-emerald-950/40 border border-emerald-500/30 rounded text-xs text-emerald-300">
              <span>已选中: {selectedElement.tagName}.{selectedElement.className}</span>
              <button onClick={() => setSelectedElement(null)}><X className="w-3 h-3" /></button>
            </div>
          )}

          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder={`在 ${activeVersionId} 版本的基础上输入增量修改要求（提交后将自动创建新快照）...`}
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleModifyVFS()}
              className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
            />
            <button
              onClick={handleModifyVFS}
              disabled={isModifying || !instruction.trim()}
              className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-medium"
            >
              {isModifying ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              应用修改并创建快照
            </button>
          </div>
        </div>

      </div>

      {/* 第 54 天时间线抽屉组件 */}
      <VersionTimelineDrawer
        isOpen={isTimelineOpen}
        onClose={() => setIsTimelineOpen(false)}
        snapshots={snapshots}
        activeVersionId={activeVersionId}
        onRollback={handleRollback}
      />

    </div>
  );
};
