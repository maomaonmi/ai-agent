import { Check, Circle, ChevronDown, ChevronRight, LoaderCircle, Search, Sparkles } from 'lucide-react';
import { useState } from 'react';
import type { PlanProgressEvent, PlanTaskStatus } from '../../lib/api';

/**
 * ReAct 主控模式的一轮思考（Q2 分节）。tokens 只包含该轮的思考正文，
 * action 在 reasoning_round_end 到达后回填（该轮实际执行的工具名）。
 */
export interface ReasoningRoundView {
  step: number;
  action: string;
  tokens: string;
  done: boolean;
}

interface PlanChainTimelineProps {
  progress?: PlanProgressEvent | null;
  status?: string;
  /** Live reasoning text from planner/executor model deltas. */
  reasoningText?: string;
  /** ReAct 主控模式按轮思考分节；非空时替代 reasoningText 的整块渲染。 */
  reasoningRounds?: ReasoningRoundView[];
  /** Pacing length used by the parent typewriter hook while a request is live. */
  reasoningDisplayedLength?: number;
  /** D3: 链路流程日志（🧭📐✅⚠️📋），与模型思考正文分开展示。 */
  chainLogText?: string;
}

const statusText: Record<PlanTaskStatus, string> = {
  pending: '等待执行',
  in_progress: '执行中',
  completed: '已完成',
  failed: '需重试',
};

export default function PlanChainTimeline({ progress, status, reasoningText = '', reasoningRounds, reasoningDisplayedLength, chainLogText = '' }: PlanChainTimelineProps) {
  const [reasoningOpen, setReasoningOpen] = useState(true);
  const [chainLogOpen, setChainLogOpen] = useState(false);
  if (!progress && !status) return null;
  const phaseLabel = progress?.phase === 'planning'
    ? '正在拆解任务'
    : progress?.phase === 'replanning'
      ? '正在调整执行计划'
      : progress?.phase === 'completed'
        ? '任务链路已完成'
        : '正在执行任务';
  const visibleReasoning = reasoningDisplayedLength == null
    ? reasoningText
    : reasoningText.slice(0, reasoningDisplayedLength);
  const reasoningCount = reasoningText.replace(/\s/g, '').length;
  const rounds = reasoningRounds ?? [];
  // Why 打字机预算按轮顺序分配：reasoningDisplayedLength 计的是原始 token
  // 流的进度，已完成轮全量展示，流式中的轮按剩余预算截断——直接对拼接后
  // 的字符串整体 slice 会把后续轮次标题/正文切错位。
  const roundVisibleTokens = (round: ReasoningRoundView, budget: number): string =>
    round.tokens.slice(0, Math.max(0, budget));
  return (
    <section data-plan-chain className="mt-4 rounded-2xl border border-indigo-100 bg-white/90 p-4 shadow-sm" aria-live="polite">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-50 text-indigo-600">
          {progress?.phase === 'completed' ? <Check size={16} /> : <Sparkles size={16} />}
        </span>
        <span>{phaseLabel}</span>
        {progress && <span className="ml-auto text-xs font-normal text-slate-400">第 {Math.max(1, progress.iteration + 1)} 轮</span>}
      </div>
      {status && !progress?.message && <p className="mt-2 text-xs text-slate-500">{status}</p>}
      {progress?.message && <p className="mt-2 text-xs text-slate-500">{progress.message}</p>}
      {reasoningCount > 0 && (
        <div className="mt-3 border-t border-indigo-100 pt-2">
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs font-semibold text-indigo-700"
            onClick={() => setReasoningOpen((open) => !open)}
            aria-expanded={reasoningOpen}
          >
            {reasoningOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span>深度思考过程 · {reasoningCount} 字</span>
          </button>
          {reasoningOpen && (
            rounds.length > 0 ? (
              <div className="mt-1 max-h-56 overflow-y-auto text-[13px] leading-6 text-slate-600">
                {(() => {
                  let budget = reasoningDisplayedLength ?? Number.POSITIVE_INFINITY;
                  return rounds.map((round, index) => {
                    const visibleTokens = roundVisibleTokens(round, budget);
                    budget -= round.tokens.length;
                    return (
                      <div key={round.step} className={index > 0 ? 'mt-3' : ''}>
                        <div className="text-[12px] font-semibold text-indigo-600">第 {round.step} 轮思考</div>
                        <div className="mt-0.5 whitespace-pre-wrap">{visibleTokens}</div>
                        {round.done && round.action ? (
                          <div className="mt-1 flex items-center gap-1.5 text-[12px] text-slate-500">
                            <span className="text-indigo-500">▶</span>
                            <span>本轮行动：{round.action}</span>
                            <Check size={12} className="text-emerald-600" />
                          </div>
                        ) : (
                          <div className="mt-1 flex items-center gap-1.5 text-[12px] text-slate-400">
                            <span className="text-indigo-400">▶</span>
                            <span className="animate-pulse">正在决策行动…</span>
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
                {reasoningDisplayedLength != null && reasoningDisplayedLength < reasoningText.length && (
                  <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-indigo-500 align-middle" aria-hidden="true" />
                )}
              </div>
            ) : (
              <div className="mt-1 max-h-56 overflow-y-auto whitespace-pre-wrap text-[13px] leading-6 text-slate-600">
                {visibleReasoning}
                {reasoningDisplayedLength != null && reasoningDisplayedLength < reasoningText.length && (
                  <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-indigo-500 align-middle" aria-hidden="true" />
                )}
              </div>
            )
          )}
        </div>
      )}
      {chainLogText.replace(/\s/g, '').length > 0 && (
        <div className="mt-3 border-t border-indigo-100 pt-2">
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-600"
            onClick={() => setChainLogOpen((open) => !open)}
            aria-expanded={chainLogOpen}
          >
            {chainLogOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <span>🧵 链路日志</span>
          </button>
          {chainLogOpen && (
            <div className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] leading-5 text-slate-500">
              {chainLogText}
            </div>
          )}
        </div>
      )}
      {progress?.tasks?.length ? (
        <ol className="mt-3 space-y-2">
          {progress.tasks.map((task) => {
            const active = task.id === progress.current_task_id || task.status === 'in_progress';
            const resultCount = task.search_results?.length || 0;
            return (
              <li key={task.id} className={`flex items-start gap-2 rounded-xl px-2.5 py-2 ${active ? 'bg-indigo-50/80' : ''}`}>
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${task.status === 'completed' ? 'bg-emerald-100 text-emerald-600' : task.status === 'failed' ? 'bg-rose-100 text-rose-600' : active ? 'bg-indigo-100 text-indigo-600' : 'bg-slate-100 text-slate-400'}`}>
                  {task.status === 'completed' ? <Check size={12} /> : active ? <LoaderCircle size={12} className="animate-spin" /> : <Circle size={10} />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-semibold text-slate-700">Task {task.id}</span>
                    <span className="truncate text-slate-500">{task.title}</span>
                    <span className="ml-auto shrink-0 text-slate-400">{statusText[task.status]}</span>
                  </div>
                  {task.requires_web && (resultCount > 0 || active) && (
                    <div className="mt-1 flex items-center gap-1 text-[11px] text-cyan-700">
                      <Search size={11} />
                      {resultCount > 0 ? `已找到 ${resultCount} 条搜索结果` : '正在搜索资料…'}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
