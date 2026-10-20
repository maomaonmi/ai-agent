import type {
  CodeAgentActorKind,
  CodeAgentTimelineEvent,
  CodeAgentTimelineStage,
  CodeFileChange,
  CodeAgentRun,
  CodeCompletionFeedback,
} from '../lib/api';

export type TimelineEventInput = Omit<CodeAgentTimelineEvent, 'eventId'> & {
  eventId: string;
};

/** Project older traces only; durable Runtime feedback owns terminal results. */
export function projectTimelineCompletionFeedback(
  sourceRun: CodeAgentRun | undefined,
  events: CodeAgentTimelineEvent[],
): CodeCompletionFeedback | undefined {
  const trace = sourceRun?.trace;
  if (trace?.completionFeedback) return trace.completionFeedback;
  if (!trace?.fileChanges?.length) return undefined;
  const candidateRevision = trace.runtimeVerification?.candidateRevision;
  let staticValidation = 'unknown';
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    // A denied tool invocation says nothing about the candidate's validity.
    if (event.metadata?.phase !== 'static_verify') continue;
    if (candidateRevision && event.metadata?.candidate_revision !== candidateRevision) continue;
    const status = String(event.metadata?.runtimeStatus ?? event.status ?? '').toLowerCase();
    staticValidation = status === 'passed' || status === 'failed' ? status : 'unknown';
    break;
  }
  const status = trace.status ?? 'unknown';
  return {
    summary: trace.summary ?? '',
    changes: trace.fileChanges.map((change) => ({...change, operation: 'modify'})),
    verification: {
      status, static_validation: staticValidation,
      acceptance_validation: status === 'completed_unverified' ? 'unavailable' : 'not_run',
    },
  };
}

/** Keep the terminal completion card as the single display for text it fully contains. */
export function filterDuplicateFinalSummaryEvents(
  events: CodeAgentTimelineEvent[],
  completionSummary: string | undefined,
): CodeAgentTimelineEvent[] {
  const finalText = completionSummary?.trim();
  if (!finalText) return events;

  return events.filter((event) => (
    !['output', 'summary'].includes(event.stage)
    || !event.content.trim()
    || !finalText.includes(event.content.trim())
  ));
}

function mergeMetrics(
  current: CodeAgentTimelineEvent['metrics'],
  incoming: CodeAgentTimelineEvent['metrics'],
): CodeAgentTimelineEvent['metrics'] {
  if (!current && !incoming) return undefined;
  return {
    ...current,
    ...incoming,
  };
}

/**
 * Appends one event to the replayable UI projection.
 *
 * The server sequence is the ordering authority. `eventId` makes reconnects
 * idempotent, while `mergeKey` coalesces deltas from the same actor/stage.
 */
export function appendTimelineEvent(
  events: CodeAgentTimelineEvent[],
  input: TimelineEventInput,
): CodeAgentTimelineEvent[] {
  const projectionKey = typeof input.metadata?.timeline_projection_key === 'string'
    ? input.metadata.timeline_projection_key
    : '';
  const projectionIndex = projectionKey
    ? events.findIndex((event) => event.metadata?.timeline_projection_key === projectionKey)
    : -1;

  if (projectionIndex >= 0) {
    const current = events[projectionIndex];
    const currentProgressSequence = Number(current?.metadata?.progress_sequence);
    const incomingProgressSequence = Number(input.metadata?.progress_sequence);
    // SSE replay can deliver an older progress event after a newer snapshot.
    // Keep the server's progress sequence as the ordering authority while the
    // timeline row itself remains a stable, local projection.
    if (
      Number.isFinite(currentProgressSequence)
      && Number.isFinite(incomingProgressSequence)
      && incomingProgressSequence <= currentProgressSequence
    ) {
      return events;
    }

    const next = [...events];
    const mergedMetadata = {
      ...current.metadata,
      ...input.metadata,
    };
    const incomingDraftDelta = input.metadata?.draft_preview_delta;
    if (typeof incomingDraftDelta === 'string' && incomingDraftDelta.length > 0) {
      mergedMetadata.planner_draft_preview = `${typeof current.metadata?.planner_draft_preview === 'string'
        ? current.metadata.planner_draft_preview
        : ''}${incomingDraftDelta}`;
    }
    delete mergedMetadata.draft_preview_delta;
    next[projectionIndex] = {
      ...current,
      ...input,
      eventId: current.eventId,
      sequence: current.sequence,
      metrics: mergeMetrics(current.metrics, input.metrics),
      metadata: mergedMetadata,
    };
    return next;
  }

  const existingIndex = events.findIndex((event) => event.eventId === input.eventId);
  if (existingIndex >= 0) {
    const next = [...events];
    next[existingIndex] = {
      ...next[existingIndex],
      ...input,
      metrics: mergeMetrics(next[existingIndex]?.metrics, input.metrics),
    };
    return next;
  }

  const mergeIndex = input.mergeKey
    ? events.findLastIndex((event) => (
      event.actorId === input.actorId
      && event.actorKind === input.actorKind
      && event.mergeKey === input.mergeKey
      && !event.done
    ))
    : -1;

  if (mergeIndex >= 0) {
    const current = events[mergeIndex];
    const next = [...events];
    next[mergeIndex] = {
      ...current,
      content: `${current.content}${input.content}`,
      done: input.done,
      timestampMs: input.timestampMs,
      status: input.status ?? current.status,
      iteration: input.iteration ?? current.iteration,
      metrics: mergeMetrics(current.metrics, input.metrics),
      file: input.file ?? current.file,
      metadata: {
        ...current.metadata,
        ...input.metadata,
      },
    };
    return next;
  }

  return [...events, input].sort((left, right) => left.sequence - right.sequence);
}

export function completeTimelineEvent(
  events: CodeAgentTimelineEvent[],
  matcher: Pick<CodeAgentTimelineEvent, 'actorId' | 'actorKind' | 'stage'> & {
    mergeKey?: string;
    timestampMs?: number;
    durationMs?: number;
  },
): CodeAgentTimelineEvent[] {
  const index = events.findLastIndex((event) => (
    event.actorId === matcher.actorId
    && event.actorKind === matcher.actorKind
    && event.stage === matcher.stage
    && event.mergeKey === matcher.mergeKey
    && !event.done
  ));
  if (index < 0) return events;

  const next = [...events];
  const current = next[index];
  next[index] = {
    ...current,
    done: true,
    timestampMs: matcher.timestampMs ?? current.timestampMs,
    metrics: matcher.durationMs == null
      ? current.metrics
      : { ...current.metrics, durationMs: matcher.durationMs },
  };
  return next;
}

export function shouldShowActorLabel(
  events: Pick<CodeAgentTimelineEvent, 'actorKind'>[],
  index: number,
): boolean {
  if (index <= 0) return index === 0 && events.length > 0;
  return events[index - 1]?.actorKind !== events[index]?.actorKind;
}

export function filterHookTimelineEvents(events: CodeAgentTimelineEvent[]): CodeAgentTimelineEvent[] {
  return events.filter((event) => event.metadata?.source !== 'hook');
}

export interface PairedActionStatus {
  status: string;
  done: boolean;
}

/**
 * PLAN-PD §3.5: index `action_result` events by `action_id` so intent cards
 * pair with their result by identity, never by temporal adjacency.
 *
 * Later results for the same id win (the newest authoritative state).
 */
export function buildPairedActionStatus(
  events: CodeAgentTimelineEvent[],
): Map<string, PairedActionStatus> {
  const map = new Map<string, PairedActionStatus>();
  for (const item of events) {
    if (item.metadata?.event_semantics !== 'action_result') continue;
    const actionId = typeof item.metadata?.action_id === 'string' ? item.metadata.action_id : '';
    if (!actionId) continue;
    map.set(actionId, {
      status: item.status ?? String(item.metadata?.action_status ?? ''),
      done: item.done,
    });
  }
  return map;
}

export interface ActionIntentNarration {
  runtimeFacts: string;
  modelRationale: string;
  rationaleState: string;
  narrationSource: string;
  actionId: string;
}

/**
 * PLAN-PD §3.5 narration dual channel. `runtime_facts` is the Runtime-authored
 * factual record; `model_rationale` carries the assistant's user-facing action
 * narration. The action result frame remains the authority for completion state.
 */
export function resolveActionIntentNarration(
  event: CodeAgentTimelineEvent,
): ActionIntentNarration {
  const metadata = event.metadata ?? {};
  const narration = (
    typeof metadata.narration === 'object' && metadata.narration !== null
      ? (metadata.narration as Record<string, unknown>)
      : {}
  );
  const runtimeFacts = typeof narration.runtime_facts === 'string' && narration.runtime_facts.trim()
    ? narration.runtime_facts
    : event.content.split('\n')[0];
  return {
    runtimeFacts,
    modelRationale: typeof narration.model_rationale === 'string'
      ? narration.model_rationale.trim()
      : '',
    rationaleState: typeof narration.rationale_state === 'string'
      ? narration.rationale_state
      : '',
    narrationSource: typeof narration.narration_source === 'string'
      ? narration.narration_source
      : '',
    actionId: typeof metadata.action_id === 'string' ? metadata.action_id : '',
  };
}

function actionTargetPaths(event: CodeAgentTimelineEvent): string[] {
  const metadata = event.metadata ?? {};
  const paths = Array.isArray(metadata.target_paths)
    ? metadata.target_paths.filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
    : [];
  if (paths.length > 0) return paths.slice(0, 3).map((path) => path.trim());
  const filePath = event.file?.path
    || (typeof metadata.path === 'string' ? metadata.path : '');
  return filePath.trim() ? [filePath.trim()] : [];
}

/** Prefer model-authored narration; use a Chinese tool-specific fallback when it is absent. */
export function describeActionIntentInChinese(event: CodeAgentTimelineEvent): string {
  const metadata = event.metadata ?? {};
  const toolName = typeof metadata.tool_name === 'string'
    ? metadata.tool_name.trim().toLowerCase()
    : '';
  const { modelRationale } = resolveActionIntentNarration(event);
  const rationale = modelRationale.trim();
  if (rationale) return rationale;

  const paths = actionTargetPaths(event);
  const target = paths.join('、');
  switch (toolName) {
    case 'validate_project':
      return '我准备开始检查项目配置和文件结构。';
    case 'read_file':
      return target
        ? `我准备先读取 ${target}，了解当前内容。`
        : '我准备先读取相关文件，了解当前内容。';
    case 'list_files':
      return '我准备先查看项目文件，确认当前有哪些内容。';
    case 'write_file':
      return target
        ? `我准备把需要的内容写入 ${target}。`
        : '我准备创建或更新所需文件。';
    case 'patch_file':
      return target
        ? `我准备修改 ${target}，完成这一步的调整。`
        : '我准备按当前计划修改相关内容。';
    case 'delete_file':
      return target
        ? `我准备删除 ${target}。`
        : '我准备移除当前步骤指定的文件。';
    case 'search_files':
    case 'search_codebase':
      return '我准备在项目中查找相关内容。';
    case 'run_command':
    case 'execute_command':
    case 'run_tests':
      return '我准备运行检查，确认实际执行结果。';
    default:
      return target
        ? `我准备继续处理与 ${target} 相关的内容。`
        : '我准备继续处理当前步骤。';
  }
}

/** Runtime-facing call summary for TestAgent actions; the public model note is
 * already streamed as an output event and should not be repeated on this card. */
export function describeTestAgentActionInChinese(event: CodeAgentTimelineEvent): string {
  const metadata = event.metadata ?? {};
  const toolName = typeof metadata.tool_name === 'string'
    ? metadata.tool_name.trim().toLowerCase()
    : '';
  const paths = Array.isArray(metadata.target_paths)
    ? metadata.target_paths.filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
    : [];
  const target = paths.join('、');
  switch (toolName) {
    case 'read_file':
      return target ? `我准备读取文件 ${target}，核对当前候选的实际内容。` : '我准备读取相关文件，核对当前候选的实际内容。';
    case 'list_files':
      return '我准备查看项目文件清单，确认当前有哪些候选文件。';
    case 'get_contract':
      return '我准备检查候选中的接口与数据契约摘要。';
    case 'sandbox_console_eval':
      return '我准备在当前预览环境中读取运行时表现。';
    default:
      return target ? `我准备检查 ${target}。` : '我准备调用只读工具核对当前证据。';
  }
}

export function toolNameInChinese(toolName: string): string {
  const names: Record<string, string> = {
    read_file: '读取文件',
    list_files: '查看文件清单',
    get_contract: '检查接口契约',
    sandbox_console_eval: '读取预览运行状态',
    validate_project: '检查项目',
    search_files: '搜索文件',
    search_codebase: '搜索代码',
  };
  const normalized = toolName.trim().toLowerCase();
  return names[normalized] ?? '执行只读检查';
}

const TIMELINE_STATUS_LABELS: Record<string, string> = {
  thinking: '正在思考',
  analyzing: '正在分析',
  planning: '正在规划',
  tool_calling: '正在准备行动',
  running: '进行中',
  processing: '处理中',
  validating: '正在检查',
  scheduled: '已安排',
  pending: '等待中',
  awaiting: '等待中',
  awaiting_approval: '等待授权',
  completed: '已完成',
  succeeded: '已完成',
  passed: '已通过',
  failed: '失败',
  blocked: '已阻塞',
  skipped: '已跳过',
  deferred: '稍后处理',
  cancelled: '已取消',
  canceled: '已取消',
  error: '出现错误',
};

/** Localize known status enums; unknown protocol values stay out of user copy. */
export function timelineStatusLabel(status: string | undefined): string {
  if (!status) return '';
  const normalized = status.trim().toLowerCase();
  return TIMELINE_STATUS_LABELS[normalized]
    || (/[\u3400-\u9fff]/.test(status) ? status : '');
}

export function timelineCharCount(events: CodeAgentTimelineEvent[]): number {
  return events.reduce((total, event) => total + event.content.length, 0);
}

export type { CodeAgentActorKind, CodeAgentTimelineEvent, CodeAgentTimelineStage, CodeFileChange };
