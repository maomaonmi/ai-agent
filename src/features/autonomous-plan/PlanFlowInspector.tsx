'use client';

import { useEffect } from 'react';
import { Bot, FileText, Search, X } from 'lucide-react';
import MarkdownMessage from '../../components/MarkdownMessage';
import { agentDisplayName } from './planFlowGraph';
import type { PlanTask } from '../../lib/api';

interface PlanFlowInspectorProps {
  task: PlanTask | null;
  open: boolean;
  onClose: () => void;
  onOpenInTasks: (taskId: number) => void;
}

const KIND_META = {
  search: { icon: Search, label: '联网搜索任务' },
  agent: { icon: Bot, label: '智能体任务' },
} as const;

const STATUS_CHIP: Record<string, string> = {
  pending: 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-400',
  in_progress: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  failed: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
};

const STATUS_LABEL: Record<string, string> = {
  pending: '等待中',
  in_progress: '执行中',
  completed: '已完成',
  failed: '失败',
};

/** 点击流程图节点后从右侧滑出的任务详情面板（Dify Inspector 交互）。 */
export default function PlanFlowInspector({ task, open, onClose, onOpenInTasks }: PlanFlowInspectorProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const kindMeta = task && task.requires_web ? KIND_META.search : KIND_META.agent;
  const KindIcon = kindMeta.icon;
  const result = task?.result || task?.streaming_result || task?.error || '';

  return (
    <>
      {open && <div className="absolute inset-0 z-20 bg-slate-900/20 dark:bg-black/40" onClick={onClose} aria-hidden />}
      <aside
        data-plan-flow-inspector
        aria-hidden={!open}
        className={`absolute inset-y-0 right-0 z-30 flex w-80 max-w-[85%] flex-col border-l border-slate-200 bg-white shadow-xl transition-transform duration-200 dark:border-white/10 dark:bg-[#101a26] ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {task && (
          <>
            <header className="flex items-start gap-2 border-b border-slate-200/80 px-4 py-3 dark:border-white/10">
              <KindIcon size={16} className="mt-0.5 shrink-0 text-slate-400 dark:text-slate-500" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold leading-6 text-slate-800 dark:text-slate-100">{task.title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className={`rounded-full px-2 py-0.5 font-medium ${STATUS_CHIP[task.status] || STATUS_CHIP.pending}`}>{STATUS_LABEL[task.status] || task.status}</span>
                  <span className="text-slate-400 dark:text-slate-500">{kindMeta.label}</span>
                  {!task.requires_web && <span className="text-slate-400 dark:text-slate-500">· {agentDisplayName(task.assigned_agent)}</span>}
                </div>
              </div>
              <button onClick={onClose} aria-label="关闭详情面板" className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-white/10 dark:hover:text-slate-200">
                <X size={16} />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-xs leading-6">
              {task.description && (
                <section className="mb-4">
                  <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">任务描述</h4>
                  <p className="whitespace-pre-wrap text-slate-600 dark:text-slate-300">{task.description}</p>
                </section>
              )}
              {result && (
                <section className="mb-4">
                  <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">执行结果</h4>
                  <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3 dark:border-white/10 dark:bg-white/[0.03]">
                    <MarkdownMessage content={result} />
                  </div>
                </section>
              )}
              {!!task.search_results?.length && (
                <section className="mb-4">
                  <h4 className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">搜索来源（{task.search_results.length}）</h4>
                  <ul className="space-y-1.5">
                    {task.search_results.slice(0, 12).map((item, index) => (
                      <li key={`${item.url}-${index}`} className="min-w-0">
                        <a href={item.url} target="_blank" rel="noopener noreferrer" className="block truncate rounded-md px-2 py-1 text-slate-600 transition-colors hover:bg-slate-100 hover:text-sky-700 dark:text-slate-300 dark:hover:bg-white/10 dark:hover:text-sky-300" title={item.title}>
                          {index + 1}. {item.title || item.url}
                        </a>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {task.status === 'pending' && !result && <p className="text-slate-400 dark:text-slate-500">任务尚未开始执行。</p>}
            </div>
            <footer className="border-t border-slate-200/80 px-4 py-3 dark:border-white/10">
              <button
                onClick={() => onOpenInTasks(task.id)}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/[0.06]"
              >
                <FileText size={13} /> 在任务列表中查看完整输出
              </button>
            </footer>
          </>
        )}
      </aside>
    </>
  );
}
