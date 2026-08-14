'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AgentConfig,
  CapabilityMode,
  DiscussionLength,
  McpMode,
  McpPluginItem,
  SkillCapsule,
  getMcpMarketplace,
  getSkills,
  listAgents,
  toggleMcp,
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
  mcpMode: McpMode;
  selectedMcpServerIds: string[];
  skillMode: McpMode;
  selectedSkillIds: number[];
  onClose: () => void;
  onResponseLengthChange: (value: DiscussionLength) => void;
  onWebSearchChange: (value: CapabilityMode) => void;
  onDeepThinkingChange: (value: CapabilityMode) => void;
  onDiscussionRoundsChange: (value: number) => void;
  onSelectedAgentIdsChange: (value: string[]) => void;
  onMcpModeChange: (value: McpMode) => void;
  onSelectedMcpServerIdsChange: (value: string[]) => void;
  onSkillModeChange: (value: McpMode) => void;
  onSelectedSkillIdsChange: (value: number[]) => void;
  onOpenDirectory: (tab?: 'skills' | 'connectors' | 'plugins') => void;
  onReset: () => void;
}

const CAPABILITY_OPTIONS: Array<{ id: CapabilityMode; label: string }> = [
  { id: 'off', label: '关闭' },
  { id: 'auto', label: '自动' },
  { id: 'on', label: '开启' },
];

const MCP_MODE_OPTIONS: Array<{ id: McpMode; label: string }> = [
  { id: 'off', label: '关闭' },
  { id: 'auto', label: '自动' },
  { id: 'custom', label: '自定义' },
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
  mcpMode,
  selectedMcpServerIds,
  skillMode,
  selectedSkillIds,
  onClose,
  onResponseLengthChange,
  onWebSearchChange,
  onDeepThinkingChange,
  onDiscussionRoundsChange,
  onSelectedAgentIdsChange,
  onMcpModeChange,
  onSelectedMcpServerIdsChange,
  onSkillModeChange,
  onSelectedSkillIdsChange,
  onOpenDirectory,
  onReset,
}: RuntimeSettingsDrawerProps) {
  void onOpenDirectory;
  const closeRef = useRef<HTMLButtonElement>(null);
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [mcpServers, setMcpServers] = useState<McpPluginItem[]>([]);
  const [mcpTogglingId, setMcpTogglingId] = useState<string | null>(null);
  // Why: 运行设置 Skill 区块只展示已上架（published）的胶囊供会话勾选；
  //   pending 待确认的在记忆面板 SkillInspector 里管理，不进挂载列表。
  const [publishedSkills, setPublishedSkills] = useState<SkillCapsule[]>([]);

  const refreshMcpServers = () => {
    return getMcpMarketplace()
      .then((items) => {
        setMcpServers(items.filter((item) => item.is_installed));
      })
      .catch(() => setMcpServers([]));
  };

  useEffect(() => {
    if (isOpen) {
      closeRef.current?.focus();
      void listAgents()
        .then((response) => {
          setAgents(response.agents.filter((agent) => agent.is_callable));
        })
        .catch(() => setAgents([]));
      // Why: 运行设置中要能看到【所有已安装】MCP（含已停用），
      // 会话模式 off/auto/custom 下能统一管理启停；custom 模式下再勾选本会话要使用的启用项。
      void refreshMcpServers();
      void getSkills(undefined, 'published')
        .then((res) => setPublishedSkills(res.skills))
        .catch(() => setPublishedSkills([]));
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

  const toggleMcpServer = async (serverId: string) => {
    setMcpTogglingId(serverId);
    try {
      await toggleMcp(serverId);
      await refreshMcpServers();
    } catch {
      // 错误静默：列表保持原值，用户可见运行态失败由后端 stderr 提供
    } finally {
      setMcpTogglingId(null);
    }
  };

  const toggleSelectedMcp = (serverId: string) => {
    onSelectedMcpServerIdsChange(
      selectedMcpServerIds.includes(serverId)
        ? selectedMcpServerIds.filter((id) => id !== serverId)
        : [...selectedMcpServerIds, serverId],
    );
  };

  const toggleSelectedSkill = (skillId: number) => {
    onSelectedSkillIdsChange(
      selectedSkillIds.includes(skillId)
        ? selectedSkillIds.filter((id) => id !== skillId)
        : [...selectedSkillIds, skillId],
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

          <section className="border-b border-slate-200 py-5">
            <h3 className="text-sm font-semibold text-slate-800">MCP 服务</h3>
            <p className="mt-1 text-xs text-slate-500">
              管理已安装的 MCP 插件，控制本会话工具注入范围
            </p>
            <SegmentedControl
              label="MCP 调用模式"
              value={mcpMode}
              options={MCP_MODE_OPTIONS}
              onChange={onMcpModeChange}
            />

            <div className="mt-3 space-y-1.5">
              {mcpServers.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-200 py-4 text-center text-xs text-slate-400">
                  暂无已安装的 MCP 服务
                </div>
              ) : (
                mcpServers.map((server) => {
                  const enabled = server.is_enabled;
                  const toggling = mcpTogglingId === server.id;
                  const status = server.runtime?.status ?? (enabled ? 'pending' : 'stopped');
                  const statusColor =
                    status === 'ready'
                      ? 'bg-emerald-500'
                      : status === 'error'
                        ? 'bg-rose-500'
                        : status === 'pending'
                          ? 'bg-amber-400'
                          : 'bg-slate-300';
                  const statusText =
                    status === 'ready'
                      ? '就绪'
                      : status === 'error'
                        ? '异常'
                        : status === 'pending'
                          ? '启动中'
                          : '已停用';
                  const canSelect = enabled && mcpMode === 'custom';
                  const selected = selectedMcpServerIds.includes(server.id);
                  return (
                    <div
                      key={server.id}
                      className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
                        selected && canSelect
                          ? 'border-slate-800 bg-slate-50'
                          : 'border-slate-200 bg-white'
                      }`}
                    >
                      <span className="text-lg leading-none">{server.icon}</span>
                      <button
                        type="button"
                        disabled={!canSelect}
                        onClick={() => canSelect && toggleSelectedMcp(server.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium text-slate-800">
                            {server.name}
                          </span>
                          <span
                            className={`inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full ${statusColor}`}
                            title={statusText}
                          />
                          {server.runtime?.tool_count ? (
                            <span className="flex-shrink-0 text-[10px] text-slate-400">
                              {server.runtime.tool_count} 工具
                            </span>
                          ) : null}
                        </div>
                        <div className="truncate text-[11px] text-slate-500">
                          {server.runtime?.last_error ? (
                            <span className="text-rose-500">{server.runtime.last_error}</span>
                          ) : (
                            server.description
                          )}
                        </div>
                      </button>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={enabled}
                        aria-label={`${enabled ? '停用' : '启用'} ${server.name}`}
                        disabled={toggling}
                        onClick={() => toggleMcpServer(server.id)}
                        className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors ${
                          enabled ? 'bg-slate-800' : 'bg-slate-200'
                        } ${toggling ? 'opacity-60' : ''}`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                            enabled ? 'translate-x-4' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                    </div>
                  );
                })
              )}
            </div>

            {mcpMode === 'custom' && mcpServers.some((s) => s.is_enabled) && (
              <p className="mt-2 text-[11px] text-slate-500">
                自定义模式：点击列表项勾选本会话使用的服务；未勾选则本会话不调用该工具。
              </p>
            )}
          </section>

          <section className="border-b border-slate-200 py-5">
            <h3 className="text-sm font-semibold text-slate-800">Skill 技能</h3>
            <p className="mt-1 text-xs text-slate-500">
              挂载已上架的 Skill 手册，命中意图时把标准步骤注入对话
            </p>
            <SegmentedControl
              label="Skill 挂载模式"
              value={skillMode}
              options={MCP_MODE_OPTIONS}
              onChange={onSkillModeChange}
            />

            <div className="mt-3 space-y-1.5">
              {publishedSkills.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-200 py-4 text-center text-xs text-slate-400">
                  暂无已上架的 Skill（在记忆面板 Skill 页签上架后出现）
                </div>
              ) : (
                publishedSkills.map((skill) => {
                  const canSelect = skillMode === 'custom';
                  const selected = selectedSkillIds.includes(skill.skill_id);
                  const typeLabel =
                    skill.skill_type === 'code_pattern'
                      ? '代码模式'
                      : skill.skill_type === 'task_flow'
                        ? '任务流程'
                        : '修复模板';
                  return (
                    <button
                      key={skill.skill_id}
                      type="button"
                      disabled={!canSelect}
                      onClick={() => canSelect && toggleSelectedSkill(skill.skill_id)}
                      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                        selected && canSelect
                          ? 'border-slate-800 bg-slate-50'
                          : 'border-slate-200 bg-white'
                      } ${canSelect ? 'cursor-pointer' : 'cursor-default'}`}
                    >
                      <span className="text-lg leading-none">🧠</span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-sm font-medium text-slate-800">
                            {skill.skill_name}
                          </span>
                          <span className="flex-shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                            {typeLabel}
                          </span>
                          {selected && canSelect ? (
                            <span className="flex-shrink-0 text-[10px] text-slate-800">✓ 已挂载</span>
                          ) : null}
                        </span>
                        <span className="block truncate text-[11px] text-slate-500">
                          {skill.trigger_condition}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            {skillMode === 'custom' && publishedSkills.length > 0 && (
              <p className="mt-2 text-[11px] text-slate-500">
                自定义模式：点击勾选本会话挂载的 Skill；未勾选则本会话不注入该手册。
              </p>
            )}
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
