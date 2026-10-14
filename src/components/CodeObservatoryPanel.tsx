'use client';

import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { Activity, AlertCircle, Clock3, Maximize2, Minimize2, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useReducer, useState } from 'react';
import '@xyflow/react/dist/style.css';

import { projectCodeObservatoryFeedEvents, type CodeObservatoryEvent, type CodeObservatoryStatus } from '../Code/codeObservatoryProjection';
import { createCodeObservatoryState, reduceCodeObservatoryState } from '../Code/codeObservatoryReducer';
import { runCodeObservatoryStream } from '../Code/codeObservatoryStream';
import type { CodeObservatoryConnection } from '../Code/codeObservatoryTypes';
import { DecisionInspector } from './DecisionInspector';
import { EvidenceInspector } from './EvidenceInspector';
import type { CodeAgentRun } from '../lib/api';
import { CodeObservatoryApiError, getCodeObservatorySnapshot, type CodeObservatoryErrorCode } from '../lib/codeObservatoryApi';

const EVENT_LIMIT = 24;
const GRAPH_EVENT_LIMIT = 6;
const DECISION_SOURCE_EVENT_TYPES = new Set([
  'control_plane_transition_batch',
  'stop_decision_recorded',
  'runtime_verification_result_committed',
]);
const EVIDENCE_SOURCE_TOOL_NAMES = new Set([
  'read_file',
  'targeted_read',
  'write_file',
  'patch_file',
  'patch_files',
]);

function requiresSnapshotRefresh(event: { event_type: string; tool_name?: string | null }): boolean {
  return DECISION_SOURCE_EVENT_TYPES.has(event.event_type)
    || (event.event_type === 'runtime_action_completed' && EVIDENCE_SOURCE_TOOL_NAMES.has(event.tool_name ?? ''));
}

type EventNode = Node<{ event: CodeObservatoryEvent }, 'observedEvent'>;

const STATUS_LABELS: Record<CodeObservatoryStatus, string> = {
  running: '进行中',
  scheduled: '已调度',
  passed: '通过',
  failed: '失败',
  blocked: '阻塞',
  completed: '已完成',
  verified: '验证通过',
  partially_verified: '部分验证',
  contradicted: '结论矛盾',
  assertion_failed: '断言失败',
  inconclusive: '验证不确定',
  unverifiable: '无法验证',
  invalid_test: '测试无效',
  infra_failure: '基础设施失败',
  cancelled: '已取消',
  unknown: '已记录',
};

const STATUS_TONES: Record<CodeObservatoryStatus, string> = {
  running: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-200',
  scheduled: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-400/30 dark:bg-violet-400/10 dark:text-violet-200',
  passed: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200',
  failed: 'border-red-200 bg-red-50 text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200',
  blocked: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200',
  completed: 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-700/60 dark:text-slate-200',
  verified: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200',
  partially_verified: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200',
  contradicted: 'border-red-200 bg-red-50 text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200',
  assertion_failed: 'border-red-200 bg-red-50 text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200',
  inconclusive: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200',
  unverifiable: 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
  invalid_test: 'border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-400/30 dark:bg-orange-400/10 dark:text-orange-200',
  infra_failure: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-400/30 dark:bg-violet-400/10 dark:text-violet-200',
  cancelled: 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
  unknown: 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

const EXECUTION_STATUS_LABELS: Record<string, string> = {
  queued: '已排队',
  running: '运行中',
  succeeded: '成功',
  failed: '失败',
  cancelled: '已取消',
  unknown: '未知',
};

const VERIFICATION_STATUS_LABELS: Record<string, string> = {
  verified: '通过',
  partially_verified: '部分通过',
  contradicted: '结论矛盾',
  assertion_failed: '断言失败',
  inconclusive: '不确定',
  unverifiable: '无法验证',
  invalid_test: '测试无效',
  infra_failure: '环境失败',
  unknown: '未知',
};

const OBSERVATION_STATUS_LABELS: Record<string, string> = {
  current: '当前',
  lagging: '滞后',
  incomplete: '不完整',
  unavailable: '不可用',
};

const CONNECTION_LABELS: Record<CodeObservatoryConnection, string> = {
  idle: '未连接',
  loading: '读取快照',
  connecting: '连接中',
  live: '实时同步',
  reconnecting: '正在重连',
  catching_up: '补齐事件',
  closed: '已关闭',
  error: '连接异常',
};

const SOURCE_ROLE_LABELS: Record<string, string> = {
  runtime_committed: '持久来源',
  transport_observed: '传输副本',
  provider_output: '模型输出',
  tool_receipt: '工具回执',
  report_projection: '报告投影',
  legacy_summary: '旧摘要',
  unknown: '来源未知',
};

const API_ERROR_LABELS: Record<CodeObservatoryErrorCode, string> = {
  NOT_FOUND: '该 Run 暂无后端持久事件。',
  FORBIDDEN: '当前会话没有读取该 Run 的权限。',
  CURSOR_INVALID: '观测游标无效，请重新获取快照。',
  CURSOR_EXPIRED: '观测历史已过期，请重新获取快照。',
  SOURCE_UNAVAILABLE: '源数据暂不可用。',
  PROJECTION_INCOMPLETE: '来源关联不完整，当前投影无法完整读取。',
  SCHEMA_UNSUPPORTED: '服务端观测版本暂不兼容。',
  EVIDENCE_NOT_FOUND: '当前 Run 中没有这条证据引用。',
  EVIDENCE_RETENTION_MISSING: '原始证据来源已清理，无法恢复预览。',
  EVIDENCE_PREVIEW_UNAVAILABLE: '该引用没有可安全预览的持久正文。',
  EVIDENCE_STALE: '证据属于旧候选版本，不能证明当前候选。',
  REQUEST_FAILED: '观测 API 请求失败。',
};

function sourceRoleLabel(value?: string): string {
  return value && Object.prototype.hasOwnProperty.call(SOURCE_ROLE_LABELS, value)
    ? SOURCE_ROLE_LABELS[value]
    : '来源未知';
}

function formatEventTime(timestampMs: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hour12: false,
  }).format(timestampMs);
}

function ObservedEventNode({ data }: NodeProps<EventNode>) {
  const { event } = data;
  return (
    <div className="w-[142px] rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !border-2 !border-white !bg-cyan-500 dark:!border-slate-900" />
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-slate-400">#{event.sequence}</span>
        <span className={`rounded-full px-1.5 py-0.5 text-[9px] ${STATUS_TONES[event.status]}`}>
          {STATUS_LABELS[event.status]}
        </span>
      </div>
      <div className="mt-1 truncate text-xs font-semibold text-slate-800 dark:text-slate-100">{event.label}</div>
      <div className="mt-1 truncate text-[9px] text-slate-400">{sourceRoleLabel(event.sourceRole)}</div>
      <div className="font-mono text-[9px] text-slate-400">{formatEventTime(event.timestampMs)}</div>
      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !border-2 !border-white !bg-cyan-500 dark:!border-slate-900" />
    </div>
  );
}

const NODE_TYPES = { observedEvent: ObservedEventNode };

function ObservedEventGraph({ events }: { events: CodeObservatoryEvent[] }) {
  const graphEvents = events.slice(-GRAPH_EVENT_LIMIT);
  const nodes = useMemo<EventNode[]>(() => graphEvents.map((event, index) => ({
    id: event.id,
    type: 'observedEvent',
    position: { x: index * 174, y: 42 },
    data: { event },
    draggable: false,
  })), [graphEvents]);
  const edges = useMemo<Edge[]>(() => graphEvents.slice(1).map((event, index) => ({
    id: `sequence:${graphEvents[index]?.sequence}:${event.sequence}`,
    source: graphEvents[index]?.id ?? '',
    target: event.id,
    type: 'smoothstep',
    animated: false,
    style: { stroke: '#94a3b8', strokeWidth: 1.5 },
  })), [graphEvents]);

  if (graphEvents.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-slate-300 text-xs text-slate-400 dark:border-slate-700">
        收到持久事件后，这里会按服务端序号展示时序。
      </div>
    );
  }

  return (
    <div className="visual-workflow-canvas h-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.16, maxZoom: 1 }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        panOnDrag
        zoomOnScroll={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#94a3b8" gap={20} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

export function CodeObservatoryLauncher({ run }: { run?: CodeAgentRun }) {
  const [isOpen, setIsOpen] = useState(false);
  const close = useCallback(() => setIsOpen(false), []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [close, isOpen]);

  return (
    <>
      <button
        type="button"
        disabled={!run}
        aria-expanded={isOpen}
        aria-controls="code-observatory-panel"
        onClick={() => setIsOpen((open) => !open)}
        className={`flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 disabled:cursor-not-allowed disabled:opacity-50 ${
          isOpen
            ? 'border-cyan-600 bg-cyan-600 text-white'
            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
        }`}
        title={run ? `查看运行 ${run.id} 的链路事件` : '当前会话还没有 Agent 运行记录'}
      >
        <Activity size={14} aria-hidden="true" />
        链路观测
      </button>
      {isOpen && run && (
        <CodeObservatoryPanel key={run.id} run={run} onClose={close} />
      )}
    </>
  );
}

function CodeObservatoryPanel({ run, onClose }: { run: CodeAgentRun; onClose: () => void }) {
  const [state, dispatch] = useReducer(
    reduceCodeObservatoryState,
    run.id,
    createCodeObservatoryState,
  );
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [inspectorTab, setInspectorTab] = useState<'events' | 'decisions' | 'evidence'>('events');
  const events = useMemo(
    () => projectCodeObservatoryFeedEvents(run.id, state.events, EVENT_LIMIT),
    [run.id, state.events],
  );
  const lastSequence = state.observationOffset;
  const executionStatus = state.status?.execution ?? 'unknown';
  const verificationStatus = state.status?.verification ?? 'unknown';
  const observationStatus = state.status?.observation ?? 'incomplete';

  useEffect(() => {
    const controller = new AbortController();
    dispatch({ type: 'snapshot_loading' });
    const connect = async () => {
      try {
        const snapshot = await getCodeObservatorySnapshot(run.id, controller.signal);
        if (controller.signal.aborted) return;
        dispatch({ type: 'snapshot_received', snapshot });
        await runCodeObservatoryStream(
          run.id,
          snapshot.projection_version,
          snapshot.cursor,
          snapshot.head_offset,
          {
            onConnection: (connection) => dispatch({ type: 'connection_changed', connection }),
            onGap: (targetOffset) => dispatch({ type: 'gap_detected', targetOffset }),
            onCatchupPage: (page, requestedAfterOffset) => {
              dispatch({ type: 'catchup_page_received', page, requestedAfterOffset });
              if (page.events.some(requiresSnapshotRefresh)) {
                setRefreshVersion((version) => version + 1);
              }
            },
            onObservation: (event, cursor) => {
              dispatch({ type: 'observation_received', event, cursor });
              if (requiresSnapshotRefresh(event)) {
                setRefreshVersion((version) => version + 1);
              }
            },
            onHeartbeat: (heartbeat) => dispatch({ type: 'heartbeat_received', heartbeat }),
            onError: (code) => dispatch({ type: 'stream_error', code }),
            onResyncRequired: (code) => {
              if (code === 'CURSOR_EXPIRED' || code === 'CURSOR_INVALID') {
                setRefreshVersion((version) => version + 1);
              }
            },
          },
          controller.signal,
        );
      } catch (error) {
        if (!controller.signal.aborted) {
          dispatch({
            type: 'snapshot_error',
            code: error instanceof CodeObservatoryApiError ? error.code : 'REQUEST_FAILED',
          });
        }
      }
    };

    void connect();
    return () => {
      controller.abort();
    };
  }, [refreshVersion, run.id]);

  const latestEvents = useMemo(() => [...events].reverse(), [events]);
  const connectionMessage = state.connectionError
    ? API_ERROR_LABELS[state.connectionError]
    : state.gapTargetOffset !== null
      ? `正在补齐观测序号 ${state.observationOffset + 1}–${state.gapTargetOffset}`
      : CONNECTION_LABELS[state.connection];
  const eventPanelContent = (state.connection === 'loading' || state.connection === 'idle') && events.length === 0 ? (
    <div className="flex h-full items-center justify-center text-xs text-slate-400">正在读取持久事件…</div>
  ) : state.connection === 'error' && events.length === 0 ? (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-xs text-slate-500">
      <AlertCircle size={18} className="text-amber-500" aria-hidden="true" />
      {API_ERROR_LABELS[state.connectionError ?? 'REQUEST_FAILED']} 可点击重新同步。
    </div>
  ) : latestEvents.length === 0 ? (
    <div className="flex h-full items-center justify-center px-4 text-center text-xs text-slate-400">
      {state.connection === 'error'
        ? `${API_ERROR_LABELS[state.connectionError ?? 'REQUEST_FAILED']} 请重新同步。`
        : '后端尚无可用持久事件；面板不会用前端状态推测结果。'}
    </div>
  ) : (
    <ol className="divide-y divide-slate-100 dark:divide-slate-800">
      {latestEvents.map((event) => (
        <li key={event.id} className="flex items-center gap-3 px-3 py-2.5">
          <span className="w-11 shrink-0 font-mono text-[10px] tabular-nums text-slate-400">#{event.sequence}</span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">{event.label}</div>
            <time className="mt-0.5 block font-mono text-[9px] text-slate-400" dateTime={new Date(event.timestampMs).toISOString()}>
              {formatEventTime(event.timestampMs)} · {sourceRoleLabel(event.sourceRole)}
            </time>
          </div>
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] ${STATUS_TONES[event.status]}`}>
            {STATUS_LABELS[event.status]}
          </span>
        </li>
      ))}
    </ol>
  );

  return (
    <div className={isFullscreen
      ? 'fixed inset-0 z-[100] flex'
      : 'fixed inset-x-3 bottom-3 top-[72px] z-[100] flex justify-end md:inset-x-8 md:bottom-8 md:top-[76px]'}>
      <aside
        id="code-observatory-panel"
        aria-label="Code 链路观测面板"
        className={`flex h-full w-full flex-col overflow-hidden border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 ${
          isFullscreen ? 'max-w-none rounded-none' : 'max-w-5xl rounded-2xl'
        }`}
      >
        <header className="flex shrink-0 items-center justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
              <Activity size={16} className="text-cyan-600 dark:text-cyan-300" aria-hidden="true" />
              Code 链路观测
            </div>
            <div className="mt-1 truncate font-mono text-[11px] text-slate-500" title={run.id}>
              Run {run.id}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${
              executionStatus === 'running'
                ? 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-200'
                : executionStatus === 'failed'
                  ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200'
                : 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
            }`}>
              执行 · {EXECUTION_STATUS_LABELS[executionStatus] ?? '未知'}
            </span>
            <button
              type="button"
              onClick={() => setRefreshVersion((version) => version + 1)}
              aria-label="刷新持久事件"
              title="刷新持久事件"
              className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <RefreshCw size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => setIsFullscreen((fullscreen) => !fullscreen)}
              aria-pressed={isFullscreen}
              aria-label={isFullscreen ? '退出链路面板全屏' : '全屏显示链路面板'}
              title={isFullscreen ? '退出全屏' : '全屏显示'}
              className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              {isFullscreen
                ? <Minimize2 size={14} aria-hidden="true" />
                : <Maximize2 size={14} aria-hidden="true" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭链路观测面板"
              className="rounded-lg border border-slate-200 p-2 text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="grid shrink-0 grid-cols-2 gap-3 border-b border-slate-200 p-4 sm:grid-cols-3 dark:border-slate-700">
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800/70">
            <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-slate-400">
              <Clock3 size={12} aria-hidden="true" /> 显示事件
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-slate-800 dark:text-slate-100">{events.length}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800/70">
            <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">最新观测序号</div>
            <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-800 dark:text-slate-100">{lastSequence || '—'}</div>
          </div>
          <div className="col-span-2 grid grid-cols-2 gap-x-3 gap-y-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-[10px] text-slate-600 sm:col-span-1 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300">
            <span>验证 · {VERIFICATION_STATUS_LABELS[verificationStatus] ?? '未知'}</span>
            <span>观测 · {OBSERVATION_STATUS_LABELS[observationStatus] ?? '未知'}</span>
            <span className="col-span-2 text-slate-400" aria-live="polite">
              连接 · {CONNECTION_LABELS[state.connection]}
            </span>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-rows-[minmax(190px,0.9fr)_minmax(190px,1.1fr)] gap-4 p-4 lg:grid-cols-[minmax(0,1.45fr)_minmax(260px,0.8fr)] lg:grid-rows-1">
          <section aria-labelledby="code-observatory-flow-title" className="flex min-h-0 flex-col">
            <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
              <h2 id="code-observatory-flow-title" className="text-xs font-semibold text-slate-700 dark:text-slate-200">事件时序</h2>
              <span className="text-[10px] text-slate-400">连线仅表示序号先后，不代表因果</span>
            </div>
            <div className="min-h-0 flex-1">
              <ObservedEventGraph events={events} />
            </div>
          </section>

          <section aria-label="事件记录与决策检查" className="flex min-h-0 flex-col">
            <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
              <div role="group" aria-label="观测详情" className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
                <button
                  type="button"
                  aria-pressed={inspectorTab === 'events'}
                  aria-controls="code-observatory-inspector-panel"
                  onClick={() => setInspectorTab('events')}
                  className={`rounded-md px-2 py-1 text-[10px] font-medium ${inspectorTab === 'events' ? 'bg-white text-slate-800 shadow-sm dark:bg-slate-700 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}`}
                >事件记录 · {events.length}</button>
                <button
                  type="button"
                  aria-pressed={inspectorTab === 'decisions'}
                  aria-controls="code-observatory-inspector-panel"
                  onClick={() => setInspectorTab('decisions')}
                  className={`rounded-md px-2 py-1 text-[10px] font-medium ${inspectorTab === 'decisions' ? 'bg-white text-slate-800 shadow-sm dark:bg-slate-700 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}`}
                >决策检查 · {state.decisions.length}</button>
                <button
                  type="button"
                  aria-pressed={inspectorTab === 'evidence'}
                  aria-controls="code-observatory-inspector-panel"
                  onClick={() => setInspectorTab('evidence')}
                  className={`rounded-md px-2 py-1 text-[10px] font-medium ${inspectorTab === 'evidence' ? 'bg-white text-slate-800 shadow-sm dark:bg-slate-700 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}`}
                >证据检查 · {state.evidence.length}</button>
              </div>
              <span className="text-[10px] text-slate-400">{inspectorTab === 'events' ? `最近 ${EVENT_LIMIT} 条` : '只读 · 来源事实'}</span>
            </div>
            <div
              id="code-observatory-inspector-panel"
              aria-live="polite"
              className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700"
            >
              {inspectorTab === 'decisions' ? (
                <DecisionInspector decisions={state.decisions} />
              ) : inspectorTab === 'evidence' ? (
                <EvidenceInspector key={run.id} runId={run.id} evidence={state.evidence} />
              ) : eventPanelContent}
            </div>
          </section>
        </div>
        <footer aria-live="polite" className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 px-5 py-2.5 text-[10px] text-slate-400 dark:border-slate-700">
          <span>{state.connection === 'error'
            ? `${API_ERROR_LABELS[state.connectionError ?? 'REQUEST_FAILED']}${state.events.length > 0 ? '，保留当前可信数据' : '，请重新同步'}`
            : state.connection === 'loading' ? '正在读取后端投影'
              : state.connection === 'catching_up' ? connectionMessage
                : state.connection === 'reconnecting' ? '连接中断，正在自动重连；已保留当前数据'
                  : state.connection === 'connecting' ? '正在连接后端事件流'
                    : state.connection === 'live' ? '已连接，正在接收后端观测事件'
                      : '等待后端观测投影'}</span>
          <span>run_id · projection_version · observation_offset</span>
        </footer>
      </aside>
    </div>
  );
}
