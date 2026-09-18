import { useMemo, useState } from 'react';

import type {
  CodeAcceptanceReport,
  CodeAgentActorKind,
  CodeAgentRun,
  CodeCompletionFeedback,
  CodeTaskPlanState,
  CodeAgentTimelineEvent,
} from '../lib/api';
import MarkdownMessage from './MarkdownMessage';
import CodeTaskListCard from './CodeTaskListCard';
import {
  AlertCircle,
  Brain,
  CheckCircle2,
  CircleDot,
  ExternalLink,
  Eye,
  FileText,
  ListChecks,
  MessageSquare,
  Terminal,
  Wrench,
} from 'lucide-react';
import { filterHookTimelineEvents, shouldShowActorLabel } from '../Code/agentTimeline';
import { placeAcceptanceTimelineEvents } from '../Code/acceptanceTimeline';
import { getGoldenTraceEligibility } from '../Code/goldenTraceEligibility';

type AcceptanceState = 'idle' | 'running' | 'passed' | 'failed' | 'blocked';

const formatEvidence = (value: unknown): string => {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

interface CodeAgentTimelineProps {
  events: CodeAgentTimelineEvent[];
  runId: string;
  isRunning: boolean;
  acceptanceState?: AcceptanceState;
  acceptanceReport?: CodeAcceptanceReport | null;
  acceptanceElapsedSeconds?: number;
  acceptanceProgressMessage?: string;
  acceptanceStartSequence?: number;
  taskPlan?: CodeTaskPlanState;
  onOpenDiff?: (path: string) => void;
  onOpenTerminal?: (runId?: string) => void;
  sourceRun?: CodeAgentRun;
  onSaveGoldenTrace?: (run: CodeAgentRun) => void;
  title?: string;
}
const ACTOR_LABEL: Record<CodeAgentActorKind, string> = {
  main: '主代码 Agent',
  test: '测试子 Agent / 浏览器验证器',
  ops: '运维 Agent',
  system: '系统',
  readonly: '只读 Agent',
};

const ACTOR_STYLE: Record<CodeAgentActorKind, string> = {
  main: 'text-slate-600',
  test: 'text-slate-500',
  ops: 'text-slate-500',
  system: 'text-slate-400',
  readonly: 'text-slate-500',
};

const timelineDetailIndent = 'ml-2 border-l border-slate-200 pl-3 sm:ml-3 sm:pl-4';
const timelinePanelSurface = 'bg-white';

function StageIcon({
  stage,
  status,
}: {
  stage: CodeAgentTimelineEvent['stage'];
  status?: string;
}) {
  const iconClass = 'h-3.5 w-3.5';
  const statusText = String(status ?? '').toLowerCase();
  const iconTone = statusText === 'failed' || statusText === 'blocked'
    ? 'text-rose-500'
    : statusText === 'passed' || statusText === 'completed'
      ? 'text-emerald-500'
      : 'text-slate-500';
  if (statusText === 'failed' || statusText === 'blocked') return <AlertCircle className={`${iconClass} ${iconTone}`} aria-hidden="true" />;
  if (statusText === 'passed' || statusText === 'completed') return <CheckCircle2 className={`${iconClass} ${iconTone}`} aria-hidden="true" />;
  if (stage === 'preflight' || stage === 'thinking') return <Brain className={`${iconClass} ${iconTone}`} aria-hidden="true" />;
  if (stage === 'tool_call') return <Wrench className={`${iconClass} ${iconTone}`} aria-hidden="true" />;
  if (stage === 'observation') return <Eye className={`${iconClass} ${iconTone}`} aria-hidden="true" />;
  if (stage === 'file_change') return <FileText className={`${iconClass} ${iconTone}`} aria-hidden="true" />;
  if (stage === 'validation' || stage === 'verification') return <ListChecks className={`${iconClass} ${iconTone}`} aria-hidden="true" />;
  if (stage === 'output' || stage === 'summary') return <MessageSquare className={`${iconClass} ${iconTone}`} aria-hidden="true" />;
  return <CircleDot className={`${iconClass} ${iconTone}`} aria-hidden="true" />;
}

const STAGE_LABEL: Record<CodeAgentTimelineEvent['stage'], string> = {
  status: '状态',
  preflight: '执行前思考',
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
  if (state === 'running') return '浏览器验证器正在执行';
  if (state === 'passed') return '验收通过';
  if (state === 'failed') return '浏览器验证未通过，已交给主 Agent';
  if (state === 'blocked') return '浏览器验证已阻塞或终止';
  return '等待浏览器验证';
}

function makeTestEvents(
  baseEvents: CodeAgentTimelineEvent[],
  runId: string,
  state: AcceptanceState,
  report: CodeAcceptanceReport | null | undefined,
  elapsedSeconds: number,
  progressMessage?: string,
  startSequence?: number,
): CodeAgentTimelineEvent[] {
  if (state === 'idle') return [];
  const agentRunId = report?.run_id || runId;
  const verificationRunId = report?.verification_run_id || `${runId}:browser`;
  const actorId = `test:${agentRunId}:${verificationRunId}`;
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
      metadata: {
        source: 'acceptance-report',
        agentRunId,
        verificationRunId,
      },
    };
  };

  const events: CodeAgentTimelineEvent[] = [
    next(
      'status',
      state === 'running'
        ? progressMessage || '确定性浏览器验证器已启动，正在检查页面、可见文本、Console 和 Network。'
        : `确定性浏览器验证器已完成：${statusText(state)}。`,
      state !== 'running',
      state,
      elapsedSeconds > 0 ? { durationMs: elapsedSeconds * 1_000 } : undefined,
    ),
  ];

  const liveTestRunKeys = new Set(
    baseEvents
      .filter((event) => event.metadata?.source === 'test-agent-live')
      .map((event) => String(
        event.metadata?.idempotency_key
        ?? event.metadata?.idempotencyKey
        ?? '',
      ))
      .filter(Boolean),
  );
  const verificationAttempts = report?.verification_attempts ?? [];
  for (const run of report?.test_agent_runs ?? []) {
    if (run.idempotency_key && liveTestRunKeys.has(run.idempotency_key)) continue;
    const testAgentEvent = next(
      'verification',
      `测试子 Agent · ${run.phase} · ${run.diagnostic || run.reason || run.status}`,
      true,
      run.status,
    );
    testAgentEvent.metadata = {
      ...testAgentEvent.metadata,
      source: 'test-agent-run',
      eventType: 'test_agent_run',
      testAgentRun: run,
    };
    events.push(testAgentEvent);
    for (const finding of run.findings ?? []) {
      events.push(next('observation', formatEvidence(finding), true, 'test_agent_finding'));
    }
  }
  if (verificationAttempts.length > 0) {
    for (const attempt of verificationAttempts) {
      events.push(next(
        'status',
          `浏览器验证器第 ${attempt.attempt} 次：执行页面验证`,
        true,
        attempt.status,
      ));
      if (attempt.plan?.summary) {
        events.push(next('observation', `验收目标：${attempt.plan.summary}`, true, 'plan'));
      }
      if (attempt.diagnostic) {
        events.push(next(
          'observation',
          attempt.diagnostic,
          true,
          attempt.blocked ? 'blocked' : attempt.status === 'failed' ? 'diagnostic' : attempt.status,
        ));
      }
      for (const assertion of attempt.assertions ?? []) {
        const target = assertion.assertion.selector || assertion.assertion.expected || assertion.assertion.kind;
        events.push(next(
          'verification',
          `${assertion.passed ? '通过' : '失败'} · ${target}${assertion.actual ? ` · 实际：${formatEvidence(assertion.actual)}` : ''}`,
          true,
          assertion.passed ? 'passed' : 'failed',
        ));
      }
    }
  } else {
    if (report?.plan?.summary) {
      events.push(next('observation', `验收目标：${report.plan.summary}`, true, 'plan'));
    }
    if (report?.diagnostic) {
      events.push(next('observation', report.diagnostic, true, report.blocked ? 'blocked' : 'diagnostic'));
    }
  }
  for (const artifact of report?.artifacts ?? []) {
    events.push(next(
      'verification',
      `验证产物：${artifact.path}`,
      true,
      'observed',
    ));
  }
  for (const assertion of report?.assertions ?? []) {
    const target = assertion.assertion.selector || assertion.assertion.expected || assertion.assertion.kind;
    events.push(next(
      'verification',
      `${assertion.passed ? '通过' : '失败'} · ${target}${assertion.actual ? ` · 实际：${formatEvidence(assertion.actual)}` : ''}`,
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
  return placeAcceptanceTimelineEvents(events, baseEvents, startSequence);
}

function thoughtSummary(event: CodeAgentTimelineEvent, isRunning: boolean): string {
  const durationMs = event.metrics?.durationMs;
  const duration = durationMs == null ? (!event.done && isRunning ? '计时中' : '已结束') : `${Math.max(0, Math.round(durationMs / 1_000))} 秒`;
  const iteration = event.iteration == null ? '' : `第 ${event.iteration} 轮 · `;
  const label = event.actorKind === 'readonly'
    ? event.stage === 'preflight' ? '读取前置分析' : '读取分析'
    : event.stage === 'preflight' ? '执行前思考' : '思考';
  return `${iteration}${label} · ${duration} · ${event.content.length.toLocaleString()} 字`;
}

function ActorBadge({ kind }: { kind: CodeAgentActorKind }) {
  return (
    <span className={`inline-flex items-center text-xs font-medium ${ACTOR_STYLE[kind]}`}>
      {ACTOR_LABEL[kind]}
    </span>
  );
}

function FullToolResultCard({ event, toolName, report }: {
  event: CodeAgentTimelineEvent;
  toolName: string;
  report: string;
}) {
  return (
    <details className={`rounded-md ${timelinePanelSurface} px-3 sm:px-4`} open>
      <summary className="cursor-pointer list-none py-2 text-xs leading-5 text-slate-600 marker:hidden">
        <span className="mr-2 text-[10px] font-medium text-slate-400">
          状态
        </span>
        <span className="font-medium">{event.content}</span>
      </summary>
      <div className={`${timelineDetailIndent} pb-2`}>
        <div className="mb-1 text-xs font-medium text-slate-500">
          {toolName} 完整返回
        </div>
        <pre
          tabIndex={0}
          className={`max-h-96 overflow-auto whitespace-pre-wrap break-words ${timelinePanelSurface} p-2 font-mono text-[11px] leading-5 text-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}
        >
          {report}
        </pre>
      </div>
    </details>
  );
}

function formatCommand(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => {
      const text = String(item ?? '');
      return /[\s"']/.test(text) ? `"${text.replaceAll('"', '\\"')}"` : text;
    }).join(' ');
  }
  return typeof value === 'string' ? value : value == null ? '' : formatEvidence(value);
}

function formatOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  return value == null ? '' : formatEvidence(value);
}

function isCompiledContract(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Array.isArray(record.checks) && record.checks.length > 0;
}

function runtimeCompiledContract(report: Record<string, unknown>): unknown {
  const direct = report.measurement_contract;
  if (isCompiledContract(direct)) return direct;

  const goal = report.acceptance_goal;
  if (!goal || typeof goal !== 'object') return null;
  const goalRecord = goal as Record<string, unknown>;
  const goalContract = goalRecord.measurement_contract;
  if (isCompiledContract(goalContract) && goalRecord.valid === true) {
    return goalContract;
  }
  const metadata = goalRecord.metadata;
  const runtimeProof = metadata && typeof metadata === 'object'
    ? (metadata as Record<string, unknown>).runtime_proof
    : null;
  const executionPlan = runtimeProof && typeof runtimeProof === 'object'
    ? (runtimeProof as Record<string, unknown>).execution_plan
    : null;
  return executionPlan && typeof executionPlan === 'object'
    && isCompiledContract((executionPlan as Record<string, unknown>).contract)
    ? (executionPlan as Record<string, unknown>).contract
    : null;
}

function TestAgentEvidenceCard({ event, onOpenTerminal }: {
  event: CodeAgentTimelineEvent;
  onOpenTerminal?: (runId?: string) => void;
}) {
  const metadata = event.metadata ?? {};
  const report = (metadata.testAgentRun && typeof metadata.testAgentRun === 'object'
    ? metadata.testAgentRun
    : metadata) as Record<string, unknown>;
  const command = formatCommand(report.command);
  const stdout = formatOutput(report.stdout ?? report.runner_stdout);
  const stderr = formatOutput(report.stderr ?? report.runner_stderr);
  const artifact = formatOutput(report.artifact);
  const candidateRevision = formatOutput(report.candidate_revision);
  const contract = runtimeCompiledContract(report);
  const draft = report.generated_contract ?? report.generated_goal ?? (
    contract == null ? report.acceptance_goal : null
  );
  const contractText = contract == null ? '' : formatEvidence(contract);
  const draftText = draft == null ? '' : formatEvidence(draft);
  const validationErrors = formatOutput(report.validation_errors);
  const hasDetails = Boolean(
    command || stdout || stderr || report.returncode != null || artifact
      || candidateRevision || contractText || draftText || validationErrors,
  );
  const status = String(event.status || report.status || 'scheduled');
  const shouldOpen = status === 'failed' || status === 'blocked';

  return (
    <div className={`flex items-start gap-2 rounded-md ${timelinePanelSurface} px-3 py-2 sm:px-4`}>
      <details className="min-w-0 flex-1" open={shouldOpen}>
        <summary className="flex cursor-pointer list-none items-center gap-2 text-xs leading-5 text-slate-600 marker:hidden">
          <span aria-hidden="true" className="text-slate-400">⌄</span>
          <Terminal size={13} aria-hidden="true" className="shrink-0 text-slate-400" />
          <span className="min-w-0 flex-1 break-words font-medium">{event.content}</span>
          {!hasDetails && <span className="shrink-0 text-[11px] text-slate-400">等待结果</span>}
        </summary>
        <div className={`${timelineDetailIndent} mt-2 space-y-2 text-xs leading-5 text-slate-600`}>
          {artifact && (
            <div className="text-slate-500">脚本：<code className="font-mono text-slate-700">{artifact}</code></div>
          )}
          {candidateRevision && (
            <div className="text-slate-500">候选版本：<code className="font-mono text-slate-700">{candidateRevision}</code></div>
          )}
          {contractText && (
            <div>
              <div className="mb-1 font-medium text-emerald-700">Runtime 已闭合的验收契约</div>
              <pre tabIndex={0} aria-label="Runtime 已闭合的验收契约" className={`max-h-56 overflow-auto whitespace-pre-wrap break-words rounded ${timelinePanelSurface} px-2 py-1.5 font-mono text-[11px] leading-5 text-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}>{contractText}</pre>
            </div>
          )}
          {!contractText && draftText && (
            <div>
              <div className="mb-1 font-medium text-amber-700">重规划候选（尚未形成验收契约）</div>
              <pre tabIndex={0} aria-label="尚未闭合的重规划候选" className={`max-h-56 overflow-auto whitespace-pre-wrap break-words rounded ${timelinePanelSurface} px-2 py-1.5 font-mono text-[11px] leading-5 text-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}>{draftText}</pre>
            </div>
          )}
          {validationErrors && (
            <div>
              <div className="mb-1 font-medium text-rose-700">Runtime 未闭合原因</div>
              <pre tabIndex={0} aria-label="Runtime 未闭合原因" className={`max-h-40 overflow-auto whitespace-pre-wrap break-words rounded ${timelinePanelSurface} px-2 py-1.5 font-mono text-[11px] leading-5 text-rose-700 outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}>{validationErrors}</pre>
            </div>
          )}
          {command && (
            <div>
              <div className="mb-1 font-medium text-slate-500">执行命令</div>
              <pre tabIndex={0} aria-label="测试子 Agent 执行命令" className={`max-h-24 overflow-auto whitespace-pre-wrap break-all rounded ${timelinePanelSurface} px-2 py-1.5 font-mono text-[11px] leading-5 text-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}>{command}</pre>
            </div>
          )}
          {stdout && (
            <div>
              <div className="mb-1 font-medium text-emerald-700">标准输出 stdout</div>
              <pre tabIndex={0} aria-label="测试子 Agent 标准输出" className={`max-h-56 overflow-auto whitespace-pre-wrap break-words rounded ${timelinePanelSurface} px-2 py-1.5 font-mono text-[11px] leading-5 text-slate-700 outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}>{stdout}</pre>
            </div>
          )}
          {stderr && (
            <div>
              <div className="mb-1 font-medium text-rose-700">错误输出 stderr</div>
              <pre tabIndex={0} aria-label="测试子 Agent 错误输出" className={`max-h-56 overflow-auto whitespace-pre-wrap break-words rounded ${timelinePanelSurface} px-2 py-1.5 font-mono text-[11px] leading-5 text-rose-700 outline-none focus-visible:ring-2 focus-visible:ring-blue-500`}>{stderr}</pre>
            </div>
          )}
          {report.returncode != null && (
            <div className={Number(report.returncode) === 0 ? 'text-emerald-700' : 'text-rose-700'}>
              退出码：<code className="font-mono">{String(report.returncode)}</code>
            </div>
          )}
        </div>
      </details>
      {onOpenTerminal && (
        <button
          type="button"
          title="跳转到右侧终端"
          aria-label="跳转到右侧终端"
          onClick={() => onOpenTerminal(event.runId)}
          className="mt-0.5 shrink-0 rounded border border-slate-200 bg-white p-1.5 text-slate-500 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
        >
          <ExternalLink size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function TimelineEventCard({ event, onOpenDiff, onOpenTerminal, isRunning }: {
  event: CodeAgentTimelineEvent;
  onOpenDiff?: (path: string) => void;
  onOpenTerminal?: (runId?: string) => void;
  isRunning: boolean;
}) {
  const source = event.metadata?.source;
  const eventType = event.metadata?.eventType;
  if (
    event.actorKind === 'test'
    && (eventType === 'test_agent_execution' || eventType === 'test_agent_result' || eventType === 'test_agent_contract_replan' || eventType === 'test_agent_run')
  ) {
    return <TestAgentEvidenceCard event={event} onOpenTerminal={onOpenTerminal} />;
  }
  if (
    event.actorKind === 'test'
    && source === 'test-agent-live'
    && (event.metadata?.artifact === 'test_agent.py' || event.metadata?.command || event.metadata?.stdout || event.metadata?.stderr)
  ) {
    return <TestAgentEvidenceCard event={event} onOpenTerminal={onOpenTerminal} />;
  }
  const filePath = event.file?.path || (typeof event.metadata?.path === 'string' ? event.metadata.path : '');
  const toolName = typeof event.metadata?.tool_name === 'string' ? event.metadata.tool_name : '';
  const toolReport = typeof event.metadata?.tool_report === 'string' ? event.metadata.tool_report : '';
  if (event.stage === 'status' && toolName && toolReport) {
    return <FullToolResultCard event={event} toolName={toolName} report={toolReport} />;
  }
  if (event.stage === 'preflight' || event.stage === 'thinking') {
    return (
      <details className={`rounded-md ${timelinePanelSurface} px-3 sm:px-4`} open={!event.done && isRunning}>
        <summary className="cursor-pointer list-none py-2 text-xs font-medium text-slate-600 marker:hidden">
          <span className="mr-2 text-slate-400">⌄</span>{thoughtSummary(event, isRunning)}
          {!event.done && isRunning && <span className="ml-2 animate-pulse text-blue-500">生成中</span>}
        </summary>
        <div className={`${timelineDetailIndent} pb-2 text-xs leading-5 text-slate-600`}>
          <div className="whitespace-pre-wrap break-words">{event.content}</div>
        </div>
      </details>
    );
  }

  if (event.stage === 'file_change' && filePath) {
    const additions = event.file?.additions ?? 0;
    const deletions = event.file?.deletions ?? 0;
    return (
      <div className={`flex items-center justify-between gap-3 rounded-md ${timelinePanelSurface} px-3 py-2 sm:px-4`}>
        <div className="min-w-0">
          <div className="text-xs font-medium text-slate-700">{event.content}</div>
          <div className="mt-0.5 truncate font-mono text-[11px] text-slate-500" title={filePath}>{filePath}</div>
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
              className="rounded-md border border-slate-100 bg-white px-2 py-0.5 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
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
      <div className={`rounded-md ${timelinePanelSurface} px-3 py-2 text-sm leading-5 text-slate-700 sm:px-4`}>
        <MarkdownMessage content={event.content} />
      </div>
    );
  }

  return (
    <div className={`rounded-md ${timelinePanelSurface} px-3 py-2 text-xs leading-5 sm:px-4 ${event.stage === 'error' ? 'text-rose-700' : 'text-slate-600'}`}>
      <span className="mr-2 text-[10px] font-medium text-slate-400">
        {STAGE_LABEL[event.stage]}
      </span>
      <span className="whitespace-pre-wrap break-words">{event.content}</span>
    </div>
  );
}

function formatVerificationValue(value: unknown): string {
  if (value == null || value === '') return '未运行';
  const labels: Record<string, string> = {
    passed: '通过',
    verified: '通过',
    completed: '完成',
    completed_unverified: '完成，未验收',
    awaiting_runtime_verification: '等待验收',
    unavailable: '不可用',
    not_run: '未运行',
    pending: '等待中',
    failed: '失败',
    blocked: '已阻塞',
    inconclusive: '无法确定',
  };
  const text = String(value);
  return labels[text] ?? text;
}

function CompletionFeedbackCard({
  feedback,
  onOpenDiff,
}: {
  feedback: CodeCompletionFeedback;
  onOpenDiff?: (path: string) => void;
}) {
  const changes = feedback.changes ?? [];
  const verification = feedback.verification ?? {
    status: 'unknown',
    static_validation: 'unknown',
    acceptance_validation: 'not_run',
  };
  const validationErrors = verification.validation_errors ?? [];
  return (
    <div aria-label="代码完成反馈" className={`mb-2 rounded-md ${timelinePanelSurface} p-2.5 text-xs text-slate-700`}>
      <div className="mb-1 font-semibold text-slate-800">完成反馈</div>
      {feedback.summary && <MarkdownMessage content={feedback.summary} density="compact" />}
      <div className="mt-2 font-medium text-slate-600">已完成修改 · {changes.length} 个文件</div>
      {changes.length > 0 ? (
        <div className="mt-1 space-y-1">
          {changes.map((change) => (
            <div key={`${change.operation ?? 'modify'}:${change.path}`} className={`flex items-center justify-between gap-2 rounded ${timelinePanelSurface} px-2 py-1`}>
              <div className="min-w-0">
                <span className="mr-1.5 text-slate-500">{change.operation === 'create' ? '新增' : change.operation === 'delete' ? '删除' : '修改'}</span>
                <code className="break-all text-[11px]">{change.path}</code>
              </div>
              <span className="shrink-0 font-mono text-[11px]">
                <span className="text-emerald-600">+{change.additions}</span>
                <span className="ml-1.5 text-rose-600">-{change.deletions}</span>
              </span>
              {onOpenDiff && change.operation !== 'delete' && (
                <button
                  type="button"
                  onClick={() => onOpenDiff(change.path)}
                  className="shrink-0 rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                >
                  查看
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-1 text-slate-400">没有检测到文件差异。</div>
      )}
      <div className="mt-2 font-medium text-slate-600">验证结果</div>
      <div className="mt-1 grid gap-1 text-[11px] sm:grid-cols-3">
        <span>运行状态：{formatVerificationValue(verification.status)}</span>
        <span>静态校验：{formatVerificationValue(verification.static_validation)}</span>
        <span>自动验收：{formatVerificationValue(verification.acceptance_validation)}</span>
      </div>
      {validationErrors.length > 0 && (
        <details className={`mt-2 rounded ${timelinePanelSurface} px-2 py-1.5 text-[11px] text-amber-800`}>
          <summary className="cursor-pointer font-medium">查看验证诊断（{validationErrors.length}）</summary>
          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words">{validationErrors.map(formatEvidence).join('\n')}</pre>
        </details>
      )}
    </div>
  );
}

function projectLegacyCompletionFeedback(sourceRun?: CodeAgentRun): CodeCompletionFeedback | undefined {
  const trace = sourceRun?.trace;
  const changes = trace?.fileChanges;
  if (!trace || !changes?.length) return undefined;
  const status = trace.status ?? 'unknown';
  return {
    summary: trace.summary ?? '',
    changes: changes.map((change) => ({ ...change, operation: 'modify' })),
    verification: {
      status,
      static_validation: 'unknown',
      acceptance_validation: status === 'completed_unverified' ? 'unavailable' : 'not_run',
    },
  };
}

function TimelineEventList({
  events,
  onOpenDiff,
  onOpenTerminal,
  isRunning,
}: {
  events: CodeAgentTimelineEvent[];
  onOpenDiff?: (path: string) => void;
  onOpenTerminal?: (runId?: string) => void;
  isRunning: boolean;
}) {
  return (
    <ol className="relative space-y-0">
      {events.map((event, index) => (
        <li key={event.eventId} className="relative pl-7 sm:pl-8">
          {index < events.length - 1 && (
            <span aria-hidden="true" className="absolute bottom-0 left-2.5 top-6 w-px bg-slate-200" />
          )}
          <span
            aria-hidden="true"
            className={`absolute left-0 top-0.5 flex h-5 w-5 items-center justify-center rounded-full border bg-white shadow-sm ${
              event.status === 'failed' || event.status === 'blocked'
                ? 'border-rose-200'
                : event.status === 'passed' || event.status === 'completed'
                  ? 'border-emerald-200'
                  : 'border-slate-200'
            }`}
          >
            <StageIcon stage={event.stage} status={event.status} />
          </span>
            <div className="relative pb-3">
              <div className="flex min-h-6 flex-wrap items-center gap-1.5">
                {shouldShowActorLabel(events, index) && (
                  <span className="inline-flex items-center rounded-full bg-slate-50 px-1.5 py-0.5">
                    <ActorBadge kind={event.actorKind} />
                  </span>
                )}
                <span className="text-xs font-medium text-slate-500">{STAGE_LABEL[event.stage]}</span>
                {event.status && <span className="text-xs text-slate-400">· {event.status}</span>}
            </div>
            <TimelineEventCard event={event} onOpenDiff={onOpenDiff} onOpenTerminal={onOpenTerminal} isRunning={isRunning} />
          </div>
        </li>
      ))}
    </ol>
  );
}

function TimelineActorControls({
  actorKinds,
  collapsedActorKinds,
  onToggle,
}: {
  actorKinds: CodeAgentActorKind[];
  collapsedActorKinds: Set<CodeAgentActorKind>;
  onToggle: (kind: CodeAgentActorKind) => void;
}) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2" aria-label="Agent 链路控制">
      {actorKinds.map((kind) => {
        const expanded = !collapsedActorKinds.has(kind);
        return (
          <button
            key={kind}
            type="button"
            aria-expanded={!collapsedActorKinds.has(kind)}
            aria-label={`${ACTOR_LABEL[kind]}${expanded ? '，收起链路' : '，展开链路'}`}
            onClick={() => onToggle(kind)}
            className="inline-flex items-center gap-1.5 rounded-md bg-white px-1 py-1 text-xs transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
          >
            <ActorBadge kind={kind} />
            <span className="text-slate-400">{expanded ? '收起' : '展开'}</span>
            <span aria-hidden="true" className="text-slate-400">{expanded ? '⌃' : '⌄'}</span>
          </button>
        );
      })}
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
  acceptanceProgressMessage,
  acceptanceStartSequence,
  taskPlan,
  onOpenDiff,
  onOpenTerminal,
  sourceRun,
  onSaveGoldenTrace,
  title = 'AgentLoop · 执行时间线',
}: CodeAgentTimelineProps) {
  // New runs use the Runtime-owned completion ledger. Keep a read-only
  // projection for older/partial event streams that already recorded the
  // authoritative file delta but did not carry completion_feedback; this
  // prevents the final file list from disappearing during a protocol upgrade.
  const completionFeedback = sourceRun?.trace.completionFeedback
    ?? projectLegacyCompletionFeedback(sourceRun);
  const visibleEvents = useMemo(
    () => filterHookTimelineEvents(events).filter((event) => (
      event.metadata?.source !== 'context_usage'
      // The final VFS ledger below replaces every provisional file event.
      // Keeping both would show duplicate or stale line counts.
      && !(completionFeedback && event.stage === 'file_change')
    )),
    [completionFeedback, events],
  );
  const allEvents = useMemo(() => [
    ...visibleEvents,
    ...makeTestEvents(
      visibleEvents,
      runId,
      acceptanceState,
      acceptanceReport,
      acceptanceElapsedSeconds,
      acceptanceProgressMessage,
      acceptanceStartSequence,
    ),
  ].sort((left, right) => left.sequence - right.sequence), [
    acceptanceElapsedSeconds,
    acceptanceProgressMessage,
    acceptanceReport,
    acceptanceState,
    acceptanceStartSequence,
    visibleEvents,
    runId,
  ]);
  const thinkingChars = allEvents
    .filter((event) => event.stage === 'preflight' || event.stage === 'thinking')
    .reduce((total, event) => total + event.content.length, 0);
  const outputChars = allEvents
    .filter((event) => event.stage === 'output' || event.stage === 'summary')
    .reduce((total, event) => total + event.content.length, 0);
  const fileCount = completionFeedback
    ? completionFeedback.changes.length
    : new Set(allEvents
      .map((event) => event.file?.path || (typeof event.metadata?.path === 'string' ? event.metadata.path : ''))
      .filter(Boolean)).size;
  const goldenTraceEligibility = getGoldenTraceEligibility(sourceRun);
  const actorKinds = useMemo(
    () => Array.from(new Set(allEvents.map((event) => event.actorKind))),
    [allEvents],
  );
  const [collapsedActorKinds, setCollapsedActorKinds] = useState<Set<CodeAgentActorKind>>(new Set());
  const renderEvents = useMemo(
    () => allEvents.filter((event) => !collapsedActorKinds.has(event.actorKind)),
    [allEvents, collapsedActorKinds],
  );
  const toggleActorLane = (kind: CodeAgentActorKind) => {
    setCollapsedActorKinds((current) => {
      const next = new Set(current);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };
  if (allEvents.length === 0 && !taskPlan && !completionFeedback) return null;

  return (
    <section aria-label={title} className="border-t border-slate-200 bg-white px-4 py-3 sm:px-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-sky-50 text-sky-600" aria-hidden="true">
            <MessageSquare className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <h4 className="text-xs font-semibold text-slate-800">{title}</h4>
            <p className="mt-1 text-[11px] text-slate-500">
              {isRunning ? '正在执行' : '已结束'} · 思考 {thinkingChars.toLocaleString()} 字 · 输出 {outputChars.toLocaleString()} 字 · 文件 {fileCount}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {acceptanceState !== 'idle' && (
            <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${acceptanceState === 'passed' ? 'bg-emerald-100 text-emerald-700' : acceptanceState === 'failed' ? 'bg-rose-100 text-rose-700' : acceptanceState === 'blocked' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
              {statusText(acceptanceState)}
            </span>
          )}
          {sourceRun && onSaveGoldenTrace && goldenTraceEligibility.eligible && (
            <button
              type="button"
              title="保存这条已通过真实浏览器验收的运行轨迹"
              aria-label="保存为 Golden Trace"
              onClick={() => onSaveGoldenTrace(sourceRun)}
              className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-800 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
            >
              保存为 Golden Trace
            </button>
          )}
        </div>
      </div>
      {taskPlan && <CodeTaskListCard plan={taskPlan} onOpenFile={onOpenDiff} />}
      <TimelineActorControls
        actorKinds={actorKinds}
        collapsedActorKinds={collapsedActorKinds}
        onToggle={toggleActorLane}
      />
      <TimelineEventList
        events={renderEvents}
        onOpenDiff={onOpenDiff}
        onOpenTerminal={onOpenTerminal}
        isRunning={isRunning}
      />
      {completionFeedback && (
        <CompletionFeedbackCard feedback={completionFeedback} onOpenDiff={onOpenDiff} />
      )}
    </section>
  );
}
