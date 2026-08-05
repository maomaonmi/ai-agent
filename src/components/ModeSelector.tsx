'use client';

import { useEffect, useRef, useState } from 'react';

export const MODE_OPTIONS = [
  { id: 'standard', label: '标准对话', icon: '⚡', desc: '快速响应', group: 'chat' },
  { id: 'deep', label: '深度思考', icon: '🧠', desc: '深度推理', group: 'chat' },
  { id: 'web', label: '联网搜索', icon: '🌐', desc: '实时搜索', group: 'chat' },
  { id: 'research', label: '深度调研', icon: '🔬', desc: '多阶段资料调研', group: 'chat' },
  { id: 'agent', label: '多智能体协同', icon: '🤖', desc: '智能体讨论与汇总', group: 'agent' },
  { id: 'plan', label: '自主任务规划', icon: '🧭', desc: '计划、执行与动态调整', group: 'agent' },
  {
    id: 'distributed_plan',
    label: '多智能体任务分发',
    icon: '🕸️',
    desc: '项目经理规划并动态指派专家',
    group: 'agent',
  },
  {
    id: 'code',
    label: '网页代码生成',
    icon: '⌨️',
    desc: '生成并实时预览完整网页',
    group: 'code',
  },
] as const;

export type ModeType = typeof MODE_OPTIONS[number]['id'];
type ModeGroup = typeof MODE_OPTIONS[number]['group'];

const GROUPS: Array<{
  id: ModeGroup;
  label: string;
  icon: string;
  activeClass: string;
}> = [
  {
    id: 'chat',
    label: '聊天 + 调研模式',
    icon: '💬',
    activeClass: 'border-blue-600 bg-blue-600 text-white',
  },
  {
    id: 'agent',
    label: 'Agent 模式',
    icon: '🤖',
    activeClass: 'border-indigo-600 bg-indigo-600 text-white',
  },
  {
    id: 'code',
    label: 'Code 模式',
    icon: '⌨️',
    activeClass: 'border-slate-800 bg-slate-900 text-white',
  },
];

interface ModeSelectorProps {
  value: ModeType;
  disabled?: boolean;
  menuPlacement?: 'top' | 'bottom';
  /** Why: Code 模式仅保留 Code 组按钮，隐藏聊天/Agent 组；默认全部展示。 */
  allowedGroups?: readonly ModeGroup[];
  onChange: (mode: ModeType) => void;
}

export default function ModeSelector({
  value,
  disabled = false,
  menuPlacement = 'top',
  allowedGroups,
  onChange,
}: ModeSelectorProps) {
  const [openGroup, setOpenGroup] = useState<ModeGroup | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedMode = MODE_OPTIONS.find((mode) => mode.id === value)!;
  // Why: 过滤后渲染的组列表，未传 allowedGroups 则展示全部。
  const visibleGroups = allowedGroups
    ? GROUPS.filter((g) => allowedGroups.includes(g.id))
    : GROUPS;

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpenGroup(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenGroup(null);
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  return (
    <div ref={containerRef} className="relative flex flex-wrap items-center gap-2">
      {/* Why: 单组模式下不需要 "模式:" 前缀，界面更紧凑。 */}
      {visibleGroups.length > 1 && <span className="mr-1 text-sm text-gray-500">模式:</span>}
      {visibleGroups.map((group) => {
        const isSelectedGroup = selectedMode.group === group.id;
        const isOpen = openGroup === group.id;
        const groupModes = MODE_OPTIONS.filter((mode) => mode.group === group.id);

        return (
          <div key={group.id} className="relative">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={isOpen}
              disabled={disabled}
              onClick={() => setOpenGroup(isOpen ? null : group.id)}
              className={`flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                isSelectedGroup
                  ? group.activeClass
                  : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <span aria-hidden="true">{group.icon}</span>
              <span>{group.label}</span>
              {isSelectedGroup && (
                <span className="hidden text-xs opacity-80 sm:inline">
                  · {selectedMode.label}
                </span>
              )}
              <svg
                aria-hidden="true"
                viewBox="0 0 20 20"
                fill="currentColor"
                className={`h-4 w-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
              >
                <path
                  fillRule="evenodd"
                  d="M5.22 7.22a.75.75 0 011.06 0L10 10.94l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 8.28a.75.75 0 010-1.06z"
                  clipRule="evenodd"
                />
              </svg>
            </button>

            {isOpen && (
              <div
                role="menu"
                aria-label={`${group.label}选项`}
                className={`absolute left-0 z-40 w-64 overflow-hidden rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl ${
                  menuPlacement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'
                }`}
              >
                {groupModes.map((mode) => {
                  const isActive = value === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={isActive}
                      onClick={() => {
                        onChange(mode.id);
                        setOpenGroup(null);
                      }}
                      className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${
                        isActive
                          ? 'bg-slate-100 text-slate-900'
                          : 'text-slate-700 hover:bg-slate-50'
                      }`}
                    >
                      <span className="mt-0.5" aria-hidden="true">{mode.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">{mode.label}</span>
                        <span className="mt-0.5 block text-xs text-slate-500">
                          {mode.desc}
                        </span>
                      </span>
                      {isActive && (
                        <span className="text-sm text-blue-600" aria-label="当前模式">✓</span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}

      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
        {selectedMode.icon} {selectedMode.desc}
      </span>
    </div>
  );
}
