'use client';

import { useState } from 'react';
import { BookOpenText, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react';
import type { ThesisOutlineState } from './thesisTypes';

interface WritingNavigationPanelProps { outline: ThesisOutlineState; open: boolean; onToggle: () => void; onNavigate: (id: string) => void; }

export default function WritingNavigationPanel({ outline, open, onToggle, onNavigate }: WritingNavigationPanelProps) {
  const [tab, setTab] = useState<'outline' | 'references'>('outline');
  const references = outline.chapters.flatMap((chapter) => chapter.references.map((reference) => ({ chapter, reference })));
  return <aside className={`relative h-full shrink-0 border-l border-slate-200 bg-white transition-[width] duration-200 ${open ? 'w-80' : 'w-12'}`} aria-label="文档导航">
    <button type="button" onClick={onToggle} aria-label={open ? '收起文档导航' : '展开文档导航'} className="absolute right-2 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-md bg-slate-50 text-slate-600 hover:bg-slate-100">{open ? <ChevronRight size={18}/> : <ChevronLeft size={18}/>}</button>
    {open && <div className="flex h-full min-h-0 flex-col pt-12">
      <div role="tablist" aria-label="文档导航分类" className="flex gap-5 px-5"><button type="button" role="tab" aria-selected={tab === 'outline'} onClick={() => setTab('outline')} className={`border-b-2 pb-2 text-sm ${tab === 'outline' ? 'border-slate-950 font-medium text-slate-950' : 'border-transparent text-slate-500'}`}>目录</button><button type="button" role="tab" aria-selected={tab === 'references'} onClick={() => setTab('references')} className={`border-b-2 pb-2 text-sm ${tab === 'references' ? 'border-slate-950 font-medium text-slate-950' : 'border-transparent text-slate-500'}`}>参考文献</button></div>
      <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {tab === 'outline' ? <nav aria-label="正文目录" className="space-y-1">{outline.chapters.map((chapter) => <div key={chapter.id} className="pt-1"><button type="button" onClick={() => onNavigate(chapter.id)} className="block w-full rounded-md px-2 py-2 text-left text-sm font-medium text-slate-800 hover:bg-slate-50">{chapter.title}</button><div className="ml-3 border-l border-slate-100 pl-2">{chapter.sections.map((section) => <button key={section.id} type="button" onClick={() => onNavigate(chapter.id)} className="block w-full truncate rounded-md px-2 py-1.5 text-left text-[13px] text-slate-500 hover:bg-slate-50 hover:text-slate-800">{section.title}</button>)}</div></div>)}</nav> : references.length ? <ol className="space-y-1">{references.map(({ chapter, reference }, index) => <li key={`${chapter.id}-${reference.id}-${index}`} className="border-b border-slate-100 py-3 last:border-0"><a href={reference.url} target="_blank" rel="noreferrer" className="group block"><span className="flex items-start gap-2 text-sm leading-6 text-slate-800"><span className="shrink-0">{index + 1}.</span><span>{reference.title}</span><ExternalLink size={13} className="mt-1.5 shrink-0 text-slate-300 group-hover:text-blue-500"/></span><span className="mt-1 block truncate pl-5 text-xs text-slate-400">{reference.domain} · {chapter.title}</span></a></li>)}</ol> : <div className="flex flex-col items-center px-4 py-12 text-center text-sm text-slate-400"><BookOpenText size={24} className="mb-3"/><p>暂无参考文献</p><p className="mt-1 text-xs">大纲联网检索结果会按章节汇总到这里</p></div>}
      </div>
    </div>}
  </aside>;
}
