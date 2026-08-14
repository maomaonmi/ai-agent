'use client';

import { useState } from 'react';
import { FileText } from 'lucide-react';
import type { ResearchChunk } from '../../lib/api';
import ResearchReportPane from './report/ResearchReportPane';

interface ResearchWorkspaceProps {
  title: string;
  report: string;
  sources?: ResearchChunk[];
  loading?: boolean;
  sidebarCollapsed: boolean;
}

export default function ResearchWorkspace({ title, report, sources, loading, sidebarCollapsed }: ResearchWorkspaceProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const desktopWidth = sidebarCollapsed ? 'calc((100vw - 3.5rem) * 0.52)' : 'calc((100vw - 18rem) * 0.52)';
  return <div data-research-workspace>
    <aside className="fixed bottom-0 right-0 top-0 z-40 hidden min-w-[560px] border-l border-slate-200 bg-white xl:block" style={{ width: desktopWidth }}><ResearchReportPane title={title} report={report} sources={sources} loading={loading}/></aside>
    <button type="button" onClick={() => setMobileOpen(true)} className="fixed bottom-28 right-4 z-50 inline-flex h-11 items-center gap-2 rounded-full bg-slate-950 px-4 text-sm font-medium text-white shadow-xl xl:hidden" aria-label="打开调研报告"><FileText size={17}/>报告</button>
    {mobileOpen && <div className="fixed inset-0 z-[120] bg-white xl:hidden"><ResearchReportPane title={title} report={report} sources={sources} loading={loading} onClose={() => setMobileOpen(false)}/></div>}
  </div>;
}

