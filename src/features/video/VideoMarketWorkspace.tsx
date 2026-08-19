'use client';

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Clapperboard,
  Clock3,
  Film,
  LoaderCircle,
  Pause,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import { listVideoTasks, type VideoTask } from '../../lib/api';

interface VideoMarketWorkspaceProps {
  initialPrompt?: string;
  onBack: () => void;
  onCreate: (prompt?: string) => void;
}

type MarketFilter = '全部' | '文生视频' | '图生视频' | '参考视频';

const filters: MarketFilter[] = ['全部', '文生视频', '图生视频', '参考视频'];

function taskLabel(task: VideoTask): Exclude<MarketFilter, '全部'> {
  if (task.mode === 'reference_to_video') return '参考视频';
  if (task.mode === 'image_to_video' || task.mode === 'start_end_video') return '图生视频';
  return '文生视频';
}

function formatDate(timestamp: number) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(timestamp * 1000));
}

function videoTitle(task: VideoTask) {
  const clean = task.prompt.replace(/\s+/g, ' ').trim();
  return clean.length > 34 ? `${clean.slice(0, 34)}…` : clean || '未命名视频作品';
}

export default function VideoMarketWorkspace({ initialPrompt = '', onBack, onCreate }: VideoMarketWorkspaceProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [tasks, setTasks] = useState<VideoTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState(initialPrompt);
  const [filter, setFilter] = useState<MarketFilter>('全部');
  const [scrollProgress, setScrollProgress] = useState(0);
  const [autoPhase, setAutoPhase] = useState(0);
  const [autoPlaying, setAutoPlaying] = useState(true);
  const [stageHovered, setStageHovered] = useState(false);
  const [stageWidth, setStageWidth] = useState(1200);
  const [selected, setSelected] = useState<VideoTask | null>(null);
  const [reducedMotion, setReducedMotion] = useState(false);
  const manualPauseUntilRef = useRef(0);

  const loadTasks = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await listVideoTasks(1, 100, 'SUCCEEDED');
      setTasks(result.tasks.filter((task) => Boolean(task.result?.video_url)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '视频作品读取失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadTasks(); }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const updateWidth = () => setStageWidth(window.innerWidth);
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  useEffect(() => {
    if (!selected) return undefined;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setSelected(null); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [selected]);

  useEffect(() => {
    if (reducedMotion || !autoPlaying) return undefined;
    const timer = window.setInterval(() => {
      if (!stageHovered && Date.now() > manualPauseUntilRef.current) {
        setAutoPhase((value) => (value + 0.55) % 360);
      }
    }, 50);
    return () => window.clearInterval(timer);
  }, [autoPlaying, reducedMotion, stageHovered]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return tasks.filter((task) => {
      const matchesFilter = filter === '全部' || taskLabel(task) === filter;
      const matchesQuery = !keyword || `${task.prompt} ${task.model}`.toLowerCase().includes(keyword);
      return matchesFilter && matchesQuery;
    });
  }, [filter, query, tasks]);

  const spiralItems = useMemo(() => {
    if (filtered.length === 0) return [];
    const count = Math.max(12, Math.min(20, filtered.length * 3));
    return Array.from({ length: count }, (_, index) => ({ task: filtered[index % filtered.length], index }));
  }, [filtered]);

  const radius = Math.max(180, Math.min(440, stageWidth * 0.29));
  const cardWidth = Math.max(150, Math.min(250, stageWidth * 0.17));
  const trajectoryPaths = useMemo(() => {
    if (spiralItems.length < 2) return { main: '', halo: '', secondary: '' };
    const points = spiralItems.map(({ index }) => {
      const angle = index * 42 + scrollProgress * 620 + autoPhase;
      const radians = angle * Math.PI / 180;
      const lift = (index - (spiralItems.length - 1) / 2) * 76 - scrollProgress * 520;
      const depth = (Math.cos(radians) + 1) / 2;
      const perspective = 0.82 + depth * 0.22;
      const x = 500 + Math.sin(radians) * radius * (1000 / Math.max(stageWidth, 1)) * perspective;
      const y = 392 + lift * 0.82;
      return { x, y };
    });
    const smoothPath = (items: Array<{ x: number; y: number }>, offset = 0) => {
      const shifted = items.map((point) => ({ x: point.x, y: point.y + offset }));
      let path = `M ${shifted[0].x.toFixed(1)} ${shifted[0].y.toFixed(1)}`;
      for (let index = 1; index < shifted.length; index += 1) {
        const previous = shifted[index - 1];
        const current = shifted[index];
        const midpoint = { x: (previous.x + current.x) / 2, y: (previous.y + current.y) / 2 };
        path += ` Q ${previous.x.toFixed(1)} ${previous.y.toFixed(1)} ${midpoint.x.toFixed(1)} ${midpoint.y.toFixed(1)}`;
      }
      const last = shifted[shifted.length - 1];
      path += ` Q ${last.x.toFixed(1)} ${last.y.toFixed(1)} ${last.x.toFixed(1)} ${last.y.toFixed(1)}`;
      return path;
    };
    return {
      main: smoothPath(points, 0),
      halo: smoothPath(points, 0),
      secondary: smoothPath(points, 24),
    };
  }, [autoPhase, radius, scrollProgress, spiralItems, stageWidth]);

  const handleScroll = () => {
    const root = scrollRef.current;
    if (!root) return;
    setScrollProgress(Math.max(0, Math.min(1, root.scrollTop / Math.max(root.clientHeight * 1.65, 1))));
    manualPauseUntilRef.current = Date.now() + 2200;
  };

  return (
    <div ref={scrollRef} onScroll={handleScroll} className="video-market fixed inset-0 z-[120] overflow-y-auto bg-slate-50 text-slate-950 dark:bg-[#0f1013] dark:text-white lg:left-72">
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur-xl dark:border-white/[0.08] dark:bg-[#0f1013]/95">
        <div className="flex h-16 items-center gap-3 px-4 sm:px-6">
          <button type="button" onClick={onBack} aria-label="返回对话" className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 dark:text-white/55 dark:hover:bg-white/[0.07] dark:hover:text-white"><ArrowLeft size={18} /></button>
          <div className="flex min-w-0 items-center gap-2"><Film size={18} className="text-cyan-600 dark:text-cyan-300" /><span className="font-semibold">AI 视频市场</span><span className="hidden text-xs text-slate-400 dark:text-white/35 sm:inline">/ Motion Gallery</span></div>
          <button type="button" onClick={() => onCreate(query.trim())} className="ml-auto inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-3 py-2 text-xs font-semibold text-white transition hover:bg-cyan-500 dark:bg-cyan-300 dark:text-slate-950 dark:hover:bg-cyan-200"><Sparkles size={14} />进入工作台</button>
        </div>
      </header>

      <main>
        <section className="relative min-h-[255vh]" aria-labelledby="video-market-title">
          <div className="video-market-ambient sticky top-16 h-[calc(100vh-4rem)] min-h-[620px] overflow-hidden">
            <div className="pointer-events-none absolute inset-x-0 top-8 z-30 mx-auto w-[min(92vw,760px)] px-4 text-center sm:top-10">
              <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-700 dark:text-cyan-300">Generated in your workspace</p>
              <h1 id="video-market-title" className="mt-3 text-3xl font-semibold tracking-tight sm:text-5xl">让作品沿灵感螺旋生长</h1>
              <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-slate-500 dark:text-white/45">滚动探索工作台生成的视频。每一次创作完成，都会自动进入这座动态画廊。</p>
            </div>

            <div className="absolute inset-x-4 top-48 z-30 mx-auto flex max-w-3xl flex-col gap-3 sm:top-52 sm:flex-row sm:items-center sm:justify-center">
              <label className="pointer-events-auto flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-white/95 px-3 py-2.5 text-sm text-slate-500 shadow-sm dark:border-white/[0.1] dark:bg-[#18191e]/95 dark:text-white/45"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索提示词或模型" className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-slate-400 dark:placeholder:text-white/25" /></label>
              <div className="pointer-events-auto flex gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-white/95 p-1 shadow-sm dark:border-white/[0.1] dark:bg-[#18191e]/95">{filters.map((item) => <button key={item} type="button" aria-pressed={filter === item} onClick={() => setFilter(item)} className={`shrink-0 rounded-lg px-3 py-2 text-xs transition ${filter === item ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-950' : 'text-slate-500 hover:bg-slate-100 dark:text-white/45 dark:hover:bg-white/[0.07]'}`}>{item}</button>)}</div>
            </div>

            {loading ? <div role="status" className="flex h-full items-center justify-center pt-40 text-sm text-slate-400"><LoaderCircle size={18} className="mr-2 animate-spin" />正在装配视频螺旋…</div> : error ? <div className="flex h-full flex-col items-center justify-center px-6 pt-40 text-center"><p className="text-sm text-rose-600 dark:text-rose-300">{error}</p><button type="button" onClick={() => void loadTasks()} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs dark:border-white/[0.12]"><RefreshCw size={14} />重新加载</button></div> : spiralItems.length === 0 ? <div className="flex h-full flex-col items-center justify-center px-6 pt-40 text-center"><Clapperboard size={34} className="text-slate-300 dark:text-white/20" /><h2 className="mt-4 font-semibold">还没有匹配的视频作品</h2><p className="mt-2 max-w-sm text-sm leading-6 text-slate-500 dark:text-white/40">去工作台完成第一条视频，它会自动出现在这里。</p><button type="button" onClick={() => onCreate(query.trim())} className="mt-5 rounded-lg bg-cyan-600 px-4 py-2.5 text-sm font-semibold text-white dark:bg-cyan-300 dark:text-slate-950">开始创作</button></div> : reducedMotion ? <div className="mx-auto grid h-full max-w-6xl grid-cols-2 content-center gap-3 overflow-y-auto px-4 pb-10 pt-72 sm:grid-cols-3 lg:grid-cols-4">{filtered.map((task) => <MarketCard key={task.id} task={task} onOpen={setSelected} />)}</div> : <div className="video-market-stage absolute inset-0 top-24" aria-label="滚动式视频作品螺旋" onMouseEnter={() => setStageHovered(true)} onMouseLeave={() => setStageHovered(false)}>
              <div className="video-market-spine" aria-hidden="true" />
              <svg className="video-market-trajectory" viewBox="0 0 1000 700" preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <linearGradient id="video-market-trajectory-gradient" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0" stopColor="#22d3ee" stopOpacity="0.08" />
                    <stop offset="0.28" stopColor="#67e8f9" stopOpacity="0.84" />
                    <stop offset="0.52" stopColor="#38bdf8" stopOpacity="0.55" />
                    <stop offset="0.78" stopColor="#67e8f9" stopOpacity="0.82" />
                    <stop offset="1" stopColor="#22d3ee" stopOpacity="0.08" />
                  </linearGradient>
                  <filter id="video-market-trajectory-glow" x="-20%" y="-20%" width="140%" height="140%">
                    <feGaussianBlur stdDeviation="4" result="blur" />
                    <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
                  </filter>
                </defs>
                <path className="video-market-trajectory-glow" d={trajectoryPaths.halo} />
                <path className="video-market-trajectory-main" d={trajectoryPaths.main} />
                <path className="video-market-trajectory-secondary" d={trajectoryPaths.secondary} />
              </svg>
              {spiralItems.map(({ task, index }) => {
                const angle = index * 42 + scrollProgress * 620 + autoPhase;
                const lift = (index - (spiralItems.length - 1) / 2) * 76 - scrollProgress * 520;
                const depth = (Math.cos(angle * Math.PI / 180) + 1) / 2;
                const style = {
                  '--spiral-angle': `${angle}deg`,
                  '--spiral-radius': `${radius}px`,
                  '--spiral-lift': `${lift}px`,
                  '--spiral-card-width': `${cardWidth}px`,
                  '--spiral-depth-scale': `${0.74 + depth * 0.28}`,
                  '--spiral-depth-opacity': `${0.44 + depth * 0.56}`,
                  '--spiral-depth-brightness': `${0.68 + depth * 0.4}`,
                  zIndex: Math.round(depth * 100),
                } as CSSProperties;
                return <button key={`${task.id}-${index}`} type="button" onClick={() => setSelected(task)} className="video-market-spiral-card group" style={style} aria-label={`播放作品：${videoTitle(task)}`}><video src={task.result?.video_url ?? ''} muted loop playsInline autoPlay preload="metadata" className="h-full w-full object-cover" /><span className="absolute inset-0 bg-slate-950/10 transition group-hover:bg-slate-950/0" /><span className="absolute inset-x-2 bottom-2 flex items-center justify-between gap-2 rounded-lg bg-slate-950/70 px-2 py-1.5 text-left text-[10px] text-white backdrop-blur"><span className="truncate">{videoTitle(task)}</span><Play size={11} className="shrink-0" fill="currentColor" /></span></button>;
              })}
            </div>}

            {!loading && spiralItems.length > 0 && !reducedMotion && <div className="absolute bottom-7 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3"><div className="pointer-events-none text-center"><div className="mx-auto h-8 w-px bg-slate-300 dark:bg-white/20" /><p className="mt-2 text-[10px] uppercase tracking-[0.24em] text-slate-400 dark:text-white/30">Scroll to rotate</p></div><button type="button" aria-pressed={!autoPlaying} onClick={() => setAutoPlaying((value) => !value)} className="mt-5 inline-flex h-8 items-center gap-1.5 rounded-full border border-slate-200 bg-white/80 px-3 text-[10px] font-medium text-slate-500 backdrop-blur transition hover:border-cyan-300 hover:text-cyan-700 dark:border-white/[0.1] dark:bg-[#18191e]/80 dark:text-white/45 dark:hover:text-cyan-200">{autoPlaying ? <Pause size={11} /> : <Play size={11} />}{autoPlaying ? '暂停环游' : '继续环游'}</button></div>}
          </div>
        </section>

        <section className="relative z-20 border-t border-slate-200 bg-white px-4 py-14 dark:border-white/[0.08] dark:bg-[#14151a] sm:px-7 lg:px-10" aria-labelledby="latest-videos-title">
          <div className="mx-auto max-w-7xl"><div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-cyan-700 dark:text-cyan-300">Workspace output</p><h2 id="latest-videos-title" className="mt-2 text-2xl font-semibold">最新作品</h2></div><p className="text-xs text-slate-400 dark:text-white/35">共 {filtered.length} 条已完成视频</p></div>
            {filtered.length > 0 ? <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">{filtered.map((task) => <MarketCard key={task.id} task={task} onOpen={setSelected} />)}</div> : <p className="mt-8 rounded-xl border border-dashed border-slate-300 px-5 py-12 text-center text-sm text-slate-400 dark:border-white/[0.12]">当前筛选下没有作品</p>}
          </div>
        </section>
      </main>

      {selected && <div role="dialog" aria-modal="true" aria-label="视频作品详情" className="fixed inset-0 z-[180] flex items-center justify-center bg-slate-950/70 p-3 backdrop-blur-sm sm:p-6" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><div className="flex max-h-[calc(100vh-24px)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#111216] text-white shadow-2xl lg:flex-row"><div className="flex min-h-64 flex-1 items-center justify-center bg-black"><video src={selected.result?.video_url ?? ''} controls autoPlay playsInline className="max-h-[76vh] w-full object-contain" /></div><aside className="w-full shrink-0 overflow-y-auto p-5 lg:w-80 lg:p-6"><div className="flex items-start justify-between gap-4"><span className="rounded-full bg-cyan-300/10 px-2.5 py-1 text-[10px] text-cyan-200">{taskLabel(selected)}</span><button type="button" onClick={() => setSelected(null)} aria-label="关闭视频详情" className="rounded-lg p-1.5 text-white/45 hover:bg-white/[0.08] hover:text-white"><X size={17} /></button></div><h2 className="mt-5 text-lg font-semibold leading-7">{videoTitle(selected)}</h2><p className="mt-3 text-xs leading-6 text-white/50">{selected.prompt}</p><div className="mt-6 space-y-3 border-t border-white/10 pt-5 text-xs text-white/55"><p className="flex items-center justify-between"><span>模型</span><strong className="font-medium text-white/85">{selected.model}</strong></p><p className="flex items-center justify-between"><span>规格</span><strong className="font-medium text-white/85">{selected.parameters.ratio} · {selected.parameters.duration}s</strong></p><p className="flex items-center justify-between"><span className="inline-flex items-center gap-1.5"><Clock3 size={13} />生成时间</span><strong className="font-medium text-white/85">{formatDate(selected.created_at)}</strong></p></div><button type="button" onClick={() => onCreate(selected.prompt)} className="mt-7 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-4 py-3 text-sm font-semibold text-slate-950 hover:bg-cyan-200">用这个提示词创作<ArrowUpRight size={15} /></button></aside></div></div>}
    </div>
  );
}

function MarketCard({ task, onOpen }: { task: VideoTask; onOpen: (task: VideoTask) => void }) {
  return <button type="button" onClick={() => onOpen(task)} className="group overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-left transition hover:-translate-y-0.5 hover:border-cyan-300 hover:shadow-lg dark:border-white/[0.08] dark:bg-[#0f1013] dark:hover:border-cyan-300/30"><div className="relative aspect-video overflow-hidden bg-black"><video src={task.result?.video_url ?? ''} muted playsInline preload="metadata" className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.02]" /><span className="absolute inset-0 flex items-center justify-center bg-slate-950/10 opacity-0 transition group-hover:opacity-100"><span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/90 text-slate-950"><Play size={16} fill="currentColor" /></span></span></div><span className="block p-4"><span className="flex items-center justify-between gap-3"><strong className="truncate text-sm font-semibold text-slate-800 dark:text-white/85">{videoTitle(task)}</strong><span className="shrink-0 text-[10px] text-slate-400 dark:text-white/30">{formatDate(task.created_at)}</span></span><span className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-white/40"><span className="truncate">{task.model}</span><span className="shrink-0">{taskLabel(task)} · {task.parameters.duration}s</span></span></span></button>;
}
