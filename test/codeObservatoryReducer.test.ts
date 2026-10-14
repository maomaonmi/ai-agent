import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCodeObservatoryState,
  reduceCodeObservatoryState,
} from '../src/Code/codeObservatoryReducer.ts';
import type {
  CodeObservatoryDecisionView,
  CodeObservatoryEvidenceView,
  CodeObservatoryEventPage,
  CodeObservatoryNodeView,
  CodeObservatorySnapshot,
  CodeObservatorySpanView,
  CodeObservatoryWireEvent,
} from '../src/lib/codeObservatoryApi.ts';

const RUN_ID = 'run-reducer';

function event(
  observationOffset: number,
  overrides: Partial<CodeObservatoryWireEvent> = {},
): CodeObservatoryWireEvent {
  return {
    schema_version: 'code-observatory/v1',
    projection_version: 1,
    aggregate_kind: 'run',
    aggregate_id: RUN_ID,
    run_id: RUN_ID,
    event_category: 'execution',
    event_type: 'future_event_kind',
    source_role: 'runtime_committed',
    observation_offset: observationOffset,
    occurred_at_ms: 1_000 + observationOffset,
    committed_at_ms: 1_000 + observationOffset,
    observed_at_ms: 1_000 + observationOffset,
    status: { execution: 'running', verification: 'unknown', observation: 'current' },
    ...overrides,
  };
}

function snapshot(headOffset: number): CodeObservatorySnapshot {
  const events = Array.from({ length: headOffset }, (_, index) => event(index + 1));
  return {
    schema_version: 'code-observatory/v1',
    projection_version: 1,
    head_offset: headOffset,
    retention_floor_offset: 0,
    cursor: `cursor:${headOffset}:0`,
    feed: {
      schema_version: 'code-observatory/v1',
      aggregate_kind: 'run',
      aggregate_id: RUN_ID,
      status: { execution: 'running', verification: 'verified', observation: 'current' },
      cursor: {
        aggregate_kind: 'run',
        aggregate_id: RUN_ID,
        projection_version: 1,
        observation_offset: headOffset,
        retention_floor_offset: 0,
      },
      events,
      source_watermarks: [],
      has_more: false,
    },
  };
}

function page(
  events: CodeObservatoryWireEvent[],
  requestedAfterOffset: number,
): CodeObservatoryEventPage {
  return {
    schema_version: 'code-observatory/v1',
    projection_version: 1,
    aggregate_kind: 'run',
    aggregate_id: RUN_ID,
    head_offset: events.at(-1)?.observation_offset ?? requestedAfterOffset,
    retention_floor_offset: 0,
    events,
    source_watermarks: [],
    next_cursor: `cursor:${events.at(-1)?.observation_offset ?? requestedAfterOffset}:0`,
    has_more: false,
  };
}

function loadedState(headOffset: number) {
  return reduceCodeObservatoryState(
    createCodeObservatoryState(RUN_ID),
    { type: 'snapshot_received', snapshot: snapshot(headOffset) },
  );
}

test('observation reducer applies contiguous events once and ignores replayed offsets', () => {
  const initial = loadedState(2);
  const next = reduceCodeObservatoryState(initial, {
    type: 'observation_received',
    event: event(3),
    cursor: 'cursor:3:0',
  });
  const replayed = reduceCodeObservatoryState(next, {
    type: 'observation_received',
    event: event(3),
    cursor: 'older-cursor',
  });

  assert.equal(next.observationOffset, 3);
  assert.equal(next.cursor, 'cursor:3:0');
  assert.equal(next.events.length, 3);
  assert.strictEqual(replayed, next);
  assert.equal(next.events[2].event_type, 'future_event_kind');
});

test('snapshot preserves backend decision views and accepts older snapshots without them', () => {
  const decision: CodeObservatoryDecisionView = {
    decision_ref: 'decision-1',
    owner: 'control_plane',
    source_ref: { stream_key: 'control-plane:run-reducer', event_key: 'transition-1' },
    source_role: 'runtime_committed',
    outcome: 'accepted',
    reason_code: null,
    versions: { verification_epoch: 2 },
    evidence_refs: [],
    selected_route: 'SUBMIT_PATCH_COMPLETE',
    allowed_actions: [],
    authorization_refs: [],
    expected_candidate_source_ids: [],
    candidate_sources: [],
    candidate_actions: [],
    remaining_executor_ids: [],
    remaining_agent_action_ids: [],
    source_gaps: ['rule_version_not_recorded'],
  };
  const withDecision = snapshot(1);
  withDecision.feed.decisions = [decision];

  assert.deepEqual(loadedState(1).decisions, []);
  assert.deepEqual(loadedState(1).decisions, []);
  assert.deepEqual(
    reduceCodeObservatoryState(createCodeObservatoryState(RUN_ID), {
      type: 'snapshot_received',
      snapshot: withDecision,
    }).decisions,
    [decision],
  );
});

test('snapshot preserves backend node-instance and span views for graph projection', () => {
  const nodeView: CodeObservatoryNodeView = {
    node_instance_id: 'node-1',
    node_definition_id: 'tool-action',
    aggregate_kind: 'run',
    aggregate_id: RUN_ID,
    run_id: RUN_ID,
    node_kind: 'runtime_action_completed',
    source_refs: [{ stream_key: 'run-stream', event_key: 'event-1' }],
    status: { execution: 'succeeded', verification: 'unknown', observation: 'current' },
    versions: {},
    association_status: 'unknown',
  };
  const spanView: CodeObservatorySpanView = {
    span_id: 'span-1',
    span_kind: 'tool_action',
    aggregate_kind: 'run',
    aggregate_id: RUN_ID,
    run_id: RUN_ID,
    action_id: 'action-1',
    source_refs: [{ stream_key: 'run-stream', event_key: 'event-1' }],
    receipt_refs: [],
    lifecycle_status: 'closed',
    execution_status: 'succeeded',
    verification_status: 'unknown',
    association_status: 'orphan',
  };
  const value = snapshot(1);
  value.feed.nodes = [nodeView];
  value.feed.spans = [spanView];

  const state = reduceCodeObservatoryState(createCodeObservatoryState(RUN_ID), {
    type: 'snapshot_received',
    snapshot: value,
  });

  assert.deepEqual(state.nodes, [nodeView]);
  assert.deepEqual(state.spans, [spanView]);
});

test('snapshot preserves evidence views and old snapshots default to no evidence', () => {
  const evidence: CodeObservatoryEvidenceView = {
    evidence_ref: 'ev-read-1',
    evidence_kind: 'source_read',
    status: 'available',
    storage_kind: 'runtime_action_journal',
    source_ref: { stream_key: 'code_operation_action:op-1', event_key: 'action-read-1' },
    source_role: 'runtime_committed',
    artifact_version: 'sha256:file-revision',
    producer: 'read_file',
    relative_path: 'src/example.py',
    media_type: 'text/plain',
    obligation_refs: [],
    preview_kind: 'runtime_read_result',
    preview_available: true,
    source_gaps: [],
    versions: { candidate_revision: 'sha256:candidate-1' },
    retention_status: 'retained',
  };
  const withEvidence = snapshot(1);
  withEvidence.feed.evidence = [evidence];

  assert.deepEqual(loadedState(1).evidence, []);
  assert.deepEqual(
    reduceCodeObservatoryState(createCodeObservatoryState(RUN_ID), {
      type: 'snapshot_received',
      snapshot: withEvidence,
    }).evidence,
    [evidence],
  );
});

test('out-of-order events mark a gap and later contiguous arrivals close it', () => {
  const initial = loadedState(1);
  const gap = reduceCodeObservatoryState(initial, {
    type: 'observation_received',
    event: event(3),
    cursor: 'cursor:3:0',
  });
  const filledPart = reduceCodeObservatoryState(gap, {
    type: 'observation_received',
    event: event(2),
    cursor: 'cursor:2:0',
  });
  const recovered = reduceCodeObservatoryState(filledPart, {
    type: 'observation_received',
    event: event(3),
    cursor: 'cursor:3:0',
  });

  assert.equal(gap.observationOffset, 1);
  assert.equal(gap.gapTargetOffset, 3);
  assert.equal(gap.connection, 'catching_up');
  assert.equal(filledPart.observationOffset, 2);
  assert.equal(filledPart.gapTargetOffset, 3);
  assert.equal(recovered.observationOffset, 3);
  assert.equal(recovered.gapTargetOffset, null);
  assert.deepEqual(recovered.events.map((item) => item.observation_offset), [1, 2, 3]);
});

test('catch-up page fills a gap and advances the opaque cursor atomically', () => {
  const gap = reduceCodeObservatoryState(loadedState(1), {
    type: 'observation_received',
    event: event(3),
    cursor: 'cursor:3:0',
  });
  const recovered = reduceCodeObservatoryState(gap, {
    type: 'catchup_page_received',
    page: page([event(2), event(3)], 1),
    requestedAfterOffset: 1,
  });

  assert.equal(recovered.observationOffset, 3);
  assert.equal(recovered.cursor, 'cursor:3:0');
  assert.equal(recovered.gapTargetOffset, null);
  assert.equal(recovered.connection, 'live');
});

test('unknown schema and invalid page gaps fail closed without changing business status', () => {
  const initial = loadedState(1);
  const unsupported = reduceCodeObservatoryState(initial, {
    type: 'observation_received',
    event: event(2, { schema_version: 'code-observatory/v2' as 'code-observatory/v1' }),
    cursor: 'cursor:2:0',
  });
  const malformedPage = reduceCodeObservatoryState(initial, {
    type: 'catchup_page_received',
    page: page([event(2), event(4)], 1),
    requestedAfterOffset: 1,
  });

  assert.equal(unsupported.connection, 'error');
  assert.equal(unsupported.connectionError, 'SCHEMA_UNSUPPORTED');
  assert.equal(unsupported.observationOffset, 1);
  assert.deepEqual(unsupported.status, initial.status);
  assert.equal(malformedPage.connection, 'error');
  assert.equal(malformedPage.connectionError, 'PROJECTION_INCOMPLETE');
  assert.equal(malformedPage.observationOffset, 1);
});

test('connection state does not replace persisted execution or verification axes', () => {
  const initial = loadedState(1);
  const reconnecting = reduceCodeObservatoryState(initial, {
    type: 'connection_changed',
    connection: 'reconnecting',
  });

  assert.equal(reconnecting.connection, 'reconnecting');
  assert.deepEqual(reconnecting.status, {
    execution: 'running',
    verification: 'verified',
    observation: 'current',
  });
});

test('heartbeat does not advance the cursor or business status across an unfilled gap', () => {
  const initial = loadedState(1);
  const heartbeat = reduceCodeObservatoryState(initial, {
    type: 'heartbeat_received',
    heartbeat: {
      cursor: 'cursor:3:0',
      head_offset: 3,
      retention_floor_offset: 0,
      status: { execution: 'failed', verification: 'inconclusive', observation: 'current' },
      source_watermarks: [],
    },
  });

  assert.equal(heartbeat.observationOffset, 1);
  assert.equal(heartbeat.cursor, 'cursor:1:0');
  assert.equal(heartbeat.connection, 'catching_up');
  assert.equal(heartbeat.gapTargetOffset, 3);
  assert.deepEqual(heartbeat.status, initial.status);
});
