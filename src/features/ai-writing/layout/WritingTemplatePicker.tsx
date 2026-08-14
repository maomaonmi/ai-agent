'use client';

import { Check, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { LAYOUT_TEMPLATES, type LayoutTemplateCategory } from './layoutTemplates';
import TemplateCoverThumbnail from './TemplateCoverThumbnail';

type Props = { open: boolean; selectedId?: string; onClose: () => void; onSelect: (id: string) => void };

export default function WritingTemplatePicker({ open, selectedId, onClose, onSelect }: Props) {
  const [category, setCategory] = useState<LayoutTemplateCategory>('all');
  const [query, setQuery] = useState('');
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);

  useEffect(() => setPortalHost(document.body), []);

  const items = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return LAYOUT_TEMPLATES.filter((item) => {
      const matchesCategory = category === 'all' || item.category === category;
      const matchesQuery = !normalized || `${item.name} ${item.subtitle}`.toLowerCase().includes(normalized);
      return matchesCategory && matchesQuery;
    });
  }, [category, query]);

  if (!open || !portalHost) return null;

  return createPortal(
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/40 p-4 sm:p-6" role="dialog" aria-modal="true" aria-label="更换模板">
      <div className="flex h-[86vh] max-h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-white/70 bg-white shadow-[0_24px_80px_rgba(15,23,42,0.28)]">
        <header className="flex items-center justify-between border-b border-slate-100 px-6 py-5 sm:px-8">
          <div><h2 className="text-xl font-semibold tracking-tight text-slate-900">更换模板</h2><p className="mt-1 text-sm text-slate-500">选择一个模板，立即应用到当前排版。</p></div>
          <button type="button" onClick={onClose} aria-label="关闭" className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"><X size={22} /></button>
        </header>
        <div className="border-b border-slate-100 px-6 pb-4 pt-5 sm:px-8">
          <label className="flex h-12 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/70 px-4 transition focus-within:border-blue-400 focus-within:bg-white focus-within:ring-4 focus-within:ring-blue-100"><Search size={18} className="shrink-0 text-slate-400" /><span className="sr-only">搜索模板</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索学校、模板名称或排版风格" className="w-full bg-transparent text-sm text-slate-800 outline-none placeholder:text-slate-400" /></label>
          <div className="mt-4 flex gap-2" role="tablist" aria-label="模板分类">{([['all', '全部'], ['university', '全国高校模板'], ['international', '国际通用模板']] as const).map(([id, label]) => <button type="button" role="tab" aria-selected={category === id} key={id} onClick={() => setCategory(id)} className={`rounded-lg px-3 py-2 text-sm transition ${category === id ? 'bg-slate-900 font-medium text-white shadow-sm' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900'}`}>{label}</button>)}</div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50/70 px-6 py-6 sm:px-8">
          {items.length ? <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">{items.map((item) => { const selected = selectedId === item.id; return <button type="button" key={item.id} data-template-card={item.id} onClick={() => onSelect(item.id)} className={`group relative overflow-hidden rounded-2xl border bg-white text-left shadow-sm transition duration-200 hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-blue-100 ${selected ? 'border-blue-500 ring-2 ring-blue-100' : 'border-slate-200'}`}>
            <div className="relative h-64 overflow-hidden bg-slate-100 p-5"><TemplateCoverThumbnail template={item} />{selected && <span className="absolute right-8 top-8 inline-flex items-center gap-1 rounded-full bg-blue-600 px-2.5 py-1 text-[11px] font-medium text-white"><Check size={12} />当前使用</span>}</div>
            <div className="flex items-center justify-between gap-3 px-5 py-4"><div><p className="text-sm font-semibold text-slate-800">{item.name}</p><p className="mt-1 text-xs text-slate-500">{item.category === 'university' ? '高校论文模板' : '国际通用模板'}</p></div><span className={`shrink-0 rounded-lg px-3 py-2 text-xs font-medium transition ${selected ? 'bg-slate-100 text-slate-500' : 'bg-blue-600 text-white group-hover:bg-blue-700'}`}>{selected ? '已选择' : '使用模板'}</span></div>
          </button>; })}</div> : <div className="flex min-h-56 flex-col items-center justify-center text-center"><Search size={28} className="text-slate-300" /><p className="mt-3 text-sm font-medium text-slate-600">没有找到匹配的模板</p><p className="mt-1 text-xs text-slate-400">试试其他关键词或切换分类</p></div>}
        </div>
      </div>
    </div>,
    portalHost,
  );
}
