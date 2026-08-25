'use client';

import { useState } from 'react';
import { Check, ChevronDown, Copy, Menu, Pause, Play, RefreshCw, Sparkles, TextSelect } from 'lucide-react';
import { formatCitationMarkers, normalizeWritingContent, type WritingDocumentState } from '../writingDocumentTypes';
import type { ThesisOutlineState } from './thesisTypes';
import WritingEditorToolbar from './WritingEditorToolbar';
import WritingNavigationPanel from './WritingNavigationPanel';

export interface WritingTextSelection {
  sectionId: string;
  text: string;
  anchorRect: { top: number; right: number; bottom: number; left: number };
}

export interface WritingRevisionSuggestion {
  sectionId: string;
  originalText: string;
  content: string;
  status: 'generating' | 'ready' | 'failed';
  anchorRect?: WritingTextSelection['anchorRect'];
}

interface ThesisBodyViewProps {
  document: WritingDocumentState;
  outline: ThesisOutlineState;
  generating: boolean;
  paused: boolean;
  onPause: () => void;
  onContinue: () => void;
  onSectionChange: (sectionId: string, content: string) => void;
  showNavigation?: boolean;
  showGenerationControls?: boolean;
  styleOptions?: string[];
  currentStyle?: string;
  onStyleChange?: (style: string) => void;
  onTextSelection?: (selection: WritingTextSelection) => void;
  onRevisionAction?: (action: 'regenerate' | 'resize' | 'polish', value?: string) => void;
  revisionSuggestion?: WritingRevisionSuggestion | null;
  onApplyRevision?: (mode: 'insert' | 'replace') => void;
  onDismissRevision?: () => void;
}

function RevisionCard({ suggestion, onApply, onDismiss }: { suggestion: WritingRevisionSuggestion; onApply: (mode: 'insert' | 'replace') => void; onDismiss: () => void }) {
  const anchor = suggestion.anchorRect;
  const floatingStyle = anchor && typeof window !== 'undefined' ? { position: 'fixed' as const, left: Math.max(16, Math.min(anchor.left, window.innerWidth - 620)), top: anchor.bottom + 12 > window.innerHeight - 360 ? Math.max(16, anchor.top - 350) : anchor.bottom + 12, width: 'min(580px, calc(100vw - 32px))', zIndex: 60 } : undefined;
  return <aside style={floatingStyle} className="mt-4 max-h-[340px] overflow-y-auto rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 via-white to-rose-50 p-5 shadow-2xl" aria-live="polite" aria-busy={suggestion.status === 'generating'}>
    <div className="flex items-center justify-between"><strong className="text-sm font-medium text-slate-900">AI 润色</strong><button type="button" onClick={onDismiss} aria-label="关闭润色建议" className="h-8 w-8 rounded-full text-slate-500 hover:bg-white">×</button></div>
    <div className="mt-4 whitespace-pre-wrap text-[16px] leading-8 text-slate-800">{suggestion.content || '正在分析选中内容…'}{suggestion.status === 'generating' && <span className="ml-1 inline-block h-5 w-0.5 animate-pulse bg-blue-500 align-middle"/>}</div>
    <p className="mt-4 text-sm text-slate-400">修改建议：可将结果插入到当前段落后，或替换选中的原文。</p>
    <div className="mt-5 flex items-center justify-between">
      <button type="button" onClick={() => void navigator.clipboard?.writeText(suggestion.content)} aria-label="复制润色结果" className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-white"><Copy size={16}/></button>
      <div className="flex gap-2"><button type="button" disabled={suggestion.status !== 'ready'} onClick={() => onApply('insert')} className="rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white disabled:opacity-40">插入</button><button type="button" disabled={suggestion.status !== 'ready'} onClick={() => onApply('replace')} className="rounded-xl bg-white px-5 py-2.5 text-sm font-medium text-blue-700 shadow-sm ring-1 ring-slate-200 disabled:opacity-40">替换</button></div>
    </div>
  </aside>;
}

function EditableSection({ sectionId, content, references, generating, onChange, onTextSelection }: { sectionId: string; content: string; references: WritingDocumentState['references']; generating: boolean; onChange: (sectionId: string, content: string) => void; onTextSelection?: (selection: WritingTextSelection) => void }) {
  const displayContent = formatCitationMarkers(normalizeWritingContent(content.replace(/\n[\t ]*\n(?:[\t ]*\n)+/g, '\n\n')), references);
  const captureSelection = (container: HTMLDivElement) => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.anchorNode || !container.contains(selection.anchorNode)) return;
    const text = selection.toString().trim();
    if (text) {
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      onTextSelection?.({ sectionId, text, anchorRect: { top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left } });
    }
  };
  return <div contentEditable={!generating} suppressContentEditableWarning role="textbox" aria-label="正文段落" aria-multiline="true" onMouseUp={(event) => captureSelection(event.currentTarget)} onKeyUp={(event) => captureSelection(event.currentTarget)} onBlur={(event) => onChange(sectionId, normalizeWritingContent(event.currentTarget.innerText))} className="mt-2 min-h-12 whitespace-pre-wrap text-[17px] leading-7 text-slate-800 outline-none empty:before:text-slate-300 empty:before:content-['正文将在这里生成'] focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-blue-100">{displayContent}</div>;
}

export default function ThesisBodyView({ document: writingDocument, outline, generating, paused, onPause, onContinue, onSectionChange, showNavigation = true, showGenerationControls = true, styleOptions = [], currentStyle, onStyleChange, onTextSelection, onRevisionAction, revisionSuggestion, onApplyRevision, onDismissRevision }: ThesisBodyViewProps) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [menu, setMenu] = useState<'resize' | 'style' | null>(null);
  const incomplete = writingDocument.sections.some((section) => section.status !== 'complete');
  const runCommand = (command: string, value?: string) => window.document.execCommand(command, false, value);
  const navigateTo = (id: string) => window.document.getElementById(`writing-section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const actionButton = 'inline-flex h-10 items-center gap-2 rounded-xl px-3 text-sm text-slate-700 transition hover:bg-slate-100 disabled:opacity-40';

  return <div className="relative flex min-h-full">
    <div className="min-w-0 flex-1">
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur"><WritingEditorToolbar onCommand={runCommand}/></div>
      {showNavigation && <button type="button" onClick={() => setNavigationOpen((value) => !value)} aria-expanded={navigationOpen} aria-controls="writing-navigation" className="absolute right-1 top-20 z-10 inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100" aria-label="目录与参考文献"><Menu size={18}/></button>}
      <article className="pb-28 pt-12" style={{ width: 'calc(100% - 96px)', maxWidth: 980, margin: '0 auto' }}>
        <h1 className="text-xl font-medium leading-8 tracking-tight text-slate-950">{writingDocument.title}</h1>
        <div className="mt-4 space-y-5">
          {writingDocument.sections.map((section) => <section id={`writing-section-${section.id}`} key={section.id} aria-busy={section.status === 'generating'} className="scroll-mt-28">
            <div className="flex items-center justify-between gap-3"><h2 className="text-[19px] font-semibold leading-7 text-slate-950">{section.title}</h2><span className="text-xs text-slate-400">{section.status === 'generating' ? '正在写作…' : section.status === 'complete' ? `${section.content.replace(/\s/g, '').length} 字` : '等待生成'}</span></div>
            <EditableSection sectionId={section.id} content={section.content} references={writingDocument.references} generating={section.status === 'generating'} onChange={onSectionChange} onTextSelection={onTextSelection}/>
            {section.status === 'generating' && <span className="mt-1 inline-block h-5 w-0.5 animate-pulse bg-blue-500 align-middle"/>}
            {revisionSuggestion?.sectionId === section.id && onApplyRevision && onDismissRevision && <RevisionCard suggestion={revisionSuggestion} onApply={onApplyRevision} onDismiss={onDismissRevision}/>} 
          </section>)}
        </div>
        {showGenerationControls && <div className="sticky bottom-16 mt-8 flex justify-center">{generating ? <button type="button" onClick={onPause} className="inline-flex h-11 items-center gap-2 rounded-full border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 shadow-lg"><Pause size={16}/>暂停生成</button> : paused || incomplete ? <button type="button" onClick={onContinue} className="inline-flex h-11 items-center gap-2 rounded-full bg-blue-600 px-6 text-sm font-medium text-white shadow-lg"><Play size={16}/>{paused ? '继续生成' : '开始生成正文'}</button> : <span className="inline-flex h-10 items-center gap-2 rounded-full border border-emerald-200 bg-white px-4 text-sm text-emerald-700 shadow-sm"><Check size={16}/>正文生成完成</span>}</div>}
        <div className="sticky bottom-4 z-20 mt-8 flex justify-center">
          <div className="relative flex items-center rounded-2xl border border-slate-200 bg-white/95 p-1.5 shadow-xl backdrop-blur">
            <button type="button" disabled={generating} onClick={() => onRevisionAction?.('regenerate')} className={actionButton}><RefreshCw size={16} className="text-blue-600"/>重新生成</button>
            <div className="relative"><button type="button" disabled={generating} onClick={() => setMenu((value) => value === 'resize' ? null : 'resize')} className={actionButton}><TextSelect size={16} className="text-blue-600"/>扩写缩写<ChevronDown size={13}/></button>{menu === 'resize' && <div className="absolute bottom-12 left-0 w-36 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">{['扩写至150%','扩写至120%','缩写至80%','缩写至50%'].map((item) => <button key={item} type="button" onClick={() => { onRevisionAction?.('resize', item); setMenu(null); }} className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50">{item}</button>)}</div>}</div>
            {styleOptions.length > 0 && <div className="relative"><button type="button" disabled={generating} onClick={() => setMenu((value) => value === 'style' ? null : 'style')} className={actionButton}><Sparkles size={16} className="text-blue-600"/>写作风格<ChevronDown size={13}/></button>{menu === 'style' && <div className="absolute bottom-12 left-0 max-h-64 w-36 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl">{styleOptions.map((item) => <button key={item} type="button" onClick={() => { onStyleChange?.(item); setMenu(null); }} className={`block w-full rounded-lg px-3 py-2 text-left text-sm ${currentStyle === item ? 'bg-blue-50 text-blue-700' : 'hover:bg-slate-50'}`}>{item}</button>)}</div>}</div>}
            <button type="button" disabled={generating} onClick={() => onRevisionAction?.('polish')} className={actionButton}><Sparkles size={16} className="text-blue-600"/>智能润色</button>
          </div>
        </div>
      </article>
    </div>
    {showNavigation && <div id="writing-navigation" className="sticky top-0 h-full"><WritingNavigationPanel outline={outline} open={navigationOpen} onToggle={() => setNavigationOpen((value) => !value)} onNavigate={navigateTo}/></div>}
  </div>;
}
