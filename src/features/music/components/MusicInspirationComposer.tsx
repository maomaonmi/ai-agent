'use client';

import { useEffect, useState } from 'react';
import { ArrowUp, Bot, ChevronDown, Cpu, Mic, Music2, Square } from 'lucide-react';
import type { MusicProvider } from '../musicInspiration';
import { useRealtimeASR } from '../hooks/useRealtimeASR';

const PROVIDERS: Array<{ value: MusicProvider; label: string }> = [
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'qwen', label: '千问 Qwen' },
  { value: 'glm', label: '智谱 GLM' },
  { value: 'minimax', label: 'MiniMax' },
];

export default function MusicInspirationComposer({
  onSubmit,
  busy = false,
  compact = false,
  suggestedInspiration,
}: {
  onSubmit: (inspiration: string, provider: MusicProvider) => void;
  busy?: boolean;
  compact?: boolean;
  suggestedInspiration?: string;
}) {
  const [inspiration, setInspiration] = useState('');
  const [provider, setProvider] = useState<MusicProvider>('deepseek');
  const handleRecognizedText = (text: string) => setInspiration(text);
  const asr = useRealtimeASR({ baseText: inspiration, onText: handleRecognizedText });

  useEffect(() => {
    if (suggestedInspiration) setInspiration(suggestedInspiration);
  }, [suggestedInspiration]);

  const canSubmit = inspiration.trim().length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit(inspiration.trim(), provider);
  };

  return (
    <section aria-label="灵感创作" className={`mx-auto flex w-full max-w-2xl flex-col items-center ${compact ? 'gap-0' : 'gap-6'}`}>
      {!compact && <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400 to-sky-600 shadow-lg shadow-sky-500/20">
          <Music2 size={32} className="text-white" aria-hidden="true" />
        </span>
        <h1 className="text-3xl font-bold tracking-wide text-slate-900 dark:text-neutral-50">妙响，灵感打磨成歌！</h1>
        <p className="text-sm text-slate-500 dark:text-neutral-400">描述你的灵感，AI 帮你完成作词、作曲与编曲</p>
      </div>}

      <div className="w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-neutral-700/60 dark:bg-neutral-900/80">
        <textarea
          value={inspiration}
          disabled={asr.isListening || asr.status === 'connecting' || busy}
          onChange={(event) => {
            setInspiration(event.target.value);
          }}
          rows={compact ? 2 : 3}
          placeholder={compact ? '继续描述修改方向，或开始一个新的创作想法' : '输入你的创作灵感，例如：把青春写成歌'}
          aria-label="创作灵感输入"
          className="w-full resize-none bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-80 dark:text-neutral-100 dark:placeholder:text-neutral-500"
        />
        {asr.error && <p role="alert" className="mt-1 text-xs text-rose-500">{asr.error}</p>}
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            aria-label="Agent 模式"
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 dark:border-neutral-700/60 dark:bg-neutral-800/70 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <Bot size={13} aria-hidden="true" />
            Agent 模式
            <ChevronDown size={12} aria-hidden="true" />
          </button>
          <label className="relative flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 dark:border-neutral-700/60 dark:bg-neutral-800/70 dark:text-neutral-300">
            <Cpu size={13} aria-hidden="true" />
            <select value={provider} onChange={(event) => setProvider(event.target.value as MusicProvider)} aria-label="模型选择" className="appearance-none bg-transparent pr-4 outline-none">
              {PROVIDERS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <ChevronDown size={12} className="pointer-events-none absolute right-2" aria-hidden="true" />
          </label>
          <button
            type="button"
            onClick={() => (asr.isListening || asr.status === 'connecting' ? asr.stop() : void asr.start())}
            disabled={busy}
            aria-label={asr.isListening ? '停止语音识别' : '开始语音识别'}
            aria-pressed={asr.isListening}
            title={asr.isListening ? '停止语音识别' : '语音输入'}
            className={`relative flex h-9 w-9 items-center justify-center rounded-full border transition ${
              asr.isListening
                ? 'border-sky-400 bg-sky-500 text-white shadow-lg shadow-sky-500/30'
                : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-sky-300 hover:bg-sky-50 hover:text-sky-600 dark:border-neutral-700/60 dark:bg-neutral-800/70 dark:text-neutral-300 dark:hover:border-sky-700 dark:hover:bg-sky-950/40'
            }`}
          >
            {asr.isListening && <span className="absolute inset-0 animate-ping rounded-full bg-sky-400/30" aria-hidden="true" />}
            {asr.isListening ? <Square size={13} fill="currentColor" className="relative" aria-hidden="true" /> : <Mic size={16} className="relative" aria-hidden="true" />}
          </button>
          {(asr.isListening || asr.status === 'connecting') && <span className="flex items-center gap-1 text-[11px] text-sky-600 dark:text-sky-400" aria-live="polite"><span className="flex items-end gap-0.5" aria-hidden="true">{[0, 1, 2].map(index => <i key={index} className="w-0.5 animate-pulse rounded-full bg-current" style={{ height: `${8 + asr.volume / 12 + index * 3}px`, animationDelay: `${index * 100}ms` }} />)}</span>{asr.status === 'connecting' ? '连接中…' : '正在识别'}</span>}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit || busy}
            aria-label="提交创作灵感"
            className="ml-auto flex h-9 w-9 items-center justify-center rounded-full bg-sky-500 text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-neutral-700 dark:disabled:text-neutral-500"
          >
            <ArrowUp size={16} aria-hidden="true" />
          </button>
        </div>
      </div>
    </section>
  );
}
