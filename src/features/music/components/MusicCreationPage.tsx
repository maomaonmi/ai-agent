'use client';

import { useEffect, useRef, useState } from 'react';
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
  Loader2,
  Download,
} from 'lucide-react';
import MusicSidebar, { type MusicTab } from './MusicSidebar';
import { generateSunoMusic, listSunoTasks, openSunoTaskStream, resolveSunoAssetUrl, type SunoTask } from '../api';

interface MusicCreationPageProps {
  activeTab: MusicTab;
  onTabChange: (tab: MusicTab) => void;
  onBack: () => void;
}

const STYLE_TAGS = ['中国风', '管弦乐团', '键盘乐器', '蓝调', '古典', '世界音乐'];

export default function MusicCreationPage({ activeTab, onTabChange, onBack }: MusicCreationPageProps) {
  const [lyrics, setLyrics] = useState('');
  const [style, setStyle] = useState('');
  const [title, setTitle] = useState('');
  const [activeRightTab, setActiveRightTab] = useState<'works' | 'favorites'>('works');
  const [mode, setMode] = useState<'inspiration' | 'custom'>('custom');
  const [instrumental, setInstrumental] = useState(false);
  const [works, setWorks] = useState<SunoTask[]>([]);
  const [currentTask, setCurrentTask] = useState<SunoTask | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const streamRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let cancelled = false;
    listSunoTasks().then((tasks) => {
      if (!cancelled) {
        setWorks(tasks);
        setCurrentTask(tasks.find((task) => !['SUCCESS', 'FAILED', 'TIMED_OUT'].includes(task.status)) || tasks[0] || null);
      }
    }).catch(() => undefined);
    return () => { cancelled = true; streamRef.current?.close(); };
  }, []);

  useEffect(() => {
    streamRef.current?.close();
    if (!currentTask || ['SUCCESS', 'FAILED', 'TIMED_OUT'].includes(currentTask.status)) return;
    streamRef.current = openSunoTaskStream(currentTask.id, (task) => {
      setCurrentTask(task);
      setWorks((items) => [task, ...items.filter((item) => item.id !== task.id)]);
    }, () => undefined);
    return () => streamRef.current?.close();
  }, [currentTask?.id]);

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
        <main className="flex flex-1 overflow-hidden">
          {/* 左侧创作区 */}
          <div className="flex flex-1 flex-col p-6 overflow-y-auto">
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

          {/* 右侧面板 */}
          <aside className="flex w-96 flex-col border-l border-slate-200 bg-white">
            {/* 顶部标签页 */}
            <div className="flex border-b border-slate-200 px-6 pt-3">
              <button
                onClick={() => setActiveRightTab('works')}
                className={`flex-1 pb-2 text-sm font-medium transition ${
                  activeRightTab === 'works' ? 'border-b-2 border-sky-600 text-sky-700' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                作品
              </button>
              <button
                onClick={() => setActiveRightTab('favorites')}
                className={`flex-1 pb-2 text-sm font-medium transition ${
                  activeRightTab === 'favorites' ? 'border-b-2 border-sky-600 text-sky-700' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                收藏
              </button>
            </div>

            {/* 内容区 */}
            <div className="flex-1 overflow-y-auto p-6">
              {activeRightTab === 'works' ? (
                works.length ? <div className="space-y-4">
                  {works.map((task) => (
                    <div key={task.id} className={`rounded-xl border p-3 ${currentTask?.id === task.id ? 'border-sky-300 bg-sky-50/60' : 'border-slate-200'}`}>
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-800">{String(task.request?.title || '未命名作品')}</p>
                          <p className="text-xs text-slate-500">{task.status} · {task.progress}%</p>
                        </div>
                        {task.status === 'SUCCESS' && <span className="text-xs text-emerald-600">已完成</span>}
                      </div>
                      {task.clips.length ? <div className="space-y-2">
                        {task.clips.slice(0, 2).map((clip, index) => {
                          const audioUrl = resolveSunoAssetUrl(clip.audio_url);
                          const imageUrl = resolveSunoAssetUrl(clip.image_url);
                          return <div key={clip.id} className="flex items-center gap-2 rounded-lg bg-white p-2">
                            {imageUrl ? <img src={imageUrl} alt="" className="h-10 w-10 rounded object-cover"/> : <div className="flex h-10 w-10 items-center justify-center rounded bg-slate-100"><Music2 size={16} className="text-slate-400"/></div>}
                            <div className="min-w-0 flex-1"><p className="truncate text-xs font-medium">{clip.title || `候选 ${String.fromCharCode(65 + index)}`}</p><p className="text-[11px] text-slate-400">{clip.duration ? `${Math.round(clip.duration)} 秒` : '生成中'}</p></div>
                            {audioUrl && <><audio controls preload="none" className="h-8 w-28" src={audioUrl}/><a href={audioUrl} download className="rounded p-1 text-slate-500 hover:bg-slate-100" aria-label="下载音频"><Download size={14}/></a></>}
                            {!audioUrl && <Play size={15} className="text-slate-300"/>}
                          </div>;
                        })}
                      </div> : <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-sky-500 transition-all" style={{ width: `${Math.max(4, task.progress)}%` }}/></div>}
                    </div>
                  ))}
                </div> : <div className="flex h-full flex-col items-center justify-center text-center"><div className="mb-4 flex h-24 w-24 items-center justify-center rounded-xl bg-slate-50"><div className="flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100"><Music2 size={24} className="text-slate-300" /></div></div><p className="text-sm text-slate-500">暂时没有作品，在此次文本中输入信息进行音乐创作</p></div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center">
                  <div className="w-24 h-24 mb-4 rounded-xl bg-slate-50 flex items-center justify-center">
                    <div className="w-12 h-12 rounded-lg bg-slate-100 flex items-center justify-center">
                      <Music2 size={24} className="text-slate-300" aria-hidden="true" />
                    </div>
                  </div>
                  <p className="text-sm text-slate-500">
                    收藏夹是空的
                  </p>
                </div>
              )}
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
