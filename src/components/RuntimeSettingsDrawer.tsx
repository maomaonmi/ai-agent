'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AgentConfig,
  CapabilityMode,
  DiscussionLength,
  listAgents,
} from '../lib/api';
import { ModeType } from './ModeSelector';

interface RuntimeSettingsDrawerProps {
  isOpen: boolean;
  mode: ModeType;
  responseLength: DiscussionLength;
  webSearch: CapabilityMode;
  deepThinking: CapabilityMode;
  discussionRounds: number;
  selectedAgentIds: string[];
  onClose: () => void;
  onResponseLengthChange: (value: DiscussionLength) => void;
  onWebSearchChange: (value: CapabilityMode) => void;
  onDeepThinkingChange: (value: CapabilityMode) => void;
  onDiscussionRoundsChange: (value: number) => void;
  onSelectedAgentIdsChange: (value: string[]) => void;
  onReset: () => void;
}

const CAPABILITY_OPTIONS: Array<{ id: CapabilityMode; label: string }> = [
  { id: 'off', label: '关闭' },
  { id: 'auto', label: '自动' },
  { id: 'on', label: '开启' },
];

function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: Array<{ id: T; label: string }>;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`mt-3 grid gap-1 rounded-lg bg-slate-100 p-1 ${
        options.length === 5 ? 'grid-cols-5' : 'grid-cols-3'
      }`}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={`rounded-md px-2 py-2 text-xs font-medium transition-colors ${
            value === option.id
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-800'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export default function RuntimeSettingsDrawer({
  isOpen,
  mode,
  responseLength,
  webSearch,
  deepThinking,
  discussionRounds,
  selectedAgentIds,
  onClose,
  onResponseLengthChange,
  onWebSearchChange,
  onDeepThinkingChange,
  onDiscussionRoundsChange,
  onSelectedAgentIdsChange,
  onReset,
}: RuntimeSettingsDrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [agents, setAgents] = useState<AgentConfig[]>([]);

  useEffect(() => {
    if (isOpen) {
      closeRef.current?.focus();
      void listAgents()
        .then((response) => {
          setAgents(response.agents.filter((agent) => agent.is_callable));
        })
        .catch(() => setAgents([]));
    }
  }, [isOpen]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isOpen) onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [isOpen, onClose]);

  const toggleAgent = (agentId: string) => {
    onSelectedAgentIdsChange(
      selectedAgentIds.includes(agentId)
        ? selectedAgentIds.filter((id) => id !== agentId)
        : [...selectedAgentIds, agentId].slice(0, 5),
    );
  };

  return (
    <>
      {isOpen && (
        <button
          type="button"
          aria-label="关闭运行设置"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-slate-950/20"
        />
      )}
      <aside
        aria-label="运行设置"
        aria-hidden={!isOpen}
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-sm flex-col border-l border-slate-200 bg-white shadow-xl transition-transform duration-200 ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <header className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-900">运行设置</h2>
            <p className="mt-0.5 text-xs text-slate-500">设置会保存到当前会话</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            aria-label="关闭运行设置"
            onClick={onClose}
            className="rounded-md p-2 text-slate-500 hover:bg-slate-100"
          >
            ×
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
          <section className="border-b border-slate-200 py-5">
            <h3 className="text-sm font-semibold text-slate-800">输出长度</h3>
            <p className="mt-1 text-xs text-slate-500">控制回答展开程度与 Token 消耗</p>
            <SegmentedControl
              label="输出长度"
              value={responseLength}
              options={[
                { id: 'brief', label: '精简' },
                { id: 'balanced', label: '标准' },
                { id: 'detailed', label: '详细' },
              ]}
              onChange={onResponseLengthChange}
            />
          </section>

          <section className="border-b border-slate-200 py-5">
            <h3 className="text-sm font-semibold text-slate-800">联网搜索</h3>
            <p className="mt-1 text-xs text-slate-500">
              自动模式会遵循当前工作模式的联网需求
            </p>
            <SegmentedControl
              label="联网搜索"
              value={webSearch}
              options={CAPABILITY_OPTIONS}
              onChange={onWebSearchChange}
            />
          </section>

          <section className="border-b border-slate-200 py-5">
            <h3 className="text-sm font-semibold text-slate-800">深度思考</h3>
            <p className="mt-1 text-xs text-slate-500">
              开启后使用当前模型的原生深度思考能力
            </p>
            <SegmentedControl
              label="深度思考"
              value={deepThinking}
              options={CAPABILITY_OPTIONS}
              onChange={onDeepThinkingChange}
            />
          </section>

          {mode === 'agent' && (
            <section className="border-b border-slate-200 py-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-800">讨论轮数</h3>
                <span className="text-xs text-slate-500">
                  约 {3 + discussionRounds * 2} 次调用
                </span>
              </div>
              <SegmentedControl
                label="讨论轮数"
                value={String(discussionRounds)}
                options={[1, 2, 3, 4, 5].map((round) => ({
                  id: String(round),
                  label: String(round),
                }))}
                onChange={(value) => onDiscussionRoundsChange(Number(value))}
              />

              <h3 className="mt-5 text-sm font-semibold text-slate-800">
                讨论成员
              </h3>
              <div className="mt-3 flex flex-wrap gap-2">
                {agents.length === 0 ? (
                  <p className="text-xs text-slate-500">暂无可调用的自定义智能体</p>
                ) : (
                  agents.map((agent) => {
                    const selected = selectedAgentIds.includes(agent.id);
                    return (
                      <button
                        key={agent.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => toggleAgent(agent.id)}
                        className={`rounded-full border px-3 py-1.5 text-xs ${
                          selected
                            ? 'border-slate-800 bg-slate-800 text-white'
                            : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                      >
                        {selected ? '✓ ' : ''}
                        {agent.name}
                      </button>
                    );
                  })
                )}
              </div>
            </section>
          )}
        </div>

        <footer className="border-t border-slate-200 p-4">
          <button
            type="button"
            onClick={onReset}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
          >
            恢复默认设置
          </button>
        </footer>
      </aside>
    </>
  );
}
