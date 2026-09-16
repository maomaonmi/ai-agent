import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CodeAgentActivityDeltaBuffer,
  CodeAgentEventBuffer,
} from '../src/Code/codeEventStream.ts';

const event = (overrides: Record<string, unknown> = {}) => ({
  type: 'agent_activity' as const,
  channel: 'status' as const,
  phase: 'analyzing' as const,
  content: 'event',
  done: false,
  run_id: 'agent-run-1',
  event_id: 'agent-run-1:sse:1',
  sequence: 1,
  timestamp_ms: 100,
  ...overrides,
});

test('deduplicates replayed SSE events by event_id', () => {
  const buffer = new CodeAgentEventBuffer('agent-run-1');

  assert.equal(buffer.accept(event()).length, 1);
  assert.equal(buffer.accept(event({ content: 'replayed' })).length, 0);
});

test('rejects events from a different Agent run', () => {
  const buffer = new CodeAgentEventBuffer('agent-run-1');

  assert.equal(buffer.accept(event({ run_id: 'agent-run-2' })).length, 0);
});

test('ignores older sequence numbers after a reconnect replay', () => {
  const buffer = new CodeAgentEventBuffer('agent-run-1');

  assert.equal(buffer.accept(event({ sequence: 3, event_id: 'agent-run-1:sse:3' })).length, 1);
  assert.equal(buffer.accept(event({ sequence: 2, event_id: 'agent-run-1:sse:2' })).length, 0);
});

test('coalesces delta activity from one model turn into one logical event', () => {
  const buffer = new CodeAgentActivityDeltaBuffer('agent-run-1');

  const first = buffer.accept(event({
    content: '不影响',
    content_mode: 'delta',
    turn_id: 'turn-1',
    event_id: 'turn-1:1',
    sequence: 1,
  }));
  const second = buffer.accept(event({
    content: '你',
    content_mode: 'delta',
    turn_id: 'turn-1',
    event_id: 'turn-1:2',
    sequence: 2,
  }));

  assert.equal(first.length, 1);
  assert.equal(second.length, 1);
  assert.equal(first[0].content, '不影响');
  assert.equal(second[0].content, '不影响你');
  assert.equal(second[0].event_id, 'turn-1:1');
  assert.equal(second[0].done, false);
});

test('turn boundary closes the aggregate without creating an empty timeline event', () => {
  const buffer = new CodeAgentActivityDeltaBuffer('agent-run-1');

  buffer.accept(event({
    content: '完整回答',
    content_mode: 'delta',
    turn_id: 'turn-1',
    event_id: 'turn-1:1',
    sequence: 1,
  }));
  const closed = buffer.accept(event({
    content: '',
    phase: 'done',
    turn_id: 'turn-1',
    boundary: 'turn_completed',
    done: true,
    event_id: 'turn-1:2',
    sequence: 2,
  }));

  assert.equal(closed.length, 1);
  assert.equal(closed[0].content, '完整回答');
  assert.equal(closed[0].event_id, 'turn-1:1');
  assert.equal(closed[0].done, true);
  assert.equal(closed[0].boundary, 'turn_completed');
  assert.equal(buffer.flush().length, 0);
});
