'use client';

import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type NodeProps,
} from '@xyflow/react';
import { AlertCircle, GitBranch, RefreshCw, ShieldAlert } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  CONTROL_STATE_LABELS,
  type ControlTopologyEdge,
  projectControlTopology,
  type ControlTopologyNode,
  type ControlTopologySelection,
} from '../Code/controlTopologyProjection';
import {
  CodeObservatoryApiError,
  getCodeControlTopology,
  type CodeControlTopology,
} from '../lib/codeObservatoryApi';
import { ControlTopologyInspector } from './ControlTopologyInspector';

function ControlStateNode({ data, selected }: NodeProps<ControlTopologyNode>) {
  return (
    <div
      role="group"
      aria-label={`控制状态：${CONTROL_STATE_LABELS[data.stateId] ?? data.stateId}`}
      className={`relative w-[208px] rounded-lg border border-l-4 px-3 py-2.5 shadow-sm transition-colors ${
        selected
          ? 'border-cyan-400 border-l-cyan-600 bg-cyan-50 ring-2 ring-cyan-500/20 dark:border-cyan-400 dark:bg-cyan-950/70'
          : data.terminal
            ? 'border-emerald-200 border-l-emerald-500 bg-white dark:border-emerald-400/30 dark:bg-slate-900'
            : 'border-slate-200 border-l-slate-400 bg-white dark:border-slate-700 dark:bg-slate-900'
      }`}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-2 !border-white !bg-slate-400 dark:!border-slate-900" />
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold text-slate-800 dark:text-slate-100">
          {CONTROL_STATE_LABELS[data.stateId] ?? data.stateId}
        </span>
        {data.terminal && (
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[8px] text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200">
            FSM 终态
          </span>
        )}
      </div>
      <code className="mt-1 block break-all text-[9px] text-slate-500 dark:text-slate-400">{data.stateId}</code>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-2 !border-white !bg-slate-400 dark:!border-slate-900" />
    </div>
  );
}

const NODE_TYPES = { controlState: ControlStateNode };

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; topology: CodeControlTopology }
  | { status: 'error'; code: string };

function ControlTopologyGraph({
  topology,
  selection,
  onSelectionChange,
}: {
  topology: CodeControlTopology;
  selection: ControlTopologySelection | null;
  onSelectionChange: (selection: ControlTopologySelection | null) => void;
}) {
  const { nodes, edges } = useMemo(
    () => projectControlTopology(topology, selection),
    [topology, selection],
  );

  return (
    <div className="visual-workflow-canvas h-full min-h-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950">
      <ReactFlow<ControlTopologyNode, ControlTopologyEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.18, minZoom: 0.28, maxZoom: 1 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        panOnDrag
        zoomOnScroll
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_event, node) => onSelectionChange({ kind: 'state', id: node.data.stateId })}
        onEdgeClick={(_event, edge) => onSelectionChange({ kind: 'transition_group', id: edge.id })}
        onPaneClick={() => onSelectionChange(null)}
        defaultEdgeOptions={{
          type: 'smoothstep',
          markerEnd: { type: MarkerType.ArrowClosed, color: '#94a3b8' },
          style: { stroke: '#94a3b8', strokeWidth: 1.5 },
        }}
      >
        <Background color="#94a3b8" gap={24} size={0.8} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

function topologyErrorLabel(code: string): string {
  if (code === 'SOURCE_UNAVAILABLE') return '规则来源暂不可用。';
  if (code === 'SCHEMA_UNSUPPORTED') return '规则拓扑版本暂不兼容。';
  return '读取规则拓扑失败。';
}

export function ControlTopology({ reloadKey = 0 }: { reloadKey?: number }) {
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' });
  const [retry, setRetry] = useState(0);
  const [selection, setSelection] = useState<ControlTopologySelection | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoadState({ status: 'loading' });
    void getCodeControlTopology(controller.signal)
      .then((topology) => {
        if (!controller.signal.aborted) {
          setLoadState({ status: 'ready', topology });
          setSelection(null);
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLoadState({
          status: 'error',
          code: error instanceof CodeObservatoryApiError ? error.code : 'REQUEST_FAILED',
        });
      });
    return () => controller.abort();
  }, [reloadKey, retry]);

  if (loadState.status === 'loading') {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3" aria-busy="true" aria-label="读取控制规则拓扑">
        <div className="h-12 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800" />
        <div className="min-h-[280px] flex-1 animate-pulse rounded-xl bg-slate-100 dark:bg-slate-800" />
      </div>
    );
  }

  if (loadState.status === 'error') {
    return (
      <div role="status" className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 text-center dark:border-slate-700">
        <AlertCircle size={20} className="text-amber-500" aria-hidden="true" />
        <p className="text-xs text-slate-600 dark:text-slate-300">{topologyErrorLabel(loadState.code)}</p>
        <button
          type="button"
          onClick={() => setRetry((version) => version + 1)}
          className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
        >
          <RefreshCw size={13} aria-hidden="true" /> 重新加载
        </button>
      </div>
    );
  }

  const { topology } = loadState;
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900">
        <div className="flex min-w-0 items-center gap-2">
          <GitBranch size={15} className="shrink-0 text-cyan-600 dark:text-cyan-300" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-slate-800 dark:text-slate-100">控制规则拓扑</p>
            <p className="truncate font-mono text-[9px] text-slate-400" title={topology.topology_version}>
              当前规则参考 · {topology.topology_version}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[9px]">
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-amber-800 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
            规则版本未记录
          </span>
          <span className="text-slate-500 dark:text-slate-400">
            {topology.states.length} 状态 · {topology.transitions.length} 转换 · {topology.runtime_routes.length} 条注册恢复路线
          </span>
        </div>
      </div>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(280px,1fr)_minmax(180px,0.8fr)] gap-3 xl:grid-cols-[minmax(0,1fr)_340px] xl:grid-rows-1">
        <section aria-label="控制状态与允许转换图" className="flex min-h-0 flex-col gap-2">
          <div className="flex shrink-0 items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 dark:border-amber-400/20 dark:bg-amber-400/5">
            <ShieldAlert size={13} className="mt-0.5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
            <p className="text-[9px] leading-4 text-amber-900 dark:text-amber-100">
              实线箭头仅表示 FSM 允许转换，不代表此 Run 走过该路径。模型与工具的运行期分支不会被静态猜测。
            </p>
          </div>
          <div className="min-h-0 flex-1">
            <ControlTopologyGraph
              topology={topology}
              selection={selection}
              onSelectionChange={setSelection}
            />
          </div>
        </section>
        <aside aria-label="控制规则详情" className="min-h-0 overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
          <ControlTopologyInspector topology={topology} selection={selection} />
        </aside>
      </div>
    </div>
  );
}
