import React, { useState, useEffect, useRef } from 'react';
import { 
  FileCode, FolderTree, Eye, Code2, Terminal, MousePointerClick, 
  Download, Sparkles, X, RefreshCw 
} from 'lucide-react';
import { bundleVFS, exportSingleFile, VirtualFileSystem } from './vfsBundler';

// 初始默认 VFS 项目
const INITIAL_VFS: VirtualFileSystem = {
  "index.html": `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>多文件项目沙盒</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div className="container">
    <header className="hero">
      <h1>🚀 多文件 VFS 项目工作区</h1>
      <p>模块化 HTML、CSS 与 JS 自动合并打包预览</p>
      <button id="cta-btn" className="btn">开始体验</button>
    </header>
  </div>
  <script src="main.js"></script>
</body>
</html>`,
  "styles.css": `body {
  margin: 0;
  background-color: #0f172a;
  color: #f8fafc;
  font-family: system-ui, sans-serif;
}

.container {
  max-width: 800px;
  margin: 0 auto;
  padding: 2rem;
  text-align: center;
}

.hero {
  padding: 3rem;
  background: linear-gradient(135deg, #1e293b, #0f172a);
  border: 1px solid #334155;
  border-radius: 1rem;
}

.btn {
  background-color: #10b981;
  color: white;
  border: none;
  padding: 0.75rem 1.5rem;
  border-radius: 0.5rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}

.btn:hover {
  background-color: #059669;
  transform: translateY(-2px);
}`,
  "main.js": `console.log("✅ 简·宣传网站已加载 - 多文件模块模式");

document.getElementById('cta-btn')?.addEventListener('click', () => {
  alert('🎉 多文件 VFS 交互响应成功！');
  console.log("用户点击了行动按钮");
});`
};

export const MultiFileSandboxContainer: React.FC = () => {
  const [vfs, setVfs] = useState<VirtualFileSystem>(INITIAL_VFS);
  const [activeFile, setActiveFile] = useState<string>('index.html');
  const [activeTab, setActiveTab] = useState<'preview' | 'code' | 'console'>('preview');
  
  const [isInspectMode, setIsInspectMode] = useState<boolean>(false);
  const [selectedElement, setSelectedElement] = useState<Record<string, string> | null>(null);
  const [consoleLogs, setConsoleLogs] = useState<Array<{ id: string; level: string; args: string[]; timestamp: string }>>([]);
  const [instruction, setInstruction] = useState<string>('');
  const [isModifying, setIsModifying] = useState<boolean>(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);

  // 1. 监听来自 iframe 的 Console 和 Inspector 事件
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const { type, payload } = event.data || {};
      if (type === 'SANDBOX_CONSOLE') {
        setConsoleLogs(prev => [...prev.slice(-100), {
          id: Math.random().toString(36).substring(2, 9),
          ...payload
        }]);
      }
      if (type === 'ELEMENT_SELECTED') {
        setSelectedElement(payload);
        setIsInspectMode(false);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // 2. 切换检查模式
  const toggleInspectMode = () => {
    const nextState = !isInspectMode;
    setIsInspectMode(nextState);
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({
        type: 'TOGGLE_INSPECT_MODE',
        enabled: nextState
      }, '*');
    }
  };

  // 3. 增量修改多文件 VFS
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
        setVfs(data.updated_vfs);
        setInstruction('');
        setSelectedElement(null);
      }
    } catch (err) {
      console.error('多文件修改失败:', err);
    } finally {
      setIsModifying(false);
    }
  };

  // 4. 打包导出全部文件为 HTML 项目文件
  const handleExportProject = () => {
    const bundledCode = bundleVFS(vfs);
    exportSingleFile(`project_${Date.now()}.html`, bundledCode);
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      
      {/* 1. 左侧项目文件树侧边栏 (File Tree Panel) */}
      <div className="w-56 bg-slate-900 border-r border-slate-800 flex flex-col">
        <div className="p-3 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold text-xs text-slate-300">
            <FolderTree className="w-4 h-4 text-emerald-400" /> 项目文件树
          </div>
          <span className="text-[10px] bg-slate-800 text-slate-400 px-1.5 py-0.5 rounded">
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
              <FileCode className="w-3.5 h-3.5 text-slate-500" />
              <span className="truncate">{filePath}</span>
            </button>
          ))}
        </div>

        <div className="p-3 border-t border-slate-800">
          <button
            onClick={handleExportProject}
            className="w-full flex items-center justify-center gap-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 px-3 py-2 rounded-lg text-xs font-medium transition"
          >
            <Download className="w-3.5 h-3.5" /> 导出项目 (.html)
          </button>
        </div>
      </div>

      {/* 2. 主区域 (沙盒预览 + 代码编辑器 + 控制台) */}
      <div className="flex-1 flex flex-col min-w-0">
        
        {/* 控制顶栏 */}
        <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <button
              onClick={toggleInspectMode}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium transition border ${
                isInspectMode
                  ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
              }`}
            >
              <MousePointerClick className="w-3.5 h-3.5" />
              {isInspectMode ? '选择 DOM 元素...' : '🎯 检查元素'}
            </button>

            <span className="text-slate-800">|</span>

            <button
              onClick={() => setActiveTab('preview')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs transition ${
                activeTab === 'preview' ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400'
              }`}
            >
              <Eye className="w-3.5 h-3.5" /> 实时沙盒预览
            </button>

            <button
              onClick={() => setActiveTab('code')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs transition ${
                activeTab === 'code' ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400'
              }`}
            >
              <Code2 className="w-3.5 h-3.5" /> 源码 ({activeFile})
            </button>

            <button
              onClick={() => setActiveTab('console')}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs transition ${
                activeTab === 'console' ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400'
              }`}
            >
              <Terminal className="w-3.5 h-3.5" /> 控制台 ({consoleLogs.length})
            </button>
          </div>
        </div>

        {/* 内容平铺区 */}
        <div className="flex-1 bg-slate-950 relative overflow-hidden">
          {/* 沙盒 iframe */}
          <div className={`w-full h-full ${activeTab === 'preview' ? 'block' : 'hidden'}`}>
            <iframe
              ref={iframeRef}
              srcDoc={bundleVFS(vfs)}
              title="VFS Preview Sandbox"
              className="w-full h-full border-none"
              sandbox="allow-scripts allow-modals allow-same-origin"
            />
          </div>

          {/* 源代码编辑器视图 */}
          {activeTab === 'code' && (
            <div className="w-full h-full flex flex-col">
              <div className="px-4 py-2 bg-slate-900/60 border-b border-slate-800/80 text-xs font-mono text-slate-400">
                正在编辑: <span className="text-emerald-400">{activeFile}</span>
              </div>
              <textarea
                value={vfs[activeFile] || ''}
                onChange={e => setVfs({ ...vfs, [activeFile]: e.target.value })}
                className="flex-1 bg-slate-950 p-4 font-mono text-xs text-slate-200 resize-none focus:outline-none"
              />
            </div>
          )}

          {/* 控制台面板 */}
          {activeTab === 'console' && (
            <div className="w-full h-full p-4 overflow-auto font-mono text-xs space-y-1.5">
              {consoleLogs.map(log => (
                <div key={log.id} className="flex items-start gap-2 text-slate-300 border-b border-slate-900 pb-1">
                  <span className="text-[10px] text-slate-600">{log.timestamp}</span>
                  <span className="text-emerald-400 font-semibold">[{log.level}]</span>
                  <span>{log.args.join(' ')}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 底栏增量对话修改框 */}
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
              placeholder="对多文件项目提出修改要求（如：在 styles.css 里修改背景色，并在 index.html 里加上新标题）"
              value={instruction}
              onChange={e => setInstruction(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleModifyVFS()}
              className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
            />
            <button
              onClick={handleModifyVFS}
              disabled={isModifying || !instruction.trim()}
              className="flex items-center gap-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-medium"
            >
              {isModifying ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              应用多文件修改
            </button>
          </div>
        </div>

      </div>
    </div>
  );
};
