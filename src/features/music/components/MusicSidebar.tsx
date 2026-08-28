'use client';

import { useState } from 'react';
import {
  ArrowLeft,
  Music2,
  Sparkles,
  Mic,
  ScrollText,
  Clock,
  Heart,
  Library,
  Radio,
  Wand2,
  UserPlus,
  User,
  MessageSquare,
  Plus,
} from 'lucide-react';
import type { SessionSummary } from '../../../lib/api';

interface MusicSidebarProps {
  activeTab: MusicTab;
  onTabChange: (tab: MusicTab) => void;
  onBack: () => void;
  musicSessions?: SessionSummary[];
  activeMusicSessionId?: string | null;
  onMusicSessionSelect?: (sessionId: string) => void;
  onNewMusicSession?: () => void;
}

export type MusicTab = 'compose' | 'music-creation' | 'voice-synthesis' | 'voice-library' | 'accompaniment' | 'history' | 'favorites' | 'voice-design' | 'voice-clone' | 'voice-extraction';

const NAV_ITEMS: readonly { id: MusicTab; label: string; icon: typeof Music2 }[] = [
  { id: 'compose', label: '灵感创作', icon: Sparkles },
  { id: 'music-creation', label: '音乐创作', icon: Music2 },
  { id: 'voice-synthesis', label: '语音合成', icon: Mic },
  { id: 'voice-library', label: '音色库', icon: Radio },
  { id: 'accompaniment', label: '伴奏', icon: ScrollText },
  { id: 'voice-design', label: '音色设计', icon: Wand2 },
  { id: 'voice-clone', label: '音色克隆', icon: UserPlus },
  { id: 'voice-extraction', label: '人声提取', icon: User },
  { id: 'history', label: '历史记录', icon: Clock },
  { id: 'favorites', label: '我的收藏', icon: Heart },
];

export default function MusicSidebar({ activeTab, onTabChange, onBack, musicSessions = [], activeMusicSessionId, onMusicSessionSelect, onNewMusicSession }: MusicSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`flex h-screen flex-col border-r border-slate-200 bg-white backdrop-blur-sm transition-all duration-300 dark:border-neutral-800 dark:bg-neutral-950/95 ${
        collapsed ? 'w-16' : 'w-60'
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-slate-200 px-4 py-4 dark:border-neutral-800">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-sky-400 to-sky-600 shadow-md shadow-sky-500/20">
          <Music2 size={16} className="text-white" aria-hidden="true" />
        </span>
        {!collapsed && (
          <span className="truncate text-sm font-semibold text-slate-900 dark:text-neutral-100">音乐工坊</span>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((prev) => !prev)}
          aria-label={collapsed ? '展开侧边栏' : '收起侧边栏'}
          className="ml-auto rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
        >
          <Library size={14} aria-hidden="true" />
        </button>
      </div>

      {/* Back button */}
      <div className="px-3 pt-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="返回聊天主页"
          className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200 ${
            collapsed ? 'justify-center px-0' : ''
          }`}
        >
          <ArrowLeft size={16} aria-hidden="true" />
          {!collapsed && <span>返回主页</span>}
        </button>
      </div>

      {/* Navigation */}
      <nav className="mt-2 flex-1 overflow-y-auto px-3 pb-4 scrollbar-none">
        <ul role="list" className="space-y-1" aria-label="音乐工坊导航">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => onTabChange(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  title={collapsed ? item.label : undefined}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm font-medium transition ${
                    isActive
                      ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
                      : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-neutral-400 dark:hover:bg-neutral-800/70 dark:hover:text-neutral-200'
                  } ${collapsed ? 'justify-center px-0' : ''}`}
                >
                  <Icon size={16} className="shrink-0" aria-hidden="true" />
                  {!collapsed && <span>{item.label}</span>}
                </button>
              </li>
            );
          })}
        </ul>
        {!collapsed && activeTab === 'compose' && (
          <div className="mt-5 border-t border-slate-200 pt-4 dark:border-neutral-800">
            <div className="mb-2 flex items-center justify-between px-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">创作对话</span>
              <button type="button" onClick={onNewMusicSession} aria-label="新建音乐创作会话" className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-neutral-800"><Plus size={14} /></button>
            </div>
            <ul className="space-y-1">
              {musicSessions.map((session) => <li key={session.session_id}><button type="button" onClick={() => onMusicSessionSelect?.(session.session_id)} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs ${activeMusicSessionId === session.session_id ? 'bg-violet-500/10 text-violet-600 dark:text-violet-300' : 'text-slate-500 hover:bg-slate-100 dark:text-neutral-400 dark:hover:bg-neutral-800'}`}><MessageSquare size={13} className="shrink-0" /><span className="truncate">{session.title}</span></button></li>)}
              {musicSessions.length === 0 && <li className="px-2 py-2 text-[11px] text-slate-400">开始创作后会自动保存</li>}
            </ul>
          </div>
        )}
      </nav>

      {/* Footer */}
      {!collapsed && (
        <div className="border-t border-slate-200 px-4 py-3 dark:border-neutral-800">
          <p className="text-[11px] leading-relaxed text-slate-400 dark:text-neutral-600">
            音乐创意工坊 v1.0
            <br />
            AI 辅助创作 · 灵感打磨成歌
          </p>
        </div>
      )}
    </aside>
  );
}
