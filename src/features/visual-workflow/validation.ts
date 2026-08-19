import type { Connection, Edge } from '@xyflow/react';
import type { VisualWorkflowNodeDefinition } from '../../lib/api';
import type { WorkflowCanvasNode } from './types';

export type ClientValidationIssue = {
  code: string;
  message: string;
  nodeId?: string;
  portId?: string;
  edgeId?: string;
};

const portsCompatible = (sourceType: string, targetType: string) => (
  sourceType === targetType || (targetType === 'media.asset' && ['image.asset', 'video.asset'].includes(sourceType))
);

const portFor = (
  nodes: WorkflowCanvasNode[],
  definitions: VisualWorkflowNodeDefinition[],
  nodeId: string | undefined,
  portId: string | null | undefined,
  direction: 'input' | 'output',
) => {
  const node = nodes.find((candidate) => candidate.id === nodeId);
  const definition = definitions.find((candidate) => candidate.kind === node?.data.kind);
  return definition?.[direction === 'input' ? 'inputs' : 'outputs'].find((port) => port.id === portId);
};

export function isValidWorkflowConnection(
  connection: Connection | Edge,
  nodes: WorkflowCanvasNode[],
  edges: Edge[],
  definitions: VisualWorkflowNodeDefinition[],
): boolean {
  if (!connection.source || !connection.target || connection.source === connection.target) return false;
  const sourcePort = portFor(nodes, definitions, connection.source, connection.sourceHandle, 'output');
  const targetPort = portFor(nodes, definitions, connection.target, connection.targetHandle, 'input');
  if (!sourcePort || !targetPort || !portsCompatible(sourcePort.dataType, targetPort.dataType)) return false;
  if (createsCycle({ ...connection, sourceHandle: connection.sourceHandle ?? null, targetHandle: connection.targetHandle ?? null }, edges)) return false;
  return true;
}

function createsCycle(connection: Connection, edges: Edge[]): boolean {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) adjacency.set(edge.source, [...(adjacency.get(edge.source) ?? []), edge.target]);
  adjacency.set(connection.source, [...(adjacency.get(connection.source) ?? []), connection.target]);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visiting.add(nodeId);
    for (const next of adjacency.get(nodeId) ?? []) if (visit(next)) return true;
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  };
  return visit(connection.target);
}

export function validateWorkflowGraph(
  nodes: WorkflowCanvasNode[],
  edges: Edge[],
  definitions: VisualWorkflowNodeDefinition[],
): ClientValidationIssue[] {
  const issues: ClientValidationIssue[] = [];
  const nodeIds = new Set<string>();
  for (const node of nodes) {
    if (nodeIds.has(node.id)) issues.push({ code: 'DUPLICATE_NODE_ID', message: `节点 ID 重复：${node.id}`, nodeId: node.id });
    nodeIds.add(node.id);
    if (!definitions.some((definition) => definition.kind === node.data.kind)) issues.push({ code: 'UNKNOWN_NODE_KIND', message: `未知节点类型：${node.data.kind}`, nodeId: node.id });
  }
  for (const edge of edges) {
    const sourcePort = portFor(nodes, definitions, edge.source, edge.sourceHandle, 'output');
    const targetPort = portFor(nodes, definitions, edge.target, edge.targetHandle, 'input');
    if (!sourcePort) issues.push({ code: 'SOURCE_PORT_NOT_FOUND', message: '连线的输出端口不存在', edgeId: edge.id });
    if (!targetPort) issues.push({ code: 'TARGET_PORT_NOT_FOUND', message: '连线的输入端口不存在', edgeId: edge.id });
    if (sourcePort && targetPort && !portsCompatible(sourcePort.dataType, targetPort.dataType)) issues.push({ code: 'PORT_TYPE_MISMATCH', message: `端口类型不兼容：${sourcePort.dataType} → ${targetPort.dataType}`, edgeId: edge.id });
  }
  return issues;
}
