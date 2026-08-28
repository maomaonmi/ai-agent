'use client';

import { useState } from 'react';
import { ArrowUp, Bot, ChevronDown, Cpu, Music2 } from 'lucide-react';

const COMING_SOON_HINT = '音乐生成能力即将上线';

export default function MusicInspirationComposer() {
  const [inspiration, setInspiration] = useState('');
  const [hint, setHint] = useState<string | null>(null);

  const canSubmit = inspiration.trim().length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    // Why: 生成本期为占位（design D6，用户已确认），仅内联提示，不发任何网络请求。
    setHint(COMING_SOON_HINT);
  };

  return (
    <section aria-label="灵感创作" className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-400 to-sky-600 shadow-lg shadow-sky-500/20">
          <Music2 size={32} className="text-white" aria-hidden="true" />
        </span>
        <h1 className="text-3xl font-bold tracking-wide text-slate-900 dark:text-neutral-50">妙响，灵感打磨成歌！</h1>
        <p className="text-sm text-slate-500 dark:text-neutral-400">描述你的灵感，AI 帮你完成作词、作曲与编曲</p>
      </div>

      <div className="w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-xl dark:border-neutral-700/60 dark:bg-neutral-900/80">
        <textarea
          value={inspiration}
          onChange={(event) => {
            setInspiration(event.target.value);
            if (hint) setHint(null);
          }}
          rows={3}
          placeholder="输入你的创作灵感，例如：把青春写成歌"
          aria-label="创作灵感输入"
          className="w-full resize-none bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none dark:text-neutral-100 dark:placeholder:text-neutral-500"
        />
        <div className="mt-2 flex items-center gap-2">
          {/* 静态占位下拉：无真实逻辑，后续接生成能力时替换 */}
          <button
            type="button"
            aria-label="Agent 模式"
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 dark:border-neutral-700/60 dark:bg-neutral-800/70 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <Bot size={13} aria-hidden="true" />
            Agent 模式
            <ChevronDown size={12} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label="模型选择"
            className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 dark:border-neutral-700/60 dark:bg-neutral-800/70 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            <Cpu size={13} aria-hidden="true" />
            Sodance v2.0
            <ChevronDown size={12} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            aria-label="提交创作灵感"
            className="ml-auto flex h-9 w-9 items-center justify-center rounded-full bg-sky-500 text-white transition hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400 dark:disabled:bg-neutral-700 dark:disabled:text-neutral-500"
          >
            <ArrowUp size={16} aria-hidden="true" />
          </button>
        </div>
        {hint && (
          <p role="status" className="mt-3 text-xs text-sky-600 dark:text-sky-400">{hint}</p>
        )}
      </div>
    </section>
  );
}
