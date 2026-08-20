import { Check, Circle, LoaderCircle, Search, Sparkles } from 'lucide-react';
import type { PlanProgressEvent, PlanTaskStatus } from '../../lib/api';

interface PlanChainTimelineProps {
  progress?: PlanProgressEvent | null;
  status?: string;
}

const statusText: Record<PlanTaskStatus, string> = {
  pending: '等待执行',
  in_progress: '执行中',
  completed: '已完成',
  failed: '需重试',
};

export default function PlanChainTimeline({ progress, status }: PlanChainTimelineProps) {
  if (!progress && !status) return null;
  const phaseLabel = progress?.phase === 'planning'
    ? '正在拆解任务'
    : progress?.phase === 'replanning'
      ? '正在调整执行计划'
      : progress?.phase === 'completed'
        ? '任务链路已完成'
        : '正在执行任务';
  return (
    <section data-plan-chain className="mt-4 rounded-2xl border border-indigo-100 bg-white/90 p-4 shadow-sm" aria-live="polite">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
          {progress?.phase === 'completed' ? <Check size={16} /> : <Sparkles size={16} />}
        </span>
        <span>{phaseLabel}</span>
        {progress && <span className="ml-auto text-xs font-normal text-slate-400">第 {Math.max(1, progress.iteration + 1)} 轮</span>}
      </div>
      {status && !progress?.message && <p className="mt-2 text-xs text-slate-500">{status}</p>}
      {progress?.message && <p className="mt-2 text-xs text-slate-500">{progress.message}</p>}
      {progress?.tasks?.length ? (
        <ol className="mt-3 space-y-2">
          {progress.tasks.map((task) => {
            const active = task.id === progress.current_task_id || task.status === 'in_progress';
            const resultCount = task.search_results?.length || 0;
            return (
              <li key={task.id} className={`flex items-start gap-2 rounded-xl px-2.5 py-2 ${active ? 'bg-indigo-50/80' : ''}`}>
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${task.status === 'completed' ? 'bg-emerald-100 text-emerald-600' : task.status === 'failed' ? 'bg-rose-100 text-rose-600' : active ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-400'}`}>
                  {task.status === 'completed' ? <Check size={12} /> : active ? <LoaderCircle size={12} className="animate-spin" /> : <Circle size={10} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-semibold text-slate-700">Task {task.id}</span>
                    <span className="truncate text-slate-500">{task.title}</span>
                    <span className="ml-auto shrink-0 text-slate-400">{statusText[task.status]}</span>
                  </div>
                  {task.requires_web && (resultCount > 0 || active) && (
                    <div className="mt-1 flex items-center gap-1 text-[11px] text-cyan-700">
                      <Search size={11} />
                      {resultCount > 0 ? `已找到 ${resultCount} 条搜索结果` : '正在搜索资料…'}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
