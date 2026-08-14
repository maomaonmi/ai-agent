'use client';

import { useState } from 'react';
import { Check, Menu, Pause, Play } from 'lucide-react';
import { formatCitationMarkers, type WritingDocumentState } from '../writingDocumentTypes';
import type { ThesisOutlineState } from './thesisTypes';
import WritingEditorToolbar from './WritingEditorToolbar';
import WritingNavigationPanel from './WritingNavigationPanel';

interface ThesisBodyViewProps {
  document: WritingDocumentState;
  outline: ThesisOutlineState;
  generating: boolean;
  paused: boolean;
  onPause: () => void;
  onContinue: () => void;
  onSectionChange: (sectionId: string, content: string) => void;
}

function EditableSection({ sectionId, content, references, generating, onChange }: { sectionId: string; content: string; references: WritingDocumentState['references']; generating: boolean; onChange: (sectionId: string, content: string) => void }) {
  const displayContent = formatCitationMarkers(content.replace(/\n[\t ]*\n(?:[\t ]*\n)+/g, '\n\n'), references);
  return <div
    contentEditable={!generating}
    suppressContentEditableWarning
    role="textbox"
    aria-label="正文段落"
    aria-multiline="true"
    onBlur={(event) => onChange(sectionId, event.currentTarget.innerText)}
    className="mt-2 min-h-12 whitespace-pre-wrap text-[17px] leading-[1.95] text-slate-800 outline-none empty:before:text-slate-300 empty:before:content-['正文将在这里生成'] focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-blue-100"
  >{displayContent}</div>;
}

export default function ThesisBodyView({ document: writingDocument, outline, generating, paused, onPause, onContinue, onSectionChange }: ThesisBodyViewProps) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const incomplete = writingDocument.sections.some((section) => section.status !== 'complete');
  const runCommand = (command: string, value?: string) => window.document.execCommand(command, false, value);
  const navigateTo = (id: string) => window.document.getElementById(`writing-section-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return <div className="relative flex min-h-full">
    <div className="min-w-0 flex-1">
      <div className="sticky top-0 z-20 bg-white/95 backdrop-blur">
        <WritingEditorToolbar onCommand={runCommand}/>
      </div>
      <button type="button" onClick={() => setNavigationOpen((value) => !value)} aria-expanded={navigationOpen} aria-controls="writing-navigation" className="absolute right-1 top-20 z-10 inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-700 hover:bg-slate-100" aria-label="目录与参考文献"><Menu size={18}/></button>
      <article className="pb-24 pt-12" style={{ width: 'calc(100% - 96px)', maxWidth: 980, margin: '0 auto' }}>
        <h1 className="text-xl font-medium leading-8 tracking-tight text-slate-950">{writingDocument.title}</h1>
        <div className="mt-4 space-y-5">
          {writingDocument.sections.map((section) => <section id={`writing-section-${section.id}`} key={section.id} aria-busy={section.status === 'generating'} className="scroll-mt-28">
            <div className="flex items-center justify-between gap-3"><h2 className="text-[19px] font-semibold leading-7 text-slate-950">{section.title}</h2><span className="text-xs text-slate-400">{section.status === 'generating' ? '正在写作…' : section.status === 'complete' ? `${section.content.replace(/\s/g, '').length} 字` : '等待生成'}</span></div>
            <EditableSection sectionId={section.id} content={section.content} references={writingDocument.references} generating={section.status === 'generating'} onChange={onSectionChange}/>
            {section.status === 'generating' && <span className="mt-1 inline-block h-5 w-0.5 animate-pulse bg-blue-500 align-middle"/>}
          </section>)}
        </div>
        <div className="sticky bottom-4 mt-8 flex justify-center">
          {generating ? <button type="button" onClick={onPause} className="inline-flex h-11 items-center gap-2 rounded-full border border-slate-200 bg-white px-5 text-sm font-medium text-slate-700 shadow-lg hover:bg-slate-50"><Pause size={16}/>暂停生成</button> : paused || incomplete ? <button type="button" onClick={onContinue} className="inline-flex h-11 items-center gap-2 rounded-full bg-blue-600 px-6 text-sm font-medium text-white shadow-lg hover:bg-blue-700"><Play size={16}/>{paused ? '继续生成' : '开始生成正文'}</button> : <span className="inline-flex h-10 items-center gap-2 rounded-full border border-emerald-200 bg-white px-4 text-sm text-emerald-700 shadow-sm"><Check size={16}/>正文生成完成</span>}
        </div>
      </article>
    </div>
    <div id="writing-navigation" className="sticky top-0 h-full"><WritingNavigationPanel outline={outline} open={navigationOpen} onToggle={() => setNavigationOpen((value) => !value)} onNavigate={navigateTo}/></div>
  </div>;
}
