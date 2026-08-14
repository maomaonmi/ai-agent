'use client';

import { useState } from 'react';
import { CirclePlus, RefreshCw, SlidersHorizontal, Sparkles, Trash2, X } from 'lucide-react';
import { ThesisChapterLength, ThesisOutlineChapter, ThesisOutlineState } from './thesisTypes';

interface ThesisOutlineViewProps {
  outline: ThesisOutlineState;
  typingText?: string;
  onSetChapterLength: (chapterId: string, length: ThesisChapterLength) => void;
  onAddSection: (chapterId: string, title: string, writingBrief: string) => void;
  onDeleteChapter: (chapterId: string) => void;
  onRegenerate: () => void;
  onGenerateBody: () => void;
}

const LENGTH_OPTIONS: Array<{ value: ThesisChapterLength; label: string; mark: string }> = [
  { value: 'short', label: '段落简短', mark: '一' },
  { value: 'medium', label: '段落适中', mark: '三' },
  { value: 'long', label: '段落较长', mark: '亖' },
];

function AddSectionForm({ chapterId, onAdd }: { chapterId: string; onAdd: ThesisOutlineViewProps['onAddSection'] }) {
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  return <form className="mt-4 rounded-xl border border-slate-200 bg-slate-50/70 p-3" onSubmit={(event) => { event.preventDefault(); if (!title.trim()) return; onAdd(chapterId, title.trim(), brief.trim()); setTitle(''); setBrief(''); }}>
    <label className="relative block"><span className="sr-only">子章节标题</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="输入子章节标题" className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-3 pr-10 text-sm outline-none focus:border-blue-400"/>{title && <button type="button" onClick={() => setTitle('')} aria-label="清除子章节标题" className="absolute right-2 top-2 rounded p-1 text-slate-400 hover:bg-slate-100"><X size={15}/></button>}</label>
    <label className="relative mt-2 block"><span className="sr-only">子章节内容主题</span><input value={brief} onChange={(event) => setBrief(event.target.value)} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') event.currentTarget.form?.requestSubmit(); }} placeholder="输入子章节内容主题/写作要求" className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-3 pr-10 text-sm outline-none focus:border-blue-400"/>{brief && <button type="button" onClick={() => setBrief('')} aria-label="清除子章节内容主题" className="absolute right-2 top-2 rounded p-1 text-slate-400 hover:bg-slate-100"><X size={15}/></button>}</label>
    <div className="mt-3 flex justify-end"><button type="submit" disabled={!title.trim()} className="rounded-lg bg-slate-950 px-3 py-2 text-xs font-medium text-white disabled:bg-slate-200 disabled:text-slate-400">添加子章节</button></div>
  </form>;
}

function ChapterCard({ chapter, onSetChapterLength, onAddSection, onDeleteChapter }: { chapter: ThesisOutlineChapter } & Pick<ThesisOutlineViewProps, 'onSetChapterLength' | 'onAddSection' | 'onDeleteChapter'>) {
  const [lengthOpen, setLengthOpen] = useState(false);
  const [referencesOpen, setReferencesOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  return <section className="relative rounded-2xl border border-slate-200 bg-white px-5 py-4">
    <div className="flex items-start gap-3"><span className="mt-1 cursor-grab text-slate-300" aria-hidden="true">⠿</span><div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold text-slate-950">{chapter.title}</h2><div className="flex items-center gap-1">
        <div className="relative"><button type="button" aria-expanded={referencesOpen} onClick={() => setReferencesOpen((value) => !value)} className="rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-500 hover:bg-slate-200">{chapter.searchStatus === 'searching' ? '正在搜索…' : `参考资料 ${chapter.references.length || 0}`}</button>{referencesOpen && <div className="absolute right-0 top-10 z-30 w-[min(28rem,80vw)] rounded-2xl border border-slate-200 bg-white p-3 shadow-xl"><p className="px-2 pb-2 text-xs font-medium text-slate-500">本章真实联网来源</p>{chapter.references.length ? <div className="space-y-1">{chapter.references.map((reference) => <a key={reference.id} href={reference.url} target="_blank" rel="noreferrer" className="block rounded-xl px-3 py-2.5 hover:bg-slate-50"><span className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">{reference.title}</span><span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${reference.status === 'scraped' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{reference.status === 'scraped' ? '已抓取' : '搜索摘要'}</span></span><span className="mt-0.5 block text-xs text-blue-600">{reference.domain}</span>{reference.snippet && <span className="mt-1 line-clamp-3 block text-xs leading-5 text-slate-500">{reference.snippet}</span>}</a>)}</div> : <p className="rounded-xl bg-slate-50 px-3 py-4 text-sm text-slate-500">{chapter.searchStatus === 'searching' ? '正在检索权威资料…' : chapter.searchStatus === 'failed' ? chapter.searchError || '本章资料检索失败，可稍后重试。' : '暂未找到可验证来源。'}</p>}</div>}</div>
        <div className="relative"><button type="button" aria-label="设置当前大章节长度" aria-expanded={lengthOpen} onClick={() => setLengthOpen((value) => !value)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"><SlidersHorizontal size={17}/></button>{lengthOpen && <div className="absolute right-0 top-11 z-30 w-48 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"><p className="px-3 py-2 text-xs font-medium text-slate-500">段落长度设置</p>{LENGTH_OPTIONS.map((option) => <button key={option.value} type="button" onClick={() => { onSetChapterLength(chapter.id, option.value); setLengthOpen(false); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-slate-50"><span className="w-4 text-center text-slate-500">{option.mark}</span><span>{option.label}</span>{chapter.length === option.value && <span className="ml-auto h-2 w-2 rounded-full bg-slate-950"/>}</button>)}<div className="my-1 border-t border-slate-100"/><button type="button" onClick={() => onDeleteChapter(chapter.id)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-rose-600 hover:bg-rose-50"><Trash2 size={16}/>删除大章节</button></div>}</div>
        <button type="button" aria-label="添加子章节" aria-expanded={adding} onClick={() => setAdding((value) => !value)} className="rounded-lg p-2 text-slate-700 hover:bg-slate-100"><CirclePlus size={18}/></button>
      </div></div>
      {chapter.summary && <p className="mt-3 text-sm leading-6 text-slate-500">{chapter.summary}</p>}
      <div className="mt-4 space-y-4">{chapter.sections.map((section) => <div key={section.id}><h3 className="text-sm font-medium text-slate-900">{section.title}</h3>{section.writingBrief && <p className="mt-1.5 text-sm leading-6 text-slate-400">{section.writingBrief}</p>}</div>)}</div>
      {adding && <AddSectionForm chapterId={chapter.id} onAdd={(...args) => { onAddSection(...args); setAdding(false); }}/>}</div>
    </div>
  </section>;
}

export default function ThesisOutlineView({ outline, typingText = '', onSetChapterLength, onAddSection, onDeleteChapter, onRegenerate, onGenerateBody }: ThesisOutlineViewProps) {
  const ready = outline.status === 'ready' && outline.chapters.every((chapter) => chapter.searchStatus !== 'searching');
  const phaseLabel = outline.researchPhase === 'ResearchPlanning' ? '正在规划检索范围' : outline.researchPhase === 'WebResearch' ? '正在联网查找资料' : outline.researchPhase === 'KeepAlive' ? '正在整合网页信息' : outline.researchPhase === 'answer' ? '正在整理最终来源' : '';
  return <div className="pb-24">
    <div className="flex items-start gap-3 text-sm leading-6 text-slate-700"><span className="mt-0.5 rounded bg-blue-500 px-2 py-0.5 text-xs font-medium text-white">分步骤</span><p>先生成并确认论文大纲，再根据每章参考资料生成正文。你可以调整章节长度或添加子章节。</p></div>
    {outline.title && <h1 className="mt-6 rounded-xl border border-slate-200 px-4 py-3 text-base font-semibold">{outline.title}</h1>}
    <div className="mt-5 space-y-5">
      {outline.prefaces.map((preface) => <section key={preface.id} className="rounded-2xl border border-slate-200 px-5 py-4"><h2 className="font-semibold">{preface.title}</h2>{preface.writingBrief && <p className="mt-2 text-sm leading-6 text-slate-400">{preface.writingBrief}</p>}</section>)}
      {outline.chapters.map((chapter) => <ChapterCard key={chapter.id} chapter={chapter} onSetChapterLength={onSetChapterLength} onAddSection={onAddSection} onDeleteChapter={onDeleteChapter}/>)}
    </div>
    {outline.status === 'generating' && <div role="status" className="mt-6 flex items-center gap-2 text-sm text-blue-600"><span className="h-2 w-2 animate-pulse rounded-full bg-blue-500"/>大纲正在真实流式生成…</div>}
    {typingText && <div role="status" aria-live="polite" className="mt-4 rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-3 text-sm leading-6 text-blue-800"><span className="mr-1 inline-block h-4 w-0.5 animate-pulse bg-blue-600 align-[-2px]"/>{typingText}</div>}
    {phaseLabel && outline.chapters.some((chapter) => chapter.searchStatus === 'searching') && <div role="status" className="mt-5 flex items-center gap-2 rounded-xl bg-blue-50 px-4 py-3 text-sm text-blue-700"><span className="h-2 w-2 animate-pulse rounded-full bg-blue-500"/>{phaseLabel} · 每章收集 4–6 条后自动结束</div>}
    {outline.status === 'failed' && <div role="alert" className="mt-5 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{outline.error || '大纲生成失败'}</div>}
    <div className="sticky bottom-4 mt-8 flex justify-center"><div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white p-1.5 shadow-[0_10px_30px_rgba(15,23,42,0.12)]"><button type="button" disabled={!ready} onClick={onRegenerate} className="inline-flex h-10 items-center gap-2 rounded-full px-4 text-sm text-slate-700 hover:bg-slate-50 disabled:text-slate-300"><RefreshCw size={16}/>换一换</button><button type="button" disabled={!ready} onClick={onGenerateBody} className="inline-flex h-10 items-center gap-2 rounded-full bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400"><Sparkles size={16}/>基于大纲生成正文</button></div></div>
  </div>;
}
