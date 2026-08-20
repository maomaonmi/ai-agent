'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Clipboard, Download, Expand, FileText, ListTree, PanelRightClose, Search as SearchIcon, X } from 'lucide-react';
import { createPlanFigureJob, getPlanFigureJob, retryPlanFigure, type PlanFigure, type PlanProgressEvent, type PlanFigureJob, type PlanSearchResult } from '../../lib/api';
import MarkdownMessage from '../../components/MarkdownMessage';
import TaskOutputDialog from '../../components/TaskOutputDialog';
import PlanReportDocument from './PlanReportDocument';
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

function agentLabel(agent?: string) {
  if (!agent) return '自主执行器';
  if (agent.includes('web')) return '联网搜索专家';
  if (agent.includes('think')) return '深度思考专家';
  if (agent.includes('data')) return '数据分析专家';
  return agent;
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
  const figureRequestKey = useRef('');
  const figuresRef = useRef(figures);
  const onFiguresChangeRef = useRef(onFiguresChange);
  const timedOutFigures = useRef(new Set<string>());
  const retryingFigures = useRef(new Set<string>());
  figuresRef.current = figures;
  onFiguresChangeRef.current = onFiguresChange;
  useEffect(() => {
    // The backend now streams report_delta events; replaying a second
    // typewriter here would reset on every chunk and make the text appear to
    // stall. Keep the already-incremental text visible immediately.
    setDisplayedReport(report || '');
  }, [report]);
  const selectedTaskForTyping = (progress?.tasks || []).find((task) => task.id === selectedTaskId) || progress?.tasks?.[0];
  useEffect(() => {
    const result = selectedTaskForTyping?.result || selectedTaskForTyping?.streaming_result || selectedTaskForTyping?.error || '';
    setDisplayedTaskResult(result);
  }, [selectedTaskForTyping?.id, selectedTaskForTyping?.result, selectedTaskForTyping?.streaming_result, selectedTaskForTyping?.error]);
  const reportDocument = useMemo(() => adaptPlanReport(displayedReport, figures, progress), [displayedReport, figures, progress]);
  useEffect(() => {
    const available = window.innerWidth - (sidebarCollapsed ? 56 : 288);
    const restored = restoreWidth(sessionId);
    const next = Math.min(Math.max(restored ?? available * 0.52, MIN_WIDTH), Math.max(MIN_WIDTH, available * 0.75));
    setWidth(next); onWidthChange?.(next);
  }, [onWidthChange, sessionId, sidebarCollapsed]);
  useEffect(() => {
    const currentFigures = figuresRef.current;
    const allImagesReady = currentFigures.length > 0 && currentFigures.every((figure) => figure.status === 'succeeded' && Boolean(figure.image_url));
    if (loading || !sessionId || report.trim().length < 80 || allImagesReady || !onFiguresChangeRef.current) return;
    const key = `${sessionId || 'draft'}:${report.length}:${report.slice(0, 96)}`;
    if (figureRequestKey.current === key) return;
    figureRequestKey.current = key;
    const sourceUrls = extractSourceUrls(report, progress?.tasks || []);
    timedOutFigures.current.clear();
    let cancelled = false;
    let pollTimer: number | undefined;
    let timeoutTimer: number | undefined;
    const placeholders = currentFigures.length > 0
      ? currentFigures.map((figure) => figure.status === 'succeeded' && figure.image_url ? figure : { ...figure, job_id: 'pending', status: 'queued' as const, image_url: undefined })
      : createFigurePlaceholders(report, key);
    onFiguresChangeRef.current(placeholders);
    const markTimedOut = () => {
      if (cancelled) return;
      const timedOut = figuresRef.current.map((figure) => {
        if (figure.status !== 'queued' && figure.status !== 'generating' && figure.status !== 'processing') return figure;
        timedOutFigures.current.add(figure.id);
        return { ...figure, status: 'failed' as const, image_url: undefined, error_message: '图片生成超过 30 秒，可点击重试' };
      });
      onFiguresChangeRef.current?.(timedOut);
    };
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
        const update = (next: PlanFigureJob) => {
          const nextFigures = (next.figures || []).map((figure) => timedOutFigures.current.has(figure.id)
            ? { ...figure, status: 'failed' as const, image_url: undefined, error_message: '图片生成超过 30 秒，可点击重试' }
            : figure);
          // The create endpoint can return a queued job before its worker has
          // inserted figure rows. Persist the job id on placeholders immediately
          // so a remount/reload can resume polling instead of spinning forever.
          const durableFigures = nextFigures.length
            ? nextFigures
            : figuresRef.current.map((figure) => ({ ...figure, job_id: next.id, status: 'queued' as const }));
          if (durableFigures.length) onFiguresChangeRef.current?.(durableFigures);
          if (next.status === 'queued' || next.status === 'generating') pollTimer = window.setTimeout(() => void poll(next.id), 1800);
          else if (timeoutTimer) window.clearTimeout(timeoutTimer);
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
    timeoutTimer = window.setTimeout(markTimedOut, FIGURE_TIMEOUT_MS);
    void sync();
    return () => { cancelled = true; if (pollTimer) window.clearTimeout(pollTimer); if (timeoutTimer) window.clearTimeout(timeoutTimer); };
  }, [loading, report, sessionId]);
  const handleRetryFigure = (figureId: string) => {
    const current = figuresRef.current.find((figure) => figure.id === figureId);
    if (!current || retryingFigures.current.has(figureId)) return;
    retryingFigures.current.add(figureId);
    timedOutFigures.current.delete(figureId);
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
  const settled = tasks.filter((task) => task.status === 'completed' || task.status === 'failed').length;
  const paneStyle = width ? { width: `${width}px` } : undefined;
  if (!progress && !report) return null;
  return <aside data-plan-workspace className={`fixed inset-y-0 right-0 z-40 flex border-l border-slate-200 bg-[#f8fafc] shadow-2xl ${fullscreen ? 'left-0' : ''}`} style={fullscreen ? { width: '100%' } : paneStyle} aria-label="自主任务规划工作区">
    <div role="separator" aria-label="调整自主规划面板宽度" onPointerDown={resize} className="absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize hover:bg-blue-400" />
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="border-b border-slate-200 bg-white px-5 py-4"><div className="flex items-center justify-between gap-3"><div><p className="text-[11px] font-semibold tracking-[0.18em] text-blue-600">AUTONOMOUS TASKS</p><h2 className="mt-1 text-lg font-semibold text-slate-900">{distributed ? '多智能体任务协作' : '自主任务规划'}</h2></div><div className="flex items-center gap-1"><button type="button" onClick={copyReport} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" title="复制报告" aria-label="复制报告">{copied ? <Check size={17} /> : <Clipboard size={17} />}</button><button type="button" onClick={downloadReport} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" title="下载报告" aria-label="下载报告"><Download size={17} /></button><button type="button" onClick={() => setFullscreen((value) => !value)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" title="全屏查看" aria-label="全屏查看">{fullscreen ? <X size={17} /> : <Expand size={17} />}</button><button type="button" onClick={() => setTab(tab === 'tasks' ? 'report' : 'tasks')} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" title="切换目录与搜索结果" aria-label="切换目录与搜索结果"><PanelRightClose size={17} /></button></div></div><nav className="mt-4 flex gap-1 rounded-xl bg-slate-100 p-1"><button type="button" onClick={() => setTab('tasks')} className={`flex-1 rounded-lg px-3 py-2 text-sm ${tab === 'tasks' ? 'bg-white font-semibold text-slate-900 shadow-sm' : 'text-slate-500'}`}><ListTree size={15} className="mr-1 inline" />任务产出 {tasks.length ? `(${settled}/${tasks.length})` : ''}</button><button type="button" onClick={() => setTab('report')} className={`flex-1 rounded-lg px-3 py-2 text-sm ${tab === 'report' ? 'bg-white font-semibold text-slate-900 shadow-sm' : 'text-slate-500'}`}><FileText size={15} className="mr-1 inline" />最终报告</button></nav></header>
      <main className="min-h-0 flex-1 overflow-y-auto p-5">{tab === 'tasks' ? <div className="space-y-4">{progress?.message && <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">{progress.message}</div>}{tasks.length > 0 && <div role="tablist" aria-label="自主规划任务" className="flex gap-2 overflow-x-auto rounded-2xl bg-slate-100 p-1.5">{tasks.map((task) => { const active = task.id === selectedTask?.id; const icon = task.status === 'completed' ? '✅' : task.status === 'failed' ? '⚠️' : task.status === 'in_progress' ? '⏳' : '○'; return <button key={task.id} type="button" role="tab" aria-selected={active} onClick={() => setSelectedTaskId(task.id)} className={`min-w-[148px] shrink-0 rounded-xl px-4 py-2.5 text-left transition ${active ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-300' : 'text-slate-500 hover:bg-white/70 hover:text-slate-800'}`}><span className="mr-2" aria-hidden="true">{icon}</span><span className="font-semibold">Task {task.id}</span><span className="mt-0.5 block truncate text-xs">{task.title}</span></button>; })}</div>}{selectedTask ? <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex min-w-0 items-start gap-3"><span className="mt-0.5 shrink-0 text-lg" aria-hidden="true">{selectedTask.status === 'completed' ? '✅' : selectedTask.status === 'failed' ? '⚠️' : selectedTask.status === 'in_progress' ? '⏳' : '○'}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-start justify-between gap-3"><h3 className="break-words text-lg font-semibold text-slate-900">Task {selectedTask.id} · {selectedTask.title}</h3><span className="shrink-0 text-sm text-slate-500">{agentLabel(selectedTask.assigned_agent)}</span></div><p className="mt-2 break-words text-sm leading-6 text-slate-600">{selectedTask.description}</p>{taskSearchResults.length > 0 && <div className="mt-4 rounded-xl border border-cyan-100 bg-cyan-50/60 p-4"><div className="mb-2 flex items-center gap-2 text-sm font-semibold text-cyan-900"><SearchIcon />搜索结果 <span className="text-xs font-normal text-cyan-700">{taskSearchResults.length} 条</span></div><div className="space-y-2">{taskSearchResults.map((item) => <a key={`${item.url}-${item.title}`} href={item.url} target="_blank" rel="noreferrer" className="block rounded-lg bg-white/80 px-3 py-2 hover:bg-white"><div className="truncate text-xs font-semibold text-slate-800">{item.title}</div><div className="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-500">{item.content}</div></a>)}</div></div>}{(selectedTask.result || selectedTask.error) && <div className="mt-4 rounded-xl bg-slate-50 p-4"><MarkdownMessage className="max-h-[min(60vh,560px)] overflow-y-auto text-sm" content={selectedTask.result || selectedTask.error ? displayedTaskResult : ''} /><button type="button" onClick={() => setExpanded({ title: `Task ${selectedTask.id} · ${selectedTask.title}`, content: selectedTask.result || selectedTask.error || '' })} className="mt-3 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50">全屏查看产出</button></div>}{!selectedTask.result && !selectedTask.error && <div className="mt-4 rounded-xl border border-dashed border-slate-200 px-4 py-8 text-center text-sm text-slate-500">该任务尚未产出内容。</div>}</div></div></section> : <div className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">等待 Planner 生成任务…</div>}{loading && <div className="animate-pulse rounded-2xl border border-slate-200 bg-white p-5 text-sm text-slate-500">正在执行任务并同步产出…</div>}</div> : <div data-plan-report-panel><PlanReportDocument document={reportDocument} onRetryFigure={handleRetryFigure} /></div>}</main>
    </div>{expanded && <TaskOutputDialog title={expanded.title} content={expanded.content} onClose={() => setExpanded(null)} />}</aside>;
}
