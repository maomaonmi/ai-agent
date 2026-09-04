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

export function timelineCharCount(events: CodeAgentTimelineEvent[]): number {
  return events.reduce((total, event) => total + event.content.length, 0);
}

export type { CodeAgentActorKind, CodeAgentTimelineEvent, CodeAgentTimelineStage, CodeFileChange };
