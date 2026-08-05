import React, { useState, useEffect } from 'react';
import { 
  Eye, Database, Server, Sparkles, RefreshCw, Layers
} from 'lucide-react';
import { bundleFullstackVFS } from './fullstackBundler';
import { VirtualFileSystem } from './vfsBundler';

const INITIAL_FULLSTACK_VFS: VirtualFileSystem = {
  "frontend/index.html": `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>全栈待办事项应用</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <div className="app-container">
    <h1>📝 全栈 Todo 应用 (内置 Mock REST API)</h1>
    <div className="input-group">
      <input type="text" id="todo-input" placeholder="输入新的待办事项..." />
      <button id="add-btn">添加任务</button>
    </div>
    <ul id="todo-list"></ul>
  </div>
  <script src="app.js"></script>
</body>
</html>`,
  "frontend/styles.css": `body { margin:0; background:#0f172a; color:#f8fafc; font-family:sans-serif; padding:2rem; }
.app-container { max-width:500px; margin:0 auto; background:#1e293b; padding:2rem; border-radius:1rem; border:1px solid #334155; }
.input-group { display:flex; gap:0.5rem; margin-bottom:1.5rem; }
input { flex:1; background:#0f172a; border:1px solid #475569; padding:0.6rem; color:#fff; border-radius:0.5rem; }
button { background:#10b981; border:none; color:#fff; padding:0.6rem 1rem; border-radius:0.5rem; font-weight:600; cursor:pointer; }
ul { list-style:none; padding:0; }
li { background:#0f172a; padding:0.75rem 1rem; margin-bottom:0.5rem; border-radius:0.5rem; display:flex; justify-content:space-between; align-items:center; border:1px solid #334155; }
.del-btn { background:#ef4444; padding:0.2rem 0.5rem; font-size:0.75rem; }`,
  "frontend/app.js": `// 向沙盒内置的虚拟 REST API 发起请求
async function fetchTodos() {
  const res = await fetch('/api/todos');
  const todos = await res.json();
  renderTodos(todos);
}

function renderTodos(todos) {
  const list = document.getElementById('todo-list');
  list.innerHTML = todos.map(t => \`
    <li>
      <span>\${t.title}</span>
      <button className="del-btn" onclick="deleteTodo(\${t.id})">删除</button>
    </li>
  \`).join('');
}

document.getElementById('add-btn')?.addEventListener('click', async () => {
  const input = document.getElementById('todo-input');
  if (!input.value.trim()) return;
  
  await fetch('/api/todos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: input.value, completed: false })
  });
  
  input.value = '';
  fetchTodos();
});

async function deleteTodo(id) {
  await fetch(\`/api/todos/\${id}\`, { method: 'DELETE' });
  fetchTodos();
}

// 页面加载时自动拉取数据
fetchTodos();`,
  "backend/server.py": `# FastAPI 路由声明 (参考定义)
from fastapi import FastAPI
app = FastAPI()

@app.get("/api/todos")
def get_todos():
    return db["todos"]

@app.post("/api/todos")
def create_todo(todo: dict):
    db["todos"].append(todo)
    return todo`,
  "backend/database.json": `{\n  "todos": [\n    {\n      "id": 1,\n      "title": "体验 Day 55 全栈沙盒交互",\n      "completed": true\n    }\n  ]\n}`
};

export const Day55FullstackContainer: React.FC = () => {
  const [vfs, setVfs] = useState<VirtualFileSystem>(INITIAL_FULLSTACK_VFS);
  const [activeFile, setActiveFile] = useState<string>('frontend/index.html');
  const [activeTab, setActiveTab] = useState<'preview' | 'code' | 'db'>('preview');
  const [instruction, setInstruction] = useState<string>('');
  const [isModifying, setIsModifying] = useState<boolean>(false);

  // 监听来自沙盒内 Mock API 的数据库更新事件
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data && e.data.type === 'DATABASE_UPDATED') {
        const updatedDB = e.data.payload;
        setVfs(prev => ({
          ...prev,
          "backend/database.json": JSON.stringify(updatedDB, null, 2)
        }));
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleModifyFullstack = async () => {
    if (!instruction.trim()) return;
    setIsModifying(true);

    try {
      const response = await fetch('http://localhost:8000/api/modify_fullstack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vfs, instruction })
      });
      const data = await response.json();
      if (data.updated_vfs) {
        setVfs(data.updated_vfs);
        setInstruction('');
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsModifying(false);
    }
  };

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 font-sans overflow-hidden">
      
      {/* 1. 左侧全栈目录树 */}
      <div className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col">
        <div className="p-3 border-b border-slate-800 flex items-center justify-between text-xs text-slate-300 font-semibold">
          <span className="flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-emerald-400" /> 全栈工程工作区
          </span>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-3 font-mono text-xs">
          {/* 前端分组 */}
          <div>
            <div className="px-2 py-1 text-[11px] font-bold text-slate-500 uppercase flex items-center gap-1">
              <Eye className="w-3 h-3" /> Frontend (前端 UI)
            </div>
            {Object.keys(vfs).filter(k => k.startsWith('frontend/')).map(file => (
              <button
                key={file}
                onClick={() => { setActiveFile(file); setActiveTab('code'); }}
                className={`w-full text-left px-3 py-1.5 rounded-lg transition truncate ${
                  activeFile === file && activeTab === 'code' ? 'bg-emerald-500/20 text-emerald-300 font-semibold' : 'text-slate-400 hover:bg-slate-800/60'
                }`}
              >
                {file.replace('frontend/', '')}
              </button>
            ))}
          </div>

          {/* 后端分组 */}
          <div>
            <div className="px-2 py-1 text-[11px] font-bold text-slate-500 uppercase flex items-center gap-1">
              <Server className="w-3 h-3" /> Backend (API & DB)
            </div>
            {Object.keys(vfs).filter(k => k.startsWith('backend/')).map(file => (
              <button
                key={file}
                onClick={() => { setActiveFile(file); setActiveTab('code'); }}
                className={`w-full text-left px-3 py-1.5 rounded-lg transition truncate ${
                  activeFile === file && activeTab === 'code' ? 'bg-emerald-500/20 text-emerald-300 font-semibold' : 'text-slate-400 hover:bg-slate-800/60'
                }`}
              >
                {file.replace('backend/', '')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 2. 主面板 */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-800 text-xs">
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setActiveTab('preview')}
              className={`px-3 py-1 rounded-lg ${activeTab === 'preview' ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400'}`}
            >
              🌐 前端 UI 预览
            </button>
            <button 
              onClick={() => setActiveTab('code')}
              className={`px-3 py-1 rounded-lg ${activeTab === 'code' ? 'bg-slate-800 text-white font-semibold' : 'text-slate-400'}`}
            >
              📝 源码编辑 ({activeFile})
            </button>
            <button 
              onClick={() => { setActiveFile('backend/database.json'); setActiveTab('code'); }}
              className={`px-3 py-1 rounded-lg flex items-center gap-1 ${activeFile === 'backend/database.json' && activeTab === 'code' ? 'bg-slate-800 text-emerald-400 font-semibold' : 'text-slate-400'}`}
            >
              <Database className="w-3.5 h-3.5" /> 实时数据库 DB
            </button>
          </div>
        </div>

        <div className="flex-1 bg-slate-950 relative overflow-hidden">
          {activeTab === 'preview' && (
            <iframe
              srcDoc={bundleFullstackVFS(vfs)}
              title="Fullstack Interactive Sandbox"
              className="w-full h-full border-none"
              sandbox="allow-scripts allow-modals allow-same-origin"
            />
          )}

          {activeTab === 'code' && (
            <textarea
              value={vfs[activeFile] || ''}
              onChange={e => setVfs({ ...vfs, [activeFile]: e.target.value })}
              className="w-full h-full bg-slate-950 p-4 font-mono text-xs text-slate-200 resize-none focus:outline-none"
            />
          )}
        </div>

        {/* 3. 增量对话框 */}
        <div className="p-3 bg-slate-900 border-t border-slate-800 flex items-center gap-2">
          <input
            type="text"
            placeholder="提出全栈修改需求（如：增加一个优先级选单，并在后端 API 里同步支持存储）"
            value={instruction}
            onChange={e => setInstruction(e.target.value)}
            className="flex-1 bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
          />
          <button
            onClick={handleModifyFullstack}
            disabled={isModifying || !instruction.trim()}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 text-white rounded-xl text-xs font-medium"
          >
            {isModifying ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            应用全栈修改
          </button>
        </div>
      </div>
    </div>
  );
};
