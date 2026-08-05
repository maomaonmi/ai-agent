import React, { useState, useEffect, useRef } from 'react';
import { buildInspectorScript } from './inspectorScript';

interface TargetElement {
  tagName: string;
  className: string;
  id: string;
  outerHTML: string;
}

interface ConsoleLog {
  id: string;
  level: 'log' | 'warn' | 'error' | 'info';
  args: string[];
  timestamp: string;
}

interface SandboxProps {
  initialCode: string;
  onCodeUpdate?: (newCode: string) => void;
}

export const SandboxContainer: React.FC<SandboxProps> = ({ initialCode, onCodeUpdate }) => {
  const [code, setCode] = useState<string>(initialCode);
  const [activeTab, setActiveTab] = useState<'preview' | 'code' | 'console'>('preview');
  const [isInspectMode, setIsInspectMode] = useState<boolean>(false);
  const [selectedElement, setSelectedElement] = useState<TargetElement | null>(null);
  const [consoleLogs, setConsoleLogs] = useState<ConsoleLog[]>([]);
  const [instruction, setInstruction] = useState<string>('');
  const [isModifying, setIsModifying] = useState<boolean>(false);

  const iframeRef = useRef<HTMLIFrameElement>(null);

  // 1. 构建包含探针脚本的 srcdoc
  const buildSrcDoc = (rawHtml: string) => {
    if (!rawHtml) return '';
    // 将探针插入到 <head> 中
    if (rawHtml.includes('<head>')) {
      return rawHtml.replace('<head>', `<head>${buildInspectorScript('standalone-preview')}`);
    }
    return `${buildInspectorScript('standalone-preview')}${rawHtml}`;
  };

  // 2. 监听来自 iframe 的 postMessage 事件
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const { type, payload } = event.data || {};

      if (type === 'SANDBOX_CONSOLE') {
        const newLog: ConsoleLog = {
          id: Math.random().toString(36).substring(2, 9),
          level: payload.level,
          args: payload.args,
          timestamp: payload.timestamp
        };
        setConsoleLogs(prev => [...prev.slice(-100), newLog]); // 最多保留100条
      }

      if (type === 'ELEMENT_SELECTED') {
        setSelectedElement(payload);
        setIsInspectMode(false);
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  // 3. 切换检查模式时，向 iframe 发送指令
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

  // 4. 调用后端 /api/modify 进行增量代码修改
  const handleModifyCode = async () => {
    if (!instruction.trim()) return;
    setIsModifying(true);

    try {
      const response = await fetch('http://localhost:8000/api/modify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          current_code: code,
          instruction: instruction,
          target_element: selectedElement
        })
      });

      const data = await response.json();
      if (data.modified_code) {
        setCode(data.modified_code);
        onCodeUpdate?.(data.modified_code);
        setInstruction('');
        setSelectedElement(null); // 清空选择
      }
    } catch (err) {
      console.error('修改代码失败:', err);
    } finally {
      setIsModifying(false);
    }
  };

  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-100 font-sans">
      {/* 顶栏控制条 */}
      <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-800">
        <div className="flex items-center gap-2">
          {/* 🎯 元素检查器按钮 */}
          <button
            onClick={toggleInspectMode}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition border ${
              isInspectMode
                ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/50 shadow-lg shadow-emerald-950'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
            }`}
          >
            <span aria-hidden="true" className={isInspectMode ? 'animate-bounce' : ''}>🎯</span>
            {isInspectMode ? '点击沙盒元素进行选择...' : '🎯 检查元素'}
          </button>

          <span className="text-slate-700">|</span>

          {/* 视图切换 */}
          <button
            onClick={() => setActiveTab('preview')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition ${
              activeTab === 'preview' ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span aria-hidden="true">◉</span> 预览
          </button>
          <button
            onClick={() => setActiveTab('code')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition ${
              activeTab === 'code' ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span aria-hidden="true">&lt;/&gt;</span> 源代码
          </button>
          <button
            onClick={() => setActiveTab('console')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition relative ${
              activeTab === 'console' ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <span aria-hidden="true">›_</span> 控制台
            {consoleLogs.length > 0 && (
              <span className="ml-1 px-1.5 py-0.2 bg-emerald-500/20 text-emerald-400 text-[10px] rounded-full font-mono">
                {consoleLogs.length}
              </span>
            )}
          </button>
        </div>

        <button 
          onClick={() => setConsoleLogs([])}
          className="text-xs text-slate-500 hover:text-slate-300 transition"
        >
          清空日志
        </button>
      </div>

      {/* 主展示区域 */}
      <div className="flex-1 relative overflow-hidden bg-slate-900/50">
        {/* 1. 预览沙盒 (iframe) */}
        <div className={`w-full h-full ${activeTab === 'preview' ? 'block' : 'hidden'}`}>
          <iframe
            ref={iframeRef}
            srcDoc={buildSrcDoc(code)}
            title="Sandbox Preview"
            className="w-full h-full border-none"
            sandbox="allow-scripts allow-modals allow-same-origin"
          />
        </div>

        {/* 2. 源代码视图 */}
        {activeTab === 'code' && (
          <div className="w-full h-full p-4 overflow-auto font-mono text-xs text-slate-300 bg-slate-950">
            <pre><code>{code}</code></pre>
          </div>
        )}

        {/* 3. 控制台日志视图 */}
        {activeTab === 'console' && (
          <div className="w-full h-full p-4 overflow-auto font-mono text-xs space-y-2 bg-slate-950">
            {consoleLogs.length === 0 ? (
              <p className="text-slate-600 italic">暂无控制台日志输出...</p>
            ) : (
              consoleLogs.map(log => (
                <div 
                  key={log.id} 
                  className={`flex items-start gap-2 p-1.5 rounded border ${
                    log.level === 'error' ? 'bg-rose-950/30 border-rose-900/50 text-rose-300' :
                    log.level === 'warn' ? 'bg-amber-950/30 border-amber-900/50 text-amber-300' :
                    'bg-slate-900/50 border-slate-800 text-slate-300'
                  }`}
                >
                  <span className="text-[10px] text-slate-500">{log.timestamp}</span>
                  <span className="font-semibold uppercase text-[10px] px-1 bg-slate-800 rounded">
                    {log.level}
                  </span>
                  <span className="flex-1 whitespace-pre-wrap">{log.args.join(' ')}</span>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* 底栏：增量修改对话框（带目标元素上下文标签） */}
      <div className="p-4 bg-slate-900 border-t border-slate-800 space-y-2">
        {/* 如果选中了元素，显示目标元素 Badge */}
        {selectedElement && (
          <div className="flex items-center justify-between px-3 py-1.5 bg-emerald-950/40 border border-emerald-500/30 rounded-lg text-xs text-emerald-300 animate-fade-in">
            <div className="flex items-center gap-2 overflow-hidden">
              <span className="font-semibold bg-emerald-500/20 px-1.5 py-0.5 rounded font-mono text-[10px]">
                {selectedElement.tagName}
                {selectedElement.className ? `.${selectedElement.className.split(' ')[0]}` : ''}
              </span>
              <span className="truncate text-slate-400 font-mono text-[11px]">
                {selectedElement.outerHTML}
              </span>
            </div>
            <button 
              onClick={() => setSelectedElement(null)}
              className="text-emerald-400 hover:text-emerald-200 p-0.5 rounded"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        )}

        {/* 增量指令输入框 */}
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder={
              selectedElement
                ? `针对选中的 <${selectedElement.tagName}> 提出修改要求，例如：把它改成红色背景并加上放大效果`
                : '描述你想对整个网页进行的增量修改，例如：在顶部加上导航栏...'
            }
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleModifyCode()}
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-slate-100 placeholder-slate-600 focus:outline-none focus:border-emerald-500 transition"
          />

          <button
            onClick={handleModifyCode}
            disabled={isModifying || !instruction.trim()}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-medium transition shadow-lg shadow-emerald-900/20"
          >
            {isModifying ? (
              <span aria-hidden="true" className="animate-spin">↻</span>
            ) : (
              <>
                <span aria-hidden="true">✦</span> 修改代码
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
