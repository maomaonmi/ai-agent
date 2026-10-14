'use client';

import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type NodeProps,
} from '@xyflow/react';
import { AlertCircle, Boxes, GitBranch, LoaderCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import '@xyflow/react/dist/style.css';

import {
  projectRequirementEvidenceGraph,
  type RequirementGraphFlowNode,
} from '../Code/requirementEvidenceGraphProjection';
import {
  CodeObservatoryApiError,
  getCodeRequirementEvidenceGraph,
  type CodeRequirementEvidenceGraph,
  type CodeRequirementGraphCoverage,
  type CodeRequirementGraphNode,
} from '../lib/codeObservatoryApi';

type LoadState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; graph: CodeRequirementEvidenceGraph }
  | { status: 'error'; message: string };

const NODE_LABELS: Record<CodeRequirementGraphNode['kind'], string> = {
  obligation: '目标义务',
  clause: '验收条款',
  proof_requirement: 'Proof IR',
  check: '执行检查',
  evidence: '证据',
  verdict: '验收判定',
  delivery: '实现交付',
};

const NODE_TONES: Record<CodeRequirementGraphNode['kind'], string> = {
  obligation: 'border-cyan-200 bg-cyan-50 dark:border-cyan-400/40 dark:bg-cyan-950/60',
  clause: 'border-blue-200 bg-blue-50 dark:border-blue-400/40 dark:bg-blue-950/60',
  proof_requirement: 'border-indigo-200 bg-indigo-50 dark:border-indigo-400/40 dark:bg-indigo-950/60',
  check: 'border-violet-200 bg-violet-50 dark:border-violet-400/40 dark:bg-violet-950/60',
  evidence: 'border-teal-200 bg-teal-50 dark:border-teal-400/40 dark:bg-teal-950/60',
  verdict: 'border-emerald-200 bg-emerald-50 dark:border-emerald-400/40 dark:bg-emerald-950/60',
  delivery: 'border-amber-200 bg-amber-50 dark:border-amber-400/40 dark:bg-amber-950/60',
};

const METRIC_LABELS: Record<CodeRequirementGraphCoverage['metric'], string> = {
  implementation: '实现覆盖',
  acceptance: '验收覆盖',
  evidence_association: '证据关联',
  materialized_evidence: '可用证据',
  proof_check_binding: 'Proof → Check',
  delivery: '交付关联',
};

const METRIC_TIPS: Record<CodeRequirementGraphCoverage['metric'], string> = {
  implementation: '当前 active required 义务中，Runtime 账本记录为 implemented 的数量',
  acceptance: '当前目标版本中，Reducer 判定为 verified 的必需条款数',
  evidence_association: '当前条款结果显式引用至少一条证据的数量',
  materialized_evidence: '条款引用能解析为当前候选版本可用证据的数量',
  proof_check_binding: '存在显式当前 check ID 绑定的 Proof IR 数量',
  delivery: '存在当前候选版本 patch artifact 义务引用的数量',
};

const EDGE_LABELS: Record<string, string> = {
  obligation_clause: '规格化为',
  clause_proof_requirement: '要求证明',
  proof_requirement_check: '编译为检查',
  clause_evidence: '关联证据',
  check_evidence: '引用证据',
  clause_verdict: '产生判定',
  obligation_delivery: '实现产物',
};

const EDGE_COLORS: Record<string, string> = {
  obligation_clause: '#0891b2',
  clause_proof_requirement: '#4f46e5',
  proof_requirement_check: '#7c3aed',
  clause_evidence: '#0f766e',
  check_evidence: '#0d9488',
  clause_verdict: '#059669',
  obligation_delivery: '#d97706',
};

function statusLabel(value?: string | null): string {
  if (!value) return '未记录';
  const labels: Record<string, string> = {
    unresolved: '待实现',
    in_progress: '实现中',
    implemented: '已实现',
    blocked: '受阻',
    ready: '规格就绪',
    needs_specification: '待规格化',
    not_compiled: '未编译',
    unbound: '未绑定',
    configured: '已配置',
    verified: '验证通过',
    partially_verified: '部分通过',
    contradicted: '结论矛盾',
    inconclusive: '结论不确定',
    unverifiable: '无法验证',
    unverified: '未验证',
    stale: '版本过期',
    patch_recorded: 'Patch 已记录',
    available: '可用',
    reference_only: '仅有引用',
    unknown: '未知',
  };
  return labels[value] ?? value;
}

function nodeStatusTone(node: CodeRequirementGraphNode): string {
  if (node.current === false || node.status === 'stale') return 'bg-amber-100 text-amber-800 dark:bg-amber-400/10 dark:text-amber-200';
  if (node.status === 'verified' || node.status === 'implemented' || node.status === 'available' || node.status === 'patch_recorded') {
    return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-200';
  }
  if (node.status === 'contradicted' || node.status === 'blocked') return 'bg-red-100 text-red-800 dark:bg-red-400/10 dark:text-red-200';
  return 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200';
}

function RequirementNodeCard({ data }: NodeProps<RequirementGraphFlowNode>) {
  const { fact } = data;
  return (
    <article className={`relative flex h-[94px] w-[216px] flex-col justify-between rounded-xl border px-3 py-2.5 shadow-sm ${NODE_TONES[fact.kind]}`}>
      <Handle type="target" position={Position.Left} className="!h-2.5 !w-2.5 !border-2 !border-white !bg-slate-400 dark:!border-slate-900" />
      <Handle type="source" position={Position.Right} className="!h-2.5 !w-2.5 !border-2 !border-white !bg-slate-400 dark:!border-slate-900" />
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-md bg-white/80 px-1.5 py-0.5 text-[9px] font-medium text-slate-600 dark:bg-slate-900/70 dark:text-slate-300">
          {NODE_LABELS[fact.kind]}
        </span>
        <span className={`max-w-[100px] truncate rounded-full px-1.5 py-0.5 text-[9px] ${nodeStatusTone(fact)}`}>
          {statusLabel(fact.status)}
        </span>
      </div>
      <div className="truncate font-mono text-[11px] font-semibold text-slate-900 dark:text-slate-100" title={fact.entity_id}>
        {fact.entity_id}
      </div>
      <div className="flex items-center justify-between gap-2 text-[9px] text-slate-500 dark:text-slate-400">
        <span>{fact.current === false ? '旧版本' : fact.current === true ? '当前版本' : '版本未知'}</span>
        <span className="max-w-[125px] truncate font-mono">{fact.artifact_version ?? fact.reason_code ?? ''}</span>
      </div>
    </article>
  );
}

const NODE_TYPES = { requirementEvidenceNode: RequirementNodeCard };

function sourceRefLabel(node: CodeRequirementGraphNode): string {
  const ref = node.source_ref;
  if (!ref) return '没有事件级来源引用';
  return [ref.stream_key, ref.event_key ?? ref.source_event_id ?? ref.stream_sequence]
    .filter((value) => value !== null && value !== undefined)
    .join(' · ');
}

function RequirementInspector({ node }: { node?: CodeRequirementGraphNode }) {
  if (!node) {
    return (
      <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 px-4 text-center text-xs text-slate-400">
        <GitBranch size={18} aria-hidden="true" />
        选择图中的节点，检查版本与持久来源。
      </div>
    );
  }
  return (
    <div className="space-y-3 p-3 text-xs text-slate-700 dark:text-slate-200">
      <section className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Boxes size={14} className="text-cyan-600 dark:text-cyan-300" aria-hidden="true" />
          {NODE_LABELS[node.kind]}
        </div>
        <p className="mt-2 break-all font-mono text-[11px]">{node.entity_id}</p>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]">
          <span className={`rounded-md px-2 py-1 ${nodeStatusTone(node)}`}>{statusLabel(node.status)}</span>
          {node.current !== null && node.current !== undefined && <span className="rounded-md bg-slate-100 px-2 py-1 dark:bg-slate-800">{node.current ? '当前版本' : '版本过期'}</span>}
          {node.evidence_status && <span className="rounded-md bg-teal-50 px-2 py-1 text-teal-700 dark:bg-teal-950/60 dark:text-teal-200">证据 · {statusLabel(node.evidence_status)}</span>}
        </div>
        {node.reason_code && <p className="mt-3 break-all text-[10px] text-amber-700 dark:text-amber-300">原因码 · {node.reason_code}</p>}
      </section>
      <section className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
        <h3 className="font-semibold">来源与版本</h3>
        <dl className="mt-2 space-y-2 text-[10px]">
          <div><dt className="text-slate-400">事件引用</dt><dd className="mt-0.5 break-all font-mono">{sourceRefLabel(node)}</dd></div>
          {node.artifact_version && <div><dt className="text-slate-400">Artifact / 候选版本</dt><dd className="mt-0.5 break-all font-mono">{node.artifact_version}</dd></div>}
        </dl>
      </section>
    </div>
  );
}

function coverageValue(metric: CodeRequirementGraphCoverage): string {
  if (metric.denominator === 0) return 'N/A';
  return `${metric.numerator} / ${metric.denominator}`;
}

function graphErrorMessage(error: unknown): string {
  if (error instanceof CodeObservatoryApiError && error.code === 'NOT_FOUND') return '此 Operation 暂无可读取的持久快照。';
  if (error instanceof CodeObservatoryApiError && error.code === 'PROJECTION_INCOMPLETE') return 'Operation 正在变化，刷新后可以重新读取一致快照。';
  return '需求与证据关系图读取失败；没有用前端状态补关系。';
}

export function RequirementEvidenceGraph({
  operationId,
  refreshKey,
}: {
  operationId: string | null;
  refreshKey: number;
}) {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'idle' });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    if (!operationId) {
      setLoadState({ status: 'idle' });
      return;
    }
    const controller = new AbortController();
    setLoadState({ status: 'loading' });
    void getCodeRequirementEvidenceGraph(operationId, controller.signal)
      .then((graph) => {
        if (!controller.signal.aborted) setLoadState({ status: 'ready', graph });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) setLoadState({ status: 'error', message: graphErrorMessage(error) });
      });
    return () => controller.abort();
  }, [operationId, refreshKey]);

  const graph = loadState.status === 'ready' ? loadState.graph : null;
  const projected = useMemo(
    () => graph ? projectRequirementEvidenceGraph(graph.nodes, graph.edges) : null,
    [graph],
  );
  const selectedNode = graph?.nodes.find((node) => node.node_id === selectedNodeId);
  const flowEdges = useMemo(() => projected?.edges.map((edge) => {
    const color = EDGE_COLORS[edge.data.relation] ?? '#94a3b8';
    return {
      ...edge,
      label: EDGE_LABELS[edge.data.relation] ?? edge.data.relation,
      labelStyle: { fill: '#64748b', fontSize: 9 },
      labelBgStyle: { fill: '#ffffff', fillOpacity: 0.86 },
      style: { stroke: color, strokeWidth: edge.data.current === false ? 1.25 : 1.8, strokeDasharray: edge.data.current === false ? '5 4' : undefined },
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 14, height: 14 },
    } satisfies Edge;
  }) ?? [], [projected]);

  if (!operationId) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center rounded-xl border border-dashed border-slate-300 px-5 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
        当前 Run 尚未明确关联到 Operation；需求关系图不会从聊天或时间线猜测归属。
      </div>
    );
  }
  if (loadState.status === 'loading' || loadState.status === 'idle') {
    return <div className="flex h-full items-center justify-center gap-2 text-xs text-slate-500"><LoaderCircle size={15} className="animate-spin" aria-hidden="true" />正在读取 Goal Event Stream 与 Runtime 计划…</div>;
  }
  if (loadState.status === 'error') {
    return <div className="flex h-full items-center justify-center gap-2 px-5 text-center text-xs text-amber-700 dark:text-amber-300"><AlertCircle size={16} aria-hidden="true" />{loadState.message}</div>;
  }
  if (!graph || !projected) return null;

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[10px] dark:border-slate-700 dark:bg-slate-800/60">
        <span className="font-medium text-slate-700 dark:text-slate-200">
          Operation {graph.operation_id} · v{graph.operation_version}
          {graph.goal_set_revision ? ` · Goal r${graph.goal_set_revision}` : ''}
          {graph.candidate_revision ? ` · Candidate ${graph.candidate_revision.slice(0, 12)}` : ''}
        </span>
        <span className={graph.source_status === 'current' ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'}>
          来源 · {graph.source_status === 'current' ? '当前' : graph.source_status === 'unavailable' ? '不可用' : '存在缺口'}
          {' · '}Runtime 计划 · {graph.runtime_plan_status === 'current' ? '当前' : graph.runtime_plan_status === 'stale' ? '过期' : '缺失'}
        </span>
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {graph.coverage.map((metric) => (
          <div key={metric.metric} title={METRIC_TIPS[metric.metric]} className="rounded-xl border border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
            <div className="text-[9px] text-slate-500 dark:text-slate-400">{METRIC_LABELS[metric.metric]}</div>
            <div className="mt-1 text-sm font-semibold tabular-nums text-slate-800 dark:text-slate-100">{coverageValue(metric)}</div>
            <div className={`mt-0.5 text-[9px] ${metric.status === 'incomplete' ? 'text-amber-600 dark:text-amber-300' : 'text-slate-400'}`}>
              {metric.status === 'not_applicable' ? '无适用分母' : metric.status === 'incomplete' ? '观测不完整' : '按当前 required 条目'}
            </div>
          </div>
        ))}
      </div>

      {graph.source_gaps.length > 0 && (
        <div className="flex shrink-0 items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] text-amber-800 dark:border-amber-400/30 dark:bg-amber-950/30 dark:text-amber-200">
          <AlertCircle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>关系来源缺口：{graph.source_gaps.join(' · ')}</span>
        </div>
      )}
      {projected.omittedNodeCount > 0 && (
        <div className="shrink-0 text-[10px] text-amber-700 dark:text-amber-300">
          图中仅显示前 500 个稳定节点，另有 {projected.omittedNodeCount} 个节点和 {projected.omittedEdgeCount} 条关系被省略。
        </div>
      )}

      {projected.nodes.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-dashed border-slate-300 px-5 text-center text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
          当前 Operation 尚无可重放的目标义务；此图不会从任务文字生成占位节点。
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_170px] gap-3 xl:grid-rows-1 xl:grid-cols-[minmax(0,1fr)_260px]">
          <div className="visual-workflow-canvas min-h-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950">
            <ReactFlow
              nodes={projected.nodes}
              edges={flowEdges}
              nodeTypes={NODE_TYPES}
              fitView
              fitViewOptions={{ padding: 0.18, minZoom: 0.28, maxZoom: 0.9 }}
              onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
              nodesDraggable={false}
              nodesConnectable={false}
              elementsSelectable
              panOnDrag
              zoomOnScroll
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#94a3b8" gap={24} size={0.8} />
              <Controls showInteractive={false} />
            </ReactFlow>
          </div>
          <aside aria-label="需求关系节点详情" className="min-h-0 overflow-auto rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
            <RequirementInspector node={selectedNode} />
          </aside>
        </div>
      )}
    </div>
  );
}
