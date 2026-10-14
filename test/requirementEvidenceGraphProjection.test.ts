import assert from 'node:assert/strict';
import test from 'node:test';

import {
  projectRequirementEvidenceGraph,
} from '../src/Code/requirementEvidenceGraphProjection.ts';

const graphNode = (node_id: string, kind: 'obligation' | 'clause' | 'proof_requirement' | 'check' | 'evidence' | 'verdict' | 'delivery', entity_id: string) => ({
  node_id,
  kind,
  entity_id,
  status: 'ready',
  current: true,
});

test('requirement graph keeps stable lanes and renders only explicit relations', () => {
  const nodes = [
    graphNode('check:1', 'check', 'check-1'),
    graphNode('obligation:1', 'obligation', 'obl-1'),
    graphNode('proof:1', 'proof_requirement', 'proof-1'),
    graphNode('clause:1', 'clause', 'clause-1'),
  ];
  const edges = [
    { edge_id: 'edge:proof-check', from_node: 'proof:1', to_node: 'check:1', kind: 'proof_requirement_check', source_kind: 'runtime_plan' },
    { edge_id: 'edge:obl-clause', from_node: 'obligation:1', to_node: 'clause:1', kind: 'obligation_clause', source_kind: 'acceptance_projection' },
  ] as const;

  const graph = projectRequirementEvidenceGraph(nodes, [...edges]);

  assert.deepEqual(graph.nodes.map((node) => node.id), ['obligation:1', 'clause:1', 'proof:1', 'check:1']);
  assert.deepEqual(graph.nodes.map((node) => node.position.x), [0, 296, 592, 888]);
  assert.deepEqual(graph.edges.map((edge) => edge.id), ['edge:obl-clause', 'edge:proof-check']);
  assert.equal(graph.omittedNodeCount, 0);
  assert.equal(graph.omittedEdgeCount, 0);
});

test('graph projection reports clipping and drops edges with invisible endpoints', () => {
  const nodes = [
    graphNode('obl:1', 'obligation', 'obl-1'),
    graphNode('clause:1', 'clause', 'clause-1'),
    graphNode('proof:1', 'proof_requirement', 'proof-1'),
  ];
  const edges = [
    { edge_id: 'edge:1', from_node: 'obl:1', to_node: 'clause:1', kind: 'obligation_clause', source_kind: 'acceptance_projection' },
    { edge_id: 'edge:2', from_node: 'clause:1', to_node: 'proof:1', kind: 'clause_proof_requirement', source_kind: 'runtime_plan' },
  ] as const;

  const graph = projectRequirementEvidenceGraph(nodes, [...edges], 2);

  assert.equal(graph.nodes.length, 2);
  assert.equal(graph.edges.length, 1);
  assert.equal(graph.omittedNodeCount, 1);
  assert.equal(graph.omittedEdgeCount, 1);
});
