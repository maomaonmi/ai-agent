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
  compact?: boolean;
}

function StatusIcon({ status }: { status: CodeTaskStatus }) {
  if (status === 'completed') return <CheckCircle2 className="h-4 w-4 text-blue-500" aria-hidden="true" />;
  if (status === 'in_progress') return <LoaderCircle className="h-4 w-4 animate-spin text-slate-500" aria-hidden="true" />;
  if (status === 'implemented_unverified') return <CheckCircle2 className="h-4 w-4 text-amber-500" aria-hidden="true" />;
  if (status === 'failed' || status === 'needs_attention') return <AlertTriangle className="h-4 w-4 text-amber-500" aria-hidden="true" />;
  if (status === 'skipped') return <MinusCircle className="h-4 w-4 text-slate-400" aria-hidden="true" />;
  return <Circle className="h-4 w-4 text-slate-300" aria-hidden="true" />;
}

function implementationLabel(task: TaskItem): string {
  const status = task.implementation_status
    || (task.status === 'completed' || task.status === 'implemented_unverified' ? 'implemented' : task.status);
  if (status === 'implemented') return '已实现';
  if (status === 'in_progress') return '实现中';
  if (status === 'blocked' || task.status === 'needs_attention' || task.status === 'failed') return '实现受阻';
  return '待实现';
}

function verificationLabel(task: TaskItem): string {
  const status = task.verification_status
    || (task.status === 'completed' ? 'verified' : task.status === 'implemented_unverified' ? 'pending' : 'not_applicable_yet');
  if (status === 'verified') return '已验收';
  if (status === 'contradicted') return '验收未通过';
  if (status === 'inconclusive' || status === 'invalid_test') return '证据不足';
  if (status === 'blocked') return '验收受阻';
  return status === 'not_applicable_yet' ? '实现后验收' : '待验收';
}

function StateBadge({ children, tone }: { children: string; tone: 'implementation' | 'verification' }) {
  return (
    <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${tone === 'implementation' ? 'bg-slate-100 text-slate-600' : 'bg-blue-50 text-blue-700'}`}>
      {children}
    </span>
  );
}

function TaskRow({ task, executionPlan = false }: { task: TaskItem; executionPlan?: boolean }) {
  const targetFiles = task.target_files || [];
  if (executionPlan) {
    return (
      <li className="py-1.5">
        <div className="text-sm text-slate-700">{task.title}</div>
        {(task.description || targetFiles.length > 0) && (
          <div className="mt-0.5 text-[11px] text-slate-400">
            {task.description}
            {targetFiles.length > 0 && <span>{` · ${targetFiles.join(' · ')}`}</span>}
          </div>
        )}
      </li>
    );
  }
  return (
    <li className="flex items-start gap-2.5 py-1.5">
      <span className="mt-0.5 shrink-0"><StatusIcon status={task.status} /></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={`text-sm ${task.status === 'completed' ? 'text-slate-500' : 'text-slate-700'}`}>
            {task.title}
          </span>
          <StateBadge tone="implementation">{implementationLabel(task)}</StateBadge>
          <StateBadge tone="verification">{verificationLabel(task)}</StateBadge>
          {task.status === 'needs_attention' && (
            <span className="text-[11px] text-amber-700">{codeTaskStatusLabel(task.status)}</span>
          )}
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

export default function CodeTaskListCard({ plan, onOpenFile, compact = false }: CodeTaskListCardProps) {
  const executionPlan = plan.planKind === 'execution';
  if (executionPlan && compact && plan.tasks[0]) {
    const task = plan.tasks[0];
    return (
      <div aria-label="紧凑执行进度" className="mb-2 flex min-w-0 items-center gap-2 py-1 text-sm text-slate-700">
        <StatusIcon status={task.status} />
        <span className="min-w-0 flex-1 truncate">{task.title}</span>
        <span className="shrink-0 text-xs text-slate-500">{codeTaskStatusLabel(task.status)}</span>
      </div>
    );
  }
  return (
    <section
      aria-label={executionPlan ? 'AgentLoop 执行拆解' : 'AgentLoop 验收任务列表'}
      className="mb-2 bg-white px-0 py-2"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-slate-600">
          <ListChecks className="h-4 w-4 shrink-0 text-blue-500" aria-hidden="true" />
          <span className="text-sm font-medium">{executionPlan ? '执行拆解' : '验收任务列表'}</span>
        </div>
        <span className="shrink-0 text-right text-xs text-slate-500">
          {executionPlan
            ? `${plan.totalCount} 个计划项`
            : `${plan.implementedCount}/${plan.totalCount} 已实现 · ${plan.completedCount}/${plan.totalCount} 已验收`}
        </span>
      </div>
      {executionPlan ? (
        <div className="mt-1 text-[11px] text-slate-400">
          用于组织实现工作的 Runtime 计划；验收状态由目标账本单独决定。
        </div>
      ) : plan.status === 'awaiting_verification' && (
        <div role="status" className="mt-1 text-[11px] text-amber-700">
          实现已落地，等待目标级验收；文件变化不等于功能已完成。
        </div>
      )}
      <ol className="mt-1 space-y-0.5">
        {plan.tasks.map((task) => (
          <TaskRow key={task.task_key || String(task.id)} task={task} executionPlan={executionPlan} />
        ))}
      </ol>
      {plan.projectionSource === 'goal_obligation_ledger' ? (
        <div className="mt-1.5 pt-1 text-[11px] text-slate-400">
          持久目标账本{plan.goalSetRevision ? ` · 目标版本 ${plan.goalSetRevision}` : ''}
        </div>
      ) : ( [plan.planPath, plan.todoPath].filter(Boolean).length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-[11px] text-slate-400">执行文件</span>
          {[plan.planPath, plan.todoPath].filter(Boolean).map((path) => (
          onOpenFile ? (
            <button
              key={path}
              type="button"
              onClick={() => onOpenFile(path)}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500 transition hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <FileText className="h-3 w-3" aria-hidden="true" />{path}
            </button>
          ) : (
            <span key={path} className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
              <FileText className="h-3 w-3" aria-hidden="true" />{path}
            </span>
          )
          ))}
        </div>
      ))}
    </section>
  );
}
