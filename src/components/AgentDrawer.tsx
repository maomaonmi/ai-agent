'use client';

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AgentConfig,
  AgentDraft,
  deleteAgent,
  generateAgent,
  listAgents,
  saveAgent,
} from '../lib/api';
import AgentForm from './AgentForm';
import AgentIdeaDialog from './AgentIdeaDialog';

const EMPTY_AGENT: AgentDraft = {
  id: '',
  name: '',
  description: '',
  system_prompt: '',
  is_callable: true,
  when_to_use: '',
  tools: ['read'],
};

function toDraft(agent: AgentConfig): AgentDraft {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    system_prompt: agent.system_prompt,
    is_callable: agent.is_callable,
    when_to_use: agent.when_to_use,
    tools: agent.tools,
  };
}

export default function AgentDrawer() {
  const [open, setOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showIdeaDialog, setShowIdeaDialog] = useState(false);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [draft, setDraft] = useState<AgentDraft>(EMPTY_AGENT);
  const [idea, setIdea] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [highlighted, setHighlighted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ideaError, setIdeaError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await listAgents();
      setAgents(response.agents);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '加载智能体失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refreshAgents();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !showIdeaDialog) setOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, refreshAgents, showIdeaDialog]);

  const startCreating = () => {
    setDraft(EMPTY_AGENT);
    setShowForm(true);
    setError(null);
    setNotice(null);
  };

  const handleGenerate = async () => {
    setGenerating(true);
    setIdeaError(null);
    try {
      const generated = await generateAgent(idea.trim());
      setDraft(toDraft(generated));
      setShowIdeaDialog(false);
      setShowForm(true);
      setIdea('');
      setHighlighted(true);
      window.setTimeout(() => setHighlighted(false), 1800);
    } catch (requestError) {
      setIdeaError(requestError instanceof Error ? requestError.message : '智能生成失败');
    } finally {
      setGenerating(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await saveAgent(draft);
      await refreshAgents();
      window.dispatchEvent(new Event('agents-updated'));
      setShowForm(false);
      setDraft(EMPTY_AGENT);
      setNotice('智能体已保存，并已加入 Planner 可用名册。');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '保存智能体失败');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (agent: AgentConfig) => {
    setError(null);
    try {
      const updated = await saveAgent({
        ...toDraft(agent),
        is_callable: !agent.is_callable,
      });
      setAgents((current) => current.map((item) => (
        item.id === updated.id ? updated : item
      )));
      window.dispatchEvent(new Event('agents-updated'));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '更新调用状态失败');
    }
  };

  const handleDelete = async (agent: AgentConfig) => {
    if (!window.confirm(`确定删除“${agent.name}”吗？此操作无法撤销。`)) return;
    setError(null);
    try {
      await deleteAgent(agent.id);
      setAgents((current) => current.filter((item) => item.id !== agent.id));
      window.dispatchEvent(new Event('agents-updated'));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : '删除智能体失败');
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50"
      >
        <span aria-hidden="true">🧩</span>
        智能体工厂
      </button>

      {open && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed inset-0 z-[90] flex justify-end bg-slate-950/55 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !showIdeaDialog) setOpen(false);
          }}
        >
          <aside
            role="dialog"
            aria-modal="true"
            aria-labelledby="agent-drawer-title"
            className="flex h-full w-full max-w-2xl flex-col border-l border-slate-700 bg-slate-900 text-slate-100 shadow-2xl"
          >
            <header className="flex items-center justify-between gap-4 border-b border-slate-800 px-4 py-4 sm:px-6">
              <div>
                <h2 id="agent-drawer-title" className="text-base font-semibold">
                  🧩 智能体工厂
                </h2>
                <p className="mt-1 text-xs text-slate-500">
                  创建可被分布式 Planner 自动调用的专项专家
                </p>
              </div>
              <div className="flex items-center gap-2">
                {showForm && (
                  <button
                    type="button"
                    onClick={() => {
                      setIdeaError(null);
                      setShowIdeaDialog(true);
                    }}
                    className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20"
                  >
                    ✨ 智能生成
                  </button>
                )}
                <button
                  type="button"
                  autoFocus
                  onClick={() => setOpen(false)}
                  aria-label="关闭智能体工厂"
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-xl text-slate-400 hover:bg-slate-800 hover:text-white"
                >
                  ×
                </button>
              </div>
            </header>

            <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
              {error && (
                <p role="alert" className="mb-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                  {error}
                </p>
              )}
              {notice && (
                <p role="status" className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-300">
                  {notice}
                </p>
              )}

              {showForm ? (
                <AgentForm
                  value={draft}
                  highlighted={highlighted}
                  saving={saving}
                  onChange={setDraft}
                  onSubmit={handleSave}
                  onCancel={() => setShowForm(false)}
                />
              ) : (
                <section>
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-semibold">自定义智能体</h3>
                      <p className="mt-1 text-xs text-slate-500">{agents.length} 个已注册</p>
                    </div>
                    <button
                      type="button"
                      onClick={startCreating}
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500"
                    >
                      ＋ 创建智能体
                    </button>
                  </div>

                  {loading ? (
                    <div aria-label="正在加载智能体" className="space-y-3">
                      {[0, 1, 2].map((item) => (
                        <div key={item} className="h-20 animate-pulse rounded-xl bg-slate-800" />
                      ))}
                    </div>
                  ) : agents.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-slate-700 px-6 py-12 text-center">
                      <div className="text-3xl">🧩</div>
                      <h3 className="mt-3 text-sm font-medium">还没有自定义智能体</h3>
                      <p className="mt-2 text-xs text-slate-500">创建后，Planner 会根据“何时调用”自动分配任务。</p>
                    </div>
                  ) : (
                    <ul className="space-y-3">
                      {agents.map((agent) => (
                        <li key={agent.id} className="rounded-xl border border-slate-800 bg-slate-950/55 p-4">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0">
                              <h3 className="truncate text-sm font-medium">{agent.name}</h3>
                              <p className="mt-1 font-mono text-[11px] text-slate-500">{agent.id}</p>
                              <p className="mt-2 text-xs leading-5 text-slate-400">{agent.description}</p>
                              <div className="mt-3 flex flex-wrap gap-1.5">
                                {agent.tools.map((tool) => (
                                  <span key={tool} className="rounded bg-slate-800 px-2 py-1 text-[10px] text-slate-400">
                                    {tool}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <div className="flex flex-none items-center gap-2">
                              <button
                                type="button"
                                role="switch"
                                aria-checked={agent.is_callable}
                                onClick={() => void handleToggle(agent)}
                                className={`rounded-full border px-2.5 py-1 text-[11px] ${
                                  agent.is_callable
                                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                                    : 'border-slate-700 bg-slate-800 text-slate-500'
                                }`}
                              >
                                {agent.is_callable ? '可调用' : '已暂停'}
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDelete(agent)}
                                aria-label={`删除 ${agent.name}`}
                                className="rounded-lg p-2 text-slate-500 hover:bg-rose-500/10 hover:text-rose-400"
                              >
                                🗑️
                              </button>
                            </div>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
              )}
            </div>
          </aside>
        </div>,
        document.body,
      )}

      {showIdeaDialog && typeof document !== 'undefined' && createPortal(
        <AgentIdeaDialog
          idea={idea}
          generating={generating}
          error={ideaError}
          onIdeaChange={setIdea}
          onGenerate={() => void handleGenerate()}
          onClose={() => setShowIdeaDialog(false)}
        />,
        document.body,
      )}
    </>
  );
}
