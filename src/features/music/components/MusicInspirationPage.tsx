'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Loader2, RotateCcw, Save, Sparkles } from 'lucide-react';
import {
  createSession,
  getSessionHistory,
  listSessions,
  saveSessionSnapshot,
  sendChatMessage,
  type ChatMessage,
  type SessionSnapshot,
  type SessionSummary,
} from '../../../lib/api';
import { buildMusicAgentPrompt, musicSessionTitle, parseMusicDraft, type MusicProvider } from '../musicInspiration';
import MusicInspirationComposer from './MusicInspirationComposer';
import MusicShowcaseGrid from './MusicShowcaseGrid';
import { inspirationFromTrack, type MusicTrack } from '../musicCatalog';

const EMPTY_DOCUMENT = { title: '', lyrics: '', provider: 'deepseek' as MusicProvider, status: 'generating' as const };
type MusicDocument = NonNullable<SessionSnapshot['musicDocument']>;
const PROVIDER_LABELS: Record<MusicProvider, string> = { deepseek: 'DeepSeek', qwen: '千问 Qwen', glm: '智谱 GLM', minimax: 'MiniMax' };

function snapshot(messages: ChatMessage[], reasoningSteps: string[], musicDocument: SessionSnapshot['musicDocument']): SessionSnapshot {
  return {
    messages, reasoningSteps, musicDocument,
    webDocs: [], researchChunks: [], agentTalks: [], planProgress: null,
    discussionLength: 'brief', discussionAgentIds: [], discussionRounds: 1,
    webSearch: 'off', deepThinking: 'on', mcpMode: 'off', mcpServerIds: [], skillMode: 'off', skillIds: [],
    webSearchOptions: { limit: 5, timeRange: '', location: '', scrapeTopN: 0, highlights: false },
    qwenNativeSearchOptions: { searchStrategy: 'turbo', forcedSearch: false, enableSearchExtension: false, freshness: 0, assignedSiteList: [], promptIntervene: '' },
  };
}

export default function MusicInspirationPage({
  activeSessionId,
  onSessionsChange,
}: {
  activeSessionId: string | null;
  onSessionsChange: (sessions: SessionSummary[], activeId?: string) => void;
}) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reasoningSteps, setReasoningSteps] = useState<string[]>([]);
  const [document, setDocument] = useState<MusicDocument>(EMPTY_DOCUMENT);
  const [savedLyrics, setSavedLyrics] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [suggestedInspiration, setSuggestedInspiration] = useState('');
  const activeRequest = useRef(0);

  const refreshSessions = useCallback(async (nextActive?: string) => {
    const result = await listSessions();
    onSessionsChange(result.sessions.filter((item) => item.mode === 'music'), nextActive);
  }, [onSessionsChange]);

  useEffect(() => {
    if (!activeSessionId || activeSessionId === sessionId) return;
    let live = true;
    getSessionHistory(activeSessionId).then(({ snapshot: stored }) => {
      if (!live) return;
      setSessionId(activeSessionId);
      setMessages(stored.messages ?? []);
      setReasoningSteps(stored.reasoningSteps ?? []);
      if (stored.musicDocument) {
        setDocument(stored.musicDocument);
        setSavedLyrics(stored.musicDocument.lyrics);
      }
      setError('');
    }).catch((reason) => live && setError(reason instanceof Error ? reason.message : '读取会话失败'));
    return () => { live = false; };
  }, [activeSessionId, sessionId]);

  const persist = useCallback(async (id: string, nextMessages: ChatMessage[], nextReasoning: string[], nextDocument: MusicDocument) => {
    await saveSessionSnapshot(id, snapshot(nextMessages, nextReasoning, nextDocument));
    await refreshSessions(id);
  }, [refreshSessions]);

  const generate = useCallback(async (inspiration: string, provider: MusicProvider, existingId?: string) => {
    const requestId = ++activeRequest.current;
    setBusy(true); setError(''); setReasoningSteps(['正在理解主题与创作意图']);
    const current = existingId ? sessionId : null;
    const created = current ? null : await createSession('music', musicSessionTitle(inspiration));
    const id = current ?? created!.session_id;
    setSessionId(id);
    if (created) await refreshSessions();
    const userMessage: ChatMessage = { role: 'user', content: inspiration };
    const baseMessages = existingId ? [...messages, userMessage] : [userMessage];
    setMessages(baseMessages);
    setDocument({ title: '', lyrics: '', provider, status: 'generating' });
    let raw = '';
    let reasoning = '';
    const stages = ['正在理解主题与创作意图'];
    try {
      await sendChatMessage(buildMusicAgentPrompt(inspiration), 'deep', {
        onNode: (event) => {
          if (event.status !== 'processing') return;
          const label = event.message || '正在组织歌曲结构与意象';
          stages.push(label); setReasoningSteps([...stages]);
        },
        onReasoningDelta: (token) => { reasoning += token; },
        onReasoning: (event) => { reasoning = event.reasoning; },
        onToken: (token) => { raw += token; },
        onDone: (event) => { if (!raw) raw = event.answer; },
        onError: (event) => { throw new Error(event.message); },
      }, {
        sessionId: id,
        providerOverride: provider,
        runtimeSettings: {
          responseLength: 'detailed', webSearch: 'off', deepThinking: 'on', discussionRounds: 1,
          mcpMode: 'off', mcpServerIds: [], skillMode: 'off', skillIds: [],
          webSearchOptions: { limit: 5, timeRange: '', location: '', scrapeTopN: 0, highlights: false },
          qwenNativeSearchOptions: { searchStrategy: 'turbo', forcedSearch: false, enableSearchExtension: false, freshness: 0, assignedSiteList: [], promptIntervene: '' },
        },
      });
      if (requestId !== activeRequest.current) return;
      const parsed = parseMusicDraft(raw);
      const finalReasoning = reasoning.trim() || '已完成主题提炼、段落编排、意象设计与可唱性检查。';
      const assistant: ChatMessage = { role: 'assistant', content: parsed.note || `已完成《${parsed.title}》的歌词初稿。`, reasoning: finalReasoning };
      const nextMessages = [...baseMessages, assistant];
      const nextSteps = [...stages, '歌词初稿已完成，可在右侧继续编辑'];
      const nextDocument = { title: parsed.title, lyrics: parsed.lyrics, provider, status: 'ready' as const };
      setMessages(nextMessages); setReasoningSteps(nextSteps); setDocument(nextDocument); setSavedLyrics(nextDocument.lyrics);
      await persist(id, nextMessages, nextSteps, nextDocument);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '歌词生成失败';
      setError(message); setDocument((old) => ({ ...old, status: 'error' }));
    } finally { if (requestId === activeRequest.current) setBusy(false); }
  }, [messages, persist, refreshSessions, sessionId]);

  const save = async () => {
    if (!sessionId) return;
    await persist(sessionId, messages, reasoningSteps, { ...document, status: 'ready' });
    setSavedLyrics(document.lyrics);
  };

  const hasWorkspace = Boolean(sessionId || busy || messages.length);
  const lastUserPrompt = useMemo(() => [...messages].reverse().find((item) => item.role === 'user')?.content ?? '', [messages]);

  const useTemplate = (track: MusicTrack) => {
    setSuggestedInspiration(inspirationFromTrack(track));
    window.requestAnimationFrame(() => globalThis.document.querySelector<HTMLTextAreaElement>('[aria-label="创作灵感输入"]')?.focus());
  };

  if (!hasWorkspace) return <div className="mx-auto flex min-h-full w-full max-w-6xl flex-col gap-10 px-6 py-8"><MusicInspirationComposer onSubmit={generate} busy={busy} suggestedInspiration={suggestedInspiration} /><MusicShowcaseGrid onUseTemplate={useTemplate} /></div>;

  return <div className="grid h-full min-h-0 grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(460px,0.95fr)]">
    <section className="flex min-h-0 flex-col border-r border-slate-200 dark:border-neutral-800">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 lg:px-10">
        <p className="mb-8 text-sm font-semibold text-slate-900 dark:text-white">{lastUserPrompt ? `创作：${musicSessionTitle(lastUserPrompt)}` : '音乐灵感 Agent'}</p>
        <div className="space-y-6">
          {messages.map((message, index) => <div key={`${message.role}-${index}`} className={message.role === 'user' ? 'ml-auto max-w-[78%] rounded-2xl bg-slate-100 px-4 py-3 text-sm dark:bg-neutral-800' : 'max-w-2xl'}>
            {message.role === 'assistant' && message.reasoning && <details className="mb-3 rounded-xl border border-slate-200 p-3 text-xs text-slate-500 dark:border-neutral-800 dark:text-neutral-400"><summary className="cursor-pointer font-medium">已完成思考</summary><p className="mt-2 whitespace-pre-wrap leading-6">{message.reasoning}</p></details>}
            <p className="whitespace-pre-wrap text-sm leading-7">{message.content}</p>
          </div>)}
          {(busy || reasoningSteps.length > 0) && <div className="rounded-2xl border border-slate-200 p-4 dark:border-neutral-800"><div className="mb-3 flex items-center gap-2 text-sm font-medium"><Sparkles size={15} className="text-violet-500" />创作链路</div><ol className="space-y-2">{reasoningSteps.map((step, index) => <li key={`${step}-${index}`} className="flex items-center gap-2 text-xs text-slate-500"><Check size={13} className="text-emerald-500" />{step}</li>)}</ol>{busy && <Loader2 size={16} className="mt-3 animate-spin text-violet-500" />}</div>}
          {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-600 dark:bg-red-950/30">{error}</p>}
        </div>
      </div>
      <div className="border-t border-slate-200 p-4 dark:border-neutral-800"><MusicInspirationComposer compact onSubmit={(text, provider) => generate(text, provider, sessionId ?? undefined)} busy={busy} /></div>
    </section>
    <section className="flex min-h-0 flex-col bg-slate-50/60 dark:bg-neutral-950/40">
      <header className="flex items-center gap-2 border-b border-slate-200 px-5 py-4 dark:border-neutral-800">
        <input value={document.title} onChange={(event) => setDocument((old) => ({ ...old, title: event.target.value }))} aria-label="歌词标题" placeholder="歌曲标题" className="min-w-0 flex-1 bg-transparent text-lg font-semibold outline-none" />
        <span className="rounded-full bg-violet-100 px-2.5 py-1 text-[11px] text-violet-700 dark:bg-violet-950 dark:text-violet-300">{PROVIDER_LABELS[document.provider]}</span>
        <button type="button" onClick={() => setDocument((old) => ({ ...old, lyrics: savedLyrics }))} className="rounded-lg p-2 hover:bg-slate-200 dark:hover:bg-neutral-800" aria-label="撤销未保存修改"><RotateCcw size={16} /></button>
        <button type="button" onClick={async () => { await navigator.clipboard.writeText(document.lyrics); setCopied(true); setTimeout(() => setCopied(false), 1200); }} className="rounded-lg p-2 hover:bg-slate-200 dark:hover:bg-neutral-800" aria-label="复制歌词">{copied ? <Check size={16} /> : <Copy size={16} />}</button>
        <button type="button" onClick={save} disabled={!sessionId || busy} className="flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-2 text-xs font-medium text-white disabled:opacity-50"><Save size={14} />保存</button>
      </header>
      <textarea value={document.lyrics} onChange={(event) => setDocument((old) => ({ ...old, lyrics: event.target.value }))} aria-label="可编辑歌词" placeholder={busy ? 'Agent 正在创作歌词…' : '歌词会显示在这里'} className="min-h-0 flex-1 resize-none bg-transparent px-6 py-5 font-sans text-sm leading-8 outline-none lg:px-10" />
      <footer className="flex items-center justify-between border-t border-slate-200 px-5 py-3 text-xs text-slate-400 dark:border-neutral-800"><span>{document.lyrics.length} 字符</span><button type="button" onClick={() => window.location.assign('/music/music-creation')} disabled={!document.lyrics} className="rounded-full bg-rose-500 px-5 py-2 font-medium text-white disabled:opacity-40">去作歌</button></footer>
    </section>
  </div>;
}
