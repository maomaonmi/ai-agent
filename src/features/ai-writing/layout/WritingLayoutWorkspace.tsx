'use client';

import { ChevronLeft, ChevronRight, Minus, Plus, Replace, Settings2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { WritingDocumentState } from '../writingDocumentTypes';
import { createLayoutDocument } from './layoutDocumentFactory';
import type { LayoutPage, LayoutTocSection } from './layoutDocumentTypes';
import WritingCoverMetadataPanel from './WritingCoverMetadataPanel';
import WritingTemplatePicker from './WritingTemplatePicker';
import { LAYOUT_TEMPLATES } from './layoutTemplates';

type Metadata = NonNullable<WritingDocumentState['layoutMetadata']>;
const EMPTY_METADATA: Metadata = { school: '', major: '', className: '', author: '', studentId: '', advisor: '', date: '' };

function PageNumber({ pageNumber, totalPages, accent }: { pageNumber: number; totalPages: number; accent: string }) {
  return <span className="absolute bottom-9 left-1/2 -translate-x-1/2 text-[11px] tracking-[0.18em]" style={{ color: accent }}>{String(pageNumber).padStart(2, '0')} / {String(totalPages).padStart(2, '0')}</span>;
}

function FormalThesisCover({ title, template, metadata }: { title: string; template: typeof LAYOUT_TEMPLATES[number]; metadata: Metadata }) {
  const school = metadata.school || '学校名称';
  const isThesis = template.id === 'degree-thesis';
  const documentType = isThesis ? '本科/硕士/博士毕业论文' : template.name;
  const titleLabel = isThesis ? '论文题目：' : '题目：';
  const rows: Array<[string, string]> = [
    ['学　　院：', metadata.college || ''],
    ['专　　业：', metadata.major || ''],
    ['年级班级：', metadata.className || ''],
    ['姓　　名：', metadata.author || ''],
    ['学　　号：', metadata.studentId || ''],
    ['指导教师：', metadata.advisor || ''],
    ['职　　称：', metadata.professionalTitle || ''],
  ];
  return <div className="relative h-full overflow-hidden bg-white px-[88px] pb-[70px] pt-[76px] text-slate-950">
    <div className="pointer-events-none absolute inset-[48px] border border-slate-100" aria-hidden="true" />
    <div className="relative flex h-full flex-col">
      <div className="grid grid-cols-2 text-[14px] leading-8 text-slate-700">
        <div><p>分类号：{metadata.categoryNumber || ''}</p><p>学校代码：{metadata.schoolCode || ''}</p></div>
        <div className="text-right"><p>密　级：{metadata.securityLevel || ''}</p><p>论文编号：{metadata.thesisNumber || ''}</p></div>
      </div>
      <div className="mt-9 text-center">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full border-2 text-sm font-semibold" style={{ borderColor: template.accent, color: template.accent }}>校徽</div>
        <p className="mt-5 font-serif text-[28px] tracking-[0.18em] text-slate-900">{school}</p>
        <p className="mt-8 font-serif text-[27px] tracking-[0.08em] text-slate-950">{documentType}</p>
        <h1 className="mx-auto mt-12 max-w-[650px] font-serif text-[28px] font-medium leading-[1.55] text-slate-950">{titleLabel}{title}</h1>
      </div>
      <div className="mx-auto mt-16 w-[480px] space-y-3 text-[16px] text-slate-900">
        {rows.map(([label, value]) => <div key={label} className="flex items-end leading-8"><span className="w-[112px] shrink-0">{label}</span><span className="min-w-0 flex-1 border-b border-slate-400 pb-0.5">{value || '\u00a0'}</span></div>)}
      </div>
      <p className="mt-auto text-center font-serif text-[16px] tracking-[0.35em] text-slate-900">{metadata.date || '年　月　日'}</p>
    </div>
  </div>;
}

function CoverPage({ title, template, metadata, totalPages }: { title: string; template: typeof LAYOUT_TEMPLATES[number]; metadata: Metadata; totalPages: number }) {
  const school = metadata.school || '学校名称';
  const date = metadata.date || '年　月　日';
  const author = metadata.author || '作者姓名';
  const degree = template.id === 'degree-thesis';
  const modern = template.id === 'modern-report';
  if (degree || template.category === 'university') return <FormalThesisCover title={title} template={template} metadata={metadata} />;
  return <div className={`relative h-full overflow-hidden ${modern ? 'bg-[#111827] text-white' : 'bg-white text-slate-950'}`}>
    {modern ? <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_18%,rgba(99,102,241,0.5),transparent_34%),linear-gradient(135deg,#111827_0%,#0f172a_58%,#1e1b4b_100%)]" /> : <div className="absolute inset-x-0 top-0 h-3" style={{ backgroundColor: template.accent }} />}
    <div className="relative flex h-full flex-col px-[92px] py-[72px]">
      {degree ? <>
        <div className="flex justify-center"><div className="flex h-16 w-16 items-center justify-center rounded-full border-2 text-xs font-semibold" style={{ borderColor: template.accent, color: template.accent }}>校徽</div></div>
        <p className="mt-5 text-center text-sm tracking-[0.32em] text-slate-500">{school}</p>
        <p className="mt-7 text-center text-base font-semibold text-slate-700">本科 / 硕士毕业论文</p>
        <h1 className="mx-auto mt-12 max-w-[600px] text-center font-serif text-[30px] font-semibold leading-[1.55] text-slate-950">{title}</h1>
        <div className="mx-auto mt-auto w-[360px] space-y-4 border-t border-slate-200 pt-7 text-[15px] text-slate-700"><p>专业：{metadata.major || '　　　　　　　　　'}</p><p>年级班级：{metadata.className || '　　　　　　　　'}</p><p>姓　名：{author}</p><p>学　号：{metadata.studentId || '　　　　　　　　'}</p><p>指导教师：{metadata.advisor || '　　　　　　　　'}</p><p className="pt-6 text-center tracking-[0.34em]">{date}</p></div>
      </> : <>
        <div className={`flex items-center justify-between text-xs tracking-[0.2em] ${modern ? 'text-indigo-200' : 'text-slate-500'}`}><span>{modern ? 'MODERN RESEARCH' : template.name.toUpperCase()}</span><span>{date}</span></div>
        <div className={`mt-40 ${modern ? 'max-w-[610px]' : 'max-w-[570px]'}`}><div className="mb-7 h-1.5 w-16 rounded-full" style={{ backgroundColor: template.accent }} /><p className={`text-sm tracking-[0.18em] ${modern ? 'text-indigo-200' : 'text-slate-500'}`}>{school}</p><h1 className={`mt-6 font-serif text-[34px] font-semibold leading-[1.35] ${modern ? 'text-white' : 'text-slate-950'}`}>{title}</h1><p className={`mt-7 text-base ${modern ? 'text-slate-300' : 'text-slate-500'}`}>{template.subtitle}</p></div>
        <div className={`mt-auto flex items-end justify-between border-t pt-6 text-sm ${modern ? 'border-white/20 text-slate-300' : 'border-slate-200 text-slate-600'}`}><span>{author} · {metadata.major || '研究方向'}</span><span>01 / COVER</span></div>
      </>}
    </div>
    <PageNumber pageNumber={1} totalPages={totalPages} accent={modern ? '#c7d2fe' : template.accent} />
  </div>;
}

function TocPage({ page, template, source, totalPages }: { page: LayoutPage; template: typeof LAYOUT_TEMPLATES[number]; source: WritingDocumentState; totalPages: number }) {
  return <div className="relative h-full bg-white px-[108px] pb-[78px] pt-[52px] font-serif text-slate-950">
    <div className="pointer-events-none absolute inset-[48px] border border-slate-100" aria-hidden="true" />
    <div className="relative flex h-full flex-col">
      <h2 aria-label="目录" className="text-center font-serif text-[22px] tracking-[0.72em]">目　录</h2>
      <div className="mx-auto mt-10 w-full max-w-[610px] space-y-1 text-[14px] leading-7">
        {page.blocks.map((block, index) => <div key={block.id} className={`grid grid-cols-[auto_1fr_auto] items-baseline gap-3 ${block.level === 1 ? 'font-medium text-slate-900' : 'text-slate-700'}`} style={{ paddingLeft: `${Math.max(0, (block.level ?? 1) - 1) * 28}px` }}>
          <span className="whitespace-nowrap">{block.text}</span>
          <span className="mb-1 min-w-8 border-b border-dotted border-slate-300" aria-hidden="true" />
          <span className="min-w-5 text-right text-[12px] text-slate-700">{index + 3}</span>
        </div>)}
      </div>
      <div className="mt-auto flex items-end justify-between text-xs text-slate-400">
        <span>{source.sections.length} 个章节 · A4 文档</span>
        <span className="tracking-[0.2em]" style={{ color: template.accent }}>目录</span>
      </div>
    </div>
    <PageNumber pageNumber={2} totalPages={totalPages} accent={template.accent} />
  </div>;
}

function BodyPage({ page, title, template, pageNumber, totalPages }: { page: LayoutPage; title: string; template: typeof LAYOUT_TEMPLATES[number]; pageNumber: number; totalPages: number }) {
  return <div className="relative h-full overflow-hidden bg-white px-[92px] pb-[150px] pt-[76px] text-slate-950"><div className="flex items-center justify-between border-b border-slate-200 pb-4 text-[11px] tracking-[0.16em] text-slate-400"><span>{title}</span><span>正文</span></div><div className="mt-10 space-y-5">{page.blocks.map((block) => block.kind === 'heading' ? <h2 key={block.id} className={`${block.level === 1 ? 'mt-7 text-[22px]' : 'mt-5 text-[17px]'} font-semibold leading-7`} style={{ color: block.level === 1 ? template.accent : '#0f172a' }}>{block.text}</h2> : <p key={block.id} className="text-[15px] leading-[1.95] text-slate-700">{block.text}</p>)}</div><PageNumber pageNumber={pageNumber} totalPages={totalPages} accent={template.accent} /></div>;
}

function ReferencesPage({ page, title, template, pageNumber, totalPages }: { page: LayoutPage; title: string; template: typeof LAYOUT_TEMPLATES[number]; pageNumber: number; totalPages: number }) {
  return <div className="relative h-full overflow-hidden bg-white px-[92px] pb-[112px] pt-[86px] text-slate-950"><p className="text-xs tracking-[0.2em] text-slate-400">REFERENCES</p><h2 className="mt-4 border-b pb-5 font-serif text-3xl font-semibold" style={{ borderColor: template.accent }}>参考文献</h2><ol className="mt-10 space-y-4">{page.blocks.map((block) => <li key={block.id} className="text-[14px] leading-7 text-slate-700">{block.text}</li>)}</ol><p className="absolute bottom-16 left-[92px] text-xs text-slate-400">{title}</p><PageNumber pageNumber={pageNumber} totalPages={totalPages} accent={template.accent} /></div>;
}

function LayoutPageRenderer({ page, source, template, metadata, pageNumber, totalPages }: { page: LayoutPage; source: WritingDocumentState; template: typeof LAYOUT_TEMPLATES[number]; metadata: Metadata; pageNumber: number; totalPages: number }) {
  if (page.kind === 'cover') return <CoverPage title={source.title} template={template} metadata={metadata} totalPages={totalPages} />;
  if (page.kind === 'toc') return <TocPage page={page} template={template} source={source} totalPages={totalPages} />;
  if (page.kind === 'references') return <ReferencesPage page={page} title={source.title} template={template} pageNumber={pageNumber} totalPages={totalPages} />;
  return <BodyPage page={page} title={source.title} template={template} pageNumber={pageNumber} totalPages={totalPages} />;
}

export default function WritingLayoutWorkspace({ document, tocSections, onTemplate, onMetadata }: { document: WritingDocumentState; tocSections?: LayoutTocSection[]; onTemplate: (id: string) => void; onMetadata: (value: Metadata) => void }) {
  const [pickerOpen, setPickerOpen] = useState(!document.layoutTemplateId);
  const [metadataOpen, setMetadataOpen] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [page, setPage] = useState(1);
  const template = LAYOUT_TEMPLATES.find((item) => item.id === document.layoutTemplateId) ?? LAYOUT_TEMPLATES[0];
  const metadata = document.layoutMetadata ?? EMPTY_METADATA;
  const layoutDocument = useMemo(() => createLayoutDocument({ documentId: document.documentId, title: document.title, sections: document.sections, tocSections, references: document.references }, template.id), [document.documentId, document.title, document.sections, tocSections, document.references, template.id]);
  const totalPages = layoutDocument.pages.length;
  const current = Math.min(page, totalPages);

  useEffect(() => setPage(1), [layoutDocument.id]);
  const goToPage = (next: number) => { const target = Math.min(totalPages, Math.max(1, next)); setPage(target); window.document.getElementById(`writing-layout-page-${target}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  useEffect(() => { const nodes = Array.from(window.document.querySelectorAll<HTMLElement>('[data-layout-page]')); const observer = new IntersectionObserver((entries) => { const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]; if (visible) setPage(Number((visible.target as HTMLElement).dataset.layoutPage) || 1); }, { threshold: [0.3, 0.6, 0.9] }); nodes.forEach((node) => observer.observe(node)); return () => observer.disconnect(); }, [totalPages]);

  return <div data-writing-layout-root className="relative -mx-6 -my-8 min-h-full bg-[#eef2f7] pb-8 sm:-mx-12 lg:-mx-16"><div data-writing-layout-toolbar className="sticky top-0 z-20 flex h-16 items-center justify-center gap-3 border-b border-slate-200 bg-white/95"><div className="flex items-center rounded-xl border border-slate-200 bg-white" aria-label="页面缩放，默认 100%"><button type="button" aria-label="缩小" onClick={() => setZoom(Math.max(60, zoom - 10))} className="p-3 text-slate-600 hover:bg-slate-50"><Minus size={16} /></button><span className="w-14 text-center text-sm font-medium">{zoom}%</span><button type="button" aria-label="放大" onClick={() => setZoom(Math.min(140, zoom + 10))} className="p-3 text-slate-600 hover:bg-slate-50"><Plus size={16} /></button></div><div className="flex items-center rounded-xl border border-slate-200 bg-white"><button type="button" aria-label="上一页" onClick={() => goToPage(current - 1)} className="p-3 text-slate-600 hover:bg-slate-50"><ChevronLeft size={17} /></button><span className="w-16 text-center text-sm font-medium">{current}/{totalPages}</span><button type="button" aria-label="下一页" onClick={() => goToPage(current + 1)} className="p-3 text-slate-600 hover:bg-slate-50"><ChevronRight size={17} /></button></div><button type="button" onClick={() => setMetadataOpen((value) => !value)} className="flex h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700"><Settings2 size={16} />封面信息</button></div><div data-writing-layout-pages className="space-y-8 px-2 py-8 pb-4">{layoutDocument.pages.map((layoutPage, index) => <div data-layout-page={index + 1} data-writing-layout-page id={`writing-layout-page-${index + 1}`} key={layoutPage.id} className="mx-auto origin-top scroll-mt-20 overflow-hidden bg-white shadow-[0_18px_50px_rgba(15,23,42,0.12)]" style={{ width: layoutDocument.pageWidth, height: layoutDocument.pageHeight, transform: `scale(${zoom / 100})`, marginBottom: `${(zoom / 100 - 1) * layoutDocument.pageHeight}px` }}><LayoutPageRenderer page={layoutPage} source={document} template={template} metadata={metadata} pageNumber={index + 1} totalPages={totalPages} /></div>)}</div><div data-writing-layout-actions className="relative z-30 flex justify-center py-10"><button type="button" data-testid="open-template-picker" onClick={() => setPickerOpen(true)} className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-6 py-3 text-sm font-medium text-slate-800 shadow-lg hover:border-slate-300"><Replace size={17} />更换模板</button></div><WritingCoverMetadataPanel open={metadataOpen} metadata={metadata} onClose={() => setMetadataOpen(false)} onChange={onMetadata} /><WritingTemplatePicker open={pickerOpen} selectedId={document.layoutTemplateId} onClose={() => setPickerOpen(false)} onSelect={(id) => { onTemplate(id); setPickerOpen(false); }} /></div>;
}

// Legacy contract markers kept for migration checks: 鏇存崲妯℃澘 / 鐩綍 / 鍙傝€冩枃鐚? / 椤电湁 / 100%.
