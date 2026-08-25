'use client';

import { AtSign, FileText, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getConversationOmniContext } from './api';
import type { ArtifactSummary } from './types';

export default function ArtifactReferencePicker({ conversationId, selected, onChange }: {
  conversationId: string | null;
  selected: ArtifactSummary[];
  onChange: (items: ArtifactSummary[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<ArtifactSummary[]>([]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open || !conversationId) return;
    const timer = window.setTimeout(() => {
      void getConversationOmniContext(conversationId, query).then((response) => {
        setProjectId(response.projectId);
        setProjects(response.projects);
        setItems(response.candidateArtifactSummaries);
      }).catch(() => setItems([]));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [conversationId, open, query]);

  return <div className="relative px-3 pt-2">
    <div className="flex flex-wrap items-center gap-1.5">
      {selected.map((item) => { const foreign = item.projectId !== projectId; return <span key={`${item.artifactId}-${item.versionId}`} className="inline-flex max-w-64 items-center gap-1 rounded-lg bg-violet-50 px-2 py-1 text-xs text-violet-700"><FileText size={12}/><span className="truncate">{item.title}</span>{foreign && <span className="text-violet-400">· 来自其他项目</span>}<button type="button" aria-label={`移除引用 ${item.title}`} onClick={() => onChange(selected.filter((candidate) => candidate.artifactId !== item.artifactId))}><X size={12}/></button></span>; })}
      <button type="button" onClick={() => setOpen((value) => !value)} disabled={!conversationId} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-slate-500 hover:bg-slate-100 disabled:opacity-40"><AtSign size={13}/>引用作品</button>
    </div>
    {open && conversationId && <div className="absolute bottom-full left-3 z-[85] mb-2 w-[min(420px,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl">
      <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索当前或其他项目的作品…" className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400" />
      <div className="mt-2 max-h-64 overflow-y-auto">{items.map((item) => { const foreign = item.projectId !== projectId; const checked = selected.some((candidate) => candidate.artifactId === item.artifactId && candidate.versionId === item.versionId); return <button key={`${item.artifactId}-${item.versionId}`} type="button" onClick={() => { if (!checked) onChange([...selected, item]); setOpen(false); }} className="block w-full rounded-xl px-3 py-2 text-left hover:bg-slate-50"><span className="block truncate text-sm font-medium text-slate-800">{item.title}</span><span className="mt-0.5 block truncate text-xs text-slate-500">{foreign ? `来自其他项目 · ${item.projectId ? projects[item.projectId] || '未命名项目' : '未归属项目'}` : '当前项目'} · {item.summary}</span></button>; })}{items.length === 0 && <p className="px-3 py-5 text-center text-xs text-slate-400">没有匹配作品</p>}</div>
    </div>}
  </div>;
}
