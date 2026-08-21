'use client';

import { MODE_OPTIONS } from './ModeSelector';
import { SessionSummary } from '../lib/api';
import type { PptHistoryRun } from '../features/ppt/api';
import { Activity, Check, ChevronRight, ChevronUp, Film, FolderInput, LogOut, MoreHorizontal, Pencil, Pin, Presentation, Puzzle, Settings, Share2, Trash2, UserRound, Workflow } from 'lucide-react';
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
  onRename: (sessionId: string, title: string) => Promise<void>;
  onClear: () => void;
  onOpenSettings: () => void;
  onOpenDirectory: (tab?: 'skills' | 'connectors' | 'plugins') => void;
  onOpenHooks: () => void;
  onOpenImageStudio: () => void;
  onOpenVideoStudio: () => void;
  onOpenVisualWorkflow: () => void;
  onOpenPpt: () => void;
  pptHistory: PptHistoryRun[];
  pptHistoryLoading: boolean;
  onSelectPptHistory: (run: PptHistoryRun) => void;
}

function modeLabel(mode: SessionSummary['mode']) {
  return MODE_OPTIONS.find((option) => option.id === mode)?.label ?? mode;
}

function pptStatusLabel(status: PptHistoryRun['status']): string {
  switch (status) {
    case 'COMPLETED': return '已完成';
    case 'RUNNING': return '制作中';
    case 'QUEUED': return '排队中';
    case 'PAUSED': return '已暂停';
    case 'CANCELLED': return '已取消';
    case 'FAILED': return '失败';
    default: return status;
  }
}

function formatPptHistoryDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
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
  onRename,
  onClear,
  onOpenSettings,
  onOpenDirectory,
  onOpenHooks,
  onOpenImageStudio,
  onOpenVideoStudio,
  onOpenVisualWorkflow,
  onOpenPpt,
  pptHistory,
  pptHistoryLoading,
  onSelectPptHistory,
}: SessionSidebarProps) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [openSessionMenuId, setOpenSessionMenuId] = useState<string | null>(null);
  const [projectMenuSessionId, setProjectMenuSessionId] = useState<string | null>(null);
  const [pinnedSessionIds, setPinnedSessionIds] = useState<Set<string>>(new Set());
  const [sessionProjects, setSessionProjects] = useState<Record<string, string>>({});
  const [projectNames, setProjectNames] = useState<string[]>([]);
  const [shareNotice, setShareNotice] = useState<string | null>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const sessionMenuRef = useRef<HTMLUListElement>(null);
  const storageHydratedRef = useRef(false);
  const skipPersistenceRef = useRef(false);
  useEffect(() => {
    try {
      const storedPins = JSON.parse(localStorage.getItem('sessionSidebarPinned-v1') ?? '[]');
      if (Array.isArray(storedPins)) setPinnedSessionIds(new Set(storedPins.filter((value): value is string => typeof value === 'string')));
      const storedProjects = JSON.parse(localStorage.getItem('sessionSidebarProjects-v1') ?? '{}');
      if (storedProjects && typeof storedProjects === 'object' && !Array.isArray(storedProjects)) setSessionProjects(storedProjects as Record<string, string>);
      const storedProjectNames = JSON.parse(localStorage.getItem('sessionSidebarProjectNames-v1') ?? '[]');
      if (Array.isArray(storedProjectNames)) setProjectNames(storedProjectNames.filter((value): value is string => typeof value === 'string'));
    } catch { /* localStorage corruption should not block the sidebar */ }
    storageHydratedRef.current = true;
    skipPersistenceRef.current = true;
  }, []);
  useEffect(() => {
    if (!storageHydratedRef.current) return;
    if (skipPersistenceRef.current) {
      skipPersistenceRef.current = false;
      return;
    }
    localStorage.setItem('sessionSidebarPinned-v1', JSON.stringify([...pinnedSessionIds]));
    localStorage.setItem('sessionSidebarProjects-v1', JSON.stringify(sessionProjects));
    localStorage.setItem('sessionSidebarProjectNames-v1', JSON.stringify(projectNames));
  }, [pinnedSessionIds, sessionProjects, projectNames]);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!userMenuRef.current?.contains(target)) setUserMenuOpen(false);
      if (!sessionMenuRef.current?.contains(target)) {
        setOpenSessionMenuId(null);
        setProjectMenuSessionId(null);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpenSessionMenuId(null);
        setProjectMenuSessionId(null);
      }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  const orderedSessions = [...sessions].sort((left, right) => {
    const pinDifference = Number(pinnedSessionIds.has(right.session_id)) - Number(pinnedSessionIds.has(left.session_id));
    return pinDifference || right.updated_at - left.updated_at;
  });
  const closeSessionMenu = () => {
    setOpenSessionMenuId(null);
    setProjectMenuSessionId(null);
  };
  const togglePinned = (sessionId: string) => {
    setPinnedSessionIds((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) next.delete(sessionId); else next.add(sessionId);
      return next;
    });
    closeSessionMenu();
  };
  const renameFromMenu = (session: SessionSummary) => {
    const nextTitle = window.prompt('重命名会话', session.title)?.trim();
    if (!nextTitle || nextTitle === session.title) return;
    void onRename(session.session_id, nextTitle).then(closeSessionMenu).catch(() => undefined);
  };
  const shareFromMenu = async (sessionId: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set('session', sessionId);
    try {
      if (!navigator.clipboard) throw new Error('clipboard unavailable');
      await navigator.clipboard.writeText(url.toString());
      setShareNotice(sessionId);
      window.setTimeout(() => setShareNotice((current) => current === sessionId ? null : current), 2_000);
    } catch {
      setShareNotice(null);
    }
    closeSessionMenu();
  };
  const moveToProject = (sessionId: string, project: string) => {
    setSessionProjects((current) => {
      const next = { ...current };
      if (project === '未分类') delete next[sessionId]; else next[sessionId] = project;
      return next;
    });
    closeSessionMenu();
  };
  const createProjectFromMenu = (sessionId: string) => {
    const project = window.prompt('新建项目', '')?.trim();
    if (!project) return;
    setProjectNames((current) => current.includes(project) ? current : [...current, project]);
    moveToProject(sessionId, project);
  };
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
          <button
            type="button"
            onClick={() => onOpenDirectory()}
            className="mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            <Puzzle size={16} className="shrink-0 text-slate-500" />
            MCP · Skills · Plugins
          </button>
          <button
            type="button"
            onClick={onOpenImageStudio}
            className="mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            <span aria-hidden="true" className="text-base">✦</span>
            AI 生图
          </button>
          <button
            type="button"
            onClick={onOpenVideoStudio}
            className="mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Film size={16} className="shrink-0 text-cyan-500" />
            AI 视频
          </button>
          <button
            type="button"
            onClick={onOpenVisualWorkflow}
            className="mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Workflow size={16} className="shrink-0 text-violet-500" />
            视频流工作台
          </button>
          <button
            type="button"
            onClick={onOpenPpt}
            className="mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Presentation size={16} className="shrink-0 text-orange-500" />
            AI PPT
          </button>
          <button
            type="button"
            onClick={onOpenHooks}
            className="mt-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <Activity size={16} className="shrink-0 text-slate-500" />
            HOOK 管理中心
          </button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto p-2">
          <section aria-labelledby="ppt-history-heading" className="mb-3 border-b border-slate-100 pb-3">
            <div className="flex items-center justify-between px-3 py-2">
              <h3 id="ppt-history-heading" className="text-xs font-semibold text-slate-700">PPT 历史记录</h3>
              <span className="text-[10px] text-slate-400">{pptHistoryLoading ? '加载中…' : `${pptHistory.length} 条`}</span>
            </div>
            {pptHistoryLoading ? (
              <div role="status" aria-label="正在加载 PPT 历史记录" className="space-y-2 px-3 py-2">
                <div className="h-10 animate-pulse rounded-lg bg-slate-100" />
                <div className="h-10 animate-pulse rounded-lg bg-slate-100" />
              </div>
            ) : pptHistory.length === 0 ? (
              <p className="px-3 py-3 text-xs text-slate-400">暂无 PPT 历史记录</p>
            ) : (
              <ul className="space-y-1" aria-label="PPT 历史会话列表">
                {pptHistory.map((run) => (
                  <li key={run.runId}>
                    <button
                      type="button"
                      onClick={() => onSelectPptHistory(run)}
                      aria-label={`打开 PPT 会话：${run.title}`}
                      title={`presentationId: ${run.presentationId}\nrunId: ${run.runId}`}
                      className="w-full rounded-lg px-3 py-2 text-left hover:bg-violet-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                    >
                      <span className="block truncate text-xs font-medium text-slate-800">{run.title}</span>
                      <span className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-slate-400">
                        <span className="truncate">{pptStatusLabel(run.status)} · {formatPptHistoryDate(run.updatedAt)}</span>
                        <span className="shrink-0 font-mono">…{run.runId.slice(-6)}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          {sessions.length === 0 ? (
            <div className="px-3 py-10 text-center text-sm text-slate-400">
              暂无历史会话
            </div>
          ) : (
            <ul ref={sessionMenuRef} className="space-y-1">
              {orderedSessions.map((session) => {
                const active = session.session_id === activeSessionId;
                const pinned = pinnedSessionIds.has(session.session_id);
                const project = sessionProjects[session.session_id];
                const menuOpen = openSessionMenuId === session.session_id;
                return (
                  <li key={session.session_id} className="relative">
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
                          {modeLabel(session.mode)}{project ? ` · ${project}` : ''}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`打开会话菜单：${session.title}`}
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        onClick={(event) => {
                          event.stopPropagation();
                          setOpenSessionMenuId(menuOpen ? null : session.session_id);
                          setProjectMenuSessionId(null);
                        }}
                        className={`mr-1 flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 transition hover:bg-white hover:text-slate-800 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 ${menuOpen ? 'bg-white opacity-100 text-slate-800' : 'opacity-0 group-hover:opacity-100'}`}
                      >
                        <MoreHorizontal size={17} />
                      </button>
                    </div>
                    {menuOpen && (
                      <div role="menu" aria-label={`${session.title} 操作`} className="absolute right-2 top-11 z-30 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-[0_16px_40px_rgba(15,23,42,0.16)]">
                        <button type="button" role="menuitem" onClick={() => togglePinned(session.session_id)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
                          <Pin size={16} className={pinned ? 'fill-violet-600 text-violet-600' : 'text-slate-500'} />{pinned ? '取消置顶' : '置顶'}
                        </button>
                        <button type="button" role="menuitem" onClick={() => void shareFromMenu(session.session_id)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
                          {shareNotice === session.session_id ? <Check size={16} className="text-emerald-600" /> : <Share2 size={16} className="text-slate-500" />}{shareNotice === session.session_id ? '链接已复制' : '分享'}
                        </button>
                        <button type="button" role="menuitem" onClick={() => renameFromMenu(session)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
                          <Pencil size={16} className="text-slate-500" />重命名
                        </button>
                        <button type="button" role="menuitem" aria-expanded={projectMenuSessionId === session.session_id} onClick={() => setProjectMenuSessionId((current) => current === session.session_id ? null : session.session_id)} className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm text-slate-700 hover:bg-slate-100">
                          <span className="flex items-center gap-3"><FolderInput size={16} className="text-slate-500" />移动到项目</span><ChevronRight size={15} className="text-slate-400" />
                        </button>
                        {projectMenuSessionId === session.session_id && (
                          <div className="mt-1 border-t border-slate-100 pt-1" role="menu" aria-label="选择项目">
                            <button type="button" role="menuitem" onClick={() => moveToProject(session.session_id, '未分类')} className="flex w-full items-center rounded-lg px-3 py-2 text-xs text-slate-600 hover:bg-slate-100">未分类{!project && <Check size={14} className="ml-auto text-violet-600" />}</button>
                            {projectNames.map((name) => <button key={name} type="button" role="menuitem" onClick={() => moveToProject(session.session_id, name)} className="flex w-full items-center rounded-lg px-3 py-2 text-xs text-slate-600 hover:bg-slate-100">{name}{project === name && <Check size={14} className="ml-auto text-violet-600" />}</button>)}
                            <button type="button" role="menuitem" onClick={() => createProjectFromMenu(session.session_id)} className="mt-1 flex w-full items-center rounded-lg border-t border-slate-100 px-3 py-2 text-xs font-medium text-violet-700 hover:bg-violet-50">＋ 新建项目</button>
                          </div>
                        )}
                        <div className="my-1 border-t border-slate-100" />
                        <button type="button" role="menuitem" onClick={() => { closeSessionMenu(); onDelete(session.session_id); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-rose-600 hover:bg-rose-50">
                          <Trash2 size={16} />删除
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </nav>

        <div className="border-t border-slate-200 p-3 dark:border-slate-700" ref={userMenuRef}>
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
            aria-label="打开 AI 视频"
            title="AI 视频"
            onClick={onOpenVideoStudio}
            className="mt-3 flex h-9 w-9 items-center justify-center rounded-lg text-cyan-600 hover:bg-cyan-50 hover:text-cyan-700"
          >
            <Film size={18} />
          </button>
          <button
            type="button"
            aria-label="打开视频流工作台"
            title="视频流工作台"
            onClick={onOpenVisualWorkflow}
            className="mt-3 flex h-9 w-9 items-center justify-center rounded-lg text-violet-600 hover:bg-violet-50 hover:text-violet-700"
          >
            <Workflow size={18} />
          </button>
          <button
            type="button"
            aria-label="打开 AI PPT"
            title="AI PPT"
            onClick={onOpenPpt}
            className="mt-3 flex h-9 w-9 items-center justify-center rounded-lg text-orange-600 hover:bg-orange-50 hover:text-orange-700"
          >
            <Presentation size={18} />
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
