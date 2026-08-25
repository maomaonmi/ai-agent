'use client';

import { useEffect, useRef, useState } from 'react';
import { FileText } from 'lucide-react';
import { createResearchFigureJob, getResearchFigureJob, retryResearchFigure, type ResearchChunk, type ResearchFigure, type ResearchFigureBatch, type ResearchFigureJob, type ResearchFigurePolicy } from '../../lib/api';
import ResearchReportPane from './report/ResearchReportPane';

interface ResearchWorkspaceProps {
  title: string;
  report: string;
  sources?: ResearchChunk[];
  loading?: boolean;
  sidebarCollapsed: boolean;
  sessionId?: string;
  researchFigures?: ResearchFigure[];
  onFiguresChange?: (figures: ResearchFigure[]) => void;
  onWidthChange?: (width: number) => void;
}

const PREFERENCES_KEY = 'research-workspace-preferences-v2';
const MIN_WIDTH = 560;

function readWidth(sessionId?: string): number | undefined {
  try {
    const preferences = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || '{}') as Record<string, { width?: number }>;
    const value = preferences[sessionId || 'draft']?.width;
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  } catch { return undefined; }
}

const FIGURE_POLICY: ResearchFigurePolicy = 'economy';
const FIGURE_TIMEOUT_MS = 30_000;
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

function normalizeFigures(figures: ResearchFigure[]): ResearchFigure[] {
  return figures.map((figure) => ({
    ...figure,
    image_url: figure.image_url && figure.image_url.startsWith('/') ? `${API_BASE_URL}${figure.image_url}` : figure.image_url,
  }));
}

function isUsableJobId(jobId?: string | null): jobId is string {
  return Boolean(jobId && jobId !== 'pending' && !jobId.startsWith('placeholder-'));
}

function createFigurePlaceholders(report: string, requestKey: string): ResearchFigure[] {
  const count = Math.max(2, Math.min(10, Math.ceil(report.length / 1800)));
  return Array.from({ length: count }, (_, index) => ({
    id: `placeholder-${requestKey}-${index}`,
    job_id: 'pending',
    ordinal: index,
    batch_index: index,
    batch_title: `研究章节 ${index + 1}`,
    section_title: `研究重点 ${index + 1}`,
    figure_type: index % 3 === 0 ? 'concept' : index % 3 === 1 ? 'comparison' : 'scene',
    caption: `研究配图 ${index + 1}`,
    status: 'queued' as const,
    model: FIGURE_POLICY,
  }));
}

export default function ResearchWorkspace({ title, report, sources, loading, sidebarCollapsed, sessionId, researchFigures = [], onFiguresChange, onWidthChange }: ResearchWorkspaceProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopWidth, setDesktopWidth] = useState<number>();
  const figureRequestKey = useRef('');
  const retryingFigures = useRef(new Set<string>());
  const timedOutFigures = useRef(new Set<string>());
  const figuresRef = useRef(researchFigures);
  const onFiguresChangeRef = useRef(onFiguresChange);
  const [figureBatches, setFigureBatches] = useState<ResearchFigureBatch[]>([]);
  figuresRef.current = researchFigures;
  onFiguresChangeRef.current = onFiguresChange;
  useEffect(() => {
    const available = window.innerWidth - (sidebarCollapsed ? 56 : 288);
    const restored = readWidth(sessionId);
    const width = Math.min(Math.max(restored ?? available * 0.52, MIN_WIDTH), Math.max(MIN_WIDTH, available * 0.72));
    setDesktopWidth(width);
    onWidthChange?.(width);
  }, [onWidthChange, sessionId, sidebarCollapsed]);

  // The image job starts only after the report is stable. It is deliberately
  // polled as one job (not one request per image), and every result is pushed
  // through the same message persistence callback used by research sources.
  useEffect(() => {
    const currentFigures = figuresRef.current;
    const allImagesReady = currentFigures.length > 0 && currentFigures.every((figure) => figure.status === 'succeeded' && Boolean(figure.image_url));
    if (loading || !sessionId || report.trim().length < 80 || allImagesReady) return;
    const requestKey = `${sessionId}:${report.length}:${report.slice(0, 24)}:${report.slice(-24)}`;
    if (figureRequestKey.current === requestKey) return;
    figureRequestKey.current = requestKey;
    timedOutFigures.current.clear();
    let cancelled = false;
    let pollTimer: number | undefined;
    let timeoutTimer: number | undefined;
    // Why: 429（限流）会触发 catch → onFiguresChange → 父组件重渲染 → report
    //   引用变化 → useEffect 重新执行 → 又调 create → 又 429 → 无限循环。
    //   用 createAttempts 限制同一 requestKey 最多尝试 2 次，429 直接标失败不重试。
    let createAttempts = 0;
    const MAX_CREATE_ATTEMPTS = 2;
    const placeholders = currentFigures.length > 0
      ? currentFigures.map((figure) => figure.status === 'succeeded' && figure.image_url
        ? figure
        : { ...figure, job_id: 'pending', status: 'queued' as const, image_url: null })
      : createFigurePlaceholders(report, requestKey);
    setFigureBatches([]);
    onFiguresChangeRef.current?.(placeholders);
    const markTimedOutFigures = () => {
      if (cancelled) return;
      const timedOut = figuresRef.current.map((figure) => {
        if (figure.status !== 'queued' && figure.status !== 'generating') return figure;
        timedOutFigures.current.add(figure.id);
        return { ...figure, status: 'failed' as const, image_url: null, error_message: '图片生成超过 30 秒，可点击重试' };
      });
      if (timedOut.some((figure, index) => figure.status !== figuresRef.current[index]?.status)) {
        onFiguresChangeRef.current?.(timedOut);
      }
    };
    const sync = async () => {
      try {
        const existingJobId = figuresRef.current[0]?.job_id;
        let job: ResearchFigureJob;
        if (isUsableJobId(existingJobId)) {
          try {
            job = await getResearchFigureJob(existingJobId);
          } catch (error) {
            // A stale/expired job must be recreated. Treating the 404 as a
            // terminal figure failure left historical sessions stuck on the
            // loading card forever.
            if (!(error instanceof Error && (error.message.includes('404') || error.message.includes('不存在')))) throw error;
            job = await createResearchFigureJob({ session_id: sessionId, report_version: requestKey, report, max_images: 10, policy: FIGURE_POLICY, context_mode: 'mixed' });
          }
        } else {
          if (createAttempts >= MAX_CREATE_ATTEMPTS) {
            throw new Error('配图任务创建次数已达上限（限流），请手动重试');
          }
          createAttempts += 1;
          // 429 限流时等 3 秒再重试，避免瞬间打满后端 in-flight 上限。
          if (createAttempts > 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 3000));
          }
          // 'pending' is a client-side placeholder ID, never a server job.
          // The create endpoint deduplicates against an existing persisted job
          // by session + report hash, so this is safe after a refresh.
          job = await createResearchFigureJob({ session_id: sessionId, report_version: requestKey, report, max_images: 10, policy: FIGURE_POLICY, context_mode: 'mixed' });
        }
        if (cancelled) return;
        const update = (next: typeof job) => {
          const figures = normalizeFigures(next.figures ?? []).map((figure) => timedOutFigures.current.has(figure.id)
            ? { ...figure, status: 'failed' as const, image_url: null, error_message: '图片生成超过 30 秒，可点击重试' }
            : figure);
          setFigureBatches(next.batches ?? []);
          if (figures.length) onFiguresChangeRef.current?.(figures);
          if (next.status === 'succeeded' || next.status === 'failed' || next.status === 'cancelled') {
            if (timeoutTimer) window.clearTimeout(timeoutTimer);
            return;
          }
          if (!cancelled) pollTimer = window.setTimeout(() => void poll(next.id), 1800);
        };
        const poll = async (jobId: string) => {
          try {
            update(await getResearchFigureJob(jobId));
          } catch {
            if (!cancelled) pollTimer = window.setTimeout(() => void poll(jobId), 1800);
          }
        };
        update(job);
      } catch (error) {
        if (cancelled) return;
        const msg = error instanceof Error ? error.message : '';
        const isRateLimited = msg.includes('429') || msg.includes('限流') || msg.includes('上限');
        const errMsg = isRateLimited
          ? '配图服务暂时限流，可点击重试'
          : '配图任务暂时不可用';
        onFiguresChangeRef.current?.(placeholders.map((figure) => ({ ...figure, status: 'failed' as const, error_message: errMsg })));
      }
    };
    // Start the deadline before the network request so a stalled create/job
    // request also becomes actionable instead of leaving an infinite spinner.
    timeoutTimer = window.setTimeout(markTimedOutFigures, FIGURE_TIMEOUT_MS);
    void sync();
    return () => {
      cancelled = true;
      if (pollTimer) window.clearTimeout(pollTimer);
      if (timeoutTimer) window.clearTimeout(timeoutTimer);
    };
  }, [loading, report, sessionId]);

  const handleFigureLoadError = (figureId: string) => {
    const current = figuresRef.current.find((figure) => figure.id === figureId);
    if (!current || (current.status !== 'succeeded' && current.status !== 'failed') || retryingFigures.current.has(figureId)) return;
    timedOutFigures.current.delete(figureId);
    retryingFigures.current.add(figureId);
    onFiguresChangeRef.current?.(figuresRef.current.map((figure) => figure.id === figureId
      ? { ...figure, status: 'queued' as const, image_url: null, error_message: '图片加载失败，正在重新生成' }
      : figure));
    const mergeJobFigures = (nextFigures: ResearchFigure[]) => {
      if (!nextFigures.length) return;
      const byOrdinal = new Map(nextFigures.map((figure) => [figure.ordinal, normalizeFigures([figure])[0]]));
      const merged = figuresRef.current.map((figure) => {
        const next = byOrdinal.get(figure.ordinal);
        return next && timedOutFigures.current.has(figure.id)
          ? { ...next, id: figure.id, status: 'failed' as const, image_url: null, error_message: '重试超过 30 秒，可再次点击重试' }
          : next ?? figure;
      });
      nextFigures.forEach((figure) => { if (!merged.some((item) => item.ordinal === figure.ordinal)) merged.push(normalizeFigures([figure])[0]); });
      onFiguresChangeRef.current?.(merged);
    };
    let retryTimeout: number | undefined;
    let retryCancelled = false;
    const markRetryTimedOut = () => {
      retryCancelled = true;
      timedOutFigures.current.add(figureId);
      const timedOut = figuresRef.current.map((figure) => figure.ordinal === current.ordinal
        ? { ...figure, status: 'failed' as const, image_url: null, error_message: '重试超过 30 秒，可再次点击重试' }
        : figure);
      onFiguresChangeRef.current?.(timedOut);
      retryingFigures.current.delete(figureId);
    };
    const pollRetry = async (jobId: string): Promise<void> => {
      if (retryCancelled) return;
      const next = await getResearchFigureJob(jobId);
      if (retryCancelled) return;
      mergeJobFigures(next.figures ?? []);
      if (next.status === 'queued' || next.status === 'generating') {
        window.setTimeout(() => void pollRetry(jobId).catch(() => undefined), 1800);
      } else {
        retryCancelled = true;
        timedOutFigures.current.delete(figureId);
        if (retryTimeout) window.clearTimeout(retryTimeout);
        retryingFigures.current.delete(figureId);
      }
    };
    retryTimeout = window.setTimeout(markRetryTimedOut, FIGURE_TIMEOUT_MS);
    void retryResearchFigure(figureId)
      .then((job) => pollRetry(job.id))
      .catch(() => {
        if (retryTimeout) window.clearTimeout(retryTimeout);
        retryingFigures.current.delete(figureId);
        onFiguresChangeRef.current?.(figuresRef.current.map((figure) => figure.id === figureId ? { ...figure, status: 'failed' as const, error_message: '图片重新生成失败' } : figure));
      });
  };
  const resize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    let pendingWidth = desktopWidth;
    const update = (clientX: number) => {
      const available = window.innerWidth - (sidebarCollapsed ? 56 : 288);
      const width = Math.min(Math.max(window.innerWidth - clientX, MIN_WIDTH), Math.max(MIN_WIDTH, available * 0.72));
      setDesktopWidth(width);
      pendingWidth = width;
      onWidthChange?.(width);
    };
    const handleMove = (moveEvent: PointerEvent) => update(moveEvent.clientX);
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      try {
        const preferences = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || '{}') as Record<string, { width?: number }>;
        preferences[sessionId || 'draft'] = { ...preferences[sessionId || 'draft'], width: pendingWidth };
        localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
      } catch { /* Preferences are optional when storage is unavailable. */ }
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp, { once: true });
  };
  return <div data-research-workspace>
    <aside className="fixed bottom-0 right-0 top-0 z-40 hidden min-w-[560px] border-l border-slate-200 bg-white xl:block" style={{ width: desktopWidth }}><div role="separator" aria-label="调整调研报告宽度" aria-orientation="vertical" onPointerDown={resize} className="group absolute inset-y-0 left-0 z-50 w-2 -translate-x-1/2 cursor-col-resize touch-none"><span className="absolute inset-y-0 left-1/2 w-px bg-transparent transition group-hover:bg-blue-400"/></div><ResearchReportPane title={title} report={report} sources={sources} loading={loading} researchFigures={researchFigures} figureBatches={figureBatches} onFigureLoadError={handleFigureLoadError} onFigureRetry={handleFigureLoadError}/></aside>
    <button type="button" onClick={() => setMobileOpen(true)} className="fixed bottom-28 right-4 z-50 inline-flex h-11 items-center gap-2 rounded-full bg-slate-950 px-4 text-sm font-medium text-white shadow-xl xl:hidden" aria-label="打开调研报告"><FileText size={17}/>报告</button>
    {mobileOpen && <div className="fixed inset-0 z-[120] bg-white xl:hidden"><ResearchReportPane title={title} report={report} sources={sources} loading={loading} researchFigures={researchFigures} figureBatches={figureBatches} onFigureLoadError={handleFigureLoadError} onFigureRetry={handleFigureLoadError} onClose={() => setMobileOpen(false)}/></div>}
  </div>;
}
