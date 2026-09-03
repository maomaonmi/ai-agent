'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, Music2, Save, Sparkles } from 'lucide-react';
import { generateSunoMusic, openSunoTaskStream, resolveSunoAssetUrl, type SunoTask } from '../music/api';
import { composeMusicStyle, INSTRUMENT_PRESETS, STYLE_PRESETS } from '../music/musicCreationPresets';
import { createArtifactVersion, type CreateArtifactResponse } from './api';
import { readMusicArtifactPayload, type MusicArtifactPayload } from './musicArtifactAdapter';
import type { Artifact, ArtifactVersion } from './types';
import MusicAudioPlayer from './MusicAudioPlayer';

const TERMINAL_STATUSES = new Set(['SUCCESS', 'FAILED', 'TIMED_OUT']);

interface MusicOmniWorkspaceProps {
  artifact: Artifact;
  version: ArtifactVersion;
  onGenerated?: (response: CreateArtifactResponse) => void;
}

export default function MusicOmniWorkspace({ artifact, version, onGenerated }: MusicOmniWorkspaceProps) {
  const initial = readMusicArtifactPayload(version.payload);
  const [title, setTitle] = useState(initial?.title || artifact.title);
  const [lyrics, setLyrics] = useState(initial?.lyrics || '');
  const [instruction, setInstruction] = useState(initial?.instruction || '');
  const [style, setStyle] = useState(initial?.style || '');
  const [task, setTask] = useState<SunoTask | null>(initial?.task || null);
  const [view, setView] = useState<'lyrics' | 'result'>(() => initial?.stage === 'music' && initial.task?.status === 'SUCCESS' ? 'result' : 'lyrics');
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const streamRef = useRef<EventSource | null>(null);
  const persistedTerminalRef = useRef('');

  const isTerminal = Boolean(task && TERMINAL_STATUSES.has(task.status));
  const isSuccessful = task?.status === 'SUCCESS';

  // ArtifactPanel keeps the workspace mounted while switching versions. Reset
  // local editor/result state whenever a new version is opened so the terminal
  // music version cannot continue rendering the previous lyrics draft.
  useEffect(() => {
    const next = readMusicArtifactPayload(version.payload);
    setTitle(next?.title || artifact.title);
    setLyrics(next?.lyrics || '');
    setInstruction(next?.instruction || '');
    setStyle(next?.style || '');
    setTask(next?.task || null);
    setView(next?.stage === 'music' && next.task?.status === 'SUCCESS' ? 'result' : 'lyrics');
    setError('');
    persistedTerminalRef.current = '';
  // Version identity is the stable boundary; payload fields are restored from that version.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version.id]);

  const buildPayload = (nextTask: SunoTask | null, stage: MusicArtifactPayload['stage']): MusicArtifactPayload => ({
    schemaVersion: 1,
    stage,
    title: title.trim() || '未命名歌曲',
    lyrics,
    instruction,
    style,
    task: nextTask,
  });

  const persist = async (nextTask: SunoTask | null, status: ArtifactVersion['status'], summary: string) => createArtifactVersion(artifact.id, {
    conversationId: artifact.originConversationId,
    messageId: `music-${crypto.randomUUID()}`,
    summary,
    sourceRef: { type: 'music_task', musicTaskId: nextTask?.id || `lyrics-${crypto.randomUUID()}` },
    payload: buildPayload(nextTask, nextTask ? 'music' : 'lyrics'),
    status,
  });

  useEffect(() => {
    streamRef.current?.close();
    if (!task || TERMINAL_STATUSES.has(task.status)) return undefined;
    streamRef.current = openSunoTaskStream(task.id, (nextTask) => {
      setTask(nextTask);
      if (!TERMINAL_STATUSES.has(nextTask.status) || persistedTerminalRef.current === nextTask.status) return;
      persistedTerminalRef.current = nextTask.status;
      if (nextTask.status === 'SUCCESS') setView('result');
      void persist(nextTask, nextTask.status === 'SUCCESS' ? 'ready' : 'failed', nextTask.status === 'SUCCESS' ? '音乐生成完成。' : '音乐生成未完成。').then((response) => onGenerated?.(response)).catch(() => setError('音乐结果已生成，但保存结果消息失败。'));
    }, () => setError('音乐任务连接中断，可稍后重新打开作品查看。'));
    return () => streamRef.current?.close();
  // The stream is keyed by task identity; editor values are read when each version is persisted.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id]);

  const toggleToken = (token: string) => setStyle((current) => {
    const values = current.split(',').map((item) => item.trim()).filter(Boolean);
    return values.includes(token) ? values.filter((item) => item !== token).join(', ') : [...values, token].join(', ');
  });

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
    setBusy(true); setError(''); setView('lyrics');
    try {
      const nextTask = await generateSunoMusic({ mode: 'custom', prompt: lyrics.trim(), style: finalStyle, title: title.trim() || '未命名歌曲', model: 'V4_5ALL' });
      setTask(nextTask);
      if (TERMINAL_STATUSES.has(nextTask.status)) {
        // Some providers can return a completed task from the create call
        // (for example when a cached result is available). Persist and expose
        // that result immediately instead of waiting for an SSE event that
        // will never arrive for an already-terminal task.
        persistedTerminalRef.current = nextTask.status;
        if (nextTask.status === 'SUCCESS') setView('result');
        const response = await persist(
          nextTask,
          nextTask.status === 'SUCCESS' ? 'ready' : 'failed',
          nextTask.status === 'SUCCESS' ? '音乐生成完成。' : '音乐生成未完成。',
        );
        onGenerated?.(response);
      } else {
        await persist(nextTask, 'generating', '音乐任务已提交，生成完成后会在对话中显示结果。');
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : '音乐生成失败'); }
    finally { setBusy(false); }
  };

  const taskLabel = task ? (isTerminal ? (isSuccessful ? '已完成' : '生成失败') : `生成中 · ${Math.max(0, Math.min(100, Number(task.progress) || 0))}%`) : '编辑歌词并设置风格后生成音乐';
  const resultClips = task?.clips.filter((clip) => clip.audio_url || clip.stream_audio_url) ?? [];
  const coverUrl = resolveSunoAssetUrl(task?.clips.find((clip) => clip.image_url)?.image_url);

  if (view === 'result' && isSuccessful) {
    return <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-slate-950" aria-label="音乐生成结果">
      {coverUrl && <div className="absolute inset-0 bg-cover bg-center opacity-25" style={{ backgroundImage: `url("${coverUrl.replace(/"/g, '\\"')}")` }} aria-hidden="true" />}
      <div className="absolute inset-0 bg-slate-950/65" aria-hidden="true" />
      <section className="relative flex min-h-0 flex-1 flex-col text-white">
        <header className="flex items-center gap-2 border-b border-white/10 px-5 py-3"><Music2 size={17} className="text-sky-300"/><h2 className="min-w-0 flex-1 truncate text-sm font-semibold">{title || artifact.title}</h2><span className="text-xs text-emerald-300">生成完成</span></header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
          {coverUrl && <div className="mx-auto mb-5 max-w-sm overflow-hidden rounded-2xl border border-white/15 shadow-2xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={coverUrl} alt={`${title || artifact.title}封面`} className="aspect-square w-full object-cover" />
          </div>}
          <div className="mx-auto max-w-xl rounded-2xl border border-white/15 bg-white/10 p-4 backdrop-blur-md">
            <p className="text-sm font-medium">{resultClips.length ? `已生成 ${resultClips.length} 个音乐版本` : '音乐已生成'}</p>
            <div className="mt-3 space-y-3">{resultClips.map((clip, index) => { const audioUrl = resolveSunoAssetUrl(clip.audio_url || clip.stream_audio_url); const clipTitle = clip.title || `音乐版本 ${index + 1}`; return audioUrl ? <div key={clip.id || index} className="rounded-xl bg-black/25 px-3 py-2.5"><div className="mb-1.5 flex items-center gap-2 text-xs text-white/80"><Music2 size={13} className="text-sky-300" />{clipTitle}</div><MusicAudioPlayer src={audioUrl} title={clipTitle} dark /></div> : null; })}</div>
          </div>
          <details className="mx-auto mt-4 max-w-xl rounded-xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-white/75"><summary className="cursor-pointer">查看歌词</summary><pre className="mt-3 whitespace-pre-wrap font-sans leading-7">{lyrics}</pre></details>
        </div>
        <footer className="flex justify-end border-t border-white/10 px-5 py-3"><button type="button" onClick={() => setView('lyrics')} className="inline-flex items-center gap-1.5 rounded-lg border border-white/20 px-3 py-2 text-xs font-medium text-white/90 hover:bg-white/10"><Save size={14}/>返回编辑歌词</button></footer>
      </section>
    </div>;
  }

  return <div className="flex h-full min-h-0 flex-col bg-white">
    <section className="flex min-h-0 flex-1 flex-col" aria-label="歌词工作台">
      <header className="flex items-center gap-2 border-b border-slate-200 px-5 py-3"><Music2 size={17} className="text-sky-600"/><input value={title} onChange={(event) => setTitle(event.target.value)} aria-label="歌曲标题" className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-slate-900 outline-none"/><span className="text-xs text-slate-400">{taskLabel}</span></header>
      {(busy || (task && !isTerminal)) && <div className="border-b border-sky-100 bg-sky-50/70 px-5 py-3" role="status" aria-label="音乐生成进度"><div className="flex items-center justify-between text-xs font-medium text-sky-800"><span className="inline-flex items-center gap-1.5"><Loader2 size={13} className="animate-spin"/>{busy && !task ? '正在提交音乐任务…' : '音乐正在生成，完成后会自动显示结果'}</span><span>{task ? `${Math.max(0, Math.min(100, Number(task.progress) || 0))}%` : '准备中'}</span></div><div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sky-100"><div className="h-full rounded-full bg-sky-500 transition-[width] duration-500" style={{ width: `${Math.max(2, Math.min(100, Number(task?.progress) || 0))}%` }} /></div></div>}
      <textarea value={lyrics} onChange={(event) => setLyrics(event.target.value)} aria-label="编辑歌词" className="min-h-56 flex-1 resize-none bg-transparent px-5 py-4 text-sm leading-7 text-slate-800 outline-none" placeholder="在这里编辑歌词…" />
      <div className="space-y-3 border-t border-slate-200 bg-white p-4">
        <input value={instruction} onChange={(event) => setInstruction(event.target.value)} aria-label="音乐创作指令" placeholder="例如：克制的思念，女声，副歌加入弦乐推进" className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-sky-400"/>
        <div className="flex gap-1.5 overflow-x-auto pb-1">{[...STYLE_PRESETS.slice(0, 6), ...INSTRUMENT_PRESETS.slice(0, 6)].map((token) => <button key={token} type="button" onClick={() => toggleToken(token)} className={`shrink-0 rounded-full border px-2.5 py-1 text-xs ${style.split(',').map((item) => item.trim()).includes(token) ? 'border-sky-300 bg-sky-50 text-sky-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}>{token}</button>)}</div>
        <div className="flex items-center justify-between"><span className="text-xs text-slate-400">{lyrics.length} 字符</span><div className="flex gap-2"><button type="button" onClick={() => void saveLyrics()} disabled={saving || busy || Boolean(task && !isTerminal)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">{saving ? <Loader2 size={14} className="animate-spin"/> : <Save size={14}/>}保存歌词</button><button type="button" onClick={() => void generate()} disabled={busy || saving || Boolean(task && !isTerminal)} className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-4 py-2 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50">{busy || (task && !isTerminal) ? <Loader2 size={14} className="animate-spin"/> : <Sparkles size={14}/>} {busy || (task && !isTerminal) ? '生成中…' : '生成音乐'}</button></div></div>
        {error && <p role="alert" className="text-xs text-rose-600">{error}</p>}
      </div>
    </section>
  </div>;
}
