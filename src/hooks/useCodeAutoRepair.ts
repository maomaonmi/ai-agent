'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fixFullstackCode,
  fixWebCode,
  generateFullstackCode,
  generateWebCode,
  modifyFullstackCode,
  modifyWebCode,
  requestCodeContextCompaction,
  runCodeAcceptanceTest,
  verifyFullstackRuntime,
  type ChatAttachment,
  type CodeAgentRun,
  type CodeAgentActorKind,
  type CodeAgentActivityEvent,
  type CodeAgentTrace,
  type CodeAgentTimelineEvent,
  type CodeAgentTimelineStage,
  type CodeFileChange,
  type CodeIntentActiveRun,
  type CodeIntentTurn,
  type CodeTaskScope,
  type CodeGenerationEvent,
  type ContextUsageEvent,
  type HookEvent,
  type TokenUsageEvent,
  type McpMode,
  type RuntimeVerificationEvidence,
} from '../lib/api';
import { appendTimelineEvent, completeTimelineEvent } from '../Code/agentTimeline';
import { classifyCodeGenerationEvent, summarizeAgentLoopRound } from '../Code/agentEventRouting';
import { applyCodeTaskEvent } from '../Code/codeTaskPlan';
import { resetAgentRuns } from '../Code/agentRunLifecycle';
import { canStartRuntimeRepair } from '../Code/acceptancePolicy';
import {
  bundleFullstackVFS,
  isFullstackVFS,
  isManifestProjectVFS,
  parseProjectCode,
} from '../Code/fullstackBundler';
import { bundleVFS } from '../Code/vfsBundler';
import {
  CodeGenerationStatus,
  RepairLog,
  RuntimeErrorReport,
  SandboxConsoleEntry,
  SelectedElementContext,
} from '../lib/codeSandbox';

const ERROR_CHECK_WINDOW_MS = 1200;
const MAX_REPAIR_DIAGNOSTIC_CHARS = 3_900;
const MAX_REPAIR_INFRASTRUCTURE_FAILURES = 3;

function clipRepairText(value: string | undefined, limit: number): string | undefined {
  if (value == null) return undefined;
  return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 18))}\n...[truncated]`;
}

function normalizeRuntimeVerificationEvidence(
  evidence: RuntimeVerificationEvidence,
): RuntimeVerificationEvidence {
  return {
    ...evidence,
    target_error: evidence.target_error ? {
      ...evidence.target_error,
      type: clipRepairText(evidence.target_error.type, 120) ?? 'RuntimeError',
      message: clipRepairText(evidence.target_error.message, 2_000) ?? 'Runtime error',
      source: clipRepairText(evidence.target_error.source, 500),
      stack: clipRepairText(evidence.target_error.stack, 4_000),
    } : undefined,
    changed_files: evidence.changed_files.slice(0, 50),
    new_errors: evidence.new_errors.slice(0, 20).map((item) => clipRepairText(item, 2_000) ?? ''),
    console_errors: evidence.console_errors.slice(0, 20).map((item) => clipRepairText(item, 2_000) ?? ''),
    diagnostic: clipRepairText(evidence.diagnostic, 2_000) ?? '',
  };
}

function buildBoundedRepairDiagnostic(
  runtimeError: RuntimeErrorReport,
  occurrence: number,
  recentErrors: string[],
): string {
  const diagnostic = [
    formatRuntimeError(runtimeError),
    `This error has occurred ${occurrence} time(s) in the current repair cycle.`,
    occurrence >= 2
      ? 'The previous approach did not solve this error. Do not repeat it. Re-diagnose from a different layer before choosing a new minimal patch.'
      : '',
    recentErrors.length > 1
      ? `Recent error history (oldest to newest):\n${recentErrors.slice(-5).map((item, index) => `${index + 1}. ${clipRepairText(item, 500)}`).join('\n')}`
      : '',
  ].filter(Boolean).join('\n\n');
  return diagnostic.length <= MAX_REPAIR_DIAGNOSTIC_CHARS
    ? diagnostic
    : `${diagnostic.slice(0, MAX_REPAIR_DIAGNOSTIC_CHARS - 18)}\n...[truncated]`;
}

function isRepairInfrastructureFailure(message: string): boolean {
  return /at most 4000 characters|max_length|validation error|HTTP 422|Failed to fetch|NetworkError/i.test(message);
}

// Why: MCP 会话级注入配置。generate/modify 调用时传入并缓存到 ref，
//   handleRuntimeError 自动修复复用，与 sessionIdRef 同一生命周期模式。
export interface McpRequestContext {
  mode: McpMode;
  serverIds: string[];
  intent?: 'action' | 'runtime_fix' | 'resume';
  resume?: boolean;
}

const EMPTY_AGENT_TRACE: CodeAgentTrace = {
  steps: [],
  output: '',
  reasoning: '',
  phase: '',
  isRunning: false,
  summary: '',
  summaryIntent: 'patch',
  status: 'completed',
  resumeEligible: false,
  terminalProposals: [],
  hookEvents: [],
  timeline: [],
};

const ENVELOPE_TOP_KEYS: ReadonlySet<string> = new Set([
  'intent', 'summary', 'payload', 'terminal_commands', 'rationale',
]);

/**
 * 前端最后一道"UNIFIED ENVELOPE 剥壳"安全网。
 *
 * Why:
 * - 后端 normalize_agent_envelope 有一条退路：破损 JSON / 不明 dict → _text_to_answer()
 *   把整段原 envelope JSON 当纯文本打成 intent=answer，再通过 runtime_summary 或
 *   agent_activity.channel=answer 发给前端。
 * - 结果用户在"回答"气泡里看到一大串 `{ "intent": "fullstack_bootstrap", ... }` 外壳字符串。
 * - 这里在 consumeAgentEvent 消费前先 try-parse：
 *   1) 如果能合法 JSON.parse，且顶层 3+ 个键在 ENVELOPE_TOP_KEYS 里 → 认为是 envelope；
 *   2) 从 payload.text / payload.html / payload.code / summary 里挑真实文本；
 *   3) 同时返回纠正后的 intent（而不是误传的 'answer' / 'ask_clarification'）。
 * - 即使 JSON 破损（如结尾 `\"}}` 没闭合），也先用字面量正则抠 payload.html 或 summary。
 */
function stripEnvelopeFromAnswerText(
  rawText: string,
  fallbackIntent: CodeAgentTrace['summaryIntent'],
): { text: string; intent: CodeAgentTrace['summaryIntent'] } {
  const clean = (rawText ?? '').trim();
  if (!clean) return { text: '', intent: fallbackIntent };
  if (!clean.startsWith('{')) return { text: clean, intent: fallbackIntent };

  // 1) 尝试完整 JSON 解析
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(clean);
  } catch {
    parsed = null;
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const obj = parsed as Record<string, unknown>;
    const hits = Object.keys(obj).filter((k) => ENVELOPE_TOP_KEYS.has(k));
    if (hits.length >= 3) {
      const intentRaw = obj.intent;
      const intent: CodeAgentTrace['summaryIntent'] =
        intentRaw === 'patch' || intentRaw === 'fullstack_bootstrap' ||
        intentRaw === 'answer' || intentRaw === 'ask_clarification'
          ? intentRaw : fallbackIntent;
      const payload = obj.payload;
      let text = '';
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        const p = payload as Record<string, unknown>;
        if (typeof p.text === 'string' && p.text.trim()) text = p.text;
        else if (typeof p.html === 'string' && p.html.trim()) text = `\`\`\`html\n${p.html.slice(0, 1200)}${p.html.length > 1200 ? '\n... (已截断)' : ''}\n\`\`\``;
        else if (typeof p.code === 'string' && p.code.trim()) text = `\`\`\`\n${(p.code as string).slice(0, 1200)}${(p.code as string).length > 1200 ? '\n... (已截断)' : ''}\n\`\`\``;
      }
      if (!text && typeof obj.summary === 'string' && obj.summary.trim()) {
        text = obj.summary;
      }
      return { text: text || clean, intent };
    }
  }

  // 2) 破损 JSON：字面量兜底提取 summary / payload.html / payload.text
  const tryGroup = (re: RegExp): string | null => {
    const m = clean.match(re);
    if (!m || !m[1]) return null;
    try {
      // JSON 字符串字面量 -> 反转义
      // eslint-disable-next-line no-new-func
      return (Function('"use strict"; return (' + m[1].replace(/\n/g, '\\n') + ')')()) as string;
    } catch {
      // 反转义失败：直接去掉一层 \" → " 作为启发式
      return m[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
  };
  const recoveredText =
    tryGroup(/"payload"\s*:\s*\{[\s\S]*?"html"\s*:\s*("(?:\\.|[^"\\])*")/) ||
    tryGroup(/"payload"\s*:\s*\{[\s\S]*?"text"\s*:("(?:\\.|[^"\\])*")/) ||
    tryGroup(/"summary"\s*:\s*("(?:\\.|[^"\\])*")/);
  if (recoveredText) {
    // intent 尽力从破损字面量里抠
    const intentMatch = clean.match(/"intent"\s*:\s*"(patch|fullstack_bootstrap|answer|ask_clarification)"/);
    const intent: CodeAgentTrace['summaryIntent'] = intentMatch?.[1] as CodeAgentTrace['summaryIntent'] | undefined
      ?? fallbackIntent;
    return { text: recoveredText, intent };
  }
  return { text: clean, intent: fallbackIntent };
}

function formatRuntimeError(error: RuntimeErrorReport) {
  return [
    error.message,
    error.source ? `Source: ${error.source}` : '',
    error.line ? `Line: ${error.line}, Column: ${error.column ?? 0}` : '',
    error.stack ? `Stack: ${error.stack}` : '',
  ].filter(Boolean).join('\n');
}

function codeToFiles(code: string): Record<string, string> {
  if (!code.trim()) return {};
  return parseProjectCode(code) ?? { 'index.html': code };
}

function countChangedLines(before: string, after: string) {
  const beforeLines = before ? before.split(/\r?\n/) : [];
  const afterLines = after ? after.split(/\r?\n/) : [];
  let prefix = 0;
  while (
    prefix < beforeLines.length &&
    prefix < afterLines.length &&
    beforeLines[prefix] === afterLines[prefix]
  ) prefix += 1;

  let suffix = 0;
  while (
    suffix < beforeLines.length - prefix &&
    suffix < afterLines.length - prefix &&
    beforeLines[beforeLines.length - 1 - suffix] === afterLines[afterLines.length - 1 - suffix]
  ) suffix += 1;

  return {
    additions: Math.max(0, afterLines.length - prefix - suffix),
    deletions: Math.max(0, beforeLines.length - prefix - suffix),
  };
}

function summarizeFileChanges(beforeCode: string, afterCode: string): CodeFileChange[] {
  const beforeFiles = codeToFiles(beforeCode);
  const afterFiles = codeToFiles(afterCode);
  return Array.from(new Set([...Object.keys(beforeFiles), ...Object.keys(afterFiles)]))
    .sort()
    .map((path) => ({ path, ...countChangedLines(beforeFiles[path] ?? '', afterFiles[path] ?? '') }))
    .filter((change) => change.additions > 0 || change.deletions > 0);
}

export default function useCodeAutoRepair() {
  const [code, setCodeState] = useState('');
  const [status, setStatus] = useState<CodeGenerationStatus>({ state: 'idle' });
  const [runId, setRunId] = useState('');
  const [repairLogs, setRepairLogs] = useState<RepairLog[]>([]);
  const [agentTrace, setAgentTrace] = useState<CodeAgentTrace>(EMPTY_AGENT_TRACE);
  const [agentRuns, setAgentRuns] = useState<CodeAgentRun[]>([]);
  const [terminalWorkspaceId] = useState<string>(() => {
    // Why: 前端单浏览器窗口内的所有 agent run 共享一个 workspace_id（简单场景就"default"也行），
    // 但不同 tab 需要区分，所以在 localStorage 里给每个浏览器 tab 持久化一个 `terminal-ws-xxx`，
    // 这样用户开两个窗口各自 agent 的终端不会乱。
    const KEY = 'terminal-workspace-id';
    try {
      const existing = window.localStorage.getItem(KEY);
      if (existing) return existing;
    } catch { /* noop */ }
    const id = `ws-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    try { window.localStorage.setItem(KEY, id); } catch { /* noop */ }
    return id;
  });
  // 会话级（本次 tab session）的信任白名单，按 runId 分组，关页面就失效。
  const [trustedTerminalPrefixes, setTrustedTerminalPrefixes] = useState<Record<string, string[]>>({});

  const codeRef = useRef('');
  const runIdRef = useRef('');
  const repairCountRef = useRef(0);
  const repairInfrastructureFailureCountRef = useRef(0);
  const isRepairingRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const checkTimerRef = useRef<number | null>(null);
  const sequenceRef = useRef(0);
  const errorOccurrencesRef = useRef<Map<string, number>>(new Map());
  const recentErrorsRef = useRef<string[]>([]);
  const autoRepairStoppedRef = useRef(false);
  const mainWorkCompletedRef = useRef(false);
  // Console warnings/errors during iframe boot are evidence for Test Agent,
  // not permission for Ops to patch before the runtime check reaches `done`.
  const runtimeCheckCompletedRef = useRef(false);
  const hasAgentOutputRef = useRef(false);
  const agentTraceRef = useRef<CodeAgentTrace>(EMPTY_AGENT_TRACE);
  const currentAgentRunIdRef = useRef('');
  const timelineSequenceRef = useRef(0);
  const thinkingStartedAtRef = useRef<Record<string, number>>({});
  const repairRetryTimerRef = useRef<number | null>(null);
  const runtimeVerificationAttemptsRef = useRef<Set<string>>(new Set());
  const repairHandlerRef = useRef<(error: RuntimeErrorReport) => void>(() => undefined);
  // Why: Phase3 记忆系统 session_id 引用——generate/modify 调用时传入并存储，
  // handleRuntimeError 自动复用，无需每次调用都显式传参。
  const sessionIdRef = useRef<string | null>(null);
  // Why: MCP 配置引用——与 sessionIdRef 同模式，自动修复链路（fixWebCode/fixFullstackCode）
  //   也需要携带 mcp_mode/mcp_server_ids，否则修复请求的 MCP 上下文与用户设定不一致。
  const mcpRef = useRef<McpRequestContext | null>(null);

  const commitAgentTrace = useCallback((update: (previous: CodeAgentTrace) => CodeAgentTrace) => {
    const next = update(agentTraceRef.current);
    agentTraceRef.current = next;
    setAgentTrace(next);
    const currentRunId = currentAgentRunIdRef.current;
    if (currentRunId) {
      setAgentRuns((previous) => previous.map((run) =>
        run.id === currentRunId ? { ...run, trace: next } : run
      ));
    }
  }, []);

  const appendTimeline = useCallback((input: {
    eventId?: string;
    runId?: string;
    actorId?: string;
    actorKind: CodeAgentActorKind;
    stage: CodeAgentTimelineStage;
    content: string;
    done?: boolean;
    timestampMs?: number;
    sequence?: number;
    iteration?: number;
    mergeKey?: string;
    status?: string;
    metrics?: CodeAgentTimelineEvent['metrics'];
    file?: CodeAgentTimelineEvent['file'];
    metadata?: Record<string, unknown>;
  }) => {
    const runId = input.runId ?? currentAgentRunIdRef.current;
    const actorId = input.actorId ?? `${input.actorKind}:${runId || 'unbound'}`;
    const sequence = input.sequence ?? (timelineSequenceRef.current + 1);
    timelineSequenceRef.current = Math.max(timelineSequenceRef.current, sequence);
    const event: CodeAgentTimelineEvent = {
      eventId: input.eventId ?? `${runId || 'unbound'}:${actorId}:${sequence}:${input.stage}`,
      runId,
      actorId,
      actorKind: input.actorKind,
      stage: input.stage,
      content: input.content,
      done: input.done ?? true,
      timestampMs: input.timestampMs ?? Date.now(),
      sequence,
      iteration: input.iteration,
      mergeKey: input.mergeKey,
      status: input.status,
      metrics: input.metrics,
      file: input.file,
      metadata: input.metadata,
    };
    commitAgentTrace((previous) => ({
      ...previous,
      timeline: appendTimelineEvent(previous.timeline ?? [], event),
    }));
  }, [commitAgentTrace]);

  const finishTimeline = useCallback((actorKind?: CodeAgentActorKind) => {
    const finishedAt = Date.now();
    commitAgentTrace((previous) => ({
      ...previous,
      timeline: (previous.timeline ?? []).map((event) => {
        if (
          event.done
          || (actorKind && event.actorKind !== actorKind)
          || !['thinking', 'output', 'validation', 'summary'].includes(event.stage)
        ) return event;
        const startedAt = event.stage === 'thinking'
          ? thinkingStartedAtRef.current[event.mergeKey ?? `${event.actorId}:${event.stage}`]
          : undefined;
        return {
          ...event,
          done: true,
          metrics: startedAt == null
            ? event.metrics
            : { ...event.metrics, durationMs: Math.max(0, finishedAt - startedAt) },
        };
      }),
    }));
    if (actorKind) {
      Object.keys(thinkingStartedAtRef.current)
        .filter((key) => key.startsWith(`${actorKind}:`))
        .forEach((key) => delete thinkingStartedAtRef.current[key]);
    } else {
      thinkingStartedAtRef.current = {};
    }
  }, [commitAgentTrace]);

  const beginAgentTrace = useCallback((
    message: string,
    request = '',
    projectKind: 'frontend' | 'fullstack' = 'frontend',
    options: {
      resumeRun?: CodeAgentRun;
      activeScope?: CodeTaskScope;
      scopeVersion?: number;
      scopeSource?: 'orchestrator' | 'inherited' | 'explicit';
      allowedNextAction?: string;
      runtimeEvidence?: RuntimeVerificationEvidence;
    } = {},
  ) => {
    hasAgentOutputRef.current = false;
    const resumedRun = options.resumeRun;
    const id = resumedRun?.id ?? `agent-run-${Date.now()}-${sequenceRef.current + 1}`;
    timelineSequenceRef.current = resumedRun
      ? Math.max(0, ...(resumedRun.trace.timeline ?? []).map((event) => event.sequence))
      : 0;
    thinkingStartedAtRef.current = {};
    currentAgentRunIdRef.current = id;
    const trace: CodeAgentTrace = {
      ...(resumedRun?.trace ?? EMPTY_AGENT_TRACE),
      steps: [...(resumedRun?.trace.steps ?? []), message],
      phase: resumedRun ? 'resuming' : 'analyzing',
      isRunning: true,
      status: 'running',
      resumeEligible: false,
      activeScope: options.activeScope ?? resumedRun?.trace.activeScope,
      scopeVersion: options.scopeVersion ?? resumedRun?.trace.scopeVersion,
      scopeSource: options.scopeSource ?? resumedRun?.trace.scopeSource,
      allowedNextAction: options.allowedNextAction ?? resumedRun?.trace.allowedNextAction,
      runtimeEvidence: options.runtimeEvidence ?? resumedRun?.trace.runtimeEvidence,
    };
    agentTraceRef.current = trace;
    setAgentTrace(trace);
    setAgentRuns((previous) => resumedRun
      ? previous.map((run) => run.id === id ? { ...run, request, projectKind, trace } : run)
      : [...previous, {
          id,
          request,
          projectKind,
          createdAt: new Date().toISOString(),
          trace,
        }]);
    // Why: 信任白名单按 runId 切分；每启动一次新 agent 自动初始化一个空数组，
    // 用户在这次 run 里勾选过“信任”的命令前缀就命中，关 tab 整体失效。
    setTrustedTerminalPrefixes((previous) => previous[id] ? previous : { ...previous, [id]: [] });
    appendTimeline({
      runId: id,
      actorId: `main:${id}`,
      actorKind: 'main',
      stage: 'status',
      content: message,
      status: 'analyzing',
    });
  }, [appendTimeline]);

  const continueAgentTrace = useCallback((message: string) => {
    appendTimeline({
      actorId: `ops:${currentAgentRunIdRef.current}:repair`,
      actorKind: 'ops',
      stage: 'status',
      content: message,
      status: 'diagnosing',
    });
  }, [appendTimeline]);

  const consumeAgentEvent = useCallback((event: CodeGenerationEvent, actorKind: CodeAgentActorKind = 'main', actorId?: string) => {
    const resolvedActorId = actorId ?? `${actorKind}:${currentAgentRunIdRef.current || 'unbound'}`;
    const appendActivity = (
      content: string,
      done: boolean,
      stage: CodeAgentTimelineStage,
      status?: string,
      options: {
        runId?: string;
        actorId?: string;
        actorKind?: CodeAgentActorKind;
        turnId?: string;
        iteration?: number;
        eventId?: string;
        timestampMs?: number;
        metadata?: Record<string, unknown>;
      } = {},
    ) => {
      const activityActorKind = options.actorKind ?? actorKind;
      const activityActorId = options.actorId ?? resolvedActorId;
      const mergeKey = stage === 'thinking' || stage === 'output' || stage === 'summary'
        ? `${activityActorId}:${stage}${options.turnId ? `:${options.turnId}` : ''}`
        : undefined;
      // The backend sends an empty, done=true activity as an explicit model-turn
      // boundary. It closes only this turn; it must not mark the whole AgentLoop
      // as finished because another tool call / model turn may follow.
      if (!content && done && mergeKey) {
        const startedAt = stage === 'thinking' ? thinkingStartedAtRef.current[mergeKey] : undefined;
        commitAgentTrace((previous) => ({
          ...previous,
          timeline: completeTimelineEvent(previous.timeline ?? [], {
            actorId: activityActorId,
            actorKind: activityActorKind,
            stage,
            mergeKey,
            timestampMs: options.timestampMs,
            durationMs: startedAt == null ? undefined : Math.max(0, Date.now() - startedAt),
          }),
        }));
        if (stage === 'thinking') delete thinkingStartedAtRef.current[mergeKey];
        return;
      }
      if (!content) return;
      const metrics: CodeAgentTimelineEvent['metrics'] = { charCount: content.length };
      if (stage === 'thinking' && mergeKey) {
        const startedAt = thinkingStartedAtRef.current[mergeKey] ?? Date.now();
        thinkingStartedAtRef.current[mergeKey] = startedAt;
        if (done) {
          metrics.durationMs = Math.max(0, Date.now() - startedAt);
          delete thinkingStartedAtRef.current[mergeKey];
        }
      }
      appendTimeline({
        runId: options.runId,
        actorKind: activityActorKind,
        actorId: activityActorId,
        stage,
        content,
        done,
        mergeKey,
        status,
        metrics,
        eventId: options.eventId,
        timestampMs: options.timestampMs,
        iteration: options.iteration,
        metadata: options.metadata,
      });
    };
    if (event.type === 'agent_loop_round') {
      const roundEvent = event;
      const roundId = [
        roundEvent.run_id ?? currentAgentRunIdRef.current,
        roundEvent.loop_id ?? 'loop',
        roundEvent.turn_id ?? roundEvent.iteration ?? 'round',
      ].join(':');
      appendActivity(
        summarizeAgentLoopRound(roundEvent),
        true,
        'observation',
        'loop_round',
        {
          runId: roundEvent.run_id,
          actorId: actorId ?? resolvedActorId,
          eventId: `agent-loop-round:${roundId}`,
          iteration: roundEvent.iteration,
          metadata: {
            source: 'agent-loop',
            loopId: roundEvent.loop_id,
            turnId: roundEvent.turn_id,
            stateHashBefore: roundEvent.state_hash_before,
            stateHashAfter: roundEvent.state_hash_after,
            filesChanged: roundEvent.files_changed ?? [],
            testsChanged: roundEvent.tests_changed ?? [],
            diffAdditions: roundEvent.diff_additions ?? 0,
            diffDeletions: roundEvent.diff_deletions ?? 0,
            progressScore: roundEvent.progress_score ?? 0,
            progressFacts: roundEvent.progress_facts ?? [],
            errorSignature: roundEvent.error_signature,
          },
        },
      );
      return true;
    }
    if (event.type === 'context_usage') {
      const contextEvent = event as ContextUsageEvent;
      // 上下文是运行指标，不再为每次 measured/compressing 事件创建时间线卡片；
      // 底部 Token 状态栏消费同一份 trace.contextUsage，实时显示最新值。
      if (actorKind === 'main') {
        commitAgentTrace((previous) => ({ ...previous, contextUsage: contextEvent }));
      }
      return true;
    }
    if (event.type === 'token_usage') {
      const usageEvent = event as TokenUsageEvent;
      commitAgentTrace((previous) => ({ ...previous, tokenUsage: usageEvent.usage }));
      return true;
    }
    if (event.type === 'hook_event') {
      const hookEvent = event as HookEvent;
      commitAgentTrace((previous) => ({
        ...previous,
        hookEvents: [
          ...(previous.hookEvents ?? []).filter((existing) => !(
            existing.agent_run_id === hookEvent.agent_run_id
            && existing.hook_id === hookEvent.hook_id
            && existing.sequence === hookEvent.sequence
            && existing.event === hookEvent.event
          )),
          hookEvent,
        ].slice(-100),
      }));
      return true;
    }
    if (event.type === 'runtime_summary') {
      const eventIntentRaw = event.intent;
      const eventIntent =
        eventIntentRaw === 'patch' || eventIntentRaw === 'fullstack_bootstrap' ||
        eventIntentRaw === 'answer' || eventIntentRaw === 'ask_clarification'
          ? eventIntentRaw : 'patch';
      // Why: 前端最后一道 envelope 剥壳安全网。若后端把 envelope 外壳误当成
      //   answer 文本（intent=answer + content=完整JSON外壳），这里剥掉外壳，
      //   取 payload.text / payload.html / summary 当真实文本，同时把 intent 纠正为
      //   真实 envelope.intent，保证回答/澄清/全栈初始化/变更总结标签不贴错。
      const { text: resolvedContent, intent: resolvedIntent } =
        stripEnvelopeFromAnswerText(event.content, eventIntent);
      const isAnswerIntent = resolvedIntent === 'answer' || resolvedIntent === 'ask_clarification';
      appendActivity(resolvedContent || event.content, event.done, 'summary', resolvedIntent);
      if (actorKind !== 'main') return true;
      commitAgentTrace((previous) => {
        const previousSummary = previous.summary ?? '';
        const incremental = event.done ? resolvedContent : `${previousSummary}${event.content}`;
        const finalSummary = event.done || resolvedContent !== event.content
          ? resolvedContent || incremental
          : incremental;
        return {
          ...previous,
          summary: finalSummary,
          summaryIntent: resolvedIntent,
          answer: isAnswerIntent ? finalSummary : previous.answer,
          isRunning: event.status === 'awaiting_runtime_verification' || !event.done,
          status: event.status === 'needs_attention'
            ? 'needs_attention'
            : event.status === 'awaiting_runtime_verification'
              ? 'awaiting_runtime_verification'
            : event.done ? 'completed' : 'running',
          resumeEligible: event.resume_eligible ?? previous.resumeEligible,
          runtimeVerification: event.run_id && event.base_revision && event.candidate_revision
            ? {
                runId: event.run_id,
                baseRevision: event.base_revision,
                candidateRevision: event.candidate_revision,
              }
            : previous.runtimeVerification,
          activeScope: event.active_scope ?? previous.activeScope,
          scopeVersion: event.scope_version ?? previous.scopeVersion,
          scopeSource: event.scope_source ?? previous.scopeSource,
          allowedNextAction: event.allowed_next_action ?? previous.allowedNextAction,
          runtimeEvidence: event.runtime_evidence ?? previous.runtimeEvidence,
        };
      });
      return true;
    }
    if (event.type === 'terminal_proposal') {
      console.log('[terminal][sse] terminal_proposal event:', event);
      appendActivity(event.command, false, 'tool_call', 'awaiting_approval');
      if (actorKind === 'main') {
        commitAgentTrace((previous) => ({
          ...previous,
          terminalProposals: [
            ...(previous.terminalProposals ?? []).filter((item) => item.command !== event.command),
            { command: event.command, reason: event.reason, expected_output_hint: event.expected_output_hint },
          ],
        }));
      }
      // Why: 通知 CodeWorkspace 自动切到终端 Tab 并选中 agent 终端，
      // 否则用户看不到审批横幅，proposition 会 90s 超时。
      try {
        const runId = (event as { run_id?: string }).run_id;
        console.log('[terminal][sse] dispatching terminal-proposal-arrived run_id=%s', runId);
        window.dispatchEvent(new CustomEvent('terminal-proposal-arrived', {
          detail: { run_id: runId },
        }));
      } catch (e) { console.log('[terminal][sse] dispatch error:', e); }
      return true;
    }
    // Why: 任务拆解事件是 AgentLoop 状态投影，不是普通文字活动。
    // 由稳定 event_id/sequence 去重后写入 trace.taskPlan，卡片和历史运行
    // 都从这一份状态渲染，不能再把它拼进黑色模型输出框。
    if (event.type === 'task_list') {
      if (actorKind !== 'main') return true;
      commitAgentTrace((previous) => {
        const nextTaskPlan = applyCodeTaskEvent(previous.taskPlan ?? null, event);
        return nextTaskPlan === previous.taskPlan
          ? previous
          : { ...previous, taskPlan: nextTaskPlan };
      });
      return true;
    }
    if (event.type === 'task_update') {
      if (actorKind !== 'main') return true;
      commitAgentTrace((previous) => {
        const nextTaskPlan = applyCodeTaskEvent(previous.taskPlan ?? null, event);
        return nextTaskPlan === previous.taskPlan
          ? previous
          : { ...previous, taskPlan: nextTaskPlan };
      });
      // Why: 子任务完成时携带 delta，追加到执行记录的 fileChanges 里。
      if (event.status === 'completed' && event.delta) {
        const changes: CodeFileChange[] = Object.entries(event.delta).map(([path, d]) => ({
          path,
          additions: d.add,
          deletions: d.del,
        }));
        changes.forEach((change) => appendTimeline({
          actorKind,
          actorId: resolvedActorId,
          stage: 'file_change',
          content: `已完成文件修改：${change.path}`,
          status: 'completed',
          file: { ...change, operation: 'modify' },
        }));
        if (actorKind === 'main') {
          commitAgentTrace((previous) => ({
            ...previous,
            fileChanges: [
              ...(previous.fileChanges ?? []),
              ...changes,
            ],
          }));
        }
      }
      return true;
    }
    // Why: Agent Loop 工具循环每落盘一个文件即推送 file_written，通知文件树高亮该文件。
    if (event.type === 'file_written') {
      appendTimeline({
        actorKind,
        actorId: resolvedActorId,
        stage: 'file_change',
        content: event.operation === 'delete' ? `已删除 ${event.path}` : `已写入 ${event.path}`,
        done: event.done,
        status: 'written',
        file: {
          path: event.path,
          additions: event.additions ?? 0,
          deletions: event.deletions ?? 0,
          operation: event.operation ?? 'modify',
        },
        metadata: { path: event.path },
      });
      window.dispatchEvent(new CustomEvent('code-file-written', { detail: { path: event.path } }));
      return true;
    }
    // Why: Phase3 记忆系统更新通知——档案卡/摘要/VFS/Skill 任一变更时推送。
    // 前端派发 window 事件，MemoryPanel 监听后自动刷新，让记忆面板实时反映后端状态。
    if (event.type === 'memory_update') {
      appendActivity(`记忆已更新：${event.layer} · ${event.action}`, true, 'observation', 'memory_update');
      console.log('[memory][sse] memory_update layer=%s action=%s', event.layer, event.action);
      window.dispatchEvent(new CustomEvent('memory-updated', {
        detail: { layer: event.layer, action: event.action },
      }));
      return true;
    }
    // Why: Phase3 Skill 匹配命中通知——展示"已命中 Skill"的实时反馈。
    if (event.type === 'skill_matched') {
      appendActivity(`已匹配 Skill：${event.skill_name}`, true, 'observation', 'skill_matched');
      console.log('[memory][sse] skill_matched=%s confidence=%s', event.skill_name, event.confidence);
      window.dispatchEvent(new CustomEvent('skill-matched', {
        detail: { skill_name: event.skill_name },
      }));
      return true;
    }
    if (event.type !== 'agent_activity') return false;
    const activity = event as CodeAgentActivityEvent;
    const stage: CodeAgentTimelineStage = event.channel === 'status'
      ? 'status'
      : event.channel === 'answer'
        ? 'summary'
        : event.phase === 'thinking'
          ? 'thinking'
          : event.phase === 'validating'
            ? 'validation'
            : 'output';
    const isTurnBoundary = activity.boundary === 'turn_completed';
    const traceDone = isTurnBoundary ? false : event.done;
    appendActivity(event.content, event.done, stage, event.phase, {
      actorId: activity.actor_id ?? resolvedActorId,
      turnId: activity.turn_id,
      iteration: activity.iteration,
      eventId: activity.event_id,
      timestampMs: activity.timestamp_ms,
      metadata: activity.metadata,
    });
    if (actorKind !== 'main') return true;
    // 思考增量只进入 reasoning，不应阻止随后真正的代码/JSON 输出更新。
    if (event.channel === 'output' && event.phase !== 'thinking') hasAgentOutputRef.current = true;
    if (event.channel === 'answer') {
      commitAgentTrace((previous) => {
        const rawNextAnswer = event.done
          ? event.content
          : `${previous.answer ?? ''}${event.content}`;
        const fallbackForAnswer = 'answer';
        const { text: strippedAnswer, intent: resolvedForAnswer } =
          stripEnvelopeFromAnswerText(rawNextAnswer, previous.summaryIntent ?? fallbackForAnswer);
        const snippet = strippedAnswer.trim().split(/\n\s*\n/)[0].slice(0, 360);
        return {
          ...previous,
          answer: strippedAnswer,
          summary: previous.summary?.trim() && !strippedAnswer.startsWith('{')
            ? previous.summary
            : snippet || strippedAnswer.slice(0, 360),
          summaryIntent: previous.summaryIntent ?? resolvedForAnswer,
          phase: event.phase,
          isRunning: !traceDone,
          resumeEligible: activity.resume_eligible ?? previous.resumeEligible,
        };
      });
      return true;
    }
    // Code Agent 的部分兼容网关仍用 channel=output 携带 phase=thinking；按 phase
    // 归一化，保证旧后端和新后端都不会把思考内容混入“完整模型输出”。
    if (event.channel === 'output' && event.phase === 'thinking') {
      commitAgentTrace((previous) => ({
        ...previous,
        reasoning: `${previous.reasoning ?? ''}${event.content}`,
        phase: event.phase,
        isRunning: !traceDone,
      }));
      return true;
    }
    commitAgentTrace((previous) => {
      const scopePatch = {
        activeScope: activity.active_scope ?? previous.activeScope,
        scopeVersion: activity.scope_version ?? previous.scopeVersion,
        scopeSource: activity.scope_source ?? previous.scopeSource,
        allowedNextAction: activity.allowed_next_action ?? previous.allowedNextAction,
        runtimeEvidence: activity.runtime_evidence ?? previous.runtimeEvidence,
      };
      if (event.channel === 'output') {
        return {
          ...previous,
          ...scopePatch,
          output: traceDone ? event.content : `${previous.output}${event.content}`,
          phase: event.phase,
          isRunning: !traceDone,
          resumeEligible: activity.resume_eligible ?? previous.resumeEligible,
        };
      }
      const steps = previous.steps.at(-1) === event.content
        ? previous.steps
        : [...previous.steps, event.content];
      return {
        ...previous,
        ...scopePatch,
        steps,
        phase: event.phase,
        isRunning: !traceDone,
        resumeEligible: activity.resume_eligible ?? previous.resumeEligible,
      };
    });
    return true;
  }, [appendTimeline, commitAgentTrace]);

  const recordFileChanges = useCallback((
    beforeCode: string,
    afterCode: string,
    append = false,
    actorKind: CodeAgentActorKind = 'main',
    actorId = `${actorKind}:${currentAgentRunIdRef.current || 'unbound'}`,
  ) => {
    const changes = summarizeFileChanges(beforeCode, afterCode);
    changes.forEach((change) => appendTimeline({
      actorKind,
      actorId,
      stage: 'file_change',
      content: `已生成文件变更：${change.path}`,
      status: 'completed',
      file: { ...change, operation: 'modify' },
    }));
    if (actorKind !== 'main') return;
    commitAgentTrace((previous) => ({
      ...previous,
      fileChanges: append
        ? changes.reduce<CodeFileChange[]>((nextChanges, current) => {
            const existing = nextChanges.find((change) => change.path === current.path);
            if (existing) {
              existing.additions += current.additions;
              existing.deletions += current.deletions;
            } else {
              nextChanges.push({ ...current });
            }
            return nextChanges;
          }, (previous.fileChanges ?? []).map((change) => ({ ...change })))
        : changes,
    }));
  }, [appendTimeline, commitAgentTrace]);

  const updateCode = useCallback((nextCode: string) => {
    codeRef.current = nextCode;
    setCodeState(nextCode);
  }, []);

  const clearCheckTimer = useCallback(() => {
    if (checkTimerRef.current !== null) {
      window.clearTimeout(checkTimerRef.current);
      checkTimerRef.current = null;
    }
  }, []);

  const clearRepairRetryTimer = useCallback(() => {
    if (repairRetryTimerRef.current !== null) {
      window.clearTimeout(repairRetryTimerRef.current);
      repairRetryTimerRef.current = null;
    }
  }, []);

  const beginRuntimeCheck = useCallback((nextCode: string) => {
    clearCheckTimer();
    mainWorkCompletedRef.current = true;
    runtimeCheckCompletedRef.current = false;
    updateCode(nextCode);
    sequenceRef.current += 1;
    const nextRunId = `code-run-${Date.now()}-${sequenceRef.current}`;
    runIdRef.current = nextRunId;
    setRunId(nextRunId);
    setStatus({ state: 'checking', attempt: repairCountRef.current });

    checkTimerRef.current = window.setTimeout(() => {
      if (runIdRef.current !== nextRunId || isRepairingRef.current) return;
      setStatus({
        state: 'done',
        charCount: nextCode.length,
        repairCount: repairCountRef.current,
      });
      runtimeCheckCompletedRef.current = true;
    }, ERROR_CHECK_WINDOW_MS);
  }, [clearCheckTimer, updateCode]);

  const verifyRuntimeCandidate = useCallback(async (
    consoleEntries: SandboxConsoleEntry[],
    bootCompleted = true,
    deterministicVerifierPassed = false,
  ) => {
    const candidate = agentTraceRef.current.runtimeVerification;
    if (!candidate) return null;
    const evidence = consoleEntries.slice(-100).map((entry) => ({
      level: entry.level,
      text: entry.args.join(' ').slice(0, 2_000),
    }));
    const errorEvidence = evidence
      .filter((entry) => entry.level === 'error')
      .map((entry) => entry.text)
      .join('\n');
    const attemptKey = `${candidate.runId}:${candidate.candidateRevision}:${bootCompleted}:${deterministicVerifierPassed}:${errorEvidence}`;
    if (runtimeVerificationAttemptsRef.current.has(attemptKey)) return null;
    runtimeVerificationAttemptsRef.current.add(attemptKey);
    const changedFiles = (agentTraceRef.current.fileChanges ?? []).map((change) => change.path);
    const diffSummary = (agentTraceRef.current.fileChanges ?? []).reduce(
      (summary, change) => ({
        additions: summary.additions + change.additions,
        deletions: summary.deletions + change.deletions,
      }),
      { additions: 0, deletions: 0 },
    );
    const targetError = agentTraceRef.current.runtimeEvidence?.target_error
      ?? (evidence.find((entry) => entry.level === 'error')
        ? { type: 'RuntimeError', message: evidence.find((entry) => entry.level === 'error')?.text ?? '' }
        : undefined);
    try {
      const result = await verifyFullstackRuntime({
        run_id: candidate.runId,
        base_revision: candidate.baseRevision,
        candidate_revision: candidate.candidateRevision,
        boot_completed: bootCompleted,
        deterministic_verifier_passed: deterministicVerifierPassed,
        console_entries: evidence,
        target_error: targetError,
        changed_files: changedFiles,
        diff_summary: `+${diffSummary.additions}/-${diffSummary.deletions}`,
      });
      const completed = result.status === 'completed' && result.verified && result.committed;
      commitAgentTrace((previous) => ({
        ...previous,
        isRunning: false,
        status: completed ? 'completed' : 'needs_attention',
        resumeEligible: !completed,
        runtimeEvidence: result.runtime_evidence ?? previous.runtimeEvidence,
      }));
      appendTimeline({
        actorKind: 'system',
        actorId: `runtime-verify:${candidate.runId}`,
        runId: candidate.runId,
        stage: completed ? 'verification' : 'error',
        status: completed ? 'completed' : 'needs_attention',
        content: result.reason,
        metadata: {
          candidateRevision: candidate.candidateRevision,
          consoleErrorCount: result.console_errors?.length ?? 0,
          runtimeEvidence: result.runtime_evidence,
        },
      });
      return result;
    } catch (error) {
      // A transport failure is retryable; never turn an unconfirmed
      // candidate into a completed run or consume its retry key permanently.
      runtimeVerificationAttemptsRef.current.delete(attemptKey);
      throw error;
    }
  }, [appendTimeline, commitAgentTrace]);

  const reset = useCallback((options: { preserveAgentRuns?: boolean } = {}) => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    clearCheckTimer();
    clearRepairRetryTimer();
    codeRef.current = '';
    runIdRef.current = '';
    repairCountRef.current = 0;
    repairInfrastructureFailureCountRef.current = 0;
    isRepairingRef.current = false;
    errorOccurrencesRef.current.clear();
    recentErrorsRef.current = [];
    autoRepairStoppedRef.current = false;
    mainWorkCompletedRef.current = false;
    runtimeCheckCompletedRef.current = false;
    runtimeVerificationAttemptsRef.current.clear();
    setCodeState('');
    setRunId('');
    setRepairLogs([]);
    agentTraceRef.current = EMPTY_AGENT_TRACE;
    currentAgentRunIdRef.current = '';
    timelineSequenceRef.current = 0;
    thinkingStartedAtRef.current = {};
    setAgentTrace(EMPTY_AGENT_TRACE);
    setAgentRuns((previous) => resetAgentRuns(previous, {
      preserveHistory: options.preserveAgentRuns,
    }));
    // 终端信任白名单：reset 时一起清掉，避免之前的 run 信任污染新会话。
    if (!options.preserveAgentRuns) setTrustedTerminalPrefixes({});
    setStatus({ state: 'idle' });
  }, [clearCheckTimer, clearRepairRetryTimer]);

  const restore = useCallback((savedCode: string) => {
    // Restoring a checkpoint/version changes the active code projection; it
    // must not erase the conversation's completed AgentLoop history.
    reset({ preserveAgentRuns: true });
    if (!savedCode) return;
    updateCode(savedCode);
    sequenceRef.current += 1;
    const restoredRunId = `code-run-${Date.now()}-${sequenceRef.current}`;
    runIdRef.current = restoredRunId;
    setRunId(restoredRunId);
    runtimeCheckCompletedRef.current = true;
    setStatus({ state: 'done', charCount: savedCode.length, repairCount: 0 });
  }, [reset, updateCode]);

  const restoreAgentRuns = useCallback((savedRuns: CodeAgentRun[]) => {
    const restoredRuns = savedRuns.map((run) => ({
      ...run,
      trace: { ...run.trace, steps: [...run.trace.steps], isRunning: false },
    }));
    const latest = restoredRuns.at(-1);
    setAgentRuns(restoredRuns);
    currentAgentRunIdRef.current = latest?.id ?? '';
    agentTraceRef.current = latest?.trace ?? EMPTY_AGENT_TRACE;
    timelineSequenceRef.current = Math.max(0, ...(agentTraceRef.current.timeline ?? []).map((event) => event.sequence));
    setAgentTrace(agentTraceRef.current);
  }, []);

  const addTrustedTerminalPrefix = useCallback((runIdValue: string, prefix: string) => {
    setTrustedTerminalPrefixes((previous) => {
      const current = previous[runIdValue] ?? [];
      if (current.includes(prefix)) return previous;
      return { ...previous, [runIdValue]: [...current, prefix] };
    });
  }, []);

  const generate = useCallback(async (
    prompt: string,
    projectKind: 'frontend' | 'fullstack' = 'frontend',
    attachments: ChatAttachment[] = [],
    sessionId: string | null = null,
    mcp: McpRequestContext | null = null,
  ) => {
    sessionIdRef.current = sessionId;
    mcpRef.current = mcp;
    // A new request starts a new run, but completed runs remain visible and
    // persistable as part of this conversation's single timeline history.
    reset({ preserveAgentRuns: true });
    beginAgentTrace(
      projectKind === 'fullstack' ? '正在启动全栈代码智能体。' : '正在启动前端代码智能体。',
      prompt,
      projectKind,
      {
        activeScope: projectKind === 'fullstack'
          ? 'fullstack_bootstrap'
          : 'frontend_patch',
        allowedNextAction: projectKind === 'fullstack'
          ? 'fullstack_bootstrap'
          : 'minimal_frontend_patch',
      },
    );
    // 注意：beginAgentTrace 内部设置了 currentAgentRunIdRef，所以必须在它之后取 meta.run_id。
    const runIdForRequest = currentAgentRunIdRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus({ state: 'generating', charCount: 0 });
    let didComplete = false;

    const handleEvent = (event: CodeGenerationEvent) => {
      if (classifyCodeGenerationEvent(event) === 'agent_event') {
        consumeAgentEvent(event);
        return;
      }
      if (event.type === 'error') {
        setStatus({ state: 'error', message: event.message });
        commitAgentTrace((previous) => ({ ...previous, isRunning: false }));
        return;
      }
      // 这里只允许显式的 CodeUpdateEvent 进入代码/VFS 投影；未知事件不能
      // 因为缺少 event.code 而把 undefined 写入 code state。
      if (event.type !== 'code_update') return;
      if (!hasAgentOutputRef.current) {
        commitAgentTrace((previous) => ({ ...previous, output: event.code, phase: 'generating' }));
      }
      updateCode(event.code);
      if (event.done) {
        didComplete = true;
        recordFileChanges('', event.code);
        finishTimeline('main');
        commitAgentTrace((previous) => ({ ...previous, isRunning: false }));
        beginRuntimeCheck(event.code);
      } else {
        setStatus({ state: 'generating', charCount: event.code.length });
      }
    };

    try {
      // Why: fullstack 和 frontend 单文件路径都已支持视觉模型分析附件。
      if (projectKind === 'fullstack') {
        await generateFullstackCode(
          prompt, handleEvent, controller.signal, attachments,
          { workspace_id: terminalWorkspaceId, run_id: runIdForRequest, session_id: sessionId ?? undefined, mcp_mode: mcp?.mode, mcp_server_ids: mcp?.serverIds },
        );
      } else {
        await generateWebCode(
          prompt, handleEvent, controller.signal, attachments,
          { workspace_id: terminalWorkspaceId, run_id: runIdForRequest, session_id: sessionId ?? undefined, mcp_mode: mcp?.mode, mcp_server_ids: mcp?.serverIds },
        );
      }
    } catch (error) {
      commitAgentTrace((previous) => ({ ...previous, isRunning: false }));
      throw error;
    }
    return didComplete;
  }, [addTrustedTerminalPrefix, beginAgentTrace, beginRuntimeCheck, commitAgentTrace, consumeAgentEvent, finishTimeline, recordFileChanges, reset, terminalWorkspaceId, updateCode]);

  const modify = useCallback(async (
    instruction: string,
    selectedElement: SelectedElementContext | null = null,
    attachments: ChatAttachment[] = [],
    // Why: Day57 @file 剪枝——把用户在前端 @ 的文件清单透传给后端 fullstack 修改接口。
    mentionedFiles: string[] = [],
    sessionId: string | null = null,
    mcp: McpRequestContext | null = null,
    options: {
      resumeFromRun?: CodeAgentRun;
      intentRouteId?: string;
      recentTurns?: CodeIntentTurn[];
      activeRun?: CodeIntentActiveRun;
      activeScope?: CodeTaskScope;
      scopeVersion?: number;
      scopeSource?: 'orchestrator' | 'inherited' | 'explicit';
      allowedNextAction?: string;
      runtimeEvidence?: RuntimeVerificationEvidence;
    } = {},
    consoleEntries: SandboxConsoleEntry[] = [],
  ) => {
    sessionIdRef.current = sessionId;
    mcpRef.current = mcp;
    const currentCode = codeRef.current;
    if (!currentCode || !instruction.trim()) return false;
    const consoleDiagnostics = consoleEntries
      .filter((entry) => entry.level === 'error' || entry.level === 'warn')
      .slice(-100)
      .map((entry) => `[browser console ${entry.level}] ${entry.args.join(' ')}`)
      .join('\n');
    const pendingDiagnostics = [
      recentErrorsRef.current.join('\n'),
      consoleDiagnostics,
    ].filter(Boolean).join('\n');
    let effectiveDiagnostics = pendingDiagnostics;

    controllerRef.current?.abort();
    clearCheckTimer();
    clearRepairRetryTimer();
    repairCountRef.current = 0;
    repairInfrastructureFailureCountRef.current = 0;
    isRepairingRef.current = false;
    errorOccurrencesRef.current.clear();
    recentErrorsRef.current = [];
    autoRepairStoppedRef.current = false;
    mainWorkCompletedRef.current = false;
    runtimeCheckCompletedRef.current = false;
    setRepairLogs([]);
    setStatus({ state: 'modifying', charCount: 0 });
    const parsedVfs = parseProjectCode(currentCode);
    const currentVfs = parsedVfs ?? {};
    // Why: parseProjectCode('{}') 返回空对象，在 JS 中是 truthy；
    //   必须检查是否包含真实文件，否则会把空 VFS 传给后端触发 422。
    const hasVfs = Object.keys(currentVfs).length > 0;
    const isResume = Boolean(options.resumeFromRun);
    beginAgentTrace(
      isResume
        ? '正在恢复上一次未完成的 Code AgentLoop。'
        : (hasVfs ? '正在启动全栈增量修改智能体。' : '正在启动前端增量修改智能体。'),
      instruction,
      hasVfs ? 'fullstack' : 'frontend',
      {
        resumeRun: options.resumeFromRun,
        activeScope: options.activeScope,
        scopeVersion: options.scopeVersion,
        scopeSource: options.scopeSource,
        allowedNextAction: options.allowedNextAction,
        runtimeEvidence: options.runtimeEvidence,
      },
    );
    const runIdForRequest = currentAgentRunIdRef.current;

    const controller = new AbortController();
    controllerRef.current = controller;
    const shouldRunRuntimePreflight = Boolean(
      hasVfs && (
        options.activeScope === 'frontend_runtime'
        || options.activeRun?.runtime_verification === true
        || options.activeRun?.status === 'awaiting_runtime_verification'
        || options.runtimeEvidence?.status === 'runtime_verification_failed'
        || options.runtimeEvidence?.status === 'needs_attention'
        || consoleEntries.some((entry) => entry.level === 'error' || entry.level === 'warn')
      ),
    );
    if (shouldRunRuntimePreflight) {
      try {
        const previewHtml = isFullstackVFS(currentVfs)
          || isManifestProjectVFS(currentVfs)
          ? bundleFullstackVFS(currentVfs, { runId: runIdForRequest })
          : bundleVFS(currentVfs, { runId: runIdForRequest, injectInspector: false });
        appendTimeline({
          actorKind: 'system',
          actorId: `deterministic-preflight:${runIdForRequest}`,
          runId: runIdForRequest,
          stage: 'verification',
          status: 'running',
          content: '正在启动确定性浏览器预检，先采集页面可见数据、Console 和页面异常。',
          metadata: { source: 'deterministic-browser-preflight' },
        });
        const report = await runCodeAcceptanceTest({
          user_request: instruction.trim(),
          preview_html: previewHtml,
          verification_run_id: `${runIdForRequest}:preflight`.slice(0, 64),
          console_entries: consoleEntries.slice(-100).map((entry) => ({
            level: entry.level,
            text: entry.args.join(' ').slice(0, 2_000),
          })),
        }, controller.signal);
        const reportDiagnostics = formatRuntimePreflightDiagnostics(report);
        effectiveDiagnostics = [effectiveDiagnostics, reportDiagnostics].filter(Boolean).join('\n\n');
        appendTimeline({
          actorKind: 'system',
          actorId: `deterministic-preflight:${runIdForRequest}:result`,
          runId: runIdForRequest,
          stage: 'verification',
          status: report.blocked ? 'blocked' : report.passed ? 'passed' : 'failed',
          content: report.diagnostic
            || (report.passed ? '确定性浏览器预检通过。' : '确定性浏览器预检未通过。'),
          metadata: {
            source: 'deterministic-browser-preflight',
            deterministic: true,
            passed: report.passed,
            blocked: report.blocked,
            diagnostic: report.diagnostic,
            deterministicFindings: report.deterministic_findings ?? [],
            pageText: report.page_text ?? '',
            console: report.console ?? [],
            pageErrors: report.page_errors ?? [],
          },
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        const message = error instanceof Error ? error.message : '确定性浏览器预检失败。';
        effectiveDiagnostics = [
          effectiveDiagnostics,
          `[deterministic-browser-preflight]\nstatus=blocked\n${message}`,
        ].filter(Boolean).join('\n\n');
        appendTimeline({
          actorKind: 'system',
          actorId: `deterministic-preflight:${runIdForRequest}:blocked`,
          runId: runIdForRequest,
          stage: 'verification',
          status: 'blocked',
          content: `确定性浏览器预检暂不可用：${message}`,
          metadata: { source: 'deterministic-browser-preflight', blocked: true },
        });
      }
    }
    let modifiedCode = '';
    let didComplete = false;

    const targetElement = selectedElement
        ? {
            selector: selectedElement.selector,
            tag_name: selectedElement.tagName,
            class_name: selectedElement.className,
            element_id: selectedElement.id,
            outer_html: selectedElement.outerHTML,
          }
        : null;
    const handleEvent = (event: CodeGenerationEvent) => {
      if (classifyCodeGenerationEvent(event) === 'agent_event') {
        consumeAgentEvent(event);
        return;
      }
      if (event.type === 'error') {
        commitAgentTrace((previous) => ({ ...previous, isRunning: false }));
        throw new Error(event.message);
      }
      // 这里只允许显式的 CodeUpdateEvent 进入代码/VFS 投影。
      if (event.type !== 'code_update') return;
      if (!hasAgentOutputRef.current) {
        commitAgentTrace((previous) => ({ ...previous, output: event.code, phase: 'patching' }));
      }
      modifiedCode = event.code;
      didComplete = didComplete || event.done;
      if (event.done) {
        finishTimeline('main');
        if (!event.candidate) {
          commitAgentTrace((previous) => ({ ...previous, isRunning: false }));
        }
      }
      setStatus({ state: 'modifying', charCount: event.code.length });
    };
    try {
      // Why: fullstack 和 frontend 单文件路径都已支持视觉模型分析附件。
      if (hasVfs) {
        await modifyFullstackCode(
          currentVfs, instruction, targetElement, handleEvent, controller.signal, effectiveDiagnostics, attachments,
          { workspace_id: terminalWorkspaceId, run_id: runIdForRequest, session_id: sessionId ?? undefined, mcp_mode: mcp?.mode, mcp_server_ids: mcp?.serverIds, intent: mcp?.intent ?? (isResume ? 'resume' : 'action'), intent_route_id: options.intentRouteId, resume: isResume, recent_turns: options.recentTurns, active_run: options.activeRun, active_scope: options.activeScope, runtime_evidence: options.runtimeEvidence },
          mentionedFiles,
        );
      } else {
        await modifyWebCode(
          currentCode, instruction, targetElement, handleEvent, controller.signal, effectiveDiagnostics, attachments,
          { workspace_id: terminalWorkspaceId, run_id: runIdForRequest, session_id: sessionId ?? undefined, mcp_mode: mcp?.mode, mcp_server_ids: mcp?.serverIds, intent: mcp?.intent ?? (isResume ? 'resume' : 'action'), intent_route_id: options.intentRouteId, resume: isResume, recent_turns: options.recentTurns, active_run: options.activeRun, active_scope: options.activeScope, runtime_evidence: options.runtimeEvidence },
        );
      }
    } catch (error) {
      commitAgentTrace((previous) => ({ ...previous, isRunning: false }));
      throw error;
    }

    if (!modifiedCode || !didComplete) {
      if (agentTraceRef.current.status === 'needs_attention') {
        if (modifiedCode) updateCode(modifiedCode);
        finishTimeline('main');
        setStatus({ state: 'idle' });
        return false;
      }
      // A needs_attention response still carries the last durable VFS
      // checkpoint in a non-final code_update. Keep that checkpoint visible
      // and available to the next "继续" request instead of reverting to the
      // pre-run code in codeRef.
      if (modifiedCode && agentTraceRef.current.resumeEligible) {
        updateCode(modifiedCode);
        finishTimeline('main');
        setStatus({ state: 'idle' });
        return false;
      }
      throw new Error('增量修改接口没有返回完整代码。');
    }
    recordFileChanges(currentCode, modifiedCode);
    beginRuntimeCheck(modifiedCode);
    return {
      completed: true,
      candidate: agentTraceRef.current.status === 'awaiting_runtime_verification',
    };
  }, [addTrustedTerminalPrefix, beginAgentTrace, beginRuntimeCheck, clearCheckTimer, clearRepairRetryTimer, commitAgentTrace, consumeAgentEvent, finishTimeline, recordFileChanges, terminalWorkspaceId, updateCode]);

  const handleRuntimeError = useCallback(async (
    runtimeError: RuntimeErrorReport,
  ) => {
    if (
      runtimeError.runId !== runIdRef.current ||
      !canStartRuntimeRepair({
        mainWorkCompleted: mainWorkCompletedRef.current,
        runtimeCheckCompleted: runtimeCheckCompletedRef.current,
        currentRunId: runIdRef.current,
        errorRunId: runtimeError.runId,
      }) ||
      isRepairingRef.current ||
      autoRepairStoppedRef.current ||
      !codeRef.current
    ) {
      return;
    }

    clearCheckTimer();
    const errorSignature = [
      runtimeError.message,
      runtimeError.source ?? '',
      runtimeError.line ?? 0,
      runtimeError.column ?? 0,
    ].join('|');
    const initialRuntimeEvidence = normalizeRuntimeVerificationEvidence({
      status: 'runtime_verification_failed',
      run_id: runtimeError.runId,
      base_revision: '',
      candidate_revision: '',
      target_error: {
        type: 'RuntimeError',
        message: clipRepairText(runtimeError.message, 2_000) ?? 'Runtime error',
        source: clipRepairText(runtimeError.source, 500),
        line: runtimeError.line,
        column: runtimeError.column,
        stack: clipRepairText(runtimeError.stack, 4_000),
      },
      changed_files: (agentTraceRef.current.fileChanges ?? []).map((change) => change.path),
      diff_summary: '',
      new_errors: [],
      same_error_persisted: true,
      boot_completed: false,
      console_errors: (runtimeError.consoleEntries ?? [])
        .filter((entry) => entry.level === 'error')
        .map((entry) => clipRepairText(entry.text, 2_000) ?? ''),
      diagnostic: clipRepairText(formatRuntimeError(runtimeError), 2_000) ?? '',
    });
    commitAgentTrace((previous) => ({ ...previous, runtimeEvidence: initialRuntimeEvidence }));
    const occurrence = (errorOccurrencesRef.current.get(errorSignature) ?? 0) + 1;
    errorOccurrencesRef.current.set(errorSignature, occurrence);
    recentErrorsRef.current = [
      ...recentErrorsRef.current.slice(-7),
      runtimeError.message,
    ];
    if (occurrence >= 3) {
      const message = '同一诊断在采用不同修复策略后仍然重复，已触发无进展熔断。当前页面将保留，不再自动修改代码。';
      autoRepairStoppedRef.current = true;
      isRepairingRef.current = false;
      clearRepairRetryTimer();
      setStatus({ state: 'error', message });
      commitAgentTrace((previous) => ({
        ...previous,
        steps: [...previous.steps, message],
        phase: 'blocked',
        isRunning: false,
      }));
      return;
    }
    if (repairCountRef.current > 0) {
      setRepairLogs((previous) => previous.map((log) =>
        log.attempt === repairCountRef.current
          ? { ...log, status: 'failed' }
          : log
      ));
    }
    isRepairingRef.current = true;
    repairCountRef.current += 1;
    const attempt = repairCountRef.current;
    const diagnostic = buildBoundedRepairDiagnostic(
      runtimeError,
      occurrence,
      recentErrorsRef.current,
    );
    setRepairLogs((previous) => [
      ...previous,
      {
        attempt,
        error: runtimeError.message,
        status: 'repairing',
        diagnostic,
        modelOutput: '',
        fileChanges: [],
        consoleEntries: runtimeError.consoleEntries ?? [],
      },
    ]);
    setStatus({ state: 'repairing', attempt, charCount: 0 });
    continueAgentTrace(`正在诊断第 ${attempt} 次运行错误并生成修复补丁。`);

    const controller = new AbortController();
    controllerRef.current = controller;
    let fixedCode = '';
    let didComplete = false;
    let repairModelOutput = '';

    try {
      const currentVfs = parseProjectCode(codeRef.current);
      const hasVfs = currentVfs && Object.keys(currentVfs).length > 0;
      const handleEvent = (event: CodeGenerationEvent) => {
        if (classifyCodeGenerationEvent(event) === 'agent_event') {
            consumeAgentEvent(event, 'ops', `ops:${currentAgentRunIdRef.current}:repair`);
            if (event.type === 'agent_activity' && event.channel === 'output' && event.phase !== 'thinking') {
              repairModelOutput += event.content;
              setRepairLogs((previous) => previous.map((log) =>
                log.attempt === attempt ? { ...log, modelOutput: repairModelOutput } : log
              ));
            }
            return;
          }
          if (event.type === 'error') {
            commitAgentTrace((previous) => ({ ...previous, isRunning: false }));
            throw new Error(event.message);
          }
          // 这里只允许显式的 CodeUpdateEvent 进入修复代码投影。
          if (event.type !== 'code_update') return;
          if (!repairModelOutput) {
            repairModelOutput = event.code;
            setRepairLogs((previous) => previous.map((log) =>
              log.attempt === attempt ? { ...log, modelOutput: repairModelOutput } : log
            ));
          }
          fixedCode = event.code;
          didComplete = didComplete || event.done;
          if (event.done) {
            finishTimeline('ops');
            appendTimeline({
              actorKind: 'ops',
              actorId: `ops:${currentAgentRunIdRef.current}:repair`,
              stage: 'status',
              content: `第 ${attempt} 次修复补丁已生成，准备校验。`,
              status: 'patch_ready',
            });
          }
          setStatus({
            state: 'repairing',
            attempt,
            charCount: event.code.length,
          });
        };
      if (hasVfs) {
        await fixFullstackCode(
          currentVfs, diagnostic, handleEvent, controller.signal,
          {
            workspace_id: terminalWorkspaceId,
            run_id: currentAgentRunIdRef.current,
            session_id: sessionIdRef.current ?? undefined,
            mcp_mode: mcpRef.current?.mode,
            mcp_server_ids: mcpRef.current?.serverIds,
            intent: 'runtime_fix',
            active_scope: agentTraceRef.current.activeScope ?? 'frontend_runtime',
            runtime_evidence: agentTraceRef.current.runtimeEvidence,
          },
        );
      } else {
        await fixWebCode(
          codeRef.current, diagnostic, handleEvent, controller.signal,
          {
            workspace_id: terminalWorkspaceId,
            run_id: currentAgentRunIdRef.current,
            session_id: sessionIdRef.current ?? undefined,
            mcp_mode: mcpRef.current?.mode,
            mcp_server_ids: mcpRef.current?.serverIds,
            intent: 'runtime_fix',
            active_scope: agentTraceRef.current.activeScope ?? 'frontend_runtime',
            runtime_evidence: agentTraceRef.current.runtimeEvidence,
          },
        );
      }

      if (!fixedCode || !didComplete) {
        throw new Error('修复接口没有返回完整代码。');
      }
      const codeBeforeRepair = codeRef.current;
      const repairFileChanges = summarizeFileChanges(codeBeforeRepair, fixedCode);
      setRepairLogs((previous) => previous.map((log) =>
        log.attempt === attempt
          ? { ...log, status: 'fixed', modelOutput: repairModelOutput, fileChanges: repairFileChanges }
          : log
      ));
      isRepairingRef.current = false;
      recordFileChanges(codeBeforeRepair, fixedCode, true, 'ops', `ops:${currentAgentRunIdRef.current}:repair`);
      finishTimeline('ops');
      appendTimeline({
        actorKind: 'ops',
        actorId: `ops:${currentAgentRunIdRef.current}:repair`,
        stage: 'verification',
        content: `第 ${attempt} 次修复已落盘，正在重新验证页面。`,
        status: 'verifying',
      });
      beginRuntimeCheck(fixedCode);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      isRepairingRef.current = false;
      const message = error instanceof Error ? error.message : '自动修复失败。';
      const infrastructureFailure = isRepairInfrastructureFailure(message);
      if (infrastructureFailure) {
        repairCountRef.current = Math.max(0, repairCountRef.current - 1);
        repairInfrastructureFailureCountRef.current += 1;
        errorOccurrencesRef.current.set(errorSignature, Math.max(0, occurrence - 1));
        recentErrorsRef.current = recentErrorsRef.current.slice(0, -1);
      }
      finishTimeline('ops');
      setRepairLogs((previous) => previous.map((log) =>
        log.attempt === attempt ? { ...log, status: 'failed' } : log
      ));
      appendTimeline({
        actorKind: 'ops',
        actorId: `ops:${currentAgentRunIdRef.current}:repair`,
        stage: 'error',
        content: infrastructureFailure
          ? `基础设施协议失败（不消耗修复次数）：${message}`
          : `第 ${attempt} 次自动修复失败：${message}`,
        status: 'failed',
      });
      if (!infrastructureFailure) {
        recentErrorsRef.current = [
          ...recentErrorsRef.current.slice(-7),
          `Repair synthesis failed: ${message}`,
        ];
      }
      if (infrastructureFailure && repairInfrastructureFailureCountRef.current >= MAX_REPAIR_INFRASTRUCTURE_FAILURES) {
        const blockedMessage = '修复协议连续失败，已停止基础设施重试；该失败未消耗模型补丁次数。';
        autoRepairStoppedRef.current = true;
        clearRepairRetryTimer();
        setStatus({ state: 'error', message: blockedMessage });
        commitAgentTrace((previous) => ({ ...previous, phase: 'blocked', isRunning: false }));
        return;
      }
      if (!infrastructureFailure && occurrence >= 2) {
        const blockedMessage = '补丁生成或校验连续两次没有产生可验证进展，已停止自动重试并保留当前页面。';
        autoRepairStoppedRef.current = true;
        clearRepairRetryTimer();
        setStatus({ state: 'error', message: blockedMessage });
        commitAgentTrace((previous) => ({
          ...previous,
          steps: [...previous.steps, blockedMessage],
          phase: 'blocked',
          isRunning: false,
        }));
        return;
      }
      setStatus({ state: 'repairing', attempt, charCount: 0 });
      continueAgentTrace(`第 ${attempt} 次补丁生成或校验失败，正在更换诊断策略继续修复。`);
      clearRepairRetryTimer();
      repairRetryTimerRef.current = window.setTimeout(() => {
        repairRetryTimerRef.current = null;
        if (autoRepairStoppedRef.current || runtimeError.runId !== runIdRef.current) return;
        repairHandlerRef.current(runtimeError);
      }, 300);
    }
  }, [appendTimeline, beginRuntimeCheck, clearCheckTimer, clearRepairRetryTimer, commitAgentTrace, consumeAgentEvent, continueAgentTrace, finishTimeline, recordFileChanges, terminalWorkspaceId]);

  repairHandlerRef.current = (runtimeError) => {
    void handleRuntimeError(runtimeError);
  };

  const stopAutoRepair = useCallback(() => {
    autoRepairStoppedRef.current = true;
    isRepairingRef.current = false;
    mainWorkCompletedRef.current = false;
    runtimeCheckCompletedRef.current = false;
    controllerRef.current?.abort();
    controllerRef.current = null;
    clearCheckTimer();
    clearRepairRetryTimer();
    setRepairLogs((previous) => previous.map((log) =>
      log.status === 'repairing' ? { ...log, status: 'failed' } : log
    ));
    // Why: 中止按钮在生成与自动修复期间都会触发，文案需覆盖两种场景。
    setStatus({ state: 'error', message: '已中止当前操作。可以重新提交需求继续生成或修改代码。' });
    commitAgentTrace((previous) => ({ ...previous, isRunning: false }));
  }, [clearCheckTimer, clearRepairRetryTimer, commitAgentTrace]);

  const compactContext = useCallback(async () => {
    const result = await requestCodeContextCompaction({
      runId: currentAgentRunIdRef.current || runIdRef.current || null,
      sessionId: sessionIdRef.current,
    });
    const statusText = result.message || (
      result.status === 'requested' ? '已请求压缩，当前模型轮次结束后执行。' : '上下文压缩请求已处理。'
    );
    commitAgentTrace((previous) => ({
      ...previous,
      steps: [...previous.steps, statusText],
    }));
    return result;
  }, [commitAgentTrace]);

  useEffect(() => () => {
    controllerRef.current?.abort();
    clearCheckTimer();
    clearRepairRetryTimer();
  }, [clearCheckTimer, clearRepairRetryTimer]);

  // Why: 集成终端组件通过 window 抛过来的“等待用户选择终端命令审批”状态需要写到 agent trace / steps，
  // 因为 IntegratedTerminal 拿不到 setAgentRuns（hooks 内部 state，在这里统一在 hook 里用 CustomEvent 接。
  // dedupeKeysRef 避免同一条 proposition 文案重复加到 step 里：同一 run_id 同一个 prop_id 多次 dispatch 多次 重复写 dedupe set 去重。
  const agentRunStepDedupeRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<{ run_id: string; step: string; dedupe_key?: string }>).detail;
      if (!detail || !detail.run_id) return;
      if (detail.dedupe_key) {
        if (agentRunStepDedupeRef.current.has(detail.dedupe_key)) return;
        agentRunStepDedupeRef.current.add(detail.dedupe_key);
      }
      setAgentRuns((previous) => {
        let changed = false;
        const next = previous.map((run) => {
          if (run.id !== detail.run_id) return run;
          changed = true;
          return { ...run, trace: { ...run.trace, steps: [...run.trace.steps, detail.step] } };
        });
        return changed ? next : previous;
      });
    };
    const key = 'code-agent-run-append-step' as unknown as keyof WindowEventMap;
    window.addEventListener(key, handler as EventListener);
    return () => window.removeEventListener(key, handler as EventListener);
  }, []);

  return {
    code,
    status,
    runId,
    repairLogs,
    agentTrace,
    agentRuns,
    terminalWorkspaceId,
    trustedTerminalPrefixes,
    generate,
    modify,
    reset,
    restore,
    restoreAgentRuns,
    handleRuntimeError,
    stopAutoRepair,
    compactContext,
    addTrustedTerminalPrefix,
    verifyRuntimeCandidate,
  };
}

function formatRuntimePreflightDiagnostics(report: Awaited<ReturnType<typeof runCodeAcceptanceTest>>): string {
  const findings = (report.deterministic_findings ?? []).slice(0, 8).map((finding) =>
    `${finding.kind} selector=${finding.selector} actual=${finding.actual}`,
  );
  const consoleErrors = (report.console ?? [])
    .filter((entry) => entry.level === 'error' || entry.level === 'warn')
    .slice(-12)
    .map((entry) => `console.${entry.level}: ${entry.text}`);
  const pageErrors = (report.page_errors ?? [])
    .slice(-8)
    .map((entry) => `pageerror: ${entry.type}: ${entry.text}`);
  const networkFailures = (report.network_failures ?? [])
    .slice(-8)
    .map((entry) => `network-failure: ${entry.url} (${entry.error})`);
  return [
    '[deterministic-browser-preflight]',
    `status=${report.blocked ? 'blocked' : report.passed ? 'passed' : 'failed'}`,
    report.diagnostic ?? '',
    ...findings,
    ...consoleErrors,
    ...pageErrors,
    ...networkFailures,
    !report.passed && report.page_text ? `页面可见文本：${report.page_text.slice(0, 3000)}` : '',
  ].filter(Boolean).join('\n');
}
