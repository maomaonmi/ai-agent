import assert from 'node:assert/strict';
import test from 'node:test';

import { placeAcceptanceTimelineEvents } from '../src/Code/acceptanceTimeline.ts';
import type { CodeAgentTimelineEvent } from '../src/lib/api.ts';

function event(sequence: number, eventId: string): CodeAgentTimelineEvent {
  return {
    eventId,
    runId: 'agent-run-1',
    actorId: 'main:agent-run-1',
    actorKind: 'main',
    stage: 'status',
    content: eventId,
    done: true,
    timestampMs: sequence,
    sequence,
  };
}

test('places browser verification events at their start anchor before later system events', () => {
  const baseEvents = [event(1, 'model-done'), event(2, 'verification-start'), event(3, 'runtime-commit')];
  const acceptanceEvents = [event(4, 'browser-start'), event(5, 'browser-result')];

  const placed = placeAcceptanceTimelineEvents(acceptanceEvents, baseEvents, 2.25);

  assert.equal(placed.length, 2);
  assert.ok(placed[0]!.sequence > 2.25);
  assert.ok(placed[1]!.sequence < 3);
  assert.ok(placed[0]!.sequence < placed[1]!.sequence);
  assert.match(placed[0]!.eventId, /acceptance:1$/);
  assert.match(placed[1]!.eventId, /acceptance:2$/);
});
