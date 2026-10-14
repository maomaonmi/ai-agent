import type { Edge, Node } from '@xyflow/react';

import type {
  CodeRequirementGraphEdge,
  CodeRequirementGraphNode,
} from '../lib/codeObservatoryApi';

export type RequirementGraphFlowNode = Node<{
  fact: CodeRequirementGraphNode;
}, 'requirementEvidenceNode'>;

export interface RequirementGraphFlowEdge extends Edge {
  data: {
    relation: CodeRequirementGraphEdge['kind'];
    current?: boolean | null;
  };
}

export interface RequirementGraphProjection {
  nodes: RequirementGraphFlowNode[];
  edges: RequirementGraphFlowEdge[];
  omittedNodeCount: number;
  omittedEdgeCount: number;
}

const NODE_LIMIT = 500;
const X_GAP = 296;
const Y_GAP = 132;
const KIND_ORDER: CodeRequirementGraphNode['kind'][] = [
  'obligation',
  'clause',
  'proof_requirement',
  'check',
  'evidence',
  'verdict',
  'delivery',
];

/** Deterministic lane layout; edges are copied only from explicit backend IDs. */
export function projectRequirementEvidenceGraph(
  sourceNodes: CodeRequirementGraphNode[],
  sourceEdges: CodeRequirementGraphEdge[],
  nodeLimit = NODE_LIMIT,
): RequirementGraphProjection {
  const sorted = [...sourceNodes].sort((left, right) => (
    KIND_ORDER.indexOf(left.kind) - KIND_ORDER.indexOf(right.kind)
    || left.entity_id.localeCompare(right.entity_id)
    || left.node_id.localeCompare(right.node_id)
  ));
  const visibleFacts = sorted.slice(0, Math.max(1, nodeLimit));
  const visibleIds = new Set(visibleFacts.map((node) => node.node_id));
  const laneCounts = new Map<CodeRequirementGraphNode['kind'], number>();
  const nodes = visibleFacts.map((fact): RequirementGraphFlowNode => {
    const lane = KIND_ORDER.indexOf(fact.kind);
    const row = laneCounts.get(fact.kind) ?? 0;
    laneCounts.set(fact.kind, row + 1);
    return {
      id: fact.node_id,
      type: 'requirementEvidenceNode',
      position: { x: lane * X_GAP, y: row * Y_GAP },
      data: { fact },
      draggable: false,
      selectable: true,
    };
  });
  const eligibleEdges = sourceEdges
    .filter((edge) => visibleIds.has(edge.from_node) && visibleIds.has(edge.to_node))
    .sort((left, right) => left.edge_id.localeCompare(right.edge_id));
  const edges: RequirementGraphFlowEdge[] = eligibleEdges.map((edge) => ({
    id: edge.edge_id,
    source: edge.from_node,
    target: edge.to_node,
    type: 'smoothstep',
    animated: false,
    label: edge.kind,
    data: { relation: edge.kind, current: edge.current },
  }));
  return {
    nodes,
    edges,
    omittedNodeCount: Math.max(0, sourceNodes.length - nodes.length),
    omittedEdgeCount: Math.max(0, sourceEdges.length - edges.length),
  };
}

export const REQUIREMENT_GRAPH_KIND_ORDER = KIND_ORDER;
