import type { CodeAgentTimelineEvent } from '../lib/api';

/**
 * Insert synthetic browser-verifier events at the verifier's start boundary.
 *
 * Acceptance reports arrive as one result, but the report describes work that
 * happened between the start boundary and the later system/commit events.
 * Reusing `max(base.sequence) + 1` would therefore force the whole report to
 * the bottom on every render.
 */
export function placeAcceptanceTimelineEvents(
  acceptanceEvents: CodeAgentTimelineEvent[],
  baseEvents: CodeAgentTimelineEvent[],
  startAnchorSequence?: number,
): CodeAgentTimelineEvent[] {
  if (
    acceptanceEvents.length === 0
    || startAnchorSequence == null
    || !Number.isFinite(startAnchorSequence)
  ) return acceptanceEvents;

  const nextBaseSequence = baseEvents
    .map((event) => event.sequence)
    .filter((sequence) => sequence > startAnchorSequence)
    .sort((left, right) => left - right)[0]
    ?? startAnchorSequence + 1;
  const step = Math.max(
    Number.EPSILON,
    (nextBaseSequence - startAnchorSequence) / (acceptanceEvents.length + 1),
  );

  return acceptanceEvents.map((event, index) => {
    const sequence = startAnchorSequence + step * (index + 1);
    return {
      ...event,
      eventId: `${event.actorId}:acceptance:${index + 1}`,
      sequence,
    };
  });
}
