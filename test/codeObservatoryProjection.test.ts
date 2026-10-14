import assert from 'node:assert/strict';
import test from 'node:test';

import { projectCodeObservatoryEvents, projectCodeObservatoryFeedEvents } from '../src/Code/codeObservatoryProjection.ts';
import type { CodeGenerationEvent } from '../src/lib/api.ts';
import type { CodeObservatoryWireEvent } from '../src/lib/codeObservatoryApi.ts';

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

test('projects backend observation offsets and keeps verification outcomes distinct', () => {
  const backendEvent = (
    observationOffset: number,
    overrides: Partial<CodeObservatoryWireEvent> = {},
  ): CodeObservatoryWireEvent => ({
    schema_version: 'code-observatory/v1',
    projection_version: 1,
    aggregate_kind: 'run',
    aggregate_id: 'run-observe',
    run_id: 'run-observe',
    event_category: 'verification',
    event_type: 'runtime_verification_result_committed',
    source_role: 'runtime_committed',
    observation_offset: observationOffset,
    committed_at_ms: observationOffset * 1_000,
    observed_at_ms: observationOffset * 1_000 + 10,
    status: { execution: 'unknown', verification: 'inconclusive', observation: 'current' },
    ...overrides,
  });

  const projected = projectCodeObservatoryFeedEvents('run-observe', [
    backendEvent(2),
    backendEvent(1, { status: { execution: 'succeeded', verification: 'verified', observation: 'current' } }),
    backendEvent(2),
    backendEvent(3, { aggregate_id: 'another-run', run_id: 'another-run' }),
  ]);

  assert.deepEqual(projected.map((item) => item.sequence), [1, 2]);
  assert.equal(projected[0]?.status, 'verified');
  assert.equal(projected[1]?.status, 'inconclusive');
  assert.equal(projected[0]?.label, '验证记录 · 验证结果提交');
  assert.equal(projected[0]?.sourceRole, 'runtime_committed');
  assert.equal(projected[0]?.category, 'verification');
  assert.ok(projected.every((item) => !JSON.stringify(item).includes('source_role')));
});
