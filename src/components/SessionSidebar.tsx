'use client';

import { MODE_OPTIONS } from './ModeSelector';
import { SessionSummary } from '../lib/api';
import { ChevronUp, LogOut, Settings, UserRound } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

interface SessionSidebarProps {
  sessions: SessionSummary[];
  activeSessionId: string | null;
  isOpen: boolean;
  isLoading: boolean;
  desktopCollapsed?: boolean;
  onClose: () => void;
  onToggleDesktop: () => void;
  onCreate: () => void;
  onSelect: (session: SessionSummary) => void;
  onDelete: (sessionId: string) => void;
  onClear: () => void;
  onOpenSettings: () => void;
}

function modeLabel(mode: SessionSummary['mode']) {
  return MODE_OPTIONS.find((option) => option.id === mode)?.label ?? mode;
}

export default function SessionSidebar({
  sessions,
  activeSessionId,
  isOpen,
  isLoading,
  desktopCollapsed = false,
  onClose,
  onToggleDesktop,
  onCreate,
  onSelect,
  onDelete,
  onClear,
  onOpenSettings,
}: SessionSidebarProps) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => !menuRef.current?.contains(event.target as Node) && setUserMenuOpen(false);
    document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close);
  }, []);
  return (
    <>
      {isOpen && (
        <button
          type="button"
          aria-label="关闭历史会话"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-slate-950/20 lg:hidden"
        />
      )}
      <aside
        aria-label="历史会话"
        className={`fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-slate-200 bg-white transition-transform ${
          isOpen ? 'translate-x-0' : '-translate-x-full'
        } ${
          desktopCollapsed ? 'lg:-translate-x-full' : 'lg:translate-x-0'
        }`}
      >
        <div className="border-b border-slate-200 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">历史会话</h2>
            <div className="flex items-center gap-1">
              <button
                type="button"
                aria-label="收起侧边栏"
                title="收起侧边栏"
                onClick={onToggleDesktop}
                className="hidden h-8 w-8 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900 lg:flex"
              >
                ◀
              </button>
              <button
                type="button"
                aria-label="关闭历史会话"
                onClick={onClose}
                className="rounded p-1 text-slate-500 hover:bg-slate-100 lg:hidden"
              >
                ×
              </button>
            </div>
          </div>
          <button
            type="button"
            disabled={isLoading}
            onClick={onCreate}
            className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            ＋ 新建会话
          </button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto p-2">
          {sessions.length === 0 ? (
            <div className="px-3 py-10 text-center text-sm text-slate-400">
              暂无历史会话
            </div>
          ) : (
            <ul className="space-y-1">
              {sessions.map((session) => {
                const active = session.session_id === activeSessionId;
                return (
                  <li key={session.session_id}>
                    <div
                      className={`group flex items-center rounded-lg ${
                        active ? 'bg-slate-200' : 'hover:bg-slate-100'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => onSelect(session)}
                        className="min-w-0 flex-1 px-3 py-2 text-left"
                      >
                        <span className="block truncate text-sm font-medium text-slate-800">
                          {session.title}
                        </span>
                        <span className="mt-0.5 block truncate text-xs text-slate-500">
                          {modeLabel(session.mode)}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`删除会话：${session.title}`}
                        onClick={() => onDelete(session.session_id)}
                        className="mr-2 rounded px-2 py-1 text-slate-400 opacity-0 hover:bg-white hover:text-rose-600 focus:opacity-100 group-hover:opacity-100"
                      >
                        ×
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        <div className="border-t border-slate-200 p-3 dark:border-slate-700" ref={menuRef}>
          {userMenuOpen && <div className="mb-2 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-700 dark:bg-slate-900">
            <div className="border-b border-slate-100 px-3 py-2 dark:border-slate-800"><p className="truncate text-sm font-semibold text-slate-900 dark:text-white">AI Agent 用户</p><p className="text-xs text-slate-500">本地工作区</p></div>
            <button type="button" onClick={() => { setUserMenuOpen(false); onOpenSettings(); }} className="mt-1 flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"><Settings size={17}/>设置</button>
            <button type="button" className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-400" disabled><LogOut size={17}/>退出登录</button>
          </div>}
          <button type="button" aria-haspopup="menu" aria-expanded={userMenuOpen} onClick={() => setUserMenuOpen(!userMenuOpen)} className="mb-2 flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left hover:bg-slate-100 dark:hover:bg-slate-800">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900"><UserRound size={18}/></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-slate-900 dark:text-white">AI Agent 用户</span><span className="block text-xs text-slate-500">点击打开菜单</span></span><ChevronUp size={16} className={`text-slate-400 transition ${userMenuOpen ? '' : 'rotate-180'}`}/>
          </button>
          <button
            type="button"
            disabled={sessions.length === 0 || isLoading}
            onClick={onClear}
            className="w-full rounded-lg px-3 py-2 text-left text-sm text-slate-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-40"
          >
            清空所有历史
          </button>
        </div>
      </aside>
      {desktopCollapsed && (
        <nav
          aria-label="快捷导航"
          className="fixed inset-y-0 left-0 z-40 hidden w-14 flex-col items-center border-r border-slate-200 bg-white py-3 shadow-sm lg:flex"
        >
          <button
            type="button"
            aria-label="展开历史会话"
            title="展开历史会话"
            onClick={onToggleDesktop}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-lg text-slate-600 hover:bg-slate-100 hover:text-slate-950"
          >
            ☰
          </button>
          <button
            type="button"
            aria-label="新建会话"
            title="新建会话"
            disabled={isLoading}
            onClick={onCreate}
            className="mt-3 flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 text-xl text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            ＋
          </button>
          <button
            type="button"
            aria-label="查看会话记录"
            title="查看会话记录"
            onClick={onToggleDesktop}
            className="mt-3 flex h-9 w-9 items-center justify-center rounded-lg text-lg text-slate-600 hover:bg-slate-100 hover:text-slate-950"
          >
            ◫
          </button>
          <button
            type="button"
            aria-label="清空所有历史"
            title="清空所有历史"
            disabled={sessions.length === 0 || isLoading}
            onClick={onClear}
            className="mt-auto flex h-9 w-9 items-center justify-center rounded-lg text-lg text-slate-500 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-40"
          >
            ⌫
          </button>
        </nav>
      )}
    </>
  );
}
