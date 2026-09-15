import assert from 'node:assert/strict';
import test from 'node:test';

import { CodeAgentEventBuffer } from '../src/Code/codeEventStream.ts';

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
