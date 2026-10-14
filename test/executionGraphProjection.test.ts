import assert from 'node:assert/strict';
import test from 'node:test';

import { projectExecutionGraph } from '../src/Code/executionGraphProjection.ts';
import type {
  CodeObservatoryDecisionView,
  CodeObservatoryEvidenceView,
  CodeObservatoryNodeView,
  CodeObservatoryOperationView,
  CodeObservatorySpanView,
  CodeObservatoryWireEvent,
} from '../src/lib/codeObservatoryApi.ts';

function ref(eventKey: string) {
  return { stream_key: 'run-stream', event_key: eventKey };
}

function node(instanceId: string, eventKey: string): CodeObservatoryNodeView {
  return {
    node_instance_id: instanceId,
    node_definition_id: `${instanceId}-definition`,
    aggregate_kind: 'run',
    aggregate_id: 'run-current',
    operation_id: 'operation-1',
    run_id: 'run-current',
    node_kind: 'agent_activity',
    source_refs: [ref(eventKey)],
    status: { execution: 'succeeded', verification: 'unknown', observation: 'current' },
    versions: {},
    association_status: 'complete',
  };
}

function span(
  spanId: string,
  kind: CodeObservatorySpanView['span_kind'],
  eventKey: string,
  parentSpanId?: string,
): CodeObservatorySpanView {
  return {
    span_id: spanId,
    span_kind: kind,
    aggregate_kind: 'run',
    aggregate_id: 'run-current',
    operation_id: 'operation-1',
    run_id: 'run-current',
    attempt_ref: spanId,
    action_id: kind === 'tool_action' ? spanId : null,
    tool_name: kind === 'tool_action' ? 'write_file' : null,
    parent_span_id: parentSpanId,
    source_refs: [ref(eventKey)],
    receipt_refs: [],
    started_at_ms: eventKey === 'e1' ? 1 : 2,
    lifecycle_status: 'closed',
    execution_status: 'succeeded',
    verification_status: 'unknown',
    association_status: parentSpanId ? 'complete' : 'orphan',
  };
}

function event(
  eventKey: string,
  nodeInstanceId: string,
  extra: Partial<CodeObservatoryWireEvent> = {},
): CodeObservatoryWireEvent {
  return {
    schema_version: 'code-observatory/v1',
    projection_version: 1,
    aggregate_kind: 'run',
    aggregate_id: 'run-current',
    run_id: 'run-current',
    operation_id: 'operation-1',
    event_category: 'execution',
    event_type: 'runtime_action_completed',
    node_instance_id: nodeInstanceId,
    source_ref: ref(eventKey),
    causation_refs: [],
    evidence_refs: [],
    action_id: nodeInstanceId,
    tool_name: 'write_file',
    source_role: 'runtime_committed',
    observation_offset: eventKey === 'e1' ? 1 : 2,
    occurred_at_ms: eventKey === 'e1' ? 1 : 2,
    committed_at_ms: eventKey === 'e1' ? 1 : 2,
    observed_at_ms: eventKey === 'e1' ? 1 : 2,
    status: { execution: 'succeeded', verification: 'unknown', observation: 'current' },
    ...extra,
  };
}

function operationView(overrides: Partial<CodeObservatoryOperationView> = {}): CodeObservatoryOperationView {
  return {
    operation_id: 'operation-1',
    lifecycle: 'running',
    version: 2,
    execution_generation: 1,
    current_run_id: 'run-current',
    recovery_budget: { status: 'available' },
    runs: [
      { run_id: 'run-before', roles: ['execution'], execution_generations: [1], association_status: 'explicit_event', source_refs: [] },
      { run_id: 'run-current', roles: ['recovery'], execution_generations: [2], association_status: 'explicit_event', source_refs: [] },
    ],
    run_links: [
      {
        from_run_id: 'run-before',
        to_run_id: 'run-current',
        relation_kind: 'resume',
        binding_status: 'explicit',
        source_kind: 'runtime_event',
        source_refs: [],
      },
    ],
    recovery_attempts: [
      { attempt_id: 'attempt-1', run_id: 'run-current', action_id: 'action-retry', executor_id: 'exec', lane_id: 'lane', status: 'failed', attempt_number: 1, started_at_ms: 1, side_effect_class: 'idempotent', required_authorization_ids: [], source_refs: [] },
      { attempt_id: 'attempt-2', run_id: 'run-current', action_id: 'action-retry', executor_id: 'exec', lane_id: 'lane', status: 'completed', attempt_number: 2, started_at_ms: 3, side_effect_class: 'idempotent', required_authorization_ids: [], source_refs: [] },
    ],
    repair_authorizations: [],
    verifications: [],
    unknown_actions: [],
    reconciliations: [],
    source_gaps: [],
    ...overrides,
  };
}

const empty = {
  runId: 'run-current',
  nodes: [] as CodeObservatoryNodeView[],
  spans: [] as CodeObservatorySpanView[],
  events: [] as CodeObservatoryWireEvent[],
  decisions: [] as CodeObservatoryDecisionView[],
  evidence: [] as CodeObservatoryEvidenceView[],
};

test('projects stable node instances and explicit parent-call relations', () => {
  const graph = projectExecutionGraph({
    ...empty,
    nodes: [node('turn-1', 'e1'), node('action-1', 'e2')],
    spans: [span('span-turn', 'model_turn', 'e1'), span('span-action', 'tool_action', 'e2', 'span-turn')],
  });

  assert.deepEqual(graph.nodes.map((item) => item.id), ['node:turn-1', 'node:action-1']);
  assert.deepEqual(graph.edges.map(({ kind, source, target }) => ({ kind, source, target })), [
    { kind: 'parent_call', source: 'node:turn-1', target: 'node:action-1' },
  ]);
});

test('uses source causation refs for trigger edges and reports unresolved parents', () => {
  const graph = projectExecutionGraph({
    ...empty,
    nodes: [node('node-parent', 'e1'), node('node-child', 'e2')],
    events: [
      event('e1', 'node-parent'),
      event('e2', 'node-child', { causation_refs: [ref('e1'), ref('missing')] }),
    ],
  });

  assert.equal(graph.edges.some((edge) => edge.kind === 'trigger' && edge.source === 'node:node-parent' && edge.target === 'node:node-child'), true);
  assert.equal(graph.coverage.unresolvedCausationRefs, 1);
});

test('projects a newly streamed event node from its stable node_instance_id', () => {
  const graph = projectExecutionGraph({
    ...empty,
    events: [event('e1', 'streamed-node', {
      event_type: 'runtime_action_started',
      status: { execution: 'running', verification: 'unknown', observation: 'current' },
    })],
  });

  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.nodes[0].id, 'node:streamed-node');
  assert.equal(graph.nodes[0].executionStatus, 'running');
});

test('adds artifact-dependency edges only when the same explicit evidence ref is consumed', () => {
  const evidence: CodeObservatoryEvidenceView[] = [{
    evidence_ref: 'artifact-1', evidence_kind: 'patch_metadata', status: 'available',
    storage_kind: 'runtime_action_journal', source_ref: ref('e1'), source_role: 'runtime_committed',
    artifact_id: 'artifact-1', artifact_version: 'candidate-2', obligation_refs: [],
    preview_available: false, source_gaps: [], versions: {}, retention_status: 'retained',
  }];
  const graph = projectExecutionGraph({
    ...empty,
    nodes: [node('producer', 'e1'), node('consumer', 'e2')],
    events: [
      event('e1', 'producer', { evidence_refs: ['artifact-1'] }),
      event('e2', 'consumer', { evidence_refs: ['artifact-1'] }),
    ],
    evidence,
  });

  assert.equal(graph.edges.some((edge) => edge.kind === 'artifact_dependency' && edge.source === 'artifact:artifact-1' && edge.target === 'node:consumer'), true);
  assert.equal(graph.edges.some((edge) => edge.kind === 'artifact_dependency' && edge.source === 'node:producer' && edge.target === 'artifact:artifact-1'), true);
  assert.equal(graph.edges.some((edge) => edge.kind === 'artifact_dependency' && edge.source === 'artifact:artifact-1' && edge.target === 'node:producer'), false);
});

test('maps only an exact persisted selected route to a decision-route edge', () => {
  const decision: CodeObservatoryDecisionView = {
    decision_ref: 'decision-1', owner: 'runtime', source_ref: ref('e1'), source_role: 'runtime_committed',
    outcome: 'route_selected', versions: {}, evidence_refs: [], selected_route: 'action-2',
    allowed_actions: [], authorization_refs: [], expected_candidate_source_ids: [], candidate_sources: [],
    candidate_actions: [], remaining_executor_ids: [], remaining_agent_action_ids: [], source_gaps: [],
  };
  const graph = projectExecutionGraph({
    ...empty,
    nodes: [node('decision-source', 'e1'), node('action-2', 'e2')],
    spans: [span('span-action-2', 'tool_action', 'e2')],
    events: [event('e1', 'decision-source'), event('e2', 'action-2', { action_id: 'action-2' })],
    decisions: [decision],
  });

  assert.equal(graph.edges.some((edge) => edge.kind === 'decision_route' && edge.source === 'decision:decision-1' && edge.target === 'node:action-2'), true);
});

test('projects explicit resume and consecutive recovery-attempt relations', () => {
  const graph = projectExecutionGraph({
    ...empty,
    operation: operationView(),
  });

  assert.equal(graph.edges.some((edge) => edge.kind === 'resume_from' && edge.source === 'run:run-before' && edge.target === 'run:run-current'), true);
  assert.equal(graph.edges.some((edge) => edge.kind === 'retry_of' && edge.source === 'attempt:attempt-1' && edge.target === 'attempt:attempt-2'), true);
});

test('hides Operation relations when the persisted Run points to a different Operation', () => {
  const graph = projectExecutionGraph({
    ...empty,
    nodes: [node('node-current', 'e1')],
    events: [event('e1', 'node-current')],
    operation: operationView({ operation_id: 'operation-other' }),
  });

  assert.equal(graph.hasOperationRelations, false);
  assert.equal(graph.nodes.some((item) => item.kind === 'run'), false);
});

test('positions are independent of live status changes and chronology alone creates no edge', () => {
  const input = {
    ...empty,
    nodes: [node('a', 'e1'), node('b', 'e2')],
    events: [event('e1', 'a'), event('e2', 'b')],
  };
  const first = projectExecutionGraph(input);
  const updated = projectExecutionGraph({
    ...input,
    nodes: input.nodes.map((item, index) => ({
      ...item,
      status: { ...item.status, execution: index === 1 ? 'failed' : 'running' },
    })),
  });

  assert.deepEqual(updated.nodes.map(({ id, position }) => ({ id, position })), first.nodes.map(({ id, position }) => ({ id, position })));
  assert.deepEqual(first.edges, []);
});

test('collapses node groups into stable summary nodes without drawing internal false edges', () => {
  const input = {
    ...empty,
    nodes: [node('a', 'e1'), node('b', 'e2')],
    events: [event('e1', 'a'), event('e2', 'b', { causation_refs: [ref('e1')] })],
  };
  const graph = projectExecutionGraph({ ...input, collapsedKinds: ['instance'] });

  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.nodes[0].kind, 'group');
  assert.equal(graph.nodes[0].groupKind, 'instance');
  assert.deepEqual(graph.edges, []);
  assert.equal(graph.coverage.collapsedInternalEdges, 1);
});
