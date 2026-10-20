import assert from 'node:assert/strict';
import test from 'node:test';

import { projectOperationUsage } from '../src/Code/operationUsage.ts';
import type { CodeAgentRun, TokenUsage } from '../src/lib/api.ts';
import type { CodeObservatoryOperationRun } from '../src/lib/codeObservatoryApi.ts';

function operationRun(runId: string): CodeObservatoryOperationRun {
  return {
    run_id: runId,
    roles: ['execution'],
    execution_generations: [1],
    association_status: 'explicit_event',
    source_refs: [],
  };
}

function agentRun(
  id: string,
  operationId: string,
  tokenUsage?: TokenUsage,
): CodeAgentRun {
  return {
    id,
    request: 'request',
    projectKind: 'frontend',
    createdAt: '2026-10-16T00:00:00.000Z',
    trace: {
      operationId,
      steps: [],
      output: '',
      phase: 'done',
      isRunning: false,
      ...(tokenUsage ? { tokenUsage } : {}),
    },
  };
}

test('operation usage joins stable run ids, deduplicates links, and exposes missing telemetry', () => {
  const summary = projectOperationUsage(
    'operation-1',
    [
      operationRun('run-1'),
      operationRun('run-2'),
      operationRun('run-3'),
      operationRun('run-1'),
    ],
    [
      agentRun('run-1', 'operation-1', {
        prompt_tokens: 4,
        completion_tokens: 6,
        total_tokens: 10,
        cached_tokens: 2,
        reasoning_tokens: 3,
        calls: 1,
        model: 'model-a',
      }),
      agentRun('run-2', 'operation-1', {
        prompt_tokens: 5,
        completion_tokens: 7,
        total_tokens: 12,
        cached_tokens: 1,
        reasoning_tokens: 2,
        calls: 2,
        model: 'model-b',
      }),
      agentRun('run-3', 'operation-1'),
      agentRun('unrelated-run', 'operation-2', {
        prompt_tokens: 500,
        completion_tokens: 500,
        total_tokens: 1_000,
        calls: 50,
      }),
    ],
  );

  assert.equal(summary.operationId, 'operation-1');
  assert.equal(summary.associatedRunCount, 3);
  assert.equal(summary.recordedRunCount, 2);
  assert.equal(summary.coverage, 'partial');
  assert.equal(summary.promptTokens, 9);
  assert.equal(summary.completionTokens, 13);
  assert.equal(summary.totalTokens, 22);
  assert.equal(summary.cachedTokens, 3);
  assert.equal(summary.reasoningTokens, 5);
  assert.equal(summary.providerCalls, 3);
  assert.deepEqual(summary.models, ['model-a', 'model-b']);
});

test('operation usage reports unavailable instead of zero when no linked run has provider telemetry', () => {
  const summary = projectOperationUsage(
    'operation-1',
    [operationRun('run-1')],
    [agentRun('run-1', 'operation-1')],
  );

  assert.equal(summary.coverage, 'unavailable');
  assert.equal(summary.associatedRunCount, 1);
  assert.equal(summary.recordedRunCount, 0);
  assert.equal(summary.totalTokens, null);
  assert.equal(summary.providerCalls, null);
});
