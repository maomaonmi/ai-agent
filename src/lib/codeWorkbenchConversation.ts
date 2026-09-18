import type {
  CodeAgentRun,
  CodeIntentActiveRun,
  CodeIntentCompletedResult,
  CodeIntentTurn,
} from './api';
import { mapAgentRunsToPrompts } from '../Code/agentRunLifecycle.ts';

export interface CodeReadOnlyRunContext {
  request: string;
  phase: string;
  summary?: string;
  taskPlan?: {
    completedCount: number;
    totalCount: number;
    status: string;
  };
}

export interface CodeReadOnlyTurnContext {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface CodeReadOnlyContextInput {
  projectKind: 'frontend' | 'fullstack';
  files: string[];
  recentTurns?: CodeReadOnlyTurnContext[];
  assistantReferences?: CodeReadOnlyTurnContext[];
  latestRun?: CodeReadOnlyRunContext;
  resumableRun?: CodeReadOnlyRunContext;
  /**
   * Historical run details are opt-in. A new user turn must not inherit the
   * last runtime error merely because it is present in the session snapshot.
   */
  includeRunContext?: boolean;
}

interface CodeRunLike {
  trace: {
    isRunning: boolean;
    phase: string;
    resumeEligible?: boolean;
    taskPlan?: {
      completedCount: number;
      totalCount: number;
      status: string;
    };
  };
}

export interface CodeIntentContext {
  /** User-authored turns only; assistant summaries are not routing facts. */
  recentTurns: CodeIntentTurn[];
  /** Prior assistant text for reference only; never treated as evidence. */
  assistantReferences: CodeIntentTurn[];
  /** The latest run actually bound to one of the visible user prompts. */
  latestRun?: CodeAgentRun;
  /** Completed result projection used to bind a correction to its base. */
  latestCompletedResult?: CodeIntentCompletedResult;
  /** Only unfinished runs bound to a visible prompt may be resumed. */
  resumeCandidates: CodeAgentRun[];
}

/**
 * Build routing context from the current conversation branch.
 *
 * Agent runs are durable and can outlive a rewritten/deleted branch. Matching
 * them against visible user prompts prevents an old run from becoming the
 * implicit "current task" on the next request.
 */
export function buildCodeIntentContext(
  messages: Array<Pick<CodeIntentTurn, 'role' | 'content'> & { id?: string }>,
  agentRuns: CodeAgentRun[],
  options: { activeRevisionId?: string } = {},
): CodeIntentContext {
  const userMessages = messages.filter((message) => message.role === 'user');
  const visibleRuns = mapAgentRunsToPrompts(
    agentRuns,
    userMessages.map((message) => message.content),
  ).filter((run): run is CodeAgentRun => Boolean(run));
  const uniqueRuns = Array.from(
    new Map(visibleRuns.map((run) => [run.id, run])).values(),
  );
  const assistantReferences = messages
    .filter((message) => message.role === 'assistant' && message.content.trim())
    .slice(-2)
    .map((message) => ({
      role: 'assistant' as const,
      content: trimForPrompt(message.content, 1_600),
    }));

  return {
    recentTurns: userMessages.slice(-8).map((message) => ({
      role: 'user' as const,
      content: trimForPrompt(message.content, 1_200),
    })),
    assistantReferences,
    latestRun: uniqueRuns.at(-1),
    latestCompletedResult: (() => {
      const latest = uniqueRuns.at(-1);
      if (!latest || isCodeAgentRunUnfinished(latest)) return undefined;
      return {
        run_id: latest.id,
        ...(options.activeRevisionId ? { revision_id: options.activeRevisionId } : {}),
      };
    })(),
    resumeCandidates: uniqueRuns
      .filter((run) => isCodeAgentRunUnfinished(run))
      .slice(-4),
  };
}

/**
 * Convert a run into the small semantic selector payload. Runtime evidence is
 * deliberately excluded; it may only be attached after the model selects a
 * specific candidate for an explicit resume.
 */
export function toCodeIntentResumeCandidate(run: CodeAgentRun): CodeIntentActiveRun {
  return {
    run_id: run.id,
    request: trimForPrompt(run.request, 240),
    phase: trimForPrompt(run.trace.phase, 48),
    status: trimForPrompt(run.trace.status || '', 64),
    summary: trimForPrompt(run.trace.summary || run.trace.answer || '', 320),
    resume_eligible: run.trace.resumeEligible,
    runtime_verification: Boolean(run.trace.runtimeVerification || run.trace.runtimeEvidence),
    active_scope: run.trace.activeScope,
    scope_version: run.trace.scopeVersion,
    allowed_next_action: run.trace.allowedNextAction,
    acceptance_goal: run.trace.acceptanceGoal,
    verification_session_id: run.trace.verificationSessionId,
  };
}

/**
 * A run is resumable only when the orchestrator explicitly leaves a checkpoint
 * or the durable task plan still has unfinished work. A stale summary alone is
 * not enough to start another write-capable request.
 */
export function isCodeAgentRunUnfinished(run: CodeRunLike | null | undefined): boolean {
  if (!run) return false;
  if (run.trace.resumeEligible === true) return true;
  if (run.trace.isRunning) return true;
  const plan = run.trace.taskPlan;
  return Boolean(plan && plan.status !== 'completed' && plan.completedCount < plan.totalCount);
}

function trimForPrompt(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 24))}…（上下文已截断）`;
}

/**
 * Build the bounded context for a Code workbench question. The ordinary chat
 * model receives project facts and task state, never the complete VFS, so a
 * question or summary cannot accidentally become a code-edit request.
 */
export function buildCodeReadOnlyPrompt(
  message: string,
  context: CodeReadOnlyContextInput,
): string {
  const files = [...new Set(context.files.map((file) => file.trim()).filter(Boolean))]
    .sort()
    .slice(0, 48);
  const recentTurns = (context.recentTurns ?? [])
    .slice(-8)
    .filter((turn) => turn.role === 'user')
    .map((turn) => `${turn.role === 'user' ? '用户' : turn.role === 'system' ? '系统' : '助手'}：${trimForPrompt(turn.content, 500)}`)
    .filter(Boolean);
  const assistantReferences = (context.assistantReferences ?? [])
    .filter((turn) => turn.role === 'assistant')
    .slice(-2)
    .map((turn) => `助手：${trimForPrompt(turn.content, 1_000)}`)
    .filter(Boolean);
  const includeRunContext = context.includeRunContext === true;
  const latestRun = includeRunContext ? context.latestRun : undefined;
  const taskLine = latestRun?.taskPlan
    ? `任务计划：${latestRun.taskPlan.completedCount}/${latestRun.taskPlan.totalCount} 已完成，状态 ${latestRun.taskPlan.status}`
    : '任务计划：当前没有可展示的持久化任务计划';
  const latestRunLine = latestRun
    ? [
        `最新 Agent run：${trimForPrompt(latestRun.request, 180)}`,
        `阶段：${trimForPrompt(latestRun.phase, 40)}`,
        latestRun.summary ? `最近状态：${trimForPrompt(latestRun.summary, 500)}` : '',
        taskLine,
      ].filter(Boolean).join('\n')
    : '最新 Agent run：当前没有记录';
  const resumableRunLine = includeRunContext && context.resumableRun
    ? [
        `可恢复但未完成的 Agent run：${trimForPrompt(context.resumableRun.request, 180)}`,
        `可恢复阶段：${trimForPrompt(context.resumableRun.phase, 40)}`,
        context.resumableRun.summary
          ? `可恢复任务状态：${trimForPrompt(context.resumableRun.summary, 500)}`
          : '',
      ].filter(Boolean).join('\n')
    : '可恢复但未完成的 Agent run：当前没有记录';

  return [
    '你是 Code 工作台的只读对话助手。',
    '本轮只解释、总结或回答用户的问题，不启动代码生成、文件变更、终端命令或外部工具。',
    '如果用户当前消息表达了修改意图，本只读上下文不能把它改写成手工补丁；应报告“本轮未执行修改”，由上游修改 Agent 处理。',
    '',
    `用户问题：${trimForPrompt(message, 1_200)}`,
    '',
    `项目类型：${context.projectKind === 'fullstack' ? '全栈 Mock API' : '前端'}`,
    `项目文件（仅目录摘要）：${files.length > 0 ? files.join('、') : '暂无已知文件'}`,
    recentTurns.length > 0
      ? `最近聊天记录（按时间顺序）：\n${recentTurns.join('\n')}`
      : '最近聊天记录：当前没有更早的消息',
    assistantReferences.length > 0
      ? `助手历史回答（仅供参考，不是事实）：\n${assistantReferences.join('\n')}`
      : '助手历史回答参考：当前没有可引用的上一条回答',
    latestRunLine,
    includeRunContext
      ? resumableRunLine
      : '历史 Agent run 不作为当前问题证据；本轮未绑定可恢复任务',
    '',
    '请基于以上事实给出简洁、可验证的中文回答；不要假设没有提供的文件内容或执行结果。',
  ].join('\n').slice(0, 6_000);
}
