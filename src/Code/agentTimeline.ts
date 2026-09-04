import type {
  CodeAgentActorKind,
  CodeAgentTimelineEvent,
  CodeAgentTimelineStage,
  CodeFileChange,
} from '../lib/api';

export type TimelineEventInput = Omit<CodeAgentTimelineEvent, 'eventId'> & {
  eventId: string;
};

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

export function timelineCharCount(events: CodeAgentTimelineEvent[]): number {
  return events.reduce((total, event) => total + event.content.length, 0);
}

export type { CodeAgentActorKind, CodeAgentTimelineEvent, CodeAgentTimelineStage, CodeFileChange };
