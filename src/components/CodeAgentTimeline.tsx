import { useMemo } from 'react';

import type {
  CodeAcceptanceReport,
  CodeAgentActorKind,
  CodeAgentTimelineEvent,
} from '../lib/api';
import MarkdownMessage from './MarkdownMessage';

type AcceptanceState = 'idle' | 'running' | 'passed' | 'failed' | 'blocked';

interface CodeAgentTimelineProps {
  events: CodeAgentTimelineEvent[];
  runId: string;
  isRunning: boolean;
  acceptanceState?: AcceptanceState;
  acceptanceReport?: CodeAcceptanceReport | null;
  acceptanceElapsedSeconds?: number;
  onOpenDiff?: (path: string) => void;
}
const ACTOR_LABEL: Record<CodeAgentActorKind, string> = {
  main: '主代码 Agent',
  test: '测试 Agent',
  ops: '运维 Agent',
  system: '系统',
};

const ACTOR_STYLE: Record<CodeAgentActorKind, string> = {
  main: 'border-blue-200 bg-blue-50 text-blue-700',
  test: 'border-violet-200 bg-violet-50 text-violet-700',
  ops: 'border-amber-200 bg-amber-50 text-amber-700',
  system: 'border-slate-200 bg-slate-50 text-slate-600',
};

const STAGE_LABEL: Record<CodeAgentTimelineEvent['stage'], string> = {
  status: '状态',
  thinking: '思考',
  output: '输出',
  tool_call: '工具调用',
  observation: '观察',
  file_change: '文件变更',
  validation: '校验',
  verification: '验证',
  summary: '总结',
  error: '错误',
};

function statusText(state: AcceptanceState): string {
  if (state === 'running') return '测试 Agent 正在执行';
  if (state === 'passed') return '验收通过';
  if (state === 'failed') return '验收失败，已交给运维 Agent';
  if (state === 'blocked') return '测试已阻塞或终止';
  return '等待测试';
}

function makeTestEvents(
  baseEvents: CodeAgentTimelineEvent[],
  runId: string,
  state: AcceptanceState,
  report: CodeAcceptanceReport | null | undefined,
  elapsedSeconds: number,
): CodeAgentTimelineEvent[] {
  if (state === 'idle') return [];
  const actorId = `test:${runId}`;
  let sequence = Math.max(0, ...baseEvents.map((event) => event.sequence));
  const createdAt = Date.now();
  const next = (
    stage: CodeAgentTimelineEvent['stage'],
    content: string,
    done = true,
    status?: string,
    metrics?: CodeAgentTimelineEvent['metrics'],
    file?: CodeAgentTimelineEvent['file'],
  ): CodeAgentTimelineEvent => {
    sequence += 1;
    return {
      eventId: `${actorId}:${stage}:${sequence}`,
      runId,
      actorId,
      actorKind: 'test',
      stage,
      content,
      done,
      timestampMs: createdAt + sequence,
      sequence,
      status,
      metrics,
      file,
      metadata: { source: 'acceptance-report' },
    };
  };

  const events: CodeAgentTimelineEvent[] = [
    next(
      'status',
      state === 'running'
        ? '测试 Agent 已启动，正在生成验收计划并执行浏览器验证。'
        : `测试 Agent 已完成：${statusText(state)}。`,
      state !== 'running',
      state,
      elapsedSeconds > 0 ? { durationMs: elapsedSeconds * 1_000 } : undefined,
    ),
  ];

  if (report?.plan?.summary) {
    events.push(next('observation', `验收目标：${report.plan.summary}`, true, 'plan'));
  }
  if (report?.model_output) {
    events.push(next(
      'thinking',
      report.model_output,
      true,
      'completed',
      { charCount: report.model_output.length },
    ));
  }
  if (report?.diagnostic) {
    events.push(next('observation', report.diagnostic, true, report.blocked ? 'blocked' : 'diagnostic'));
  }
  for (const artifact of report?.artifacts ?? []) {
    events.push(next(
      'file_change',
      `测试 Agent 读取产物：${artifact.path}`,
      true,
      'observed',
      undefined,
      { ...artifact, operation: 'modify' },
    ));
  }
  for (const assertion of report?.assertions ?? []) {
    const target = assertion.assertion.selector || assertion.assertion.expected || assertion.assertion.kind;
    events.push(next(
      'verification',
      `${assertion.passed ? '通过' : '失败'} · ${target}${assertion.actual ? ` · 实际：${assertion.actual}` : ''}`,
      true,
      assertion.passed ? 'passed' : 'failed',
    ));
  }
  if (report?.runner_stderr) {
    events.push(next('observation', `测试运行器 stderr：\n${report.runner_stderr}`, true, 'stderr'));
  }
  if (report?.runner_stdout) {
    events.push(next('observation', `测试运行器 stdout：\n${report.runner_stdout}`, true, 'stdout'));
  }
  if (report?.network_failures?.length) {
    events.push(next(
      'observation',
      report.network_failures.map((item) => `${item.url} · ${item.error}`).join('\n'),
      true,
      'network_failure',
    ));
  }
  if (report?.returncode != null) {
    events.push(next('verification', `测试运行器退出码：${report.returncode}`, true, report.returncode === 0 ? 'passed' : 'failed'));
  }
  return events;
}

function thoughtSummary(event: CodeAgentTimelineEvent, isRunning: boolean): string {
  const durationMs = event.metrics?.durationMs;
  const duration = durationMs == null ? (isRunning ? '计时中' : '已结束') : `${Math.max(0, Math.round(durationMs / 1_000))} 秒`;
  return `思考 · ${duration} · ${event.content.length.toLocaleString()} 字`;
}

function ActorBadge({ kind }: { kind: CodeAgentActorKind }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${ACTOR_STYLE[kind]}`}>
      {ACTOR_LABEL[kind]}
    </span>
  );
}

function TimelineEventCard({ event, onOpenDiff, isRunning }: {
  event: CodeAgentTimelineEvent;
  onOpenDiff?: (path: string) => void;
  isRunning: boolean;
}) {
  const filePath = event.file?.path || (typeof event.metadata?.path === 'string' ? event.metadata.path : '');
  if (event.stage === 'thinking') {
    return (
      <details className="rounded-lg border border-slate-200 bg-white" open={!event.done && isRunning}>
        <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-slate-600 marker:hidden">
          <span className="mr-2 text-slate-400">⌄</span>{thoughtSummary(event, isRunning)}
          {!event.done && isRunning && <span className="ml-2 animate-pulse text-blue-500">生成中</span>}
        </summary>
        <div className="border-t border-slate-100 px-3 py-3 text-xs leading-6 text-slate-600">
          <div className="whitespace-pre-wrap break-words">{event.content}</div>
        </div>
      </details>
    );
  }

  if (event.stage === 'file_change' && filePath) {
    const additions = event.file?.additions ?? 0;
    const deletions = event.file?.deletions ?? 0;
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
        <div className="min-w-0">
          <div className="text-xs font-medium text-slate-700">{event.content}</div>
          <div className="mt-1 truncate font-mono text-[11px] text-slate-500" title={filePath}>{filePath}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="font-mono text-[11px]">
            <span className="text-emerald-600">+{additions}</span>
            <span className="ml-1.5 text-rose-600">-{deletions}</span>
          </span>
          {onOpenDiff && (
            <button
              type="button"
              onClick={() => onOpenDiff(filePath)}
              className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              查看变更
            </button>
          )}
        </div>
      </div>
    );
  }

  if (event.stage === 'output' || event.stage === 'summary') {
    return (
      <div className="rounded-lg border border-slate-200 bg-white px-3 py-3 text-sm leading-6 text-slate-700">
        <MarkdownMessage content={event.content} />
      </div>
    );
  }

  return (
    <div className={`rounded-lg border px-3 py-2.5 text-xs leading-5 ${event.stage === 'error' ? 'border-rose-200 bg-rose-50 text-rose-700' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>
      <span className="mr-2 rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
        {STAGE_LABEL[event.stage]}
      </span>
      <span className="whitespace-pre-wrap break-words">{event.content}</span>
    </div>
  );
}

export default function CodeAgentTimeline({
  events,
  runId,
  isRunning,
  acceptanceState = 'idle',
  acceptanceReport,
  acceptanceElapsedSeconds = 0,
  onOpenDiff,
}: CodeAgentTimelineProps) {
  const allEvents = useMemo(() => [
    ...events,
    ...makeTestEvents(events, runId, acceptanceState, acceptanceReport, acceptanceElapsedSeconds),
  ].sort((left, right) => left.sequence - right.sequence), [
    acceptanceElapsedSeconds,
    acceptanceReport,
    acceptanceState,
    events,
    runId,
  ]);
  const thinkingChars = allEvents
    .filter((event) => event.stage === 'thinking')
    .reduce((total, event) => total + event.content.length, 0);
  const outputChars = allEvents
    .filter((event) => event.stage === 'output' || event.stage === 'summary')
    .reduce((total, event) => total + event.content.length, 0);
  const fileCount = new Set(allEvents
    .map((event) => event.file?.path || (typeof event.metadata?.path === 'string' ? event.metadata.path : ''))
    .filter(Boolean)).size;

  if (allEvents.length === 0) return null;

  return (
    <section aria-label="代码 AgentLoop 时间线" className="border-t border-slate-200 bg-slate-50/60 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-semibold text-slate-800">AgentLoop · 执行时间线</h4>
          <p className="mt-1 text-[11px] text-slate-500">
            {isRunning ? '正在执行' : '已结束'} · 思考 {thinkingChars.toLocaleString()} 字 · 输出 {outputChars.toLocaleString()} 字 · 文件 {fileCount}
          </p>
        </div>
        {acceptanceState !== 'idle' && (
          <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${acceptanceState === 'passed' ? 'bg-emerald-100 text-emerald-700' : acceptanceState === 'failed' ? 'bg-rose-100 text-rose-700' : acceptanceState === 'blocked' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
            {statusText(acceptanceState)}
          </span>
        )}
      </div>
      <ol className="space-y-2.5">
        {allEvents.map((event) => (
          <li key={event.eventId} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <ActorBadge kind={event.actorKind} />
              <span className="text-[10px] text-slate-400">{STAGE_LABEL[event.stage]}</span>
              {event.status && <span className="text-[10px] text-slate-400">· {event.status}</span>}
            </div>
          <TimelineEventCard event={event} onOpenDiff={onOpenDiff} isRunning={isRunning} />
          </li>
        ))}
      </ol>
    </section>
  );
}
