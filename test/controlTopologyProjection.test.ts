import assert from 'node:assert/strict';
import test from 'node:test';

import {
  controlTopologyEdgeId,
  projectControlTopology,
} from '../src/Code/controlTopologyProjection.ts';
import type { CodeControlTopology } from '../src/lib/codeObservatoryApi.ts';

const topology: CodeControlTopology = {
  schema_version: 'code-observatory/v1',
  topology_schema_version: 1,
  topology_version: 'sha256:current',
  rule_version: null,
  rule_version_status: 'not_recorded',
  reference_status: 'current_reference',
  states: [
    { state_id: 'accepted', terminal: false },
    { state_id: 'patch_only', terminal: false },
    { state_id: 'final_committed', terminal: true },
  ],
  transitions: [
    {
      transition_id: 'accepted:diagnosis_opened',
      from_state: 'accepted',
      event: 'diagnosis_opened',
      to_state: 'patch_only',
      guard_id: null,
      action: 'NOOP',
      owner: 'runtime',
      rule_id: 'T01',
    },
    {
      transition_id: 'accepted:commit_phase_ok',
      from_state: 'accepted',
      event: 'commit_phase_ok',
      to_state: 'patch_only',
      guard_id: 'guard_patch',
      action: 'NOOP',
      owner: 'runtime',
      rule_id: 'T02',
    },
    {
      transition_id: 'patch_only:complete',
      from_state: 'patch_only',
      event: 'completion_requested',
      to_state: 'final_committed',
      guard_id: null,
      action: 'NOOP',
      owner: 'runtime',
      rule_id: 'T03',
    },
  ],
  dynamic_regions: [],
  runtime_routes: [],
};

test('control topology projection groups parallel rules without dropping their facts', () => {
  const graph = projectControlTopology(topology);
  const parallel = graph.edges.find((edge) => edge.id === controlTopologyEdgeId('accepted', 'patch_only'));

  assert.equal(graph.nodes.length, 3);
  assert.equal(graph.edges.length, 2);
  assert.equal(parallel?.label, '2 条规则');
  assert.deepEqual(parallel?.data?.transitions.map((item) => item.event), [
    'diagnosis_opened',
    'commit_phase_ok',
  ]);
  assert.equal(graph.nodes.find((node) => node.id === 'state:final_committed')?.data.terminal, true);
});

test('selecting a topology state or edge only decorates the matching graph item', () => {
  const edgeId = controlTopologyEdgeId('accepted', 'patch_only');
  const stateGraph = projectControlTopology(topology, { kind: 'state', id: 'patch_only' });
  const edgeGraph = projectControlTopology(topology, { kind: 'transition_group', id: edgeId });

  assert.equal(stateGraph.nodes.find((node) => node.id === 'state:patch_only')?.selected, true);
  assert.equal(stateGraph.nodes.find((node) => node.id === 'state:accepted')?.selected, false);
  assert.equal(edgeGraph.edges.find((edge) => edge.id === edgeId)?.selected, true);
  assert.equal(edgeGraph.edges.find((edge) => edge.id === controlTopologyEdgeId('patch_only', 'final_committed'))?.selected, false);
});
