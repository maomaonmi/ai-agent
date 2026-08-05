'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import {
  fixFullstackCode,
  fixWebCode,
  generateFullstackCode,
  generateWebCode,
  modifyFullstackCode,
  modifyWebCode,
  type ChatAttachment,
  type CodeAgentRun,
  type CodeAgentTrace,
  type CodeFileChange,
  type CodeGenerationEvent,
} from '../lib/api';
import { parseProjectCode } from '../Code/fullstackBundler';
import {
  CodeGenerationStatus,
  RepairLog,
  RuntimeErrorReport,
  SelectedElementContext,
} from '../lib/codeSandbox';

const ERROR_CHECK_WINDOW_MS = 1200;

const EMPTY_AGENT_TRACE: CodeAgentTrace = {
  steps: [],
  output: '',
  phase: '',
  isRunning: false,
  summary: '',
  summaryIntent: 'patch',
  terminalProposals: [],
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
  const isRepairingRef = useRef(false);
  const controllerRef = useRef<AbortController | null>(null);
  const checkTimerRef = useRef<number | null>(null);
  const sequenceRef = useRef(0);
  const errorOccurrencesRef = useRef<Map<string, number>>(new Map());
  const recentErrorsRef = useRef<string[]>([]);
  const autoRepairStoppedRef = useRef(false);
  const hasAgentOutputRef = useRef(false);
  const agentTraceRef = useRef<CodeAgentTrace>(EMPTY_AGENT_TRACE);
  const currentAgentRunIdRef = useRef('');
  const repairRetryTimerRef = useRef<number | null>(null);
  const repairHandlerRef = useRef<(error: RuntimeErrorReport) => void>(() => undefined);

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

  const beginAgentTrace = useCallback((message: string, request = '', projectKind: 'frontend' | 'fullstack' = 'frontend') => {
    hasAgentOutputRef.current = false;
    const trace = { steps: [message], output: '', phase: 'analyzing', isRunning: true };
    const id = `agent-run-${Date.now()}-${sequenceRef.current + 1}`;
    currentAgentRunIdRef.current = id;
    agentTraceRef.current = trace;
    setAgentTrace(trace);
    setAgentRuns((previous) => [...previous, {
      id,
      request,
      projectKind,
      createdAt: new Date().toISOString(),
      trace,
    }]);
    // Why: 信任白名单按 runId 切分；每启动一次新 agent 自动初始化一个空数组，
    // 用户在这次 run 里勾选过“信任”的命令前缀就命中，关 tab 整体失效。
    setTrustedTerminalPrefixes((previous) => previous[id] ? previous : { ...previous, [id]: [] });
  }, []);

  const continueAgentTrace = useCallback((message: string) => {
    hasAgentOutputRef.current = false;
    commitAgentTrace((previous) => ({
      ...previous,
      steps: [...previous.steps, message],
      output: `${previous.output}${previous.output ? '\n\n' : ''}--- ${message} ---\n`,
      phase: 'diagnosing',
      isRunning: true,
    }));
  }, [commitAgentTrace]);

  const consumeAgentEvent = useCallback((event: CodeGenerationEvent) => {
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
          isRunning: !event.done,
        };
      });
      return true;
    }
    if (event.type === 'terminal_proposal') {
      commitAgentTrace((previous) => ({
        ...previous,
        terminalProposals: [
          ...(previous.terminalProposals ?? []).filter((item) => item.command !== event.command),
          { command: event.command, reason: event.reason, expected_output_hint: event.expected_output_hint },
        ],
      }));
      return true;
    }
    if (event.type !== 'agent_activity') return false;
    if (event.channel === 'output') hasAgentOutputRef.current = true;
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
          isRunning: !event.done,
        };
      });
      return true;
    }
    commitAgentTrace((previous) => {
      if (event.channel === 'output') {
        return {
          ...previous,
          output: event.done ? event.content : `${previous.output}${event.content}`,
          phase: event.phase,
          isRunning: !event.done,
        };
      }
      const steps = previous.steps.at(-1) === event.content
        ? previous.steps
        : [...previous.steps, event.content];
      return { ...previous, steps, phase: event.phase, isRunning: !event.done };
    });
    return true;
  }, [commitAgentTrace]);

  const recordFileChanges = useCallback((beforeCode: string, afterCode: string, append = false) => {
    commitAgentTrace((previous) => ({
      ...previous,
      fileChanges: append
        ? summarizeFileChanges(beforeCode, afterCode).reduce<CodeFileChange[]>((changes, current) => {
            const existing = changes.find((change) => change.path === current.path);
            if (existing) {
              existing.additions += current.additions;
              existing.deletions += current.deletions;
            } else {
              changes.push({ ...current });
            }
            return changes;
          }, (previous.fileChanges ?? []).map((change) => ({ ...change })))
        : summarizeFileChanges(beforeCode, afterCode),
    }));
  }, [commitAgentTrace]);

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
    }, ERROR_CHECK_WINDOW_MS);
  }, [clearCheckTimer, updateCode]);

  const reset = useCallback(() => {
    controllerRef.current?.abort();
    controllerRef.current = null;
    clearCheckTimer();
    clearRepairRetryTimer();
    codeRef.current = '';
    runIdRef.current = '';
    repairCountRef.current = 0;
    isRepairingRef.current = false;
    errorOccurrencesRef.current.clear();
    recentErrorsRef.current = [];
    autoRepairStoppedRef.current = false;
    setCodeState('');
    setRunId('');
    setRepairLogs([]);
    agentTraceRef.current = EMPTY_AGENT_TRACE;
    currentAgentRunIdRef.current = '';
    setAgentTrace(EMPTY_AGENT_TRACE);
    setAgentRuns([]);
    // 终端信任白名单：reset 时一起清掉，避免之前的 run 信任污染新会话。
    setTrustedTerminalPrefixes({});
    setStatus({ state: 'idle' });
  }, [clearCheckTimer, clearRepairRetryTimer]);

  const restore = useCallback((savedCode: string) => {
    reset();
    if (!savedCode) return;
    updateCode(savedCode);
    sequenceRef.current += 1;
    const restoredRunId = `code-run-${Date.now()}-${sequenceRef.current}`;
    runIdRef.current = restoredRunId;
    setRunId(restoredRunId);
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
  ) => {
    reset();
    beginAgentTrace(projectKind === 'fullstack' ? '正在启动全栈代码智能体。' : '正在启动前端代码智能体。', prompt, projectKind);
    // 注意：beginAgentTrace 内部设置了 currentAgentRunIdRef，所以必须在它之后取 meta.run_id。
    const runIdForRequest = currentAgentRunIdRef.current;
    const controller = new AbortController();
    controllerRef.current = controller;
    setStatus({ state: 'generating', charCount: 0 });
    let didComplete = false;

    const handleEvent = (event: CodeGenerationEvent) => {
      if (event.type === 'agent_activity' || event.type === 'runtime_summary' || event.type === 'terminal_proposal') {
        consumeAgentEvent(event);
        return;
      }
      if (event.type === 'error') {
        setStatus({ state: 'error', message: event.message });
        commitAgentTrace((previous) => ({ ...previous, isRunning: false }));
        return;
      }
      // 这里只有 CodeUpdateEvent 了：RuntimeSummaryEvent/TerminalProposalEvent 都在上层 return
      if (!hasAgentOutputRef.current) {
        commitAgentTrace((previous) => ({ ...previous, output: event.code, phase: 'generating' }));
      }
      updateCode(event.code);
      if (event.done) {
        didComplete = true;
        recordFileChanges('', event.code);
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
          { workspace_id: terminalWorkspaceId, run_id: runIdForRequest },
        );
      } else {
        await generateWebCode(
          prompt, handleEvent, controller.signal, attachments,
          { workspace_id: terminalWorkspaceId, run_id: runIdForRequest },
        );
      }
    } catch (error) {
      commitAgentTrace((previous) => ({ ...previous, isRunning: false }));
      throw error;
    }
    return didComplete;
  }, [addTrustedTerminalPrefix, beginAgentTrace, beginRuntimeCheck, commitAgentTrace, consumeAgentEvent, recordFileChanges, reset, terminalWorkspaceId, updateCode]);

  const modify = useCallback(async (
    instruction: string,
    selectedElement: SelectedElementContext | null = null,
    attachments: ChatAttachment[] = [],
    // Why: Day57 @file 剪枝——把用户在前端 @ 的文件清单透传给后端 fullstack 修改接口。
    mentionedFiles: string[] = [],
  ) => {
    const currentCode = codeRef.current;
    if (!currentCode || !instruction.trim()) return false;
    const pendingDiagnostics = recentErrorsRef.current.join('\n');

    controllerRef.current?.abort();
    clearCheckTimer();
    clearRepairRetryTimer();
    repairCountRef.current = 0;
    isRepairingRef.current = false;
    errorOccurrencesRef.current.clear();
    recentErrorsRef.current = [];
    autoRepairStoppedRef.current = false;
    setRepairLogs([]);
    setStatus({ state: 'modifying', charCount: 0 });
    const currentVfs = parseProjectCode(currentCode);
    beginAgentTrace(currentVfs ? '正在启动全栈增量修改智能体。' : '正在启动前端增量修改智能体。', instruction, currentVfs ? 'fullstack' : 'frontend');
    const runIdForRequest = currentAgentRunIdRef.current;

    const controller = new AbortController();
    controllerRef.current = controller;
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
      if (event.type === 'agent_activity' || event.type === 'runtime_summary' || event.type === 'terminal_proposal') {
        consumeAgentEvent(event);
        return;
      }
      if (event.type === 'error') {
        commitAgentTrace((previous) => ({ ...previous, isRunning: false }));
        throw new Error(event.message);
      }
      // 这里只剩下 CodeUpdateEvent：narrowing 后 event.code / event.done 都合法
      if (!hasAgentOutputRef.current) {
        commitAgentTrace((previous) => ({ ...previous, output: event.code, phase: 'patching' }));
      }
      modifiedCode = event.code;
      didComplete = didComplete || event.done;
      if (event.done) commitAgentTrace((previous) => ({ ...previous, isRunning: false }));
      setStatus({ state: 'modifying', charCount: event.code.length });
    };
    try {
      // Why: fullstack 和 frontend 单文件路径都已支持视觉模型分析附件。
      if (currentVfs) {
        await modifyFullstackCode(
          currentVfs, instruction, targetElement, handleEvent, controller.signal, pendingDiagnostics, attachments,
          { workspace_id: terminalWorkspaceId, run_id: runIdForRequest },
          mentionedFiles,
        );
      } else {
        await modifyWebCode(
          currentCode, instruction, targetElement, handleEvent, controller.signal, pendingDiagnostics, attachments,
          { workspace_id: terminalWorkspaceId, run_id: runIdForRequest },
        );
      }
    } catch (error) {
      commitAgentTrace((previous) => ({ ...previous, isRunning: false }));
      throw error;
    }

    if (!modifiedCode || !didComplete) {
      throw new Error('增量修改接口没有返回完整代码。');
    }
    recordFileChanges(currentCode, modifiedCode);
    beginRuntimeCheck(modifiedCode);
    return true;
  }, [addTrustedTerminalPrefix, beginAgentTrace, beginRuntimeCheck, clearCheckTimer, clearRepairRetryTimer, commitAgentTrace, consumeAgentEvent, recordFileChanges, terminalWorkspaceId]);

  const handleRuntimeError = useCallback(async (
    runtimeError: RuntimeErrorReport,
  ) => {
    if (
      runtimeError.runId !== runIdRef.current ||
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
    const diagnostic = [
      formatRuntimeError(runtimeError),
      `This error has occurred ${occurrence} time(s) in the current repair cycle.`,
      occurrence >= 2
        ? 'The previous approach did not solve this error. Do not repeat it. Re-diagnose from a different layer: inspect syntax boundaries, event wiring, request URL, frontend/backend/database contracts, and possible sandbox bridge failures before choosing a new minimal patch.'
        : '',
      recentErrorsRef.current.length > 1
        ? `Recent error history (oldest to newest):\n${recentErrorsRef.current.map((item, index) => `${index + 1}. ${item}`).join('\n')}`
        : '',
    ].filter(Boolean).join('\n\n');
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
      const handleEvent = (event: CodeGenerationEvent) => {
          if (event.type === 'agent_activity' || event.type === 'runtime_summary' || event.type === 'terminal_proposal') {
            consumeAgentEvent(event);
            if (event.type === 'agent_activity' && event.channel === 'output') {
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
          // 只剩 CodeUpdateEvent
          if (!hasAgentOutputRef.current) {
            commitAgentTrace((previous) => ({ ...previous, output: `${previous.output}${event.code}`, phase: 'patching' }));
            repairModelOutput = event.code;
            setRepairLogs((previous) => previous.map((log) =>
              log.attempt === attempt ? { ...log, modelOutput: repairModelOutput } : log
            ));
          }
          fixedCode = event.code;
          didComplete = didComplete || event.done;
          if (event.done) commitAgentTrace((previous) => ({ ...previous, isRunning: false }));
          setStatus({
            state: 'repairing',
            attempt,
            charCount: event.code.length,
          });
        };
      if (currentVfs) {
        await fixFullstackCode(
          currentVfs, diagnostic, handleEvent, controller.signal,
          { workspace_id: terminalWorkspaceId, run_id: currentAgentRunIdRef.current },
        );
      } else {
        await fixWebCode(
          codeRef.current, diagnostic, handleEvent, controller.signal,
          { workspace_id: terminalWorkspaceId, run_id: currentAgentRunIdRef.current },
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
      recordFileChanges(codeBeforeRepair, fixedCode, true);
      beginRuntimeCheck(fixedCode);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      isRepairingRef.current = false;
      const message = error instanceof Error ? error.message : '自动修复失败。';
      setRepairLogs((previous) => previous.map((log) =>
        log.attempt === attempt ? { ...log, status: 'failed' } : log
      ));
      recentErrorsRef.current = [
        ...recentErrorsRef.current.slice(-7),
        `Repair synthesis failed: ${message}`,
      ];
      if (occurrence >= 2) {
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
  }, [beginRuntimeCheck, clearCheckTimer, clearRepairRetryTimer, commitAgentTrace, consumeAgentEvent, continueAgentTrace, recordFileChanges, terminalWorkspaceId]);

  repairHandlerRef.current = (runtimeError) => {
    void handleRuntimeError(runtimeError);
  };

  const stopAutoRepair = useCallback(() => {
    autoRepairStoppedRef.current = true;
    isRepairingRef.current = false;
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
    addTrustedTerminalPrefix,
  };
}
