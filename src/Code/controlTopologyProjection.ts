import type { Edge, Node } from '@xyflow/react';

import type {
  CodeControlTopology,
  CodeControlTopologyTransition,
} from '../lib/codeObservatoryApi';

export const CONTROL_STATE_LABELS: Record<string, string> = {
  accepted: '已接收',
  contract_planning: '契约规划中',
  contract_free: '自由契约',
  contract_required: '需要契约',
  contract_pending: '等待契约来源',
  diagnosing: '诊断中',
  patch_only: '仅修改',
  verify: '待验证',
  verifying: '验证中',
  controller_pause: '控制器暂停',
  final_committed: '已验证完成',
  final_unverified: '未验证终态',
};

const STATE_LAYOUT: Record<string, { x: number; y: number }> = {
  accepted: { x: 0, y: 300 },
  contract_pending: { x: 0, y: 10 },
  contract_planning: { x: 260, y: 10 },
  contract_required: { x: 520, y: 10 },
  contract_free: { x: 260, y: 145 },
  diagnosing: { x: 260, y: 300 },
  patch_only: { x: 520, y: 300 },
  verify: { x: 780, y: 300 },
  verifying: { x: 1_040, y: 300 },
  controller_pause: { x: 1_040, y: 520 },
  final_unverified: { x: 1_300, y: 120 },
  final_committed: { x: 1_300, y: 330 },
};

export interface ControlTopologyNodeData {
  [key: string]: unknown;
  stateId: string;
  terminal: boolean;
}

export interface ControlTopologyEdgeData {
  [key: string]: unknown;
  transitions: CodeControlTopologyTransition[];
}

export type ControlTopologyNode = Node<ControlTopologyNodeData, 'controlState'>;
export type ControlTopologyEdge = Edge<ControlTopologyEdgeData, 'smoothstep'>;

export interface ControlTopologySelection {
  kind: 'state' | 'transition_group';
  id: string;
}

export function controlTopologyEdgeId(fromState: string, toState: string): string {
  return `fsm:${fromState}:${toState}`;
}

function statePosition(stateId: string, index: number): { x: number; y: number } {
  return STATE_LAYOUT[stateId] ?? {
    x: (index % 4) * 260,
    y: Math.floor(index / 4) * 180,
  };
}

export function projectControlTopology(
  topology: CodeControlTopology,
  selection: ControlTopologySelection | null = null,
): { nodes: ControlTopologyNode[]; edges: ControlTopologyEdge[] } {
  const nodes = topology.states.map((state, index): ControlTopologyNode => ({
    id: `state:${state.state_id}`,
    type: 'controlState',
    position: statePosition(state.state_id, index),
    data: { stateId: state.state_id, terminal: state.terminal },
    selected: selection?.kind === 'state' && selection.id === state.state_id,
    draggable: false,
  }));

  const groupedTransitions = new Map<string, CodeControlTopologyTransition[]>();
  for (const transition of topology.transitions) {
    const edgeId = controlTopologyEdgeId(transition.from_state, transition.to_state);
    const group = groupedTransitions.get(edgeId) ?? [];
    group.push(transition);
    groupedTransitions.set(edgeId, group);
  }

  const edges = [...groupedTransitions.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([edgeId, transitions]): ControlTopologyEdge => {
      const isSelected = selection?.kind === 'transition_group' && selection.id === edgeId;
      return {
        id: edgeId,
        source: `state:${transitions[0]?.from_state ?? ''}`,
        target: `state:${transitions[0]?.to_state ?? ''}`,
        type: 'smoothstep',
        label: transitions.length === 1 ? transitions[0]?.event : `${transitions.length} 条规则`,
        data: { transitions },
        selected: isSelected,
        animated: false,
        markerEnd: { type: 'arrowclosed', color: isSelected ? '#0891b2' : '#94a3b8' },
        style: {
          stroke: isSelected ? '#0891b2' : '#94a3b8',
          strokeWidth: isSelected ? 2.5 : 1.5,
        },
      };
    });

  return { nodes, edges };
}
