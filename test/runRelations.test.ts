import assert from 'node:assert/strict';
import test from 'node:test';

import { projectCodeObservatoryRunRelations } from '../src/Code/runRelations.ts';
import type { CodeObservatoryOperationSnapshot } from '../src/lib/codeObservatoryApi.ts';

function snapshot(): CodeObservatoryOperationSnapshot {
  const sourceRef = {
    stream_key: 'code_operation_control:operation-1',
    event_key: 'claim-2',
    stream_sequence: 3,
  };
  const operation = {
    operation_id: 'operation-1',
    lifecycle: 'executing',
    version: 5,
    execution_generation: 2,
    current_run_id: 'run-new',
    recovery_budget: { takeovers_used: 1, takeovers_limit: 3, status: 'available' as const },
    runs: [
      {
        run_id: 'run-old',
        roles: ['execution'] as Array<'execution'>,
        execution_generations: [1],
        association_status: 'explicit_event' as const,
        source_refs: [sourceRef],
      },
      {
        run_id: 'run-new',
        roles: ['execution', 'current'] as Array<'execution' | 'current'>,
        execution_generations: [2],
        association_status: 'explicit_event' as const,
        source_refs: [sourceRef],
      },
    ],
    run_links: [{
      from_run_id: 'run-old',
      to_run_id: 'run-new',
      relation_kind: 'execution_takeover' as const,
      binding_status: 'explicit' as const,
      source_kind: 'runtime_event' as const,
      source_refs: [sourceRef],
    }],
    recovery_attempts: [],
    repair_authorizations: [],
    verifications: [],
    unknown_actions: [],
    reconciliations: [],
    source_gaps: [],
  };
  return {
    schema_version: 'code-observatory/v1',
    projection_version: 1,
    operation_id: 'operation-1',
    operation,
    feed: {
      schema_version: 'code-observatory/v1',
      aggregate_kind: 'operation',
      aggregate_id: 'operation-1',
      status: { execution: 'running', verification: 'unknown', observation: 'current' },
      cursor: {
        aggregate_kind: 'operation',
        aggregate_id: 'operation-1',
        projection_version: 1,
        observation_offset: 3,
        retention_floor_offset: 0,
      },
      events: [],
      source_watermarks: [],
      has_more: false,
    },
  };
}

test('preserves prior Runs and only shows the durable takeover edge', () => {
  const relations = projectCodeObservatoryRunRelations(snapshot(), 'operation-1', 'run-new');

  assert.ok(relations);
  assert.deepEqual(relations.operation.runs.map((run) => run.run_id), ['run-old', 'run-new']);
  assert.equal(relations.focusedRunFound, true);
  assert.equal(relations.operation.run_links[0]?.relation_kind, 'execution_takeover');
});

test('does not infer an absent Run from the currently displayed Run ID', () => {
  const relations = projectCodeObservatoryRunRelations(snapshot(), 'operation-1', 'unlinked-run');

  assert.ok(relations);
  assert.equal(relations.focusedRunFound, false);
  assert.deepEqual(relations.operation.runs.map((run) => run.run_id), ['run-old', 'run-new']);
});

test('rejects a response whose Operation or feed identity differs', () => {
  const response = snapshot();
  response.feed.aggregate_id = 'another-operation';

  assert.equal(
    projectCodeObservatoryRunRelations(response, 'operation-1', 'run-new'),
    null,
  );
});
