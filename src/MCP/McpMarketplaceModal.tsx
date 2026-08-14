import React, { useState, useEffect } from 'react';
import { Store, Download, Check, Power, Trash2, Key, Sparkles, X, Puzzle } from 'lucide-react';

interface EnvSchema {
  key: string;
  label: string;
  type: string;
  description: string;
}

interface McpPlugin {
  id: string;
  name: string;
  icon: string;
  category: string;
  description: string;
  env_schema: EnvSchema[];
  is_installed: boolean;
  is_enabled: boolean;
}

export const McpMarketplaceModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const [plugins, setPlugins] = useState<McpPlugin[]>([]);
  const [selectedPlugin, setSelectedPlugin] = useState<McpPlugin | null>(null);
  const [envInputs, setEnvValues] = useState<Record<string, string>>({});

  const fetchPlugins = async () => {
    const res = await fetch('http://localhost:8000/api/mcp/marketplace');
    const data = await res.json();
    setPlugins(data);
  };

  useEffect(() => {
    if (isOpen) fetchPlugins();
  }, [isOpen]);

  const handleInstallClick = (plugin: McpPlugin) => {
    setSelectedPlugin(plugin);
    setEnvValues({});
  };

  const handleConfirmInstall = async () => {
    if (!selectedPlugin) return;
    await fetch('http://localhost:8000/api/mcp/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        plugin_id: selectedPlugin.id,
        env_values: envInputs
      })
    });
    setSelectedPlugin(null);
    fetchPlugins();
  };

  const handleToggle = async (pluginId: string) => {
    await fetch(`http://localhost:8000/api/mcp/toggle/${pluginId}`, { method: 'POST' });
    fetchPlugins();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-3xl h-[600px] flex flex-col shadow-2xl overflow-hidden font-sans">
        
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950">
          <div className="flex items-center gap-2">
            <Puzzle className="w-5 h-5 text-emerald-400" />
            <h2 className="font-semibold text-base text-slate-100">MCP 扩展插件市场 (Model Context Protocol)</h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1 rounded-lg"><X className="w-5 h-5" /></button>
        </div>

        {/* 插件网格列表 */}
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-2 gap-4">
          {plugins.map(p => (
            <div key={p.id} className="p-4 bg-slate-950/60 border border-slate-800/80 rounded-xl flex flex-col justify-between hover:border-slate-700 transition">
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{p.icon}</span>
                    <span className="font-semibold text-sm text-slate-100">{p.name}</span>
                  </div>
                  <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded-full">{p.category}</span>
                </div>
                <p className="text-xs text-slate-400 line-clamp-2 mb-4">{p.description}</p>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-slate-800/60">
                {p.is_installed ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleToggle(p.id)}
                      className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-md transition border ${
                        p.is_enabled 
                          ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/40' 
                          : 'bg-slate-800 text-slate-500 border-slate-700'
                      }`}
                    >
                      <Power className="w-3 h-3" /> {p.is_enabled ? '已启用' : '已暂停'}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleInstallClick(p)}
                    className="flex items-center gap-1.5 text-xs bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-lg transition font-medium"
                  >
                    <Download className="w-3.5 h-3.5" /> 安装配置
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

      </div>

      {/* 配置 API Key 弹窗 */}
      {selectedPlugin && (
        <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/80 p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-md p-6 shadow-2xl">
            <h3 className="text-sm font-semibold text-slate-100 mb-2 flex items-center gap-2">
              <span>{selectedPlugin.icon}</span> 配置 {selectedPlugin.name} 凭证
            </h3>
            <p className="text-xs text-slate-400 mb-4">使用此 MCP 扩展前，请输入所需的凭证信息：</p>

            <div className="space-y-3 mb-6">
              {selectedPlugin.env_schema.map(env => (
                <div key={env.key}>
                  <label className="block text-xs font-medium text-slate-300 mb-1">{env.label}</label>
                  <input
                    type={env.type}
                    placeholder={env.description}
                    value={envInputs[env.key] || ''}
                    onChange={e => setEnvValues({ ...envInputs, [env.key]: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-100 focus:outline-none focus:border-emerald-500"
                  />
                </div>
              ))}
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => setSelectedPlugin(null)} className="px-3.5 py-1.5 bg-slate-800 text-slate-300 text-xs rounded-lg">取消</button>
              <button onClick={handleConfirmInstall} className="px-4 py-1.5 bg-emerald-600 text-white text-xs rounded-lg font-medium">确认并保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};