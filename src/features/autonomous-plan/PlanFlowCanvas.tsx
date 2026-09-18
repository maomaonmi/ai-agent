'use client';

import { Background, Controls, Handle, Position, ReactFlow, ReactFlowProvider, type Edge, type Node, type NodeProps } from '@xyflow/react';
import { memo, useMemo } from 'react';
import { Bot, FileText, Search, Sparkles } from 'lucide-react';
import { buildPlanFlowGraph, type PlanFlowGraphNode } from './planFlowGraph';
import type { PlanProgressEvent } from '../../lib/api';
import '@xyflow/react/dist/style.css';

type PlanFlowNodeData = { node: PlanFlowGraphNode; compact: boolean; selected: boolean };
type PlanFlowCanvasNode = Node<PlanFlowNodeData, 'planFlow'>;

const KIND_ICONS = {
  planner: Sparkles,
  search: Search,
  agent: Bot,
  report: FileText,
} as const;

/* Why 状态色语义沿用任务面板（lucide 图标配色）：同一状态在全应用内视觉一致。 */
const STATUS_STYLES: Record<string, string> = {
  pending: 'border-slate-200 bg-white text-slate-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-400',
  in_progress: 'border-sky-300 bg-sky-50 text-sky-800 ring-2 ring-sky-200 dark:border-sky-500/40 dark:bg-sky-500/10 dark:text-sky-200 dark:ring-sky-500/20',
  completed: 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200',
  failed: 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200',
};

const STATUS_DOTS: Record<string, string> = {
  pending: 'bg-slate-300 dark:bg-slate-600',
  in_progress: 'bg-sky-500 animate-pulse dark:bg-cyan-400',
  completed: 'bg-emerald-500',
  failed: 'bg-amber-500',
};

const PlanFlowNodeCard = memo(function PlanFlowNodeCard({ data }: NodeProps<PlanFlowCanvasNode>) {
  const { node, compact, selected } = data;
  const Icon = KIND_ICONS[node.kind];
  return (
    <div
      data-plan-flow-node={node.id}
      className={`flex items-center gap-2 rounded-xl border px-3 py-2 shadow-sm transition-shadow ${STATUS_STYLES[node.status] || STATUS_STYLES.pending} ${selected ? 'shadow-md ring-2 ring-slate-900/10 dark:ring-white/20' : ''} ${compact ? 'max-w-[150px]' : 'max-w-[176px]'}`}
    >
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !border-0 !bg-slate-300 dark:!bg-slate-600" />
      <Icon size={compact ? 13 : 15} className="shrink-0" />
      <div className="min-w-0 flex-1">
        <div className={`truncate font-medium ${compact ? 'text-[11px] leading-4' : 'text-xs leading-5'}`}>{node.title}</div>
        {!compact && node.agentLabel && <div className="truncate text-[10px] leading-4 opacity-70">{node.agentLabel}</div>}
      </div>
      <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOTS[node.status] || STATUS_DOTS.pending}`} />
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !border-0 !bg-slate-300 dark:!bg-slate-600" />
    </div>
  );
});

const NODE_TYPES = { planFlow: PlanFlowNodeCard };

interface PlanFlowCanvasProps {
  progress: PlanProgressEvent | null | undefined;
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string) => void;
}

function FlowInner({ progress, selectedNodeId, onSelectNode }: PlanFlowCanvasProps) {
  const graph = useMemo(() => buildPlanFlowGraph(progress), [progress]);
  const activeIds = useMemo(() => new Set(graph.nodes.filter((node) => node.status === 'in_progress').map((node) => node.id)), [graph]);
  const nodes = useMemo<Node[]>(
    () => graph.nodes.map((node) => ({
      id: node.id,
      type: 'planFlow' as const,
      position: { x: node.x, y: node.y },
      data: { node, compact: graph.compact, selected: node.id === selectedNodeId },
      draggable: false,
      selectable: true,
    })),
    [graph, selectedNodeId],
  );
  const edges = useMemo<Edge[]>(
    () => graph.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'smoothstep' as const,
      animated: activeIds.has(edge.source) || activeIds.has(edge.target) || graph.replanning,
      style: { stroke: activeIds.has(edge.source) ? '#0ea5e9' : '#94a3b8', strokeWidth: 1.5 },
    })),
    [graph, activeIds],
  );

  return (
    // Why key=节点数：任务产出导致图结构变化时重新 fitView，新节点不会跑出视野。
    <ReactFlow
      key={graph.nodes.length}
      nodes={nodes}
      edges={edges}
      nodeTypes={NODE_TYPES}
      fitView
      fitViewOptions={{ padding: 0.18, maxZoom: 1 }}
      minZoom={0.15}
      maxZoom={1.4}
      nodesDraggable={false}
      nodesConnectable={false}
      zoomOnScroll={false}
      panOnScroll={false}
      preventScrolling={false}
      zoomOnDoubleClick={false}
      proOptions={{ hideAttribution: true }}
      onNodeClick={(_, node) => onSelectNode?.(node.id)}
    >
      <Background gap={18} className="dark:[&_.react-flow__background]:opacity-40" />
      <Controls showInteractive={false} className="!bottom-2 !left-2 [&_button]:!bg-white [&_button]:!border-slate-200 [&_button]:!fill-slate-500 dark:[&_button]:!bg-[#141d2c] dark:[&_button]:!border-white/10 dark:[&_button]:!fill-slate-300" />
    </ReactFlow>
  );
}

export default function PlanFlowCanvas(props: PlanFlowCanvasProps) {
  return (
    <ReactFlowProvider>
      <FlowInner {...props} />
    </ReactFlowProvider>
  );
}
