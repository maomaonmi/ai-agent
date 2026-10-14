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
import { Activity, AlertCircle, Clock3, RefreshCw, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import '@xyflow/react/dist/style.css';

import { projectCodeObservatoryEvents, type CodeObservatoryEvent, type CodeObservatoryStatus } from '../Code/codeObservatoryProjection';
import { replayCodeEvents, type CodeAgentRun, type CodeGenerationEvent } from '../lib/api';

const EVENT_LIMIT = 24;
const GRAPH_EVENT_LIMIT = 6;

type EventNode = Node<{ event: CodeObservatoryEvent }, 'observedEvent'>;

const STATUS_LABELS: Record<CodeObservatoryStatus, string> = {
  running: '进行中',
  scheduled: '已调度',
  passed: '通过',
  failed: '失败',
  blocked: '阻塞',
  completed: '已完成',
  unknown: '已记录',
};

const STATUS_TONES: Record<CodeObservatoryStatus, string> = {
  running: 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-200',
  scheduled: 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-400/30 dark:bg-violet-400/10 dark:text-violet-200',
  passed: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200',
  failed: 'border-red-200 bg-red-50 text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200',
  blocked: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200',
  completed: 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-600 dark:bg-slate-700/60 dark:text-slate-200',
  unknown: 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300',
};

const RUN_STATUS_LABELS: Record<string, string> = {
  running: '运行中',
  awaiting_runtime_verification: '等待验收',
  completed: '已完成',
  completed_unverified: '待验收',
  needs_attention: '需要处理',
  failed: '失败',
  superseded: '已被新运行替代',
};

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
      <div className="mt-1 font-mono text-[9px] text-slate-400">{formatEventTime(event.timestampMs)}</div>
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
  const [events, setEvents] = useState<CodeObservatoryEvent[]>([]);
  const [readState, setReadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [lastSequence, setLastSequence] = useState(0);
  const cursorRef = useRef(0);
  const runStatus = run.trace.status ?? (run.trace.isRunning ? 'running' : 'completed');
  const isRunActive = run.trace.isRunning;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let requestInFlight = false;
    const poll = async () => {
      if (requestInFlight || controller.signal.aborted) return;
      requestInFlight = true;
      try {
        const delivered = await replayCodeEvents(
          run.id,
          cursorRef.current,
          (event: CodeGenerationEvent) => {
            if (event.run_id !== run.id || typeof event.sequence !== 'number') return;
            const sequence = Math.trunc(event.sequence);
            if (!Number.isSafeInteger(sequence) || sequence <= 0) return;
            cursorRef.current = Math.max(cursorRef.current, sequence);
            setLastSequence((previous) => Math.max(previous, sequence));
            const safeEvent = projectCodeObservatoryEvents(run.id, [event], EVENT_LIMIT)[0];
            if (!safeEvent) return;
            setEvents((previous) => {
              if (previous.some((item) => item.sequence === safeEvent.sequence)) return previous;
              return [...previous, safeEvent]
                .sort((left, right) => left.sequence - right.sequence)
                .slice(-EVENT_LIMIT);
            });
          },
          controller.signal,
        );
        if (active && delivered >= 0) setReadState('ready');
      } catch {
        if (active && !controller.signal.aborted) setReadState('error');
      } finally {
        requestInFlight = false;
      }
    };

    void poll();
    const timer = isRunActive ? window.setInterval(() => void poll(), 1800) : undefined;
    return () => {
      active = false;
      controller.abort();
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [isRunActive, refreshVersion, run.id]);

  const runStatusLabel = RUN_STATUS_LABELS[runStatus] ?? '状态未知';
  const latestEvents = useMemo(() => [...events].reverse(), [events]);

  return (
    <div className="fixed inset-x-3 bottom-3 top-[72px] z-[100] flex justify-end md:inset-x-8 md:bottom-8 md:top-[76px]">
      <aside
        id="code-observatory-panel"
        aria-label="Code 链路观测面板"
        className="flex h-full w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
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
              isRunActive
                ? 'border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/30 dark:bg-sky-400/10 dark:text-sky-200'
                : 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
            }`}>
              Run {runStatusLabel}
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
              <Clock3 size={12} aria-hidden="true" /> 持久事件
            </div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-slate-800 dark:text-slate-100">{events.length}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-800/70">
            <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400">最新序号</div>
            <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-800 dark:text-slate-100">{lastSequence || '—'}</div>
          </div>
          <div className="col-span-2 flex items-center rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs text-slate-500 sm:col-span-1 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400">
            {isRunActive ? '每 1.8 秒从持久事件流续拉' : '历史 Run · 只读回放'}
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

          <section aria-labelledby="code-observatory-events-title" className="flex min-h-0 flex-col">
            <div className="mb-2 flex shrink-0 items-center justify-between gap-2">
              <h2 id="code-observatory-events-title" className="text-xs font-semibold text-slate-700 dark:text-slate-200">事件记录</h2>
              <span className="text-[10px] text-slate-400">显示最近 {EVENT_LIMIT} 条</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700">
              {readState === 'loading' && events.length === 0 ? (
                <div className="flex h-full items-center justify-center text-xs text-slate-400">正在读取持久事件…</div>
              ) : readState === 'error' && events.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center text-xs text-slate-500">
                  <AlertCircle size={18} className="text-amber-500" aria-hidden="true" />
                  无法读取事件。服务恢复后可点击刷新重试。
                </div>
              ) : latestEvents.length === 0 ? (
                <div className="flex h-full items-center justify-center px-4 text-center text-xs text-slate-400">
                  {readState === 'error' ? '事件读取暂时失败，请刷新重试。' : '该 Run 暂无持久事件。'}
                </div>
              ) : (
                <ol className="divide-y divide-slate-100 dark:divide-slate-800">
                  {latestEvents.map((event) => (
                    <li key={event.id} className="flex items-center gap-3 px-3 py-2.5">
                      <span className="w-11 shrink-0 font-mono text-[10px] tabular-nums text-slate-400">#{event.sequence}</span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium text-slate-700 dark:text-slate-200">{event.label}</div>
                        <time className="mt-0.5 block font-mono text-[9px] text-slate-400" dateTime={new Date(event.timestampMs).toISOString()}>
                          {formatEventTime(event.timestampMs)}
                        </time>
                      </div>
                      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[9px] ${STATUS_TONES[event.status]}`}>
                        {STATUS_LABELS[event.status]}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </section>
        </div>
        <footer aria-live="polite" className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200 px-5 py-2.5 text-[10px] text-slate-400 dark:border-slate-700">
          <span>{readState === 'error' ? '读取失败' : readState === 'loading' ? '正在同步' : '已与持久事件流同步'}</span>
          <span>run_id · sequence · timestamp_ms</span>
        </footer>
      </aside>
    </div>
  );
}
