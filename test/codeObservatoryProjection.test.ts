import assert from 'node:assert/strict';
import test from 'node:test';

import { projectCodeObservatoryEvents } from '../src/Code/codeObservatoryProjection.ts';
import type { CodeGenerationEvent } from '../src/lib/api.ts';

function event(sequence: number, overrides: Record<string, unknown> = {}): CodeGenerationEvent {
  return {
    type: 'agent_activity',
    channel: 'status',
    phase: 'analyzing',
    content: 'private prompt or reasoning must never enter the observability projection',
    done: false,
    run_id: 'run-observe',
    event_id: `run-observe:${sequence}`,
    sequence,
    timestamp_ms: sequence * 1000,
    ...overrides,
  } as CodeGenerationEvent;
}

test('projects durable run events into ordered, safe metadata only', () => {
  const projected = projectCodeObservatoryEvents('run-observe', [
    event(3, { phase: 'tool_calling', content: 'secret terminal command', metadata: { token: 'secret' } }),
    event(1),
    event(2, { type: 'test_agent_result', phase: 'module_verify', status: 'passed' }),
    event(2, { event_id: 'duplicate-sequence' }),
    event(4, { run_id: 'another-run', content: 'cross-run content' }),
  ]);

  assert.deepEqual(projected.map((item) => item.sequence), [1, 2, 3]);
  assert.deepEqual(projected.map((item) => item.label), ['分析', '模块验证', '调用工具']);
  assert.equal(projected[1]?.status, 'passed');
  assert.ok(projected.every((item) => !JSON.stringify(item).includes('secret')));
  assert.ok(projected.every((item) => !JSON.stringify(item).includes('private prompt')));
});

test('bounds the projection to the latest events while preserving backend sequence order', () => {
  const events = Array.from({ length: 40 }, (_, index) => event(index + 1));
  const projected = projectCodeObservatoryEvents('run-observe', events);

  assert.equal(projected.length, 24);
  assert.equal(projected[0]?.sequence, 17);
  assert.equal(projected.at(-1)?.sequence, 40);
});

test('does not manufacture timestamps or sequences for incomplete events', () => {
  const projected = projectCodeObservatoryEvents('run-observe', [
    event(1, { timestamp_ms: undefined }),
    event(2, { sequence: undefined }),
    event(3),
  ]);

  assert.deepEqual(projected.map((item) => item.sequence), [3]);
});

test('uses generic labels for unknown prototype property names and marks explicit errors as failed', () => {
  const projected = projectCodeObservatoryEvents('run-observe', [
    event(1, { phase: '__proto__', type: 'constructor' }),
    event(2, { type: 'error', phase: undefined }),
  ]);

  assert.deepEqual(projected.map((item) => item.label), ['流程事件', '错误']);
  assert.equal(projected[1]?.status, 'failed');
});
