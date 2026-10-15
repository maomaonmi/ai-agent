'use client';

import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { AlertCircle, Clock3, GitBranch, Network, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  projectExecutionGraph,
  type ExecutionGraphEdge,
  type ExecutionGraphNode,
  type ExecutionGraphNodeKind,
} from '../Code/executionGraphProjection';
import {
  CodeObservatoryApiError,
  getCodeObservatoryOperationSnapshot,
  type CodeObservatoryDecisionView,
  type CodeObservatoryEvidenceView,
  type CodeObservatoryNodeView,
  type CodeObservatoryOperationSnapshot,
  type CodeObservatorySpanView,
  type CodeObservatoryWireEvent,
} from '../lib/codeObservatoryApi';

type FlowNodeData = { graphNode: ExecutionGraphNode };
type FlowNode = Node<FlowNodeData, 'executionGraphNode'>;
type FlowEdge = Edge<ExecutionGraphEdge>;

type OperationLoadState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; snapshot: CodeObservatoryOperationSnapshot }
  | { status: 'error'; message: string };

const NODE_KIND_LABELS: Record<ExecutionGraphNodeKind, string> = {
  instance: '节点实例',
  span: '执行跨度',
  run: 'Run 关联',
  attempt: '恢复尝试',
  artifact: '证据引用',
  decision: '决策记录',
  group: '折叠分组',
};

const NODE_TONES: Record<ExecutionGraphNodeKind, string> = {
  instance: 'border-sky-200 bg-sky-50 dark:border-sky-400/40 dark:bg-sky-950/70',
  span: 'border-indigo-200 bg-indigo-50 dark:border-indigo-400/40 dark:bg-indigo-950/70',
  run: 'border-violet-200 bg-violet-50 dark:border-violet-400/40 dark:bg-violet-950/70',
  attempt: 'border-amber-200 bg-amber-50 dark:border-amber-400/40 dark:bg-amber-950/70',
  artifact: 'border-teal-200 bg-teal-50 dark:border-teal-400/40 dark:bg-teal-950/70',
  decision: 'border-fuchsia-200 bg-fuchsia-50 dark:border-fuchsia-400/40 dark:bg-fuchsia-950/70',
  group: 'border-slate-300 bg-white dark:border-slate-600 dark:bg-slate-800',
};

const COLLAPSIBLE_KINDS: Array<Exclude<ExecutionGraphNodeKind, 'group'>> = [
  'instance', 'span', 'run', 'attempt', 'artifact', 'decision',
];

const EDGE_COLORS: Record<ExecutionGraphEdge['kind'], string> = {
  parent_call: '#0ea5e9',
  trigger: '#6366f1',
  retry_of: '#f59e0b',
  resume_from: '#8b5cf6',
  recovery: '#d97706',
  artifact_dependency: '#0d9488',
  decision_route: '#c026d3',
};

const NODE_TYPES = { executionGraphNode: ExecutionGraphNodeCard };

function statusLabel(value?: string): string {
  switch (value) {
    case 'running': return '运行中';
    case 'queued': return '排队中';
    case 'succeeded':
    case 'completed':
    case 'available': return '已完成';
    case 'failed': return '失败';
    case 'cancelled': return '已取消';
    case 'verified': return '验证通过';
    case 'partially_verified': return '部分通过';
    case 'unknown':
    case undefined: return '未知';
    default: return value;
  }
}

function operationErrorMessage(error: unknown): string {
  if (error instanceof CodeObservatoryApiError && error.code === 'NOT_FOUND') {
    return '该 Run 尚未关联可读取的 Operation 快照。';
  }
  if (error instanceof CodeObservatoryApiError && error.code === 'PROJECTION_INCOMPLETE') {
    return 'Operation 快照正在变化，稍后刷新可重新读取。';
  }
  return 'Operation 关系读取失败；Run 内节点图仍可查看。';
}

function ExecutionGraphNodeCard({ data }: NodeProps<FlowNode>) {
  const { graphNode } = data;
  const status = graphNode.verificationStatus && graphNode.verificationStatus !== 'unknown'
    ? graphNode.verificationStatus
    : graphNode.executionStatus;
  return (
    <article className={`relative flex h-[100px] w-[222px] flex-col justify-between rounded-xl border px-3 py-2.5 shadow-sm ${NODE_TONES[graphNode.kind]}`}>
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-2 !border-white !bg-slate-400 dark:!border-slate-900" />
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-2 !border-white !bg-slate-400 dark:!border-slate-900" />
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full bg-white/75 px-1.5 py-0.5 text-[9px] font-medium text-slate-600 dark:bg-slate-900/70 dark:text-slate-300">
          {NODE_KIND_LABELS[graphNode.kind]}
        </span>
        <span className="max-w-[95px] truncate text-[9px] text-slate-500 dark:text-slate-400">{statusLabel(status)}</span>
      </div>
      <div className="truncate text-xs font-semibold text-slate-900 dark:text-slate-100" title={graphNode.label}>
        {graphNode.label}
      </div>
      <div className="truncate font-mono text-[9px] text-slate-500 dark:text-slate-400" title={graphNode.identity}>
        {graphNode.subtitle || graphNode.identity}
      </div>
    </article>
  );
}

function formatTimestamp(value?: number): string {
  if (value === undefined || !Number.isFinite(value)) return '未记录时间';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hour12: false,
  }).format(value);
}

function ExecutionGraphInspector({ node }: { node?: ExecutionGraphNode }) {
  if (!node) {
    return (
      <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 px-5 text-center text-xs text-slate-400">
        <Network size={18} aria-hidden="true" />
        选择一个节点，查看稳定身份、状态与来源引用。
      </div>
    );
  }
  const versions = Object.entries(node.versions ?? {}).filter(([, value]) => value !== null && value !== undefined);
  return (
    <div className="space-y-4 p-3 text-xs text-slate-700 dark:text-slate-200">
      <section className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <GitBranch size={14} className="text-cyan-600 dark:text-cyan-300" aria-hidden="true" />
          {NODE_KIND_LABELS[node.kind]}
        </div>
        <p className="mt-2 break-all font-medium">{node.label}</p>
        <p className="mt-1 break-all font-mono text-[10px] text-slate-500">{node.identity}</p>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]">
          {node.executionStatus && <span className="rounded-md bg-slate-100 px-2 py-1 dark:bg-slate-800">执行 · {statusLabel(node.executionStatus)}</span>}
          {node.verificationStatus && node.verificationStatus !== 'unknown' && <span className="rounded-md bg-emerald-50 px-2 py-1 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300">验证 · {statusLabel(node.verificationStatus)}</span>}
          {node.associationStatus && <span className="rounded-md bg-slate-100 px-2 py-1 dark:bg-slate-800">关联 · {node.associationStatus}</span>}
        </div>
      </section>
      <section className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
        <h3 className="font-semibold">节点上下文</h3>
        <dl className="mt-2 space-y-2 text-[10px]">
          {node.runId && <div><dt className="text-slate-400">Run</dt><dd className="mt-0.5 break-all font-mono">{node.runId}</dd></div>}
          {node.nodeInstanceId && <div><dt className="text-slate-400">node_instance_id</dt><dd className="mt-0.5 break-all font-mono">{node.nodeInstanceId}</dd></div>}
          {node.spanKind && <div><dt className="text-slate-400">执行跨度</dt><dd className="mt-0.5">{node.spanKind} · {node.lifecycleStatus ?? '边界不完整'}</dd></div>}
          {node.groupKind && <div><dt className="text-slate-400">折叠内容</dt><dd className="mt-0.5">{NODE_KIND_LABELS[node.groupKind]} · {node.groupedNodeCount ?? 0} 个节点；点击分组可展开</dd></div>}
          {node.actionId && <div><dt className="text-slate-400">action_id</dt><dd className="mt-0.5 break-all font-mono">{node.actionId}</dd></div>}
          <div><dt className="text-slate-400">发生时间</dt><dd className="mt-0.5 font-mono">{formatTimestamp(node.startedAtMs)}</dd></div>
        </dl>
      </section>
      {node.sourceRefs.length > 0 && (
        <section className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <h3 className="font-semibold">来源事件 · {node.sourceRefs.length}</h3>
          <ul className="mt-2 space-y-1.5">
            {node.sourceRefs.slice(0, 12).map((ref, index) => (
              <li key={`${ref.stream_key ?? ''}:${ref.event_key ?? ref.source_event_id ?? ref.source_sequence ?? ref.stream_sequence ?? ref.transport_event_id ?? index}`} className="break-all font-mono text-[9px] text-slate-500">
                {ref.stream_key ?? 'stream 未记录'} · {ref.event_key ?? ref.source_event_id ?? ref.source_sequence ?? ref.stream_sequence ?? ref.transport_event_id ?? 'event 未记录'}
              </li>
            ))}
          </ul>
        </section>
      )}
      {versions.length > 0 && (
        <section className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
          <h3 className="font-semibold">版本上下文</h3>
          <dl className="mt-2 space-y-1.5 text-[10px]">
            {versions.slice(0, 10).map(([key, value]) => <div key={key} className="flex justify-between gap-3"><dt className="text-slate-400">{key}</dt><dd className="break-all text-right font-mono">{String(value)}</dd></div>)}
          </dl>
        </section>
      )}
    </div>
  );
}

function coverageMessages(coverage: ReturnType<typeof projectExecutionGraph>['coverage']): string[] {
  const messages: string[] = [];
  if (coverage.unresolvedCausationRefs) messages.push(`${coverage.unresolvedCausationRefs} 条因果引用未能映射到当前 Run 的节点`);
  if (coverage.missingSpanParents) messages.push(`${coverage.missingSpanParents} 条跨度/恢复关系缺少一端`);
  if (coverage.ambiguousSpanParents) messages.push(`${coverage.ambiguousSpanParents} 条跨度关联存在多个候选节点`);
  if (coverage.unlinkedDecisionRoutes) messages.push(`${coverage.unlinkedDecisionRoutes} 条决策路线没有唯一匹配的实际动作`);
  if (coverage.unlinkedArtifacts) messages.push(`${coverage.unlinkedArtifacts} 条证据引用缺少唯一的生产者或版本映射`);
  if (coverage.unlinkedRecoveryAttempts) messages.push(`${coverage.unlinkedRecoveryAttempts} 次恢复尝试没有唯一动作跨度`);
  if (coverage.omittedNodes) messages.push(`为保持画布响应，当前未显示 ${coverage.omittedNodes} 个节点`);
  if (coverage.collapsedInternalEdges) messages.push(`折叠分组内收起了 ${coverage.collapsedInternalEdges} 条内部关系`);
  return messages;
}

export function ExecutionGraph({
  runId,
  operationId,
  nodes,
  spans,
  events,
  decisions,
  evidence,
  observationStatus,
}: {
  runId: string;
  operationId: string | null;
  nodes: CodeObservatoryNodeView[];
  spans: CodeObservatorySpanView[];
  events: CodeObservatoryWireEvent[];
  decisions: CodeObservatoryDecisionView[];
  evidence: CodeObservatoryEvidenceView[];
  observationStatus: string;
}) {
  const [operationState, setOperationState] = useState<OperationLoadState>({ status: 'idle' });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [collapsedKinds, setCollapsedKinds] = useState<Exclude<ExecutionGraphNodeKind, 'group'>[]>([]);

  useEffect(() => {
    if (!operationId) {
      setOperationState({ status: 'idle' });
      return;
    }
    const controller = new AbortController();
    setOperationState({ status: 'loading' });
    void getCodeObservatoryOperationSnapshot(operationId, controller.signal).then(
      (snapshot) => {
        if (controller.signal.aborted) return;
        if (snapshot.operation_id !== operationId || snapshot.operation.operation_id !== operationId) {
          setOperationState({ status: 'error', message: 'Operation 快照身份不匹配，已隐藏跨 Run 关系。' });
          return;
        }
        setOperationState({ status: 'ready', snapshot });
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setOperationState({ status: 'error', message: operationErrorMessage(error) });
      },
    );
    return () => controller.abort();
  }, [operationId]);

  const operation = operationState.status === 'ready' ? operationState.snapshot.operation : undefined;
  const projection = useMemo(() => projectExecutionGraph({
    runId, nodes, spans, events, decisions, evidence, operation, collapsedKinds,
  }), [collapsedKinds, decisions, events, evidence, nodes, operation, runId, spans]);
  const flowNodes = useMemo<FlowNode[]>(() => projection.nodes.map((graphNode) => {
    const status = graphNode.verificationStatus && graphNode.verificationStatus !== 'unknown'
      ? graphNode.verificationStatus
      : graphNode.executionStatus;
    return {
      id: graphNode.id,
      type: 'executionGraphNode',
      position: graphNode.position,
      data: { graphNode },
      ariaLabel: `${NODE_KIND_LABELS[graphNode.kind]}：${graphNode.label}；${statusLabel(status)}`,
      draggable: false,
      selectable: true,
    };
  }), [projection.nodes]);
  const flowEdges = useMemo<FlowEdge[]>(() => projection.edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    data: edge,
    type: 'smoothstep',
    label: edge.label,
    labelStyle: { fill: EDGE_COLORS[edge.kind], fontSize: 10, fontWeight: 600 },
    labelBgStyle: { fill: '#ffffff', fillOpacity: 0.9 },
    style: { stroke: EDGE_COLORS[edge.kind], strokeWidth: 1.8 },
    markerEnd: { type: MarkerType.ArrowClosed, color: EDGE_COLORS[edge.kind] },
    selectable: false,
  })), [projection.edges]);
  const selectedNode = projection.nodes.find((node) => node.id === selectedNodeId);
  const coverage = coverageMessages(projection.coverage);

  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(180px,1fr)_minmax(120px,0.55fr)] gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.34fr)] lg:grid-rows-1">
      <section aria-label="实际执行图画布" className="relative min-h-[180px] overflow-hidden rounded-xl border border-slate-200 bg-slate-50 sm:min-h-[240px] dark:border-slate-700 dark:bg-slate-950">
        <div className="absolute right-3 top-3 z-10 flex max-w-[72%] flex-wrap justify-end gap-1" role="group" aria-label="折叠执行图分组">
          {COLLAPSIBLE_KINDS.map((kind) => {
            const groupNode = projection.nodes.find((node) => node.kind === 'group' && node.groupKind === kind);
            const count = groupNode?.groupedNodeCount
              ?? projection.nodes.filter((node) => node.kind === kind).length;
            if (count === 0) return null;
            const isCollapsed = collapsedKinds.includes(kind);
            return (
              <button
                key={kind}
                type="button"
                aria-pressed={isCollapsed}
                aria-label={`${isCollapsed ? '展开' : '折叠'}${NODE_KIND_LABELS[kind]}`}
                onClick={() => setCollapsedKinds((current) => isCollapsed
                  ? current.filter((item) => item !== kind)
                  : [...current, kind])}
                className={`rounded-full border px-2 py-1 text-[9px] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 ${isCollapsed ? 'border-cyan-300 bg-cyan-50 text-cyan-800 dark:border-cyan-700 dark:bg-cyan-950/60 dark:text-cyan-200' : 'border-white/80 bg-white/90 text-slate-600 dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-300'}`}
              >
                {NODE_KIND_LABELS[kind]} · {count}
              </button>
            );
          })}
        </div>
        {flowNodes.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-5 text-center text-xs text-slate-400">
            <Network size={20} aria-hidden="true" />
            <span>当前 Run 没有带稳定身份的执行节点。</span>
            <span className="max-w-lg text-[10px]">面板不会根据消息文本、时间顺序或前端活动记录补造执行关系。</span>
          </div>
        ) : (
          <ReactFlow
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={NODE_TYPES}
            fitView
            fitViewOptions={{ padding: 0.18, minZoom: 0.22, maxZoom: 1 }}
            nodesDraggable={false}
            nodesConnectable={false}
            nodesFocusable
            elementsSelectable
            panOnDrag
            zoomOnScroll
            onNodeClick={(_event, node) => {
              const selected = node.data.graphNode;
              if (selected.kind === 'group' && selected.groupKind) {
                setCollapsedKinds((current) => current.filter((kind) => kind !== selected.groupKind));
                setSelectedNodeId(null);
                return;
              }
              setSelectedNodeId(node.id);
            }}
            onSelectionChange={({ nodes }) => {
              const selectedNode = nodes[nodes.length - 1];
              if (!selectedNode) {
                setSelectedNodeId(null);
              } else if (selectedNode.data.graphNode.kind === 'group' && selectedNode.data.graphNode.groupKind) {
                const groupKind = selectedNode.data.graphNode.groupKind;
                setCollapsedKinds((current) => current.filter((kind) => kind !== groupKind));
                setSelectedNodeId(null);
              } else {
                setSelectedNodeId(selectedNode.id);
              }
            }}
            onPaneClick={() => setSelectedNodeId(null)}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#94a3b8" gap={22} size={0.8} />
            <Controls showInteractive={false} />
          </ReactFlow>
        )}
        <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5">
          <span className="rounded-full border border-white/80 bg-white/90 px-2 py-1 text-[9px] text-slate-600 shadow-sm dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-300">
            {flowNodes.length} 个可见节点 · {flowEdges.length} 条明确关系
          </span>
          <span className="rounded-full border border-white/80 bg-white/90 px-2 py-1 text-[9px] text-slate-500 shadow-sm dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-400">
            观测覆盖 · {observationStatus}
          </span>
        </div>
      </section>

      <aside aria-label="执行节点详情与关系覆盖" className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700">
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-700">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-800 dark:text-slate-100">
            <Clock3 size={13} className="text-cyan-600 dark:text-cyan-300" aria-hidden="true" />
            节点详情
          </div>
          <span className="text-[9px] text-slate-400">选择节点查看来源</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ExecutionGraphInspector node={selectedNode} />
          <section className="border-t border-slate-200 p-3 dark:border-slate-700">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold">
              <ShieldCheck size={13} className="text-emerald-600 dark:text-emerald-300" aria-hidden="true" />关系覆盖
            </h3>
            {coverage.length === 0 ? (
              <p className="mt-2 text-[10px] leading-5 text-slate-500 dark:text-slate-400">当前没有未映射的显式关系；无因果字段的节点仍保持独立。</p>
            ) : (
              <ul className="mt-2 space-y-1.5 text-[10px] leading-4 text-amber-800 dark:text-amber-200">
                {coverage.map((message) => <li key={message} className="rounded-lg bg-amber-50 px-2 py-1.5 dark:bg-amber-950/30">{message}</li>)}
              </ul>
            )}
            {operationId && operationState.status === 'loading' && <p className="mt-2 text-[10px] text-slate-400">正在读取 Operation 的跨 Run 恢复关系…</p>}
            {operationState.status === 'error' && <p role="status" className="mt-2 flex items-start gap-1.5 text-[10px] text-amber-700 dark:text-amber-300"><AlertCircle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />{operationState.message}</p>}
            {operationState.status === 'ready' && !projection.hasOperationRelations && <p role="status" className="mt-2 text-[10px] text-amber-700 dark:text-amber-300">Operation 未明确关联当前 Run，跨 Run 关系已隐藏。</p>}
          </section>
        </div>
      </aside>
    </div>
  );
}
