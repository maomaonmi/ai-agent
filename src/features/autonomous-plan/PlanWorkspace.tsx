'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, ChevronDown, Circle, Clipboard, Download, Expand, FileText, ListTree, Loader2, Maximize2, Minimize2, PanelRightClose, Search as SearchIcon, Workflow, X } from 'lucide-react';
import { createPlanFigureJob, getPlanFigureJob, retryPlanFigure, type PlanFigure, type PlanProgressEvent, type PlanFigureJob, type PlanSearchResult } from '../../lib/api';
import MarkdownMessage from '../../components/MarkdownMessage';
import TaskOutputDialog from '../../components/TaskOutputDialog';
import PlanReportDocument from './PlanReportDocument';
import PlanFlowCanvas from './PlanFlowCanvas';
import PlanFlowInspector from './PlanFlowInspector';
import { agentDisplayName } from './planFlowGraph';
import { adaptPlanReport } from './planReportAdapter';

interface PlanWorkspaceProps {
  progress?: PlanProgressEvent | null;
  report: string;
  figures?: PlanFigure[];
  loading?: boolean;
  distributed?: boolean;
  sidebarCollapsed: boolean;
  sessionId?: string;
  onWidthChange?: (width: number) => void;
  onFiguresChange?: (figures: PlanFigure[]) => void;
}

const PREF_KEY = 'autonomous-plan-workspace-preferences-v1';
const FLOW_PREF_KEY = 'autonomous-plan-flow-collapsed-v1';
const MIN_WIDTH = 520;
const FIGURE_TIMEOUT_MS = 30_000;

function usableJobId(jobId?: string | null): jobId is string {
  return Boolean(jobId && jobId !== 'pending' && !jobId.startsWith('placeholder-'));
}

function createFigurePlaceholders(report: string, requestKey: string): PlanFigure[] {
  const count = figureCountForReport(report);
  return Array.from({ length: count }, (_, index) => ({
    id: `placeholder-${requestKey}-${index}`,
    job_id: 'pending',
    ordinal: index,
    section_title: `报告章节 ${index + 1}`,
    caption: `任务报告配图 ${index + 1}`,
    status: 'queued' as const,
  }));
}

function figureCountForReport(report: string): number {
  return Math.max(2, Math.min(10, Math.ceil(report.length / 1800)));
}

function extractSourceUrls(report: string, tasks: PlanProgressEvent['tasks'] = []): string[] {
  const taskUrls = tasks.flatMap((task) => task.source_urls || []);
  const urls = [...report.matchAll(/(?:\]\(|\b)(https:\/\/[^\s)\]}>]+)/gi)]
    .map((match) => match[1].replace(/[.,;，。；]+$/, ''))
    .filter((url) => !/localhost|127\.0\.0\.1/i.test(url));
  return [...new Set([...taskUrls, ...urls])].slice(0, 24);
}

function restoreWidth(sessionId?: string) {
  try {
    const all = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') as Record<string, number>;
    return Number.isFinite(all[sessionId || 'draft']) ? all[sessionId || 'draft'] : undefined;
  } catch { return undefined; }
}

function saveWidth(sessionId: string | undefined, width: number) {
  try {
    const all = JSON.parse(localStorage.getItem(PREF_KEY) || '{}') as Record<string, number>;
    all[sessionId || 'draft'] = width;
    localStorage.setItem(PREF_KEY, JSON.stringify(all));
  } catch { /* preference storage is best effort */ }
}

/* Why 状态图标用 lucide 替代 emoji：报告与任务面板需要统一的视觉语言，
   ✅⚠️⏳ 在深浅主题下都显得随意且不可控。 */
function taskStatusIcon(status: string | undefined, size = 16) {
  switch (status) {
    case 'completed': return <CheckCircle2 size={size} className="text-emerald-500" />;
    case 'failed': return <AlertTriangle size={size} className="text-amber-500" />;
    case 'in_progress': return <Loader2 size={size} className="animate-spin text-sky-500 dark:text-cyan-400" />;
    default: return <Circle size={size} className="text-slate-300 dark:text-slate-600" />;
  }
}

export default function PlanWorkspace({ progress, report, figures = [], loading, distributed, sidebarCollapsed, sessionId, onWidthChange, onFiguresChange }: PlanWorkspaceProps) {
  const [width, setWidth] = useState<number>();
  const [tab, setTab] = useState<'tasks' | 'report'>('tasks');
  const [fullscreen, setFullscreen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState<{ title: string; content: string } | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<number>();
  const [displayedReport, setDisplayedReport] = useState('');
  const [displayedTaskResult, setDisplayedTaskResult] = useState('');
  const [figuresSlow, setFiguresSlow] = useState(false);
  const [flowCollapsed, setFlowCollapsed] = useState(false);
  const [flowExpanded, setFlowExpanded] = useState(false);
  const [inspectorNodeId, setInspectorNodeId] = useState<string | null>(null);
  const figureRequestKey = useRef('');
  const activeFigureJobIdRef = useRef<string | null>(null);
  const figuresRef = useRef(figures);
  const onFiguresChangeRef = useRef(onFiguresChange);
  const retryingFigures = useRef(new Set<string>());
  figuresRef.current = figures;
  onFiguresChangeRef.current = onFiguresChange;
  // ---- 增量打字机（用户硬约束：模型输出必须流式逐字出现，不能整块跳）----
  // Why 不能 setDisplayedXxx(full) 完整替换：后端每块 delta（64 字符/块）到达
  // 时若整体重打会闪烁卡顿（此前注释），若直接显示完整串则无打字机效果。
  // 这里维护"已显示长度"，每次只逐字 reveal 新到达的部分；loading 结束
  // （历史恢复/完成态）直接显示完整内容，避免几千字慢慢打。
  const reportShownRef = useRef(0);
  const taskResultShownRef = useRef(0);
  const reportTimerRef = useRef<number | null>(null);
  const taskResultTimerRef = useRef<number | null>(null);
  const lastTaskIdRef = useRef<number | undefined>(undefined);

  const scheduleReveal = (
    full: string,
    shownRef: { current: number },
    timerRef: { current: number | null },
    setter: (value: string) => void,
    live: boolean,
  ) => {
    const target = full || '';
    const current = shownRef.current;
    if (!live) {
      if (timerRef.current != null) { window.clearInterval(timerRef.current); timerRef.current = null; }
      if (target.length !== current) { shownRef.current = target.length; setter(target); }
      return;
    }
    if (target.length <= current) {
      if (target.length < current) { shownRef.current = target.length; setter(target); }
      if (timerRef.current != null) { window.clearInterval(timerRef.current); timerRef.current = null; }
      return;
    }
    if (timerRef.current != null) return; // 已有 reveal 在跑，新内容追加进同一目标
    timerRef.current = window.setInterval(() => {
      const targetLen = target.length;
      const shownLen = shownRef.current;
      if (shownLen >= targetLen) {
        if (timerRef.current != null) { window.clearInterval(timerRef.current); timerRef.current = null; }
        return;
      }
      const step = Math.min(3, targetLen - shownLen);
      shownRef.current = shownLen + step;
      setter(target.slice(0, shownLen + step));
    }, 12);
  };

  useEffect(() => {
    scheduleReveal(report || '', reportShownRef, reportTimerRef, setDisplayedReport, Boolean(loading));
  }, [report, loading]);

  const selectedTaskForTyping = (progress?.tasks || []).find((task) => task.id === selectedTaskId) || progress?.tasks?.[0];
  useEffect(() => {
    const result = selectedTaskForTyping?.result || selectedTaskForTyping?.streaming_result || selectedTaskForTyping?.error || '';
    // 切换任务时从零开始 reveal；同一任务流式增长时延续已显示长度
    if (selectedTaskForTyping?.id !== lastTaskIdRef.current) {
      lastTaskIdRef.current = selectedTaskForTyping?.id;
      taskResultShownRef.current = 0;
    }
    scheduleReveal(result, taskResultShownRef, taskResultTimerRef, setDisplayedTaskResult, Boolean(loading));
  }, [selectedTaskForTyping?.id, selectedTaskForTyping?.result, selectedTaskForTyping?.streaming_result, selectedTaskForTyping?.error, loading]);

  useEffect(() => () => {
    if (reportTimerRef.current != null) window.clearInterval(reportTimerRef.current);
    if (taskResultTimerRef.current != null) window.clearInterval(taskResultTimerRef.current);
  }, []);
  const reportDocument = useMemo(() => adaptPlanReport(displayedReport, figures, progress), [displayedReport, figures, progress]);
  useEffect(() => {
    const available = window.innerWidth - (sidebarCollapsed ? 56 : 288);
    const restored = restoreWidth(sessionId);
    const next = Math.min(Math.max(restored ?? available * 0.52, MIN_WIDTH), Math.max(MIN_WIDTH, available * 0.75));
    setWidth(next); onWidthChange?.(next);
  }, [onWidthChange, sessionId, sidebarCollapsed]);
  // 流程图折叠偏好：仅挂载后读取 localStorage，避免 SSR 首帧与客户端渲染不一致。
  useEffect(() => {
    try { setFlowCollapsed(window.localStorage.getItem(FLOW_PREF_KEY) === '1'); } catch { /* preference storage is best effort */ }
  }, []);
  // 全屏流程图支持 Esc 退出
  useEffect(() => {
    if (!flowExpanded) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setFlowExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flowExpanded]);
  const toggleFlow = () => setFlowCollapsed((value) => {
    const next = !value;
    try { window.localStorage.setItem(FLOW_PREF_KEY, next ? '1' : '0'); } catch { /* preference storage is best effort */ }
    return next;
  });
  const inspectorTask = useMemo(() => {
    if (!inspectorNodeId?.startsWith('task-')) return null;
    const taskId = Number(inspectorNodeId.slice(5));
    return (progress?.tasks || []).find((task) => task.id === taskId) || null;
  }, [inspectorNodeId, progress]);
  const openTaskInList = (taskId: number) => {
    setTab('tasks');
    setSelectedTaskId(taskId);
    setInspectorNodeId(null);
  };
  useEffect(() => {
    const currentFigures = figuresRef.current;
    const allImagesReady = currentFigures.length > 0 && currentFigures.every((figure) => figure.status === 'succeeded' && Boolean(figure.image_url));
    // loading=true 时不创建配图任务（报告还在流式变化，key 不稳定会反复建任务）。
    if (loading || !sessionId || report.trim().length < 80 || allImagesReady || !onFiguresChangeRef.current) return;
    // key 只取报告前 96 字 + 会话，不用 report.length：流式中长度持续变化会导致
    // key 反复变 → 反复建任务；报告内容稳定后 key 自然稳定。
    const key = `${sessionId || 'draft'}:${report.slice(0, 96)}`;
    // Why 不能直接 return：上一轮 effect 因 loading 翻转被 cleanup（cancelled=true）
    // 杀掉了 poll 定时器，若此处 return 则配图永远卡在"正在生成配图…"。
    // 正确做法：key 相同但图未就绪时，用 activeFigureJobIdRef 恢复轮询。
    if (figureRequestKey.current === key) {
      const pendingJobId = activeFigureJobIdRef.current;
      if (!pendingJobId) return;
      const hasPending = currentFigures.some((figure) => figure.status === 'queued' || figure.status === 'generating' || figure.status === 'processing');
      if (!hasPending) return;
      let cancelled = false;
      let pollTimer: number | undefined;
      const poll = async (jobId: string): Promise<void> => {
        if (cancelled) return;
        try {
          // Why 不做本地超时判死：后端 job 终态（succeeded/failed/cancelled）
          // 是配图状态的唯一真相。多张图并发 2 + 来源页抓取很容易超过本地
          // 任意固定秒数，本地判死会把后端实际成功的结果覆盖成 failed。
          const job = await getPlanFigureJob(jobId);
          if ((job.figures || []).length) onFiguresChangeRef.current?.(job.figures || []);
          if (job.status === 'queued' || job.status === 'generating') {
            pollTimer = window.setTimeout(() => void poll(jobId), 1800);
          }
        } catch {
          if (!cancelled) pollTimer = window.setTimeout(() => void poll(jobId), 1800);
        }
      };
      void poll(pendingJobId);
      return () => { cancelled = true; if (pollTimer) window.clearTimeout(pollTimer); };
    }
    figureRequestKey.current = key;
    activeFigureJobIdRef.current = null;
    const sourceUrls = extractSourceUrls(report, progress?.tasks || []);
    let cancelled = false;
    let pollTimer: number | undefined;
    const placeholders = currentFigures.length > 0
      ? currentFigures.map((figure) => figure.status === 'succeeded' && figure.image_url ? figure : { ...figure, job_id: 'pending', status: 'queued' as const, image_url: undefined })
      : createFigurePlaceholders(report, key);
    onFiguresChangeRef.current(placeholders);
    const sync = async () => {
      try {
        const existingJobId = figuresRef.current[0]?.job_id;
        let job: PlanFigureJob;
        if (usableJobId(existingJobId)) {
          try {
            job = await getPlanFigureJob(existingJobId);
          } catch (error) {
            if (!(error instanceof Error && (error.message.includes('404') || error.message.includes('不存在')))) throw error;
            job = await createPlanFigureJob({ session_id: sessionId, report_version: key, report, max_images: figureCountForReport(report), policy: 'economy', context_mode: 'mixed', source_urls: sourceUrls });
          }
        } else {
          job = await createPlanFigureJob({ session_id: sessionId, report_version: key, report, max_images: figureCountForReport(report), policy: 'economy', context_mode: 'mixed', source_urls: sourceUrls });
        }
        if (cancelled) return;
        activeFigureJobIdRef.current = job.id;
        const update = (next: PlanFigureJob) => {
          // 直接采用后端返回的图状态：本地不再覆盖判死（唯一真相在后端 job）。
          const nextFigures = next.figures || [];
          const durableFigures = nextFigures.length
            ? nextFigures
            : figuresRef.current.map((figure) => ({ ...figure, job_id: next.id, status: 'queued' as const }));
          if (durableFigures.length) onFiguresChangeRef.current?.(durableFigures);
          if (next.status === 'queued' || next.status === 'generating') pollTimer = window.setTimeout(() => void poll(next.id), 1800);
        };
        const poll = async (jobId: string): Promise<void> => {
          if (cancelled) return;
          try { update(await getPlanFigureJob(jobId)); } catch { if (!cancelled) pollTimer = window.setTimeout(() => void poll(jobId), 1800); }
        };
        update(job);
      } catch {
        if (!cancelled) onFiguresChangeRef.current?.(placeholders.map((figure) => ({ ...figure, status: 'failed' as const, error_message: '配图任务暂时不可用' })));
      }
    };
    void sync();
    return () => { cancelled = true; if (pollTimer) window.clearTimeout(pollTimer); };
  }, [loading, report, sessionId]);
  const handleRetryFigure = (figureId: string) => {
    const current = figuresRef.current.find((figure) => figure.id === figureId);
    if (!current || retryingFigures.current.has(figureId)) return;
    retryingFigures.current.add(figureId);
    onFiguresChangeRef.current?.(figuresRef.current.map((figure) => figure.id === figureId
      ? { ...figure, status: 'queued' as const, image_url: undefined, error_message: '正在重新生成图片…' }
      : figure));
    let cancelled = false;
    let timer: number | undefined;
    const finish = (nextFigures: PlanFigure[]) => {
      if (cancelled || !nextFigures.length) return;
      const targetOrdinal = current.ordinal;
      const replacement = targetOrdinal == null ? nextFigures[0] : nextFigures.find((figure) => figure.ordinal === targetOrdinal) || nextFigures[0];
      onFiguresChangeRef.current?.(figuresRef.current.map((figure) => figure.id === figureId ? { ...replacement, id: figureId } : figure));
    };
    const poll = async (jobId: string): Promise<void> => {
      if (cancelled) return;
      try {
        const job = await getPlanFigureJob(jobId);
        finish(job.figures || []);
        if (job.status === 'queued' || job.status === 'generating') timer = window.setTimeout(() => void poll(jobId), 1800);
        else { retryingFigures.current.delete(figureId); window.clearTimeout(timeout); }
      } catch {
        if (!cancelled) timer = window.setTimeout(() => void poll(jobId), 1800);
      }
    };
    const timeout = window.setTimeout(() => {
      cancelled = true;
      retryingFigures.current.delete(figureId);
      onFiguresChangeRef.current?.(figuresRef.current.map((figure) => figure.id === figureId ? { ...figure, status: 'failed' as const, image_url: undefined, error_message: '重试超过 30 秒，可再次点击重试' } : figure));
      if (timer) window.clearTimeout(timer);
    }, FIGURE_TIMEOUT_MS);
    const request = usableJobId(current.id)
      ? retryPlanFigure(current.id)
      : createPlanFigureJob({ session_id: sessionId, report_version: `plan-retry-${report.length}`, report, max_images: figureCountForReport(report), policy: 'economy', context_mode: 'mixed', source_urls: extractSourceUrls(report, progress?.tasks || []) });
    void request.then((job) => poll(job.id)).catch(() => {
      window.clearTimeout(timeout);
      retryingFigures.current.delete(figureId);
      onFiguresChangeRef.current?.(figuresRef.current.map((figure) => figure.id === figureId ? { ...figure, status: 'failed' as const, error_message: '图片重新生成失败' } : figure));
    });
  };
  const resize = (event: React.PointerEvent<HTMLDivElement>) => {
    const startX = event.clientX;
    const startWidth = width || 640;
    const move = (moveEvent: PointerEvent) => {
      const next = Math.min(Math.max(startWidth + startX - moveEvent.clientX, MIN_WIDTH), window.innerWidth * 0.8);
      setWidth(next); onWidthChange?.(next); saveWidth(sessionId, next);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const copyReport = async () => { await navigator.clipboard?.writeText(report); setCopied(true); window.setTimeout(() => setCopied(false), 1500); };
  const downloadReport = () => { const blob = new Blob([report], { type: 'text/markdown;charset=utf-8' }); const url = URL.createObjectURL(blob); const link = window.document.createElement('a'); link.href = url; link.download = `${reportDocument.title}.md`; link.click(); URL.revokeObjectURL(url); };
  // Runtime task deltas are kept separate from the durable result on the
  // message, but the workspace can render them through the same result path.
  const tasks = (progress?.tasks || []).map((task) => ({
    ...task,
    result: task.result ?? task.streaming_result ?? null,
  }));
  useEffect(() => {
    if (tasks.length === 0) {
      setSelectedTaskId(undefined);
      return;
    }
    if (!selectedTaskId || !tasks.some((task) => task.id === selectedTaskId)) {
      setSelectedTaskId(tasks[0].id);
    }
  }, [selectedTaskId, tasks]);
  const selectedTask = tasks.find((task) => task.id === selectedTaskId) || tasks[0];
  const taskSearchResults: PlanSearchResult[] = selectedTask?.search_results || [];
  // Why 软提示而非硬判死：后端多张图并发 2 + 来源页抓取时整体耗时不可预估，
  // 45 秒只提示"仍在生成"，状态真相始终以后端 job 终态为准。
  const hasPendingFigures = figures.some((figure) => figure.status === 'queued' || figure.status === 'generating' || figure.status === 'processing');
  useEffect(() => {
    if (!hasPendingFigures) { setFiguresSlow(false); return; }
    const timer = window.setTimeout(() => setFiguresSlow(true), 45_000);
    return () => window.clearTimeout(timer);
  }, [hasPendingFigures]);
  const settled = tasks.filter((task) => task.status === 'completed' || task.status === 'failed').length;
  const paneStyle = width ? { width: `${width}px` } : undefined;
  if (!progress && !report) return null;
  return (
    <aside
      data-plan-workspace
      aria-label="自主任务规划工作区"
      className={`fixed inset-y-0 right-0 z-40 flex border-l border-slate-200/70 bg-white shadow-[0_0_48px_-16px_rgba(15,23,42,0.18)] dark:border-white/10 dark:bg-[#0d1420] dark:shadow-[0_0_48px_-12px_rgba(0,0,0,0.65)] ${fullscreen ? 'left-0' : ''}`}
      style={fullscreen ? { width: '100%' } : paneStyle}
    >
      <div role="separator" aria-label="调整自主规划面板宽度" onPointerDown={resize} className="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize hover:bg-blue-400 dark:hover:bg-cyan-400" />
      <div className="relative flex min-w-0 flex-1 flex-col">
        <header className="border-b border-slate-200/80 bg-white px-6 py-4 dark:border-white/10 dark:bg-[#0d1420]">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] font-semibold tracking-[0.24em] text-cyan-700 dark:text-cyan-400">TASK COLLABORATION</p>
              <h2 className="mt-1.5 text-lg font-semibold tracking-tight text-slate-900 dark:text-slate-100">{distributed ? '多智能体任务协作' : '自主任务规划'}</h2>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={copyReport} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/[0.06]" title="复制报告" aria-label="复制报告">{copied ? <Check size={17} /> : <Clipboard size={17} />}</button>
              <button type="button" onClick={downloadReport} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/[0.06]" title="下载报告" aria-label="下载报告"><Download size={17} /></button>
              <button type="button" onClick={() => setFullscreen((value) => !value)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/[0.06]" title="全屏查看" aria-label="全屏查看">{fullscreen ? <X size={17} /> : <Expand size={17} />}</button>
              <button type="button" onClick={() => setTab(tab === 'tasks' ? 'report' : 'tasks')} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-white/[0.06]" title="切换目录与搜索结果" aria-label="切换目录与搜索结果"><PanelRightClose size={17} /></button>
            </div>
          </div>
          <nav className="mt-4 flex gap-1 rounded-xl border border-slate-200/80 bg-slate-50/60 p-1 dark:border-white/10 dark:bg-white/[0.04]">
            <button type="button" onClick={() => setTab('tasks')} className={`flex flex-1 items-center justify-center rounded-lg px-3 py-2 text-sm transition ${tab === 'tasks' ? 'bg-white font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200 dark:bg-white/10 dark:text-white dark:ring-white/10' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'}`}>
              <ListTree size={15} className="mr-1.5" />任务产出 {tasks.length ? `(${settled}/${tasks.length})` : ''}
            </button>
            <button type="button" onClick={() => setTab('report')} className={`flex flex-1 items-center justify-center rounded-lg px-3 py-2 text-sm transition ${tab === 'report' ? 'bg-white font-semibold text-slate-900 shadow-sm ring-1 ring-slate-200 dark:bg-white/10 dark:text-white dark:ring-white/10' : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'}`}>
              <FileText size={15} className="mr-1.5" />最终报告
            </button>
          </nav>
        </header>
        {/* 流程图折叠条：由 PlanProgressEvent 自动生成 DAG，只读展示，点击节点滑出 Inspector。 */}
        <div data-plan-flow className="border-b border-slate-200/70 bg-slate-50/40 dark:border-white/10 dark:bg-white/[0.02]">
          <div className="flex items-center">
            <button type="button" onClick={toggleFlow} aria-expanded={!flowCollapsed} className="flex min-w-0 flex-1 items-center gap-2 px-6 py-2 text-xs font-medium text-slate-500 transition-colors hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200">
              <Workflow size={14} />
              执行流程
              {tasks.length > 0 && <span className="rounded-full bg-slate-200/70 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-white/10 dark:text-slate-400">{tasks.filter((task) => task.status === 'completed').length}/{tasks.length}</span>}
              {progress?.phase === 'replanning' && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">重规划中</span>}
              <ChevronDown size={14} className={`ml-auto transition-transform ${flowCollapsed ? '' : 'rotate-180'}`} />
            </button>
            {/* Why 独立全屏按钮：React Flow Controls 自带的角括号按钮是"适配视图"（fitView），
                视图已适配时点击无视觉变化，用户会误判为"没反应"；真正的全屏入口放这里。 */}
            {!flowCollapsed && (
              <button type="button" onClick={() => setFlowExpanded(true)} title="全屏流程图" aria-label="全屏流程图" className="mr-3 rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-200/60 hover:text-slate-700 dark:hover:bg-white/10 dark:hover:text-slate-200">
                <Maximize2 size={13} />
              </button>
            )}
          </div>
          {!flowCollapsed && (
            <div className="h-60 border-t border-slate-200/60 dark:border-white/[0.06]">
              <PlanFlowCanvas progress={progress} selectedNodeId={inspectorNodeId} onSelectNode={setInspectorNodeId} />
            </div>
          )}
        </div>
        {/* 流程图全屏层：撑满面板 header 以下区域，Esc 或收起按钮退出。 */}
        {flowExpanded && (
          <div data-plan-flow-fullscreen className="absolute inset-0 z-20 flex flex-col bg-white dark:bg-[#0d1420]">
            <div className="flex items-center justify-between border-b border-slate-200/70 px-6 py-2 dark:border-white/10">
              <span className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400"><Workflow size={14} /> 执行流程 · 全屏</span>
              <button type="button" onClick={() => setFlowExpanded(false)} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-white/10 dark:hover:text-slate-200">
                <Minimize2 size={13} /> 收起全屏
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <PlanFlowCanvas progress={progress} selectedNodeId={inspectorNodeId} onSelectNode={setInspectorNodeId} />
            </div>
          </div>
        )}
        {/* Why 报告页给纸张底色（浅色暖白 / 深色墨蓝）：呼应编辑部排版方向 */}
        <main className={`min-h-0 flex-1 overflow-y-auto px-6 py-6 ${tab === 'report' ? 'bg-[#faf9f6] dark:bg-[#0b111c]' : ''}`}>
          {tab === 'tasks' ? (
            <div className="space-y-4">
              {progress?.message && (
                <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-500/20 dark:bg-blue-950/30 dark:text-blue-200">{progress.message}</div>
              )}
              {tasks.length > 0 && (
                <div role="tablist" aria-label="自主规划任务" className="flex gap-2 overflow-x-auto rounded-2xl border border-slate-200/70 bg-slate-50/50 p-1.5 dark:border-white/10 dark:bg-white/[0.03]">
                  {tasks.map((task) => {
                    const active = task.id === selectedTask?.id;
                    return (
                      <button key={task.id} type="button" role="tab" aria-selected={active} onClick={() => setSelectedTaskId(task.id)} className={`min-w-[148px] shrink-0 rounded-xl border px-4 py-2.5 text-left transition ${active ? 'border-cyan-200 bg-white text-slate-900 shadow-sm ring-2 ring-cyan-600/10 dark:border-cyan-500/30 dark:bg-white/10 dark:text-white dark:ring-cyan-400/20' : 'border-transparent text-slate-500 hover:border-slate-200 hover:bg-white/80 hover:text-slate-800 dark:text-slate-400 dark:hover:border-white/10 dark:hover:bg-white/[0.06] dark:hover:text-slate-200'}`}>
                        <span className="mr-2 inline-block align-[-2px]" aria-hidden="true">{taskStatusIcon(task.status)}</span><span className="font-semibold">Task {task.id}</span>
                        <span className="mt-0.5 block truncate text-xs">{task.title}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              {selectedTask ? (
                <section className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm ring-1 ring-slate-100 dark:border-white/10 dark:bg-white/[0.03] dark:shadow-none dark:ring-transparent">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 shrink-0" aria-hidden="true">{taskStatusIcon(selectedTask.status, 18)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <h3 className="break-words text-lg font-semibold text-slate-900 dark:text-slate-100">Task {selectedTask.id} · {selectedTask.title}</h3>
                        <span className="shrink-0 text-sm text-slate-500 dark:text-slate-400">{agentDisplayName(selectedTask.assigned_agent)}</span>
                      </div>
                      <p className="mt-2 break-words text-sm leading-6 text-slate-600 dark:text-slate-400">{selectedTask.description}</p>
                      {taskSearchResults.length > 0 && (
                        <div className="mt-4 rounded-xl border border-cyan-100 bg-cyan-50/40 p-4 dark:border-cyan-500/20 dark:bg-cyan-950/20">
                          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-cyan-900 dark:text-cyan-300"><SearchIcon />搜索结果 <span className="text-xs font-normal text-cyan-700 dark:text-cyan-400/80">{taskSearchResults.length} 条</span></div>
                          <div className="space-y-2">
                            {taskSearchResults.map((item) => (
                              <a key={`${item.url}-${item.title}`} href={item.url} target="_blank" rel="noreferrer" className="block rounded-lg border border-cyan-100/80 bg-white px-3 py-2 transition hover:border-cyan-200 hover:shadow-sm dark:border-white/10 dark:bg-transparent dark:hover:border-cyan-500/40">
                                <div className="truncate text-xs font-semibold text-slate-800 dark:text-slate-200">{item.title}</div>
                                <div className="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-500 dark:text-slate-400">{item.content}</div>
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                      {(selectedTask.result || selectedTask.error) && (
                        <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50/60 p-4 dark:border-white/10 dark:bg-white/[0.02]">
                          <MarkdownMessage className="max-h-[min(60vh,560px)] overflow-y-auto text-sm" content={selectedTask.result || selectedTask.error ? displayedTaskResult : ''} />
                          <button type="button" onClick={() => setExpanded({ title: `Task ${selectedTask.id} · ${selectedTask.title}`, content: selectedTask.result || selectedTask.error || '' })} className="mt-3 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 transition hover:bg-blue-50 dark:border-cyan-500/30 dark:bg-transparent dark:text-cyan-300 dark:hover:bg-cyan-500/10">全屏查看产出</button>
                        </div>
                      )}
                      {!selectedTask.result && !selectedTask.error && (
                        <div className="mt-4 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500 dark:border-white/15 dark:text-slate-400">该任务尚未产出内容。</div>
                      )}
                    </div>
                  </div>
                </section>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-white/15 dark:text-slate-400">等待 Planner 生成任务…</div>
              )}
              {loading && (
                <div className="animate-pulse rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">正在执行任务并同步产出…</div>
              )}
            </div>
          ) : (
            <div data-plan-report-panel>
              {figuresSlow && (
                <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs leading-6 text-amber-800 dark:border-amber-500/25 dark:bg-amber-950/20 dark:text-amber-300">
                  <Loader2 size={14} className="shrink-0 animate-spin" />
                  配图生成较慢（多张图排队生成中），完成后会自动插入报告，可先继续阅读正文。
                </div>
              )}
              {report ? (
                <PlanReportDocument document={reportDocument} onRetryFigure={handleRetryFigure} />
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-white/15 dark:text-slate-400">
                  {loading ? '任务执行完成后将在此生成最终报告…' : '暂无最终报告。'}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
      <PlanFlowInspector task={inspectorTask} open={Boolean(inspectorTask)} onClose={() => setInspectorNodeId(null)} onOpenInTasks={openTaskInList} />
      {expanded && <TaskOutputDialog title={expanded.title} content={expanded.content} onClose={() => setExpanded(null)} />}
    </aside>
  );
}
