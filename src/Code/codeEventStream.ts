import type { CodeGenerationEvent } from '../lib/api';
import type { CodeAgentActivityEvent } from '../lib/api';

/**
 * Consumes the transport envelope at the browser boundary.
 * The backend sequence is authoritative for one Agent run; local timeline
 * sequence allocation is only a fallback for legacy events without metadata.
 */
export class CodeAgentEventBuffer {
  private readonly seenEventIds = new Set<string>();
  private lastSequence = 0;
  private readonly expectedRunId?: string;

  constructor(expectedRunId?: string) {
    this.expectedRunId = expectedRunId;
  }

  get lastAcceptedSequence(): number {
    return this.lastSequence;
  }

  accept(event: CodeGenerationEvent): CodeGenerationEvent[] {
    if (this.expectedRunId && event.run_id && event.run_id !== this.expectedRunId) {
      return [];
    }

    if (event.event_id) {
      if (this.seenEventIds.has(event.event_id)) return [];
      this.seenEventIds.add(event.event_id);
    }

    if (typeof event.sequence === 'number') {
      if (event.sequence <= this.lastSequence) return [];
      this.lastSequence = event.sequence;
    }

    return [event];
  }
}

const ACTIVITY_KEY_SEPARATOR = '\u001f';

function activityRunId(event: CodeAgentActivityEvent, fallbackRunId?: string): string {
  return event.run_id?.trim() || fallbackRunId?.trim() || 'unknown-run';
}

function activityActorId(event: CodeAgentActivityEvent): string {
  return event.actor_id?.trim() || 'unknown-actor';
}

function activityKey(
  event: CodeAgentActivityEvent,
  fallbackRunId?: string,
  includePhase = true,
  mergeLegacyOutputDeltas = false,
): string | null {
  const turnId = event.turn_id?.trim();
  if (!turnId) return null;
  const isLegacyOutputDelta = (
    mergeLegacyOutputDeltas
    && event.channel === 'output'
    && event.content_mode == null
  );
  if (
    event.boundary !== 'turn_completed'
    && event.content_mode !== 'delta'
    && !isLegacyOutputDelta
  ) return null;
  const parts = [
    activityRunId(event, fallbackRunId),
    turnId,
    activityActorId(event),
    event.channel,
  ];
  if (includePhase) parts.push(event.phase);
  return parts.join(ACTIVITY_KEY_SEPARATOR);
}

/**
 * Projects provider token deltas onto one logical timeline event per turn.
 *
 * Transport events remain individually replayable in CodeAgentEventBuffer;
 * this buffer only changes the UI projection. That keeps the event protocol
 * lossless while preventing one model answer from becoming one card per
 * provider chunk. The empty AgentLoop turn boundary closes the aggregate.
 */
export class CodeAgentActivityDeltaBuffer {
  private readonly active = new Map<string, CodeAgentActivityEvent>();
  private readonly fallbackRunId?: string;
  private readonly mergeLegacyOutputDeltas: boolean;

  constructor(
    fallbackRunId?: string,
    options?: { mergeLegacyOutputDeltas?: boolean },
  ) {
    this.fallbackRunId = fallbackRunId;
    this.mergeLegacyOutputDeltas = options?.mergeLegacyOutputDeltas ?? false;
  }

  accept(event: CodeAgentActivityEvent): CodeAgentActivityEvent[] {
    const exactKey = activityKey(
      event,
      this.fallbackRunId,
      true,
      this.mergeLegacyOutputDeltas,
    );
    const isBoundary = event.boundary === 'turn_completed';
    if (!exactKey && !isBoundary) return [event];

    const key = isBoundary
      ? (exactKey && this.active.has(exactKey) ? exactKey : this.findBoundaryKey(event))
      : exactKey;
    if (!key) return event.content.trim() ? [event] : [];

    const previous = this.active.get(key);
    if (isBoundary) {
      this.active.delete(key);
      if (!previous) return event.content.trim() ? [event] : [];
      return [this.close(previous, event)];
    }

    const merged: CodeAgentActivityEvent = previous
      ? {
          ...previous,
          ...event,
          content: `${previous.content}${event.content}`,
          done: event.done,
          event_id: previous.event_id,
        }
      : {
          ...event,
          event_id: event.event_id || this.syntheticEventId(event),
        };

    if (event.done) this.active.delete(key);
    else this.active.set(key, merged);
    return [merged];
  }

  /** Close a stream defensively when a transport ends without a boundary. */
  flush(): CodeAgentActivityEvent[] {
    const events = [...this.active.values()].map((event) => ({
      ...event,
      done: true,
    }));
    this.active.clear();
    return events;
  }

  private findBoundaryKey(event: CodeAgentActivityEvent): string | null {
    const prefix = activityKey(
      event,
      this.fallbackRunId,
      false,
      this.mergeLegacyOutputDeltas,
    );
    if (!prefix) return null;
    return [...this.active.keys()].find((key) => key.startsWith(`${prefix}${ACTIVITY_KEY_SEPARATOR}`)) || null;
  }

  private syntheticEventId(event: CodeAgentActivityEvent): string {
    const key = activityKey(
      event,
      this.fallbackRunId,
      true,
      this.mergeLegacyOutputDeltas,
    );
    return `${key || activityRunId(event, this.fallbackRunId)}:activity`;
  }

  private close(
    previous: CodeAgentActivityEvent,
    boundary: CodeAgentActivityEvent,
  ): CodeAgentActivityEvent {
    return {
      ...previous,
      content: `${previous.content}${boundary.content}`,
      done: true,
      boundary: boundary.boundary,
      sequence: boundary.sequence ?? previous.sequence,
      timestamp_ms: boundary.timestamp_ms ?? previous.timestamp_ms,
      status: boundary.status ?? previous.status,
      event_id: previous.event_id,
    };
  }
}
