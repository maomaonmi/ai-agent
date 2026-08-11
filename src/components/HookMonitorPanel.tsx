'use client';

import { useMemo, useState } from 'react';
import { Activity, ChevronDown, ChevronUp, ShieldAlert } from 'lucide-react';
import type { HookEvent } from '../lib/api';

export default function HookMonitorPanel({ events }: { events: HookEvent[] }) {
  const [collapsed, setCollapsed] = useState(true);
  const latest = events[events.length - 1];
  const blocked = useMemo(() => events.filter((event) => event.status === 'blocked' || event.event === 'blocked').length, [events]);
  if (!events.length) return null;
  return <aside className="fixed bottom-5 right-5 z-40 w-[min(360px,calc(100vw-2.5rem))] overflow-hidden rounded-xl border border-slate-200 bg-white/95 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95" aria-live="polite">
    <button type="button" onClick={() => setCollapsed((value) => !value)} className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"><span className="flex items-center gap-2 text-sm font-semibold"><Activity size={16} className="text-sky-600" />HOOK 实时观察 <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-normal dark:bg-slate-800">{events.length}</span></span>{collapsed ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
    {!collapsed && <div className="border-t border-slate-200 dark:border-slate-700"><div className="flex items-center justify-between px-4 py-2 text-xs text-slate-500"><span>{latest?.hook_name} · {latest?.status}</span>{blocked > 0 && <span className="flex items-center gap-1 text-rose-600"><ShieldAlert size={13} />阻断 {blocked}</span>}</div><div className="max-h-64 overflow-auto px-3 pb-3">{events.slice(-20).reverse().map((event, index) => <div key={`${event.agent_run_id}-${event.sequence}-${index}`} className="border-b border-slate-100 py-2 text-xs last:border-0 dark:border-slate-800"><div className="flex items-center justify-between gap-2"><span className="font-medium">{event.hook_name}</span><span className={event.status === 'failed' || event.status === 'blocked' ? 'text-rose-600' : 'text-emerald-600'}>{event.status}</span></div><p className="mt-1 text-slate-500">{event.lifecycle} · {event.summary || event.event}</p></div>)}</div></div>}
    {collapsed && <div className="px-4 pb-3 text-xs text-slate-500">最近：{latest?.summary || latest?.event} · 点击展开时间线</div>}
  </aside>;
}
