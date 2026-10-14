'use client';

import { ShieldAlert } from 'lucide-react';

import {
  CONTROL_STATE_LABELS,
  controlTopologyEdgeId,
  type ControlTopologySelection,
} from '../Code/controlTopologyProjection';
import type {
  CodeControlTopology,
  CodeControlTopologyTransition,
} from '../lib/codeObservatoryApi';

function TransitionRows({ transitions }: { transitions: CodeControlTopologyTransition[] }) {
  if (transitions.length === 0) {
    return <p className="px-3 py-4 text-xs text-slate-400">该状态没有已枚举的 FSM 转换。</p>;
  }

  return (
    <ul className="divide-y divide-slate-100 dark:divide-slate-800">
      {transitions.map((transition) => (
        <li key={transition.transition_id} className="space-y-1.5 px-3 py-3">
          <div className="flex items-start justify-between gap-2">
            <span className="min-w-0 break-all font-mono text-[10px] font-semibold text-slate-700 dark:text-slate-200">
              {transition.event}
            </span>
            <span className="shrink-0 rounded-full border border-slate-200 px-1.5 py-0.5 text-[9px] text-slate-500 dark:border-slate-700 dark:text-slate-400">
              {transition.owner}
            </span>
          </div>
          <p className="text-[10px] text-slate-500 dark:text-slate-400">
            {CONTROL_STATE_LABELS[transition.from_state] ?? transition.from_state}
            {' → '}
            {CONTROL_STATE_LABELS[transition.to_state] ?? transition.to_state}
          </p>
          <dl className="grid grid-cols-[64px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[9px]">
            <dt className="text-slate-400">Guard</dt>
            <dd className="break-all font-mono text-slate-600 dark:text-slate-300">{transition.guard_id ?? '无'}</dd>
            <dt className="text-slate-400">动作</dt>
            <dd className="break-all font-mono text-slate-600 dark:text-slate-300">{transition.action}</dd>
            <dt className="text-slate-400">规则</dt>
            <dd className="break-all font-mono text-slate-600 dark:text-slate-300">{transition.rule_id ?? '未登记'}</dd>
          </dl>
        </li>
      ))}
    </ul>
  );
}

function topologySelectionTitle(
  topology: CodeControlTopology,
  selection: ControlTopologySelection | null,
): { title: string; transitions: CodeControlTopologyTransition[]; note: string } {
  if (!selection) {
    return {
      title: '规则拓扑说明',
      transitions: [],
      note: '选择状态节点或连线查看源表中的规则明细。',
    };
  }

  if (selection.kind === 'state') {
    const state = topology.states.find((item) => item.state_id === selection.id);
    return {
      title: state ? CONTROL_STATE_LABELS[state.state_id] ?? state.state_id : selection.id,
      transitions: topology.transitions.filter(
        (item) => item.from_state === selection.id || item.to_state === selection.id,
      ),
      note: state?.terminal ? 'FSM 标记的终态。' : '相关入边和出边来自已注册 FSM 转换表。',
    };
  }

  const [fromState, toState] = selection.id.replace(/^fsm:/, '').split(/:(?=[^:]+$)/);
  const transitions = topology.transitions.filter(
    (item) => controlTopologyEdgeId(item.from_state, item.to_state) === selection.id,
  );
  return {
    title: `${CONTROL_STATE_LABELS[fromState ?? ''] ?? fromState ?? '未知'} → ${CONTROL_STATE_LABELS[toState ?? ''] ?? toState ?? '未知'}`,
    transitions,
    note: `${transitions.length} 条允许转换共用此连线；事件与 Guard 仍逐条列出。`,
  };
}

function sideEffectLabel(value: string): string {
  const labels: Record<string, string> = {
    none: '无副作用',
    idempotent: '幂等',
    compensatable: '可补偿',
    non_idempotent: '非幂等',
  };
  return labels[value] ?? '未知';
}

export function ControlTopologyInspector({
  topology,
  selection,
}: {
  topology: CodeControlTopology;
  selection: ControlTopologySelection | null;
}) {
  const detail = topologySelectionTitle(topology, selection);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      <section className="space-y-3 border-b border-slate-200 p-3 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-100">{detail.title}</h3>
          <span className="rounded-full border border-cyan-200 bg-cyan-50 px-2 py-0.5 text-[9px] font-medium text-cyan-700 dark:border-cyan-400/30 dark:bg-cyan-400/10 dark:text-cyan-200">
            只读规则
          </span>
        </div>
        <p className="text-[10px] leading-5 text-slate-500 dark:text-slate-400">{detail.note}</p>
        {selection && <TransitionRows transitions={detail.transitions} />}
      </section>

      <section className="space-y-2 border-b border-slate-200 p-3 dark:border-slate-700">
        <h3 className="text-[10px] font-semibold text-slate-700 dark:text-slate-200">版本与范围</h3>
        <dl className="grid grid-cols-[72px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[9px]">
          <dt className="text-slate-400">规则版本</dt>
          <dd className="text-amber-700 dark:text-amber-300">未记录 · 当前规则参考</dd>
          <dt className="text-slate-400">拓扑指纹</dt>
          <dd className="break-all font-mono text-slate-600 dark:text-slate-300" title={topology.topology_version}>
            {topology.topology_version}
          </dd>
          <dt className="text-slate-400">FSM</dt>
          <dd className="text-slate-600 dark:text-slate-300">{topology.states.length} 状态 · {topology.transitions.length} 转换</dd>
        </dl>
      </section>

      <section className="space-y-2 border-b border-slate-200 p-3 dark:border-slate-700">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-amber-800 dark:text-amber-200">
          <ShieldAlert size={12} aria-hidden="true" /> 未静态枚举区域
        </div>
        <ul className="space-y-2 text-[9px] leading-4 text-slate-500 dark:text-slate-400">
          {topology.dynamic_regions.map((region) => (
            <li key={region.region_id}>
              {region.region_id === 'agent_model_tool_routing'
                ? '模型与工具路线由运行时上下文决定，不在静态图中展开。'
                : '此处仅列注册的恢复路线元数据；路线是否适用于某 Run 由该 Run 的事实决定。'}
            </li>
          ))}
        </ul>
      </section>

      <section className="p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-[10px] font-semibold text-slate-700 dark:text-slate-200">已注册恢复路线</h3>
          <span className="text-[9px] text-slate-400">{topology.runtime_routes.length} 项</span>
        </div>
        <ol className="space-y-2">
          {topology.runtime_routes.map((route) => (
            <li key={route.route_id} className="rounded-lg border border-slate-200 px-2.5 py-2 dark:border-slate-700">
              <div className="flex items-start justify-between gap-2">
                <span className="break-all font-mono text-[9px] font-medium text-slate-700 dark:text-slate-200">{route.route_id}</span>
                <span className="shrink-0 text-[8px] text-slate-400">仲裁 {route.arbitration_order + 1}</span>
              </div>
              <p className="mt-1 break-all font-mono text-[8px] text-slate-500 dark:text-slate-400">
                {route.executor_id} · {route.lane_id}
              </p>
              <p className="mt-1 text-[8px] text-slate-400">副作用等级：{sideEffectLabel(route.side_effect_class)}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
