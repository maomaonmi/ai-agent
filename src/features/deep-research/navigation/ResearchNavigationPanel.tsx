'use client';

import { useMemo, useState } from 'react';
import { BookOpenText, ExternalLink, ListTree, Search, X } from 'lucide-react';
import type { ResearchChunk } from '../../../lib/api';
import type { ResearchOutlineItem } from '../report/researchReportAdapter';

interface ResearchNavigationPanelProps {
  open: boolean;
  outline: ResearchOutlineItem[];
  sources: ResearchChunk[];
  onClose: () => void;
  onNavigate: (id: string) => void;
}

function safeExternalUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : undefined;
  } catch { return undefined; }
}

export default function ResearchNavigationPanel({ open, outline, sources, onClose, onNavigate }: ResearchNavigationPanelProps) {
  const [tab, setTab] = useState<'sources' | 'outline'>('sources');
  const [query, setQuery] = useState('');
  const filteredSources = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return sources;
    return sources.filter((source) => `${source.title}\n${source.text}\n${source.url}`.toLocaleLowerCase().includes(normalized));
  }, [query, sources]);

  if (!open) return null;
  return <aside className="absolute bottom-0 right-0 top-16 z-30 flex w-[min(360px,88%)] flex-col border-l border-slate-200 bg-white shadow-[-18px_0_40px_rgba(15,23,42,0.08)]" aria-label="搜索结果与目录面板">
    <div className="flex h-14 shrink-0 items-center border-b border-slate-100 px-4">
      <div role="tablist" aria-label="调研导航分类" className="flex gap-4">
        <button type="button" role="tab" aria-selected={tab === 'sources'} onClick={() => setTab('sources')} className={`border-b-2 py-4 text-sm ${tab === 'sources' ? 'border-slate-950 font-medium text-slate-950' : 'border-transparent text-slate-500'}`}>搜索结果 <span className="ml-1 text-xs text-slate-400">{sources.length}</span></button>
        <button type="button" role="tab" aria-selected={tab === 'outline'} onClick={() => setTab('outline')} className={`border-b-2 py-4 text-sm ${tab === 'outline' ? 'border-slate-950 font-medium text-slate-950' : 'border-transparent text-slate-500'}`}>目录结构</button>
      </div>
      <button type="button" onClick={onClose} aria-label="关闭搜索结果与目录" className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"><X size={17}/></button>
    </div>
    {tab === 'sources' && <label className="mx-4 mt-4 flex h-10 shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 focus-within:border-blue-400 focus-within:bg-white"><Search size={15} className="text-slate-400"/><span className="sr-only">筛选搜索结果</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选标题、摘要或网址" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"/></label>}
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
      {tab === 'outline' ? (outline.length ? <nav aria-label="调研报告目录" className="space-y-1">{outline.map((item) => <button key={item.id} type="button" onClick={() => onNavigate(item.id)} className="block w-full truncate rounded-lg py-2 text-left text-sm text-slate-700 hover:bg-slate-50 hover:text-slate-950" style={{ paddingLeft: `${8 + (item.level - 1) * 16}px`, paddingRight: 8 }}>{item.title}</button>)}</nav> : <Empty icon={<ListTree size={24}/>} title="暂未识别到目录" detail="报告中的 Markdown 或编号标题会显示在这里"/>) : (filteredSources.length ? <ol className="space-y-2">{filteredSources.map((source, index) => { const href = safeExternalUrl(source.url); return <li key={`${source.id}-${source.url}`} className="rounded-xl border border-slate-100 p-3 hover:border-slate-200 hover:bg-slate-50/70"><div className="flex items-start gap-2"><span className="mt-0.5 text-xs tabular-nums text-slate-400">{index + 1}</span><div className="min-w-0 flex-1">{href ? <a href={href} target="_blank" rel="noreferrer noopener" className="group flex items-start gap-1.5 text-sm font-medium leading-5 text-slate-850"><span>{source.title || '未命名来源'}</span><ExternalLink size={12} className="mt-1 shrink-0 text-slate-300 group-hover:text-blue-500"/></a> : <p className="text-sm font-medium text-slate-800">{source.title || '未命名来源'}</p>}<p className="mt-1.5 line-clamp-3 text-xs leading-5 text-slate-500">{source.text || '暂无搜索摘要'}</p>{href && <p className="mt-2 truncate text-[11px] text-blue-600">{new URL(href).hostname}</p>}</div></div></li>; })}</ol> : <Empty icon={<BookOpenText size={24}/>} title={query ? '没有匹配的搜索结果' : '暂无搜索结果'} detail={query ? '尝试更换筛选关键词' : '调研链路返回的来源会自动显示在这里'}/>) }
    </div>
  </aside>;
}

function Empty({ icon, title, detail }: { icon: React.ReactNode; title: string; detail: string }) {
  return <div className="flex flex-col items-center px-4 py-14 text-center text-slate-400">{icon}<p className="mt-3 text-sm font-medium text-slate-600">{title}</p><p className="mt-1 text-xs leading-5">{detail}</p></div>;
}
