import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  FileText,
  ListChecks,
  LoaderCircle,
  MinusCircle,
} from 'lucide-react';

import type { CodeTaskPlanState, CodeTaskStatus, TaskItem } from '../lib/api';
import { codeTaskStatusLabel } from '../Code/codeTaskPlan';

interface CodeTaskListCardProps {
  plan: CodeTaskPlanState;
  onOpenFile?: (path: string) => void;
}

function StatusIcon({ status }: { status: CodeTaskStatus }) {
  if (status === 'completed') return <CheckCircle2 className="h-4 w-4 text-blue-500" aria-hidden="true" />;
  if (status === 'in_progress') return <LoaderCircle className="h-4 w-4 animate-spin text-slate-500" aria-hidden="true" />;
  if (status === 'failed' || status === 'needs_attention') return <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden="true" />;
  if (status === 'skipped') return <MinusCircle className="h-4 w-4 text-slate-400" aria-hidden="true" />;
  return <Circle className="h-4 w-4 text-slate-300" aria-hidden="true" />;
}

function TaskRow({ task }: { task: TaskItem }) {
  const targetFiles = task.target_files || [];
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <span className="mt-0.5 shrink-0"><StatusIcon status={task.status} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className={`text-sm ${task.status === 'completed' ? 'text-slate-500' : 'text-slate-700'}`}>
            {task.title}
          </span>
          <span className="text-[11px] text-slate-400">{codeTaskStatusLabel(task.status)}</span>
        </div>
        {(targetFiles.length > 0 || task.reason) && (
          <div className="mt-0.5 truncate text-[11px] text-slate-400" title={task.reason || targetFiles.join(', ')}>
            {task.reason || targetFiles.join(' · ')}
          </div>
        )}
      </div>
    </li>
  );
}

export default function CodeTaskListCard({ plan, onOpenFile }: CodeTaskListCardProps) {
  return (
    <section
      aria-label="AgentLoop 任务列表"
      className="mb-3 rounded-xl border border-slate-200 bg-white px-3.5 py-3 shadow-sm"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-slate-600">
          <ListChecks className="h-4 w-4 shrink-0 text-blue-500" aria-hidden="true" />
          <span className="text-sm font-medium">任务列表</span>
        </div>
        <span className="shrink-0 text-sm text-slate-400">
          {plan.completedCount}/{plan.totalCount} 已完成
        </span>
      </div>
      <ol className="mt-2 divide-y divide-slate-100">
        {plan.tasks.map((task) => (
          <TaskRow key={task.task_key || String(task.id)} task={task} />
        ))}
      </ol>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2">
        <span className="text-[11px] text-slate-400">执行文件</span>
        {[plan.planPath, plan.todoPath].map((path) => (
          onOpenFile ? (
            <button
              key={path}
              type="button"
              onClick={() => onOpenFile(path)}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <FileText className="h-3 w-3" aria-hidden="true" />{path}
            </button>
          ) : (
            <span key={path} className="inline-flex items-center gap-1 rounded-md bg-slate-50 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
              <FileText className="h-3 w-3" aria-hidden="true" />{path}
            </span>
          )
        ))}
      </div>
    </section>
  );
}
