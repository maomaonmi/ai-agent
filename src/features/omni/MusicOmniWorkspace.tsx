'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, Loader2, Music2, Play, Save, Sparkles } from 'lucide-react';
import { generateSunoMusic, openSunoTaskStream, resolveSunoAssetUrl, type SunoTask } from '../music/api';
import { composeMusicStyle, INSTRUMENT_PRESETS, STYLE_PRESETS } from '../music/musicCreationPresets';
import { createArtifactVersion } from './api';
import { readMusicArtifactPayload, type MusicArtifactPayload } from './musicArtifactAdapter';
import type { Artifact, ArtifactVersion } from './types';

const TERMINAL_STATUSES = new Set(['SUCCESS', 'FAILED', 'TIMED_OUT']);

export default function MusicOmniWorkspace({ artifact, version }: { artifact: Artifact; version: ArtifactVersion }) {
  const initial = readMusicArtifactPayload(version.payload);
  const [title, setTitle] = useState(initial?.title || artifact.title);
  const [lyrics, setLyrics] = useState(initial?.lyrics || '');
  const [instruction, setInstruction] = useState(initial?.instruction || '');
  const [style, setStyle] = useState(initial?.style || '');
  const [task, setTask] = useState<SunoTask | null>(initial?.task || null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const streamRef = useRef<EventSource | null>(null);
  const persistedTerminalRef = useRef('');

  const payload = (nextTask: SunoTask | null, stage: MusicArtifactPayload['stage']): MusicArtifactPayload => ({
    schemaVersion: 1, stage, title: title.trim() || '未命名歌曲', lyrics, instruction, style, task: nextTask,
  });

  const persist = async (nextTask: SunoTask | null, status: ArtifactVersion['status'], summary: string) => {
    return createArtifactVersion(artifact.id, {
      conversationId: artifact.originConversationId,
      messageId: `music-${crypto.randomUUID()}`,
      summary,
      sourceRef: { type: 'music_task', musicTaskId: nextTask?.id || `lyrics-${crypto.randomUUID()}` },
      payload: payload(nextTask, nextTask ? 'music' : 'lyrics'),
      status,
    });
  };

  useEffect(() => {
    streamRef.current?.close();
    if (!task || TERMINAL_STATUSES.has(task.status)) return undefined;
    streamRef.current = openSunoTaskStream(task.id, (nextTask) => {
      setTask(nextTask);
      if (!TERMINAL_STATUSES.has(nextTask.status) || persistedTerminalRef.current === nextTask.status) return;
      persistedTerminalRef.current = nextTask.status;
      void persist(nextTask, nextTask.status === 'SUCCESS' ? 'ready' : 'failed', nextTask.status === 'SUCCESS' ? '音乐生成完成。' : '音乐生成未完成。');
    }, () => setError('音乐任务连接中断，可稍后重新打开作品查看。'));
    return () => streamRef.current?.close();
  // The stream is keyed only by task identity; editor text remains the latest local draft.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);

  const toggleToken = (token: string) => {
    setStyle((current) => {
      const values = current.split(',').map((item) => item.trim()).filter(Boolean);
      return values.includes(token) ? values.filter((item) => item !== token).join(', ') : [...values, token].join(', ');
    });
  };

  const saveLyrics = async () => {
    setSaving(true); setError('');
    try { await persist(null, 'draft', '更新歌词与音乐创作指令。'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '歌词保存失败'); }
    finally { setSaving(false); }
  };

  const generate = async () => {
    if (!lyrics.trim()) { setError('请先填写歌词'); return; }
    const finalStyle = composeMusicStyle(instruction, style.split(',').map((item) => item.trim()).filter(Boolean), []);
    if (!finalStyle) { setError('请添加情感、曲风或乐器指令'); return; }
    setBusy(true); setError('');
    try {
      const nextTask = await generateSunoMusic({ mode: 'custom', prompt: lyrics.trim(), style: finalStyle, title: title.trim() || '未命名歌曲', model: 'V4_5ALL' });
      setTask(nextTask);
      await persist(nextTask, 'generating', '音乐任务已提交，正在生成。');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '音乐生成失败'); }
    finally { setBusy(false); }
  };

  const clips = task?.clips || [];
  const background = resolveSunoAssetUrl(clips.find((clip) => clip.image_url)?.image_url);
  return <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-white">
    {background && <div className="pointer-events-none absolute inset-0 bg-cover bg-center opacity-20 blur-sm" style={{ backgroundImage: `url(${background})` }} aria-hidden="true" />}
    <div className="relative grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
      <section className="flex min-h-0 flex-col border-b border-slate-200 bg-white/85 lg:border-b-0 lg:border-r" aria-label="歌词工作台">
        <header className="flex items-center gap-2 border-b border-slate-200 px-5 py-3"><Music2 size={17} className="text-sky-600"/><input value={title} onChange={(event) => setTitle(event.target.value)} aria-label="歌曲标题" className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-900 outline-none"/></header>
        <textarea value={lyrics} onChange={(event) => setLyrics(event.target.value)} aria-label="编辑歌词" className="min-h-56 flex-1 resize-none bg-transparent px-5 py-4 text-sm leading-7 text-slate-800 outline-none" placeholder="在这里编辑歌词…" />
        <div className="space-y-3 border-t border-slate-200 bg-white/80 p-4">
          <input value={instruction} onChange={(event) => setInstruction(event.target.value)} aria-label="音乐创作指令" placeholder="例如：克制的思念，女声，副歌加入弦乐推进" className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400"/>
          <div className="flex gap-1.5 overflow-x-auto pb-1">{[...STYLE_PRESETS.slice(0, 6), ...INSTRUMENT_PRESETS.slice(0, 6)].map((token) => <button key={token} type="button" onClick={() => toggleToken(token)} className={`shrink-0 rounded-full border px-2.5 py-1 text-xs ${style.split(',').map((item) => item.trim()).includes(token) ? 'border-sky-300 bg-sky-50 text-sky-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{token}</button>)}</div>
          <div className="flex items-center justify-between"><span className="text-xs text-slate-400">{lyrics.length} 字符</span><div className="flex gap-2"><button type="button" onClick={() => void saveLyrics()} disabled={saving || busy} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">{saving ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>}保存歌词</button><button type="button" onClick={() => void generate()} disabled={busy || saving} className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50">{busy ? <Loader2 size={14} className="animate-spin"/> : <Sparkles size={14}/>}生成音乐</button></div></div>
          {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
        </div>
      </section>
      <section className="relative min-h-64 overflow-y-auto bg-slate-950/5 p-5" aria-label="音乐生成结果">
        <div className="mb-4 flex items-center justify-between"><div><h3 className="text-sm font-semibold text-slate-900">音乐生成结果</h3><p className="mt-1 text-xs text-slate-500">{task ? `${task.status} · ${task.progress}%` : '编辑歌词并设置风格后开始生成'}</p></div>{task && !TERMINAL_STATUSES.has(task.status) && <Loader2 size={18} className="animate-spin text-sky-600"/>}</div>
        <div className="space-y-3">{clips.map((clip, index) => { const audio = resolveSunoAssetUrl(clip.audio_url || clip.stream_audio_url); const image = resolveSunoAssetUrl(clip.image_url); return <article key={clip.id || index} className="overflow-hidden rounded-xl border border-white/50 bg-white/75 shadow-sm backdrop-blur"><div className="flex gap-3 p-3">{image ? <span className="h-16 w-16 shrink-0 rounded-lg bg-cover bg-center" style={{ backgroundImage: `url(${image})` }} role="img" aria-label={`${clip.title || title} 封面`} /> : <div className="flex h-16 w-16 items-center justify-center rounded-lg bg-slate-100"><Music2 size={20}/></div>}<div className="min-w-0 flex-1"><h4 className="truncate text-sm font-medium text-slate-900">{clip.title || title || `版本 ${index + 1}`}</h4><p className="mt-1 truncate text-xs text-slate-500">{clip.tags || style || instruction}</p><div className="mt-2 flex gap-2">{audio && <a href={audio} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-full bg-slate-900 px-3 py-1 text-xs text-white"><Play size={11} fill="currentColor"/>播放</a>}{audio && <a href={audio} download className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600"><Download size={11}/>下载</a>}</div></div></div>{audio && <audio src={audio} controls className="w-full px-3 pb-3"/>}</article>; })}</div>
        {!task && <div className="flex h-48 flex-col items-center justify-center text-center text-slate-400"><Music2 size={30}/><p className="mt-3 text-sm">歌曲将在这里出现</p></div>}
      </section>
    </div>
  </div>;
}
