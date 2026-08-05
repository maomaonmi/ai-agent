'use client';

import { useCallback, useState } from 'react';
import { PlanProgressEvent, PlanTaskStatus } from '../lib/api';
import MarkdownMessage from './MarkdownMessage';
import TaskOutputDialog from './TaskOutputDialog';

const STATUS_META: Record<PlanTaskStatus, {
  icon: string;
  label: string;
  container: string;
}> = {
  completed: {
    icon: '✅',
    label: '已完成',
    container: 'border-emerald-200 bg-emerald-50/70',
  },
  in_progress: {
    icon: '⏳',
    label: '执行中',
    container: 'border-sky-300 bg-sky-50',
  },
  pending: {
    icon: '⏸️',
    label: '等待中',
    container: 'border-slate-200 bg-white',
  },
  failed: {
    icon: '⚠️',
    label: '执行失败',
    container: 'border-red-200 bg-red-50/70',
  },
};

const PHASE_LABELS: Record<PlanProgressEvent['phase'], string> = {
  planning: '正在规划',
  executing: '正在执行',
  replanning: '动态重规划',
  completed: '全部完成',
};

const AGENT_LABELS = {
  web_search_agent: { icon: '🌐', label: '联网搜索专家' },
  deep_thinker_agent: { icon: '🧠', label: 'R1 深度思考专家' },
  data_analyst_agent: { icon: '📊', label: '数据分析专家' },
} as const;

export default function TaskExecutionPanel({
  progress,
  distributed = false,
}: {
  progress: PlanProgressEvent;
  distributed?: boolean;
}) {
  const [expandedOutput, setExpandedOutput] = useState<{
    title: string;
    content: string;
  } | null>(null);
  const closeExpandedOutput = useCallback(() => setExpandedOutput(null), []);
  const settledCount = progress.tasks.filter(
    (task) => task.status === 'completed' || task.status === 'failed',
  ).length;
  const percentage = progress.tasks.length
    ? Math.round((settledCount / progress.tasks.length) * 100)
    : 0;

  return (
    <section
      aria-label="自主任务规划进度"
      aria-live="polite"
      className="overflow-hidden rounded-xl border border-sky-200 bg-slate-50 shadow-sm"
    >
      <header className="border-b border-sky-100 bg-white px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">
              {distributed ? '🕸️ 多智能体任务分发' : '🧭 自主任务规划'}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {PHASE_LABELS[progress.phase]}
              {progress.iteration > 0 ? ` · 第 ${progress.iteration} 轮` : ''}
            </p>
          </div>
          <span className="text-xs font-medium text-slate-600">
            {settledCount}/{progress.tasks.length} 项完成
          </span>
        </div>
        <div
          className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200"
          role="progressbar"
          aria-label="任务完成进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percentage}
        >
          <div
            className="h-full rounded-full bg-sky-600 transition-all duration-500"
            style={{ width: `${percentage}%` }}
          />
        </div>
      </header>

      {progress.message && (
        <p className="border-b border-slate-200 px-4 py-2 text-xs text-slate-600">
          {progress.message}
        </p>
      )}

      <ol className="space-y-2 p-3">
        {progress.tasks.map((task) => {
          const meta = STATUS_META[task.status];
          const builtInAgent = task.assigned_agent
            ? AGENT_LABELS[task.assigned_agent as keyof typeof AGENT_LABELS]
            : null;
          const agent = builtInAgent || (task.assigned_agent
            ? { icon: '🧩', label: task.assigned_agent }
            : null);
          return (
            <li
              key={task.id}
              className={`rounded-lg border px-3 py-3 ${meta.container}`}
            >
              <div className="flex items-start gap-3">
                <span className={task.status === 'in_progress' ? 'animate-pulse' : ''}>
                  {meta.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <h3 className="text-sm font-semibold text-slate-800">
                      Task {task.id}: {task.title}
                    </h3>
                    <span className="text-xs font-medium text-slate-600">
                      {meta.label}
                    </span>
                  </div>
                  {task.description && (
                    <p className="mt-1 text-xs leading-5 text-slate-600">
                      {task.description}
                    </p>
                  )}
                  {distributed && agent && (
                    <div className="mt-2">
                      <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-600">
                        <span aria-hidden="true">{agent.icon}</span>
                        负责人：{agent.label}
                      </span>
                    </div>
                  )}
                  {(task.result || task.error) && (
                    <div className="mt-2 flex items-start gap-2">
                      <details className="min-w-0 flex-1">
                        <summary className="cursor-pointer py-1 text-xs font-medium text-sky-700">
                          查看任务产出
                        </summary>
                        <MarkdownMessage
                          className="mt-2 max-h-72 overflow-y-auto rounded-md bg-white/80 p-3 text-xs text-slate-700"
                          content={task.result || task.error || ''}
                        />
                      </details>
                      <button
                        type="button"
                        onClick={() => setExpandedOutput({
                          title: `Task ${task.id}: ${task.title}`,
                          content: task.result || task.error || '',
                        })}
                        className="inline-flex flex-none items-center gap-1 rounded-md border border-sky-200 bg-white px-2.5 py-1.5 text-xs font-medium text-sky-700 transition-colors hover:bg-sky-50 focus:outline-none focus:ring-2 focus:ring-sky-500"
                        aria-label={`放大查看 Task ${task.id} 的完整产出`}
                      >
                        <span aria-hidden="true">⛶</span>
                        放大查看
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
      {expandedOutput && (
        <TaskOutputDialog
          title={expandedOutput.title}
          content={expandedOutput.content}
          onClose={closeExpandedOutput}
        />
      )}
    </section>
  );
}
