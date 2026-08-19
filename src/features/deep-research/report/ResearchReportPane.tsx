'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Copy, Download, FileDown, Maximize2, Minimize2, PanelRightOpen, Printer, X } from 'lucide-react';
import type { ResearchChunk, ResearchFigure, ResearchFigureBatch } from '../../../lib/api';
import DeepResearchDocument from './DeepResearchDocument';
import RawResearchReport from './RawResearchReport';
import { createResearchReportDocument } from './researchReportAdapter';
import { createResearchWordDocument } from '../export/researchWordExport';
import ResearchNavigationPanel from '../navigation/ResearchNavigationPanel';

type ReportView = 'deep' | 'raw';

interface ResearchReportPaneProps {
  title: string;
  report: string;
  sources?: ResearchChunk[];
  loading?: boolean;
  researchFigures?: ResearchFigure[];
  figureBatches?: ResearchFigureBatch[];
  onFigureLoadError?: (figureId: string) => void;
  onFigureRetry?: (figureId: string) => void;
  onClose?: () => void;
}

function saveBlob(content: BlobPart, type: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function ResearchReportPane({ title, report, sources = [], loading = false, researchFigures = [], figureBatches = [], onFigureLoadError, onFigureRetry, onClose }: ResearchReportPaneProps) {
  const [view, setView] = useState<ReportView>('deep');
  const [copied, setCopied] = useState(false);
  const [actionError, setActionError] = useState('');
  const [downloadOpen, setDownloadOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const paneRef = useRef<HTMLElement>(null);
  const reportDocument = useMemo(() => createResearchReportDocument(report, title, sources), [report, sources, title]);
  const safeName = (title || '深度调研报告').replace(/[\\/:*?"<>|]/g, '-').slice(0, 64);

  useEffect(() => {
    const syncFullscreen = () => setFullscreen(document.fullscreenElement === paneRef.current);
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setActionError('');
      window.setTimeout(() => setCopied(false), 1600);
    } catch { setActionError('复制失败，请重试'); }
  };
  const downloadWord = async () => {
    try {
      const blob = await createResearchWordDocument(reportDocument);
      saveBlob(blob, blob.type, `${safeName}.docx`);
      setDownloadOpen(false);
      setActionError('');
    } catch { setActionError('Word 生成失败，请重试'); }
  };
  const downloadText = (format: 'md' | 'txt') => {
    saveBlob(`\ufeff${report}`, 'text/plain;charset=utf-8', `${safeName}.${format}`);
    setDownloadOpen(false);
  };
  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement && paneRef.current) await paneRef.current.requestFullscreen();
      else if (document.fullscreenElement) await document.exitFullscreen();
      setActionError('');
    } catch { setActionError('当前浏览器无法切换全屏'); }
  };
  const navigateTo = (id: string) => {
    const directTarget = paneRef.current?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
    const index = reportDocument.outline.findIndex((item) => item.id === id);
    const renderedHeadings = paneRef.current?.querySelectorAll<HTMLElement>('[data-research-markdown] h1, [data-research-markdown] h2, [data-research-markdown] h3');
    (directTarget ?? (index >= 0 ? renderedHeadings?.[index] : undefined))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <section ref={paneRef} aria-label="调研报告工作区" className="relative flex h-full min-h-0 flex-col bg-white text-slate-950 fullscreen:h-screen fullscreen:w-screen">
      <header className="relative z-20 flex h-16 shrink-0 items-center border-b border-slate-100 bg-white px-4 sm:px-5">
        <h2 className="min-w-0 max-w-[28%] truncate text-sm font-semibold">{reportDocument.title}</h2>
        <div role="tablist" aria-label="报告视图" className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 rounded-lg bg-slate-100 p-1">
          {([['deep', '深度研报'], ['raw', '文本报告']] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={view === id} onClick={() => setView(id)} className={`rounded-md px-3 py-1.5 text-sm transition ${view === id ? 'bg-white font-medium text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>{label}</button>)}
        </div>
        <div className="ml-auto flex items-center gap-0.5">
          <button type="button" onClick={() => setNavigationOpen((value) => !value)} aria-label="搜索结果与目录" aria-expanded={navigationOpen} className={`inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-slate-100 ${navigationOpen ? 'bg-slate-100 text-slate-950' : 'text-slate-600'}`}><PanelRightOpen size={18}/></button>
          <button type="button" onClick={() => void copyReport()} aria-label="复制报告" className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100">{copied ? <Check size={17} className="text-emerald-600"/> : <Copy size={17}/>}</button>
          <div className="relative"><button type="button" onClick={() => setDownloadOpen((value) => !value)} aria-label="下载报告" aria-haspopup="menu" aria-expanded={downloadOpen} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100"><Download size={18}/></button>{downloadOpen && <div role="menu" className="absolute right-0 top-11 w-48 rounded-xl border border-slate-200 bg-white p-1.5 text-sm shadow-xl"><button type="button" role="menuitem" onClick={() => void downloadWord()} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-slate-50"><FileDown size={16}/>格式化 Word</button><button type="button" role="menuitem" onClick={() => downloadText('md')} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-slate-50"><FileDown size={16}/>Markdown</button><button type="button" role="menuitem" onClick={() => downloadText('txt')} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-slate-50"><FileDown size={16}/>原始文本</button><button type="button" role="menuitem" onClick={() => { window.print(); setDownloadOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-slate-50"><Printer size={16}/>打印 / PDF</button></div>}</div>
          <button type="button" onClick={() => void toggleFullscreen()} aria-label={fullscreen ? '退出全屏' : '全屏查看'} className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100">{fullscreen ? <Minimize2 size={17}/> : <Maximize2 size={17}/>}</button>
          {onClose && <button type="button" onClick={onClose} aria-label="关闭报告" className="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-600 hover:bg-slate-100 xl:hidden"><X size={18}/></button>}
        </div>
      </header>
      {actionError && <p role="alert" className="border-b border-rose-100 bg-rose-50 px-5 py-2 text-xs text-rose-700">{actionError}</p>}
      {figureBatches.length > 0 && <div role="status" aria-live="polite" className="flex items-center justify-between border-b border-blue-100 bg-blue-50/70 px-5 py-2 text-xs text-blue-700"><span>配图按章节分批生成</span><span>{figureBatches.filter((batch) => batch.status === 'succeeded' || batch.status === 'failed').length}/{figureBatches.length} 章已处理</span></div>}
      <div className="min-h-0 flex-1 overflow-y-auto bg-white">
        {!report.trim() ? (
          <div role="status" aria-busy={loading} className="flex min-h-full items-center justify-center px-8 text-center">
            <div>
              <div className="mx-auto h-10 w-10 rounded-full border border-slate-200 bg-slate-50 p-2">
                {loading ? <span className="block h-full w-full animate-spin rounded-full border-2 border-slate-200 border-t-blue-600"/> : <FileDown size={20} className="text-slate-400"/>}
              </div>
              <h3 className="mt-4 text-sm font-medium text-slate-800">{loading ? '正在生成调研报告' : '报告将在调研完成后显示'}</h3>
              <p className="mt-2 text-xs leading-5 text-slate-400">左侧对话和调研链路会持续保留。</p>
            </div>
          </div>
        ) : view === 'deep' ? (
          <DeepResearchDocument document={reportDocument} figures={researchFigures} onFigureLoadError={onFigureLoadError} onFigureRetry={onFigureRetry}/>
        ) : (
          <RawResearchReport title={reportDocument.title} report={report}/>
        )}
      </div>
      <ResearchNavigationPanel open={navigationOpen} outline={reportDocument.outline} sources={sources} onClose={() => setNavigationOpen(false)} onNavigate={navigateTo}/>
    </section>
  );
}
