'use client';

import { useEffect, useState } from 'react';
import { AgentConfig, DiscussionLength, listAgents } from '../lib/api';

const LENGTH_OPTIONS: Array<{
  id: DiscussionLength;
  label: string;
  description: string;
}> = [
  { id: 'brief', label: '精简', description: '最省 Token，短句交流' },
  { id: 'balanced', label: '适中', description: '更多例子与补充' },
  { id: 'detailed', label: '展开', description: '允许较完整讨论' },
];

interface AgentDiscussionSettingsProps {
  length: DiscussionLength;
  rounds: number;
  selectedAgentIds: string[];
  onLengthChange: (length: DiscussionLength) => void;
  onRoundsChange: (rounds: number) => void;
  onSelectedAgentIdsChange: (ids: string[]) => void;
}

export default function AgentDiscussionSettings({
  length,
  rounds,
  selectedAgentIds,
  onLengthChange,
  onRoundsChange,
  onSelectedAgentIdsChange,
}: AgentDiscussionSettingsProps) {
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = () => {
      void listAgents()
        .then((response) => {
          const callableAgents = response.agents.filter((agent) => agent.is_callable);
          setAgents(callableAgents);
          onSelectedAgentIdsChange(
            selectedAgentIds.filter((id) =>
              callableAgents.some((agent) => agent.id === id),
            ),
          );
          setError(null);
        })
        .catch((requestError) => {
          setError(
            requestError instanceof Error
              ? requestError.message
              : '加载成员失败',
          );
        });
    };
    load();
    window.addEventListener('agents-updated', load);
    return () => window.removeEventListener('agents-updated', load);
    // Initial selection is reconciled only when the agent store changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleAgent = (agentId: string) => {
    if (selectedAgentIds.includes(agentId)) {
      onSelectedAgentIdsChange(
        selectedAgentIds.filter((id) => id !== agentId),
      );
      return;
    }
    if (selectedAgentIds.length < 5) {
      onSelectedAgentIdsChange([...selectedAgentIds, agentId]);
    }
  };

  return (
    <section className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3">
      <div className="grid gap-4 lg:grid-cols-[1fr_0.8fr_1.5fr]">
        <fieldset className="min-w-0">
          <legend className="text-xs font-semibold text-slate-700">
            单次发言长度
          </legend>
          <div className="mt-2 flex gap-1 rounded-lg bg-white p-1 shadow-sm">
            {LENGTH_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => onLengthChange(option.id)}
                title={option.description}
                aria-pressed={length === option.id}
                className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                  length === option.id
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="min-w-0">
          <legend className="flex w-full items-center justify-between text-xs font-semibold text-slate-700">
            <span>讨论轮数</span>
            <span className="font-normal text-slate-500">
              约 {3 + rounds * 2} 次调用
            </span>
          </legend>
          <div className="mt-2 flex gap-1 rounded-lg bg-white p-1 shadow-sm">
            {[1, 2, 3, 4, 5].map((round) => (
              <button
                key={round}
                type="button"
                aria-label={`${round} 轮讨论`}
                aria-pressed={rounds === round}
                onClick={() => onRoundsChange(round)}
                className={`flex-1 rounded-md py-1.5 text-xs font-semibold transition-colors ${
                  rounds === round
                    ? 'bg-violet-600 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {round}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-xs font-semibold text-slate-700">
              邀请自定义智能体
            </h3>
            <span className="text-[11px] text-slate-500">
              {selectedAgentIds.length}/5
            </span>
          </div>
          {error ? (
            <p role="alert" className="mt-2 text-xs text-rose-600">
              {error}
            </p>
          ) : agents.length === 0 ? (
            <p className="mt-2 text-xs text-slate-500">
              暂无可调用的自定义智能体，可在“智能体工厂”中创建。
            </p>
          ) : (
            <div className="mt-2 flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">
              {agents.map((agent) => {
                const selected = selectedAgentIds.includes(agent.id);
                return (
                  <button
                    key={agent.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => toggleAgent(agent.id)}
                    className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                      selected
                        ? 'border-indigo-300 bg-indigo-600 text-white'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-indigo-300'
                    }`}
                  >
                    {selected ? '✓ ' : ''}
                    {agent.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <p className="mt-2 text-[11px] text-slate-500">
        每轮包含一次接话和一次回应；轮数越多，观点碰撞更充分，也会消耗更多
        Token。多个自定义智能体会轮流参与。
      </p>
    </section>
  );
}
