import type { CodeGenerationEvent } from '../lib/api';
import type { CodeObservatoryWireEvent } from '../lib/codeObservatoryApi';

export type CodeObservatoryStatus =
  | 'running'
  | 'scheduled'
  | 'passed'
  | 'failed'
  | 'blocked'
  | 'completed'
  | 'verified'
  | 'partially_verified'
  | 'contradicted'
  | 'assertion_failed'
  | 'inconclusive'
  | 'unverifiable'
  | 'invalid_test'
  | 'infra_failure'
  | 'cancelled'
  | 'unknown';

/** Safe event metadata for the UI; model text and tool payloads are intentionally excluded. */
export interface CodeObservatoryEvent {
  id: string;
  sequence: number;
  timestampMs: number;
  label: string;
  status: CodeObservatoryStatus;
  sourceRole?: string;
}

const PHASE_LABELS: Record<string, string> = {
  preflight: '预检',
  analyzing: '分析',
  diagnosing: '诊断',
  thinking: '思考',
  generating: '生成',
  patching: '修改',
  validating: '验证',
  static_verify: '静态检查',
  planning: '规划',
  tool_calling: '调用工具',
  action_intent: '准备执行',
  tool_result: '工具返回',
  next_step: '下一步',
  done: '完成',
  module_verify: '模块验证',
  precheck: '前置检查',
  test_agent: '测试智能体',
};

const TYPE_LABELS: Record<string, string> = {
  code_update: '代码更新',
  error: '错误',
  agent_activity: '智能体活动',
  test_agent_checkpoint: '验收检查点',
  test_agent_execution: '验收执行',
  test_agent_result: '验收结果',
  test_agent_contract_replan: '验收重规划',
  hook_event: '钩子事件',
  token_usage: 'Token 用量',
  runtime_summary: '运行总结',
  runtime_verification_result_committed: '验证结果提交',
  stop_decision_recorded: '终态决策',
  terminal_proposal: '终端提议',
  sandbox_command_request: '沙盒命令请求',
  task_list: '任务列表',
  goal_obligations: '目标约束',
  task_update: '任务更新',
  file_written: '文件写入',
  agent_loop_round: '智能体轮次',
  context_usage: '上下文用量',
  memory_update: '记忆更新',
  skill_matched: '技能匹配',
};

const KNOWN_STATUSES = new Set<CodeObservatoryStatus>([
  'running',
  'scheduled',
  'passed',
  'failed',
  'blocked',
  'completed',
  'verified',
  'partially_verified',
  'contradicted',
  'assertion_failed',
  'inconclusive',
  'unverifiable',
  'invalid_test',
  'infra_failure',
  'cancelled',
]);

const EVENT_CATEGORY_LABELS: Record<string, string> = {
  intake: '任务接入',
  control: '控制判定',
  execution: '执行活动',
  implementation: '代码实现',
  proof: '证明记录',
  verification: '验证记录',
  recovery: '恢复记录',
  terminal: '终态决策',
  observation: '观测记录',
  other: '流程事件',
};

const VERIFICATION_STATUSES = new Set<CodeObservatoryStatus>([
  'verified',
  'partially_verified',
  'contradicted',
  'assertion_failed',
  'inconclusive',
  'unverifiable',
  'invalid_test',
  'infra_failure',
]);

function safeFeedStatus(event: CodeObservatoryWireEvent): CodeObservatoryStatus {
  const verification = event.status?.verification;
  if (typeof verification === 'string' && VERIFICATION_STATUSES.has(verification as CodeObservatoryStatus)) {
    return verification as CodeObservatoryStatus;
  }
  switch (event.status?.execution) {
    case 'queued': return 'scheduled';
    case 'running': return 'running';
    case 'succeeded': return 'completed';
    case 'failed': return 'failed';
    case 'cancelled': return 'cancelled';
    default: return 'unknown';
  }
}

/** Project only the backend's safe contract; source payloads never reach the UI. */
export function projectCodeObservatoryFeedEvents(
  runId: string,
  events: CodeObservatoryWireEvent[],
  limit = 24,
): CodeObservatoryEvent[] {
  const aggregateId = runId.trim();
  if (!aggregateId || !Number.isFinite(limit) || limit < 1) return [];

  const seenOffsets = new Set<number>();
  const projected: CodeObservatoryEvent[] = [];
  for (const event of events) {
    const offset = event.observation_offset;
    if (
      event.aggregate_kind !== 'run'
      || event.aggregate_id !== aggregateId
      || event.run_id !== aggregateId
      || !Number.isSafeInteger(offset)
      || offset < 1
      || seenOffsets.has(offset)
    ) continue;

    seenOffsets.add(offset);
    const category = Object.prototype.hasOwnProperty.call(EVENT_CATEGORY_LABELS, event.event_category)
      ? EVENT_CATEGORY_LABELS[event.event_category]
      : '流程事件';
    const typeLabel = Object.prototype.hasOwnProperty.call(TYPE_LABELS, event.event_type)
      ? TYPE_LABELS[event.event_type]
      : undefined;
    const timestampMs = event.committed_at_ms ?? event.occurred_at_ms ?? event.observed_at_ms;
    if (!Number.isFinite(timestampMs) || timestampMs < 0) continue;

    projected.push({
      id: `${aggregateId}:observation:${offset}`,
      sequence: offset,
      timestampMs,
      label: typeLabel ? `${category} · ${typeLabel}` : category,
      status: safeFeedStatus(event),
      sourceRole: event.source_role,
    });
  }

  projected.sort((left, right) => left.sequence - right.sequence);
  return projected.slice(-Math.trunc(limit));
}

function safeStatus(value: unknown): CodeObservatoryStatus {
  return typeof value === 'string' && KNOWN_STATUSES.has(value as CodeObservatoryStatus)
    ? value as CodeObservatoryStatus
    : 'unknown';
}

/**
 * Project the durable event envelope into an ordered, bounded, read-only view.
 * Backend sequence and timestamp are mandatory; local fallback ordering would
 * make a replay look authoritative when its event contract is incomplete.
 */
export function projectCodeObservatoryEvents(
  runId: string,
  events: CodeGenerationEvent[],
  limit = 24,
): CodeObservatoryEvent[] {
  const streamRunId = runId.trim();
  if (!streamRunId || !Number.isFinite(limit) || limit < 1) return [];

  const seenSequences = new Set<number>();
  const projected: CodeObservatoryEvent[] = [];

  for (const event of events) {
    const envelope = event as unknown as Record<string, unknown>;
    const sequence = envelope.sequence;
    const timestampMs = envelope.timestamp_ms;
    if (
      envelope.run_id !== streamRunId
      || typeof sequence !== 'number'
      || !Number.isSafeInteger(sequence)
      || sequence < 1
      || typeof timestampMs !== 'number'
      || !Number.isFinite(timestampMs)
      || timestampMs < 0
      || seenSequences.has(sequence)
    ) continue;

    seenSequences.add(sequence);
    const phase = envelope.phase;
    const eventType = envelope.type;
    const label = typeof phase === 'string' && Object.prototype.hasOwnProperty.call(PHASE_LABELS, phase)
      ? PHASE_LABELS[phase]
      : typeof eventType === 'string' && Object.prototype.hasOwnProperty.call(TYPE_LABELS, eventType)
        ? TYPE_LABELS[eventType]
        : '流程事件';
    const status = safeStatus(
      envelope.status
      ?? (eventType === 'error' || (eventType === 'hook_event' && envelope.event === 'errored')
        ? 'failed'
        : undefined),
    );

    projected.push({
      id: `${streamRunId}:${sequence}`,
      sequence,
      timestampMs,
      label,
      status,
    });
  }

  projected.sort((left, right) => left.sequence - right.sequence);
  return projected.slice(-Math.trunc(limit));
}
