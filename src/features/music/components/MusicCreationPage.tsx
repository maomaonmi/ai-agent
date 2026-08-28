'use client';

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  Mic,
  Music,
  Video,
  ChevronDown,
  Settings,
  Sparkles,
  GripVertical,
  Music2,
  Palette,
  ArrowUpRight,
  Play,
  Pause,
  Loader2,
  Download,
  FileText,
  FolderOpen,
  Heart,
  Star,
} from 'lucide-react';
import MusicSidebar, { type MusicTab } from './MusicSidebar';
import { generateSunoMusic, listSunoTasks, openSunoTaskStream, resolveSunoAssetUrl, type SunoTask } from '../api';

interface MusicCreationPageProps {
  activeTab: MusicTab;
  onTabChange: (tab: MusicTab) => void;
  onBack: () => void;
}

const STYLE_TAGS = ['中国风', '管弦乐团', '键盘乐器', '蓝调', '古典', '世界音乐'];
const TERMINAL_STATUSES = ['SUCCESS', 'FAILED', 'TIMED_OUT'];
const DEFAULT_ASSET_PANEL_WIDTH = 460;
const MIN_ASSET_PANEL_WIDTH = 320;
const MAX_ASSET_PANEL_WIDTH = 760;

function extractLyrics(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(extractLyrics).filter(Boolean).join('\n');
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  for (const key of ['text', 'lyrics', 'content', 'line']) {
    const text = extractLyrics(record[key]);
    if (text) return text;
  }
  return '';
}

function getTaskLyrics(task: SunoTask): string {
  const clipLyrics = task.clips.map((clip) => extractLyrics(clip.lyrics)).find(Boolean);
  if (clipLyrics) return clipLyrics;
  const prompt = typeof task.request?.prompt === 'string' ? task.request.prompt.trim() : '';
  return prompt;
}

function EmptyRightPanel({ icon, text }: { icon: React.ReactNode; text: string }) {
  return <div className="flex h-full min-h-64 flex-col items-center justify-center text-center text-slate-400"><div className="mb-4 flex h-20 w-20 items-center justify-center rounded-xl bg-slate-50"><div className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-100">{icon}</div></div><p className="text-sm">{text}</p></div>;
}

function formatAudioTime(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '00:00';
  const totalSeconds = Math.floor(value);
  return `${String(Math.floor(totalSeconds / 60)).padStart(2, '0')}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function AudioTrackPlayer({ src, duration }: { src: string; duration?: number | null }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [durationSeconds, setDurationSeconds] = useState(duration || 0);

  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDurationSeconds(duration || 0);
    audioRef.current?.pause();
  }, [src, duration]);

  const togglePlayback = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try {
        await audio.play();
        setPlaying(true);
      } catch {
        setPlaying(false);
      }
    } else {
      audio.pause();
      setPlaying(false);
    }
  };

  const handleSeek = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextTime = Number(event.target.value);
    if (audioRef.current) audioRef.current.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <button type="button" onClick={() => void togglePlayback()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white transition hover:bg-sky-700" aria-label={playing ? '暂停播放' : '播放音频'}>
        {playing ? <Pause size={15} fill="currentColor" aria-hidden="true" /> : <Play size={15} fill="currentColor" className="translate-x-px" aria-hidden="true" />}
      </button>
      <div className="min-w-0 flex-1">
        <input
          type="range"
          min={0}
          max={durationSeconds || 1}
          step={0.1}
          value={Math.min(currentTime, durationSeconds || 1)}
          onChange={handleSeek}
          className="h-1.5 w-full cursor-pointer accent-sky-600"
          aria-label="音频播放进度"
        />
        <div className="mt-0.5 flex justify-between text-[10px] tabular-nums text-slate-400">
          <span>{formatAudioTime(currentTime)}</span>
          <span>{formatAudioTime(durationSeconds)}</span>
        </div>
      </div>
      <audio
        ref={audioRef}
        key={src}
        src={src}
        preload="metadata"
        className="hidden"
        onLoadedMetadata={(event) => setDurationSeconds(event.currentTarget.duration || duration || 0)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrentTime(0); }}
      />
    </div>
  );
}

export default function MusicCreationPage({ activeTab, onTabChange, onBack }: MusicCreationPageProps) {
  const [lyrics, setLyrics] = useState('');
  const [style, setStyle] = useState('');
  const [title, setTitle] = useState('');
  const [activeRightTab, setActiveRightTab] = useState<'works' | 'lyrics' | 'assets' | 'favorites'>('works');
  const [mode, setMode] = useState<'inspiration' | 'custom'>('custom');
  const [instrumental, setInstrumental] = useState(false);
  const [works, setWorks] = useState<SunoTask[]>([]);
  const [currentTask, setCurrentTask] = useState<SunoTask | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [assetPanelWidth, setAssetPanelWidth] = useState(DEFAULT_ASSET_PANEL_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const streamRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;
    listSunoTasks().then((tasks) => {
      if (!cancelled) {
        setWorks(tasks);
        setCurrentTask(tasks.find((task) => !TERMINAL_STATUSES.includes(task.status)) || tasks[0] || null);
      }
    }).catch(() => undefined);
    return () => { cancelled = true; streamRef.current?.close(); };
  }, []);

  useEffect(() => {
    streamRef.current?.close();
    if (!currentTask || TERMINAL_STATUSES.includes(currentTask.status)) return;
    streamRef.current = openSunoTaskStream(currentTask.id, (task) => {
      setCurrentTask(task);
      setWorks((items) => [task, ...items.filter((item) => item.id !== task.id)]);
    }, () => undefined);
    return () => streamRef.current?.close();
  }, [currentTask?.id]);

  useEffect(() => {
    if (!isResizing) return;

    const handlePointerMove = (event: PointerEvent) => {
      const nextWidth = window.innerWidth - event.clientX;
      setAssetPanelWidth(Math.max(MIN_ASSET_PANEL_WIDTH, Math.min(MAX_ASSET_PANEL_WIDTH, nextWidth)));
    };
    const stopResizing = () => setIsResizing(false);
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResizing);
    window.addEventListener('pointercancel', stopResizing);

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResizing);
      window.removeEventListener('pointercancel', stopResizing);
    };
  }, [isResizing]);

  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const direction = event.key === 'ArrowLeft' ? 1 : -1;
    setAssetPanelWidth((width) => Math.max(MIN_ASSET_PANEL_WIDTH, Math.min(MAX_ASSET_PANEL_WIDTH, width + direction * 24)));
  };

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsResizing(true);
  };

  const handleGenerate = async () => {
    const prompt = mode === 'custom' ? lyrics.trim() : (style.trim() || lyrics.trim());
    if (!prompt) { setError(mode === 'custom' ? '请先填写歌词' : '请先填写音乐创意'); return; }
    if (mode === 'custom' && (!style.trim() || !title.trim())) { setError('自定义模式需要填写风格和歌曲名称'); return; }
    setBusy(true); setError('');
    try {
      const task = await generateSunoMusic({
        mode,
        prompt,
        ...(mode === 'custom' ? { style: style.trim(), title: title.trim(), instrumental } : { instrumental }),
        model: 'V4_5ALL',
      });
      setCurrentTask(task);
      setWorks((items) => [task, ...items.filter((item) => item.id !== task.id)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Suno 任务提交失败');
    } finally { setBusy(false); }
  };

  const assetRows = works.flatMap((task) => task.clips.map((clip, index) => ({
    task,
    clip,
    index,
    audioUrl: resolveSunoAssetUrl(clip.audio_url || clip.stream_audio_url),
    imageUrl: resolveSunoAssetUrl(clip.image_url),
    localized: Boolean(clip.audio_asset_id || clip.image_asset_id),
  })));

  return (
    <div className="flex h-screen w-full bg-white text-slate-800">
      {/* 左侧专属侧边栏 */}
      <MusicSidebar activeTab={activeTab} onTabChange={onTabChange} onBack={onBack} />

      {/* 主内容区 */}
      <div className="flex flex-1 flex-col">
        {/* 顶部导航 */}
        <header className="flex items-center justify-between border-b border-slate-200 bg-sky-600 px-6 py-3 text-white">
          <div className="flex items-center gap-8">
            <span className="text-xl font-bold">MINIMAX</span>
            <nav className="flex items-center gap-1">
              <button className="flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium text-white/80 hover:text-white">
                <Mic size={16} aria-hidden="true" />
                语音
              </button>
              <button className="flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium text-white">
                <Music size={16} aria-hidden="true" />
                音乐
              </button>
              <button className="flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium text-white/80 hover:text-white">
                <Video size={16} aria-hidden="true" />
                视频
              </button>
            </nav>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm">
              <span className="font-semibold">Music 3.0</span>
              创作者内测开启，限时免费活动继续
            </span>
            <button className="rounded-full bg-white px-4 py-1.5 text-sm font-medium text-sky-700 hover:bg-sky-50">
              开始创作
            </button>
            <div className="flex items-center gap-2">
              <button className="rounded-full p-1 text-white/80 hover:text-white hover:bg-white/10">
                <Settings size={18} aria-hidden="true" />
              </button>
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-sm font-medium">
                S
              </div>
            </div>
          </div>
        </header>

        {/* 主工作区 */}
        <main className="flex min-h-0 flex-1 overflow-hidden">
          {/* 左侧创作区 */}
          <div className="min-h-0 flex flex-1 flex-col overflow-y-auto p-6 scrollbar-none">
            {/* 标题 + 模型 */}
            <div className="flex items-start justify-between mb-6">
              <div>
                <h1 className="text-2xl font-semibold text-slate-900">音乐创作</h1>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5">
                  <span className="text-xs text-slate-500">模型</span>
                  <button className="flex items-center gap-1 text-sm font-medium text-slate-700 hover:text-slate-900">
                    Music 3.0
                    <span className="ml-1 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
                      New
                    </span>
                    <ChevronDown size={12} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>

            <div className="mb-6 flex items-center gap-2 rounded-xl bg-slate-50 p-1">
              {([['custom', '自定义模式'], ['inspiration', '灵感模式']] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => { setMode(value); setError(''); }}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${mode === value ? 'bg-white text-sky-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >{label}</button>
              ))}
            </div>

            {/* 参考音乐卡片 */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 mb-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-6 w-6 items-center justify-center rounded bg-sky-100">
                    <Music2 size={14} className="text-sky-700" aria-hidden="true" />
                  </div>
                  <span className="text-sm font-medium text-slate-700">参考音乐（可选）</span>
                </div>
                <span className="text-[11px] text-slate-500">点击添加参考上传，生成音乐更像（上传参考音服务量）</span>
              </div>
            </div>

            {/* 歌词输入 */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-slate-700">歌词</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">上传歌词</span>
                  <button type="button" onClick={() => setInstrumental((value) => !value)} className={`rounded-full px-2 py-1 text-[10px] ${instrumental ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-400'}`}>纯音乐{instrumental ? '：开' : ''}</button>
                </div>
              </div>
              <textarea
                value={lyrics}
                onChange={(e) => setLyrics(e.target.value)}
                placeholder="在此添加你的歌词，也可以输入 / 查看快捷输入规则结构
你可以在 [Intro]、[Verse]、[Chorus] 等标签后补充人声、人声、情绪等说明
如果未填写歌词，我们将根据风格为你自动生成"
                className="w-full h-40 rounded-xl border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-[11px] text-slate-400">{lyrics.length} / 5,000 字符</span>
                <button className="text-xs text-slate-500 hover:text-slate-700">
                  <GripVertical size={14} className="inline-block mr-1" aria-hidden="true" />
                </button>
              </div>
            </div>

            {/* 风格输入 */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-slate-700">风格</span>
                <button className="text-xs text-slate-500 hover:text-slate-700">
                  <Palette size={14} className="inline-block mr-1" aria-hidden="true" />
                </button>
              </div>
              <textarea
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                placeholder="描述音乐风格与制作要求，例如国风、伤感、欢快、乐段人声采集等"
                className="w-full h-24 rounded-xl border border-slate-200 bg-white p-4 text-sm leading-relaxed text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-[11px] text-slate-400">{style.length} / 1,000 字符</span>
              </div>
            </div>

            {/* 风格标签 */}
            <div className="flex flex-wrap gap-2 mb-6">
              {STYLE_TAGS.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => setStyle((value) => value ? `${value}, ${tag}` : tag)}
                  className="flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:border-violet-300 hover:text-violet-700"
                >
                  <span className="text-[12px]">＋</span>
                  {tag}
                </button>
              ))}
            </div>

            {/* 歌曲名称 + Suno 双候选提示 */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <div>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="歌曲名称（可选）"
                  className="w-full rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
              <div className="flex items-center gap-4">
                <div className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-600">每次生成 2 个候选</div>
                <div className="flex items-center gap-1 rounded-full bg-sky-50 px-3 py-1">
                  <Sparkles size={12} className="text-sky-600" aria-hidden="true" />
                  <span className="text-[11px] text-sky-700 font-medium">限时免费</span>
                </div>
              </div>
            </div>

            {/* 底部按钮 */}
            {error && <p role="alert" className="mb-2 text-sm text-rose-600">{error}</p>}
            <button onClick={() => void handleGenerate()} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-sky-600 py-3 text-sm font-medium text-white shadow-md shadow-sky-500/20 transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60">
              {busy ? <><Loader2 size={16} className="animate-spin"/>提交中…</> : <><Sparkles size={16}/>立即生成</>}
            </button>
          </div>

          {/* 中间可拖拽分隔线 */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="调整歌曲与资产面板宽度"
            aria-valuemin={MIN_ASSET_PANEL_WIDTH}
            aria-valuemax={MAX_ASSET_PANEL_WIDTH}
            aria-valuenow={assetPanelWidth}
            tabIndex={0}
            onPointerDown={handleResizePointerDown}
            onKeyDown={handleResizeKeyDown}
            onDoubleClick={() => setAssetPanelWidth(DEFAULT_ASSET_PANEL_WIDTH)}
            className="group relative z-10 flex w-2 shrink-0 cursor-col-resize items-center justify-center border-x border-slate-200 bg-slate-50 transition-colors hover:bg-sky-50 focus:outline-none focus:ring-2 focus:ring-sky-400"
          >
            <span className="h-10 w-0.5 rounded-full bg-slate-300 transition-colors group-hover:bg-sky-400" aria-hidden="true" />
          </div>

          {/* 右侧资产面板 */}
          <aside className="flex min-h-0 w-80 shrink-0 flex-col bg-white lg:w-96" style={{ width: `min(${assetPanelWidth}px, 100%)` }}>
            <div className="flex overflow-x-auto border-b border-slate-200 px-4 pt-3 scrollbar-none sm:px-6">
              {([
                ['works', '歌曲'],
                ['lyrics', '灵感歌词'],
                ['assets', '本地素材'],
                ['favorites', '收藏'],
              ] as const).map(([tab, label]) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveRightTab(tab)}
                  className={`shrink-0 px-3 pb-3 text-sm font-medium transition sm:flex-1 ${activeRightTab === tab ? 'border-b-2 border-sky-600 text-sky-700' : 'text-slate-500 hover:text-slate-700'}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-none sm:p-6">
              {activeRightTab === 'works' && (
                works.length ? <div className="space-y-4">
                  {works.map((task) => {
                    const taskTitle = String(task.request?.title || '未命名作品');
                    const taskLyrics = getTaskLyrics(task);
                    return <article key={task.id} className={`rounded-xl border p-3 transition ${currentTask?.id === task.id ? 'border-sky-300 bg-sky-50/60 shadow-sm' : 'border-slate-200'}`}>
                      <button type="button" onClick={() => setCurrentTask(task)} aria-pressed={currentTask?.id === task.id} className="mb-2 flex w-full items-start justify-between gap-2 text-left">
                        <span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-800">{taskTitle}</span><span className="mt-0.5 block text-xs text-slate-500">{task.status} · {task.progress}%</span></span>
                        <span className="flex shrink-0 items-center gap-1.5 text-xs">{task.status === 'SUCCESS' ? <span className="text-emerald-600">已完成</span> : <span className="text-slate-400">处理中</span>}<Star size={15} className="text-slate-300" aria-hidden="true" /></span>
                      </button>
                      {task.clips.length ? <div className="space-y-2">
                        {task.clips.slice(0, 2).map((clip, index) => {
                          const audioUrl = resolveSunoAssetUrl(clip.audio_url || clip.stream_audio_url);
                          const imageUrl = resolveSunoAssetUrl(clip.image_url);
                          return <div key={clip.id} className="flex items-center gap-2 rounded-lg bg-white p-2">
                            {imageUrl ? <img src={imageUrl} alt={`${clip.title || '候选音频'} 封面`} className="h-11 w-11 rounded object-cover"/> : <div className="flex h-11 w-11 items-center justify-center rounded bg-slate-100"><Music2 size={16} className="text-slate-400"/></div>}
                            <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{clip.title || `候选 ${String.fromCharCode(65 + index)}`}</p><p className="text-[11px] text-slate-400">{clip.duration ? `${Math.round(clip.duration)} 秒` : '生成中'}</p></div>
                            {audioUrl ? <><AudioTrackPlayer src={audioUrl} duration={clip.duration}/><a href={audioUrl} download className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="下载音频"><Download size={14}/></a></> : <Play size={15} className="text-slate-300"/>}
                          </div>;
                        })}
                      </div> : <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${Math.max(4, task.progress)}%` }}/></div>}
                      {taskLyrics && <div className="mt-3 rounded-lg bg-slate-50 px-3 py-2"><p className="mb-1 text-[11px] font-medium text-slate-500">歌词</p><p className="line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-slate-600">{taskLyrics}</p></div>}
                    </article>;
                  })}
                </div> : <EmptyRightPanel icon={<Music2 size={24} />} text="暂时没有歌曲，在左侧输入灵感后开始创作" />
              )}

              {activeRightTab === 'lyrics' && (
                works.length ? <div className="space-y-4">
                  <div className="flex items-center justify-between"><div><h2 className="text-base font-semibold text-slate-900">生成过的歌词</h2><p className="mt-1 text-xs text-slate-500">歌词会随歌曲任务一起保存，可切换历史作品查看</p></div><FileText size={18} className="text-sky-600" aria-hidden="true" /></div>
                  {works.map((task) => {
                    const taskLyrics = getTaskLyrics(task);
                    const isCurrent = currentTask?.id === task.id;
                    return <details key={task.id} open={isCurrent} className={`rounded-xl border p-4 transition ${isCurrent ? 'border-sky-300 bg-sky-50/60 shadow-sm' : 'border-slate-200 bg-white'}`}>
                      <summary onClick={() => setCurrentTask(task)} className="cursor-pointer list-none text-sm font-semibold text-slate-800">{String(task.request?.title || '未命名作品')}<span className="ml-2 text-xs font-normal text-slate-400">{task.status} · {task.progress}%</span></summary>
                      <div className="mt-3 border-t border-slate-200/80 pt-3"><p className="mb-2 text-xs font-medium text-slate-500">{task.mode === 'inspiration' ? '灵感歌词' : '自定义歌词'}</p><pre className="max-h-[min(52vh,520px)] overflow-y-auto whitespace-pre-wrap font-sans text-sm leading-7 text-slate-700 scrollbar-none">{taskLyrics || '当前任务还没有返回歌词内容。'}</pre></div>
                      {isCurrent && taskLyrics && <button type="button" onClick={() => { setLyrics(taskLyrics); setMode('custom'); }} className="mt-3 w-full rounded-lg border border-sky-200 bg-white px-3 py-2 text-sm font-medium text-sky-700 hover:bg-sky-50">带入左侧歌词编辑</button>}
                    </details>;
                  })}
                </div> : <EmptyRightPanel icon={<FileText size={24} />} text="生成歌曲后，歌词会显示在这里" />
              )}

              {activeRightTab === 'assets' && (
                assetRows.length ? <div className="space-y-4"><div className="flex items-center justify-between"><div><h2 className="text-base font-semibold text-slate-900">本地素材</h2><p className="mt-1 text-xs text-slate-500">音频与封面会在后端转存后长期保留</p></div><FolderOpen size={18} className="text-sky-600" aria-hidden="true" /></div>{assetRows.map(({ task, clip, index, audioUrl, imageUrl, localized }) => <article key={`${task.id}-${clip.id}`} className="rounded-xl border border-slate-200 bg-white p-3"><div className="flex gap-3">{imageUrl ? <img src={imageUrl} alt={`${clip.title || '歌曲'} 封面`} className="h-16 w-16 rounded-lg object-cover"/> : <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg bg-slate-100"><Music2 size={22} className="text-slate-400"/></div>}<div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><h3 className="truncate text-sm font-semibold text-slate-800">{clip.title || `候选 ${String.fromCharCode(65 + index)}`}</h3><p className="mt-1 truncate text-xs text-slate-500">{String(task.request?.title || '未命名作品')}</p></div><span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-medium ${localized ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>{localized ? '已本地化' : '远程临时'}</span></div>{audioUrl && <div className="mt-2 flex items-center gap-2"><AudioTrackPlayer src={audioUrl} duration={clip.duration}/><a href={audioUrl} download className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-50" aria-label="下载本地音频"><Download size={14}/></a></div>}</div></div></article>)}</div> : <EmptyRightPanel icon={<FolderOpen size={24} />} text="生成完成后，音频和封面会出现在这里" />
              )}

              {activeRightTab === 'favorites' && <EmptyRightPanel icon={<Heart size={24} />} text="收藏夹是空的" />}
            </div>
          </aside>
        </main>

        {/* 底部 */}
        <div className="border-t border-slate-200 px-6 py-2 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <span className="text-[10px] text-slate-400">相关免责</span>
            <span className="text-[10px] text-slate-400">API</span>
            <span className="text-[10px] text-slate-400">用户协议</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500">隐私政策</span>
            <span className="text-[10px] text-slate-400">•</span>
            <span className="text-[10px] text-slate-400">©MinMax 2024</span>
          </div>
        </div>

        {/* 右下角图标 */}
        <div className="absolute bottom-4 right-4 flex flex-col gap-2">
          <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center text-white">
            <div className="w-6 h-6 rounded-full bg-slate-600 flex items-center justify-center text-xs">
              秒
            </div>
          </div>
          <div className="w-10 h-10 rounded-full bg-sky-600 flex items-center justify-center text-white">
            <ArrowUpRight size={18} aria-hidden="true" />
          </div>
        </div>
      </div>
    </div>
  );
}
