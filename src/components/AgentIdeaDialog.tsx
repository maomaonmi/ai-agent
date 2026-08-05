'use client';

import { useEffect } from 'react';

interface AgentIdeaDialogProps {
  idea: string;
  generating: boolean;
  error: string | null;
  onIdeaChange: (idea: string) => void;
  onGenerate: () => void;
  onClose: () => void;
}

export default function AgentIdeaDialog({
  idea,
  generating,
  error,
  onIdeaChange,
  onGenerate,
  onClose,
}: AgentIdeaDialogProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !generating) onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [generating, onClose]);

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !generating) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="agent-idea-title"
        className="w-full max-w-lg rounded-xl border border-slate-700 bg-slate-900 p-6 shadow-2xl"
      >
        <h2 id="agent-idea-title" className="text-base font-semibold text-slate-100">
          ✨ AI 一键生成智能体
        </h2>
        <p className="mt-2 text-xs leading-5 text-slate-400">
          用一句话描述目标，AI 会生成名称、ID、简介、提示词、调用时机和工具配置。
        </p>
        <textarea
          autoFocus
          rows={4}
          maxLength={1000}
          value={idea}
          disabled={generating}
          onChange={(event) => onIdeaChange(event.target.value)}
          placeholder="例如：创建一个检查 Python 测试覆盖率并重构单元测试的专家"
          className="mt-4 w-full resize-y rounded-lg border border-slate-700 bg-slate-950 p-3 text-sm text-slate-100 placeholder:text-slate-600 focus:border-emerald-500 focus:outline-none"
        />
        {error && <p role="alert" className="mt-2 text-xs text-rose-400">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" disabled={generating} onClick={onClose} className="rounded-lg bg-slate-800 px-4 py-2 text-xs text-slate-300 hover:bg-slate-700 disabled:opacity-50">
            取消
          </button>
          <button
            type="button"
            disabled={generating || idea.trim().length < 2}
            onClick={onGenerate}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generating ? '✨ 正在生成…' : '开始智能生成'}
          </button>
        </div>
      </section>
    </div>
  );
}
