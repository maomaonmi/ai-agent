'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { chooseMenuPlacement, type MenuPlacement } from './menuPlacement';

export const MODE_OPTIONS = [
  { id: 'omni', label: '全能模式', icon: '✨', desc: '多模态自然对话', group: 'omni' },
  { id: 'standard', label: '标准对话', icon: '⚡', desc: '快速响应', group: 'standard' },
  { id: 'deep', label: '深度思考', icon: '🧠', desc: '深度推理', group: 'standard' },
  { id: 'web', label: '联网搜索', icon: '🌐', desc: '实时搜索', group: 'standard' },
  { id: 'research', label: '深度调研', icon: '🔬', desc: '多阶段资料调研', group: 'standard' },
  { id: 'agent', label: '多智能体协同', icon: '🤖', desc: '智能体讨论与汇总', group: 'agent' },
  { id: 'plan', label: '自主任务规划', icon: '🧭', desc: '计划、执行与动态调整', group: 'agent' },
  { id: 'distributed_plan', label: '多智能体任务分发', icon: '🕸️', desc: '项目经理规划并动态指派专家', group: 'agent' },
  { id: 'code', label: '网页代码生成', icon: '⌨️', desc: '生成并实时预览完整网页', group: 'code' },
  { id: 'writing', label: 'AI 写作', icon: '✍️', desc: '轻文档写作工作台', group: 'standard', hidden: true },
] as const;

export type ModeType = typeof MODE_OPTIONS[number]['id'];
export type ModeGroup = typeof MODE_OPTIONS[number]['group'];

export function normalizeMode(value: string): ModeType {
  return MODE_OPTIONS.some((mode) => mode.id === value) ? value as ModeType : MODE_OPTIONS[0].id;
}

const GROUPS: Array<{ id: ModeGroup; label: string; icon: string; activeClass: string }> = [
  { id: 'omni', label: '全能模式', icon: '✨', activeClass: 'border-blue-600 bg-blue-600 text-white' },
  { id: 'standard', label: '标准与调研', icon: '💬', activeClass: 'border-blue-600 bg-blue-600 text-white' },
  { id: 'agent', label: '多智能体与规划', icon: '🤖', activeClass: 'border-indigo-600 bg-indigo-600 text-white' },
  { id: 'code', label: 'Code 模式', icon: '⌨️', activeClass: 'border-slate-800 bg-slate-900 text-white' },
];

interface ModeSelectorProps {
  value: ModeType;
  disabled?: boolean;
  menuPlacement?: MenuPlacement | 'auto';
  compact?: boolean;
  allowedGroups?: readonly ModeGroup[];
  onChange: (mode: ModeType) => void;
}

export default function ModeSelector({
  value,
  disabled = false,
  menuPlacement = 'auto',
  compact = false,
  allowedGroups,
  onChange,
}: ModeSelectorProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [expandedGroup, setExpandedGroup] = useState<ModeGroup | null>(null);
  const [resolvedPlacement, setResolvedPlacement] = useState<MenuPlacement>('bottom');
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const selectedMode = MODE_OPTIONS.find((mode) => mode.id === value) ?? MODE_OPTIONS[0];
  const visibleGroups = allowedGroups ? GROUPS.filter((group) => allowedGroups.includes(group.id)) : GROUPS;
  const selectedGroup = visibleGroups.find((group) => group.id === selectedMode.group) ?? visibleGroups[0];

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  useLayoutEffect(() => {
    if (!menuOpen || menuPlacement !== 'auto') return;
    const updatePlacement = () => {
      const anchor = containerRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const estimatedHeight = Math.min(menuRef.current?.scrollHeight || 420, window.innerHeight * 0.7);
      setResolvedPlacement(chooseMenuPlacement(anchor.top, anchor.bottom, window.innerHeight, estimatedHeight));
    };
    updatePlacement();
    window.addEventListener('resize', updatePlacement);
    window.addEventListener('scroll', updatePlacement, true);
    return () => {
      window.removeEventListener('resize', updatePlacement);
      window.removeEventListener('scroll', updatePlacement, true);
    };
  }, [menuOpen, menuPlacement, expandedGroup, visibleGroups.length]);

  useEffect(() => {
    if (menuOpen) setExpandedGroup(selectedGroup?.id ?? null);
  }, [menuOpen, selectedGroup?.id]);

  if (!selectedGroup) return null;
  const placement = menuPlacement === 'auto' ? resolvedPlacement : menuPlacement;
  const selectedOnly = compact ? [selectedGroup] : visibleGroups;

  return (
    <div ref={containerRef} className="relative flex flex-wrap items-center gap-2">
      {!compact && visibleGroups.length > 1 && <span className="mr-1 text-sm text-gray-500">模式:</span>}
      {selectedOnly.map((group) => {
        const isSelectedGroup = selectedMode.group === group.id;
        const isExpanded = expandedGroup === group.id;
        return (
          <div key={group.id} className="relative">
            <button type="button" aria-haspopup="menu" aria-expanded={menuOpen} disabled={disabled} onClick={() => {
              const willOpen = !(menuOpen && isExpanded);
              if (willOpen && menuPlacement === 'auto') {
                const anchor = containerRef.current?.getBoundingClientRect();
                if (anchor) setResolvedPlacement(chooseMenuPlacement(anchor.top, anchor.bottom, window.innerHeight, Math.min(menuRef.current?.scrollHeight || 420, window.innerHeight * 0.7)));
              }
              setExpandedGroup(group.id);
              setMenuOpen(willOpen);
            }} className={`${compact ? 'flex h-9 items-center gap-1.5 px-2 text-xs' : 'flex min-h-10 items-center gap-2 px-3 py-2 text-sm'} rounded-lg border font-medium transition-colors ${isSelectedGroup ? group.activeClass : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'} disabled:cursor-not-allowed disabled:opacity-50`}>
              <span aria-hidden="true">{group.icon}</span><span>{group.label}</span>
              {isSelectedGroup && <span className="hidden text-xs opacity-80 sm:inline">{compact && group.id === 'omni' ? '' : `· ${selectedMode.label}`}</span>}
              <svg aria-hidden="true" viewBox="0 0 20 20" fill="currentColor" className={`h-4 w-4 transition-transform ${menuOpen ? 'rotate-180' : ''}`}><path fillRule="evenodd" d="M5.22 7.22a.75.75 0 011.06 0L10 10.94l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 8.28a.75.75 0 010-1.06z" clipRule="evenodd" /></svg>
            </button>
            {menuOpen && (compact || isExpanded) && (
              <div ref={menuRef} role="menu" aria-label="模式选择" className={`absolute left-0 z-40 ${compact ? 'w-80' : 'w-64'} max-h-[min(70vh,520px)] overflow-y-auto rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl ${placement === 'top' ? 'bottom-full mb-2' : 'top-full mt-2'}`}>
                {(compact ? visibleGroups : [group]).map((menuGroup) => {
                  const modes = MODE_OPTIONS.filter((mode) => mode.group === menuGroup.id && !('hidden' in mode && mode.hidden));
                  const groupExpanded = compact ? expandedGroup === menuGroup.id : true;
                  return (
                    <div key={menuGroup.id} className={compact ? 'border-b border-slate-100 last:border-b-0' : ''}>
                      {compact && <button type="button" role="menuitem" aria-expanded={groupExpanded} onClick={() => setExpandedGroup(groupExpanded ? null : menuGroup.id)} className="flex w-full items-center gap-2 px-3 pb-1 pt-2 text-left text-[11px] font-semibold text-slate-400 hover:text-slate-700"><span aria-hidden="true">{menuGroup.icon}</span><span>{menuGroup.label}</span><span className="ml-auto">{groupExpanded ? '⌃' : '⌄'}</span></button>}
                      {groupExpanded && modes.map((mode) => {
                        const isActive = value === mode.id;
                        return <button key={mode.id} type="button" role="menuitemradio" aria-checked={isActive} onClick={() => { onChange(mode.id); setMenuOpen(false); }} className={`flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors ${isActive ? 'bg-slate-100 text-slate-900' : 'text-slate-700 hover:bg-slate-50'}`}><span className="mt-0.5" aria-hidden="true">{mode.icon}</span><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{mode.label}</span><span className="mt-0.5 block text-xs text-slate-500">{mode.desc}</span></span>{isActive && <span className="text-sm text-blue-600" aria-label="当前模式">✓</span>}</button>;
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      {!compact && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{selectedMode.icon} {selectedMode.desc}</span>}
    </div>
  );
}
