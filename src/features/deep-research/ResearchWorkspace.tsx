'use client';

import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';
import type { ResearchChunk } from '../../lib/api';
import ResearchReportPane from './report/ResearchReportPane';

interface ResearchWorkspaceProps {
  title: string;
  report: string;
  sources?: ResearchChunk[];
  loading?: boolean;
  sidebarCollapsed: boolean;
  sessionId?: string;
  onWidthChange?: (width: number) => void;
}

const PREFERENCES_KEY = 'research-workspace-preferences-v2';
const MIN_WIDTH = 560;

function readWidth(sessionId?: string): number | undefined {
  try {
    const preferences = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || '{}') as Record<string, { width?: number }>;
    const value = preferences[sessionId || 'draft']?.width;
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  } catch { return undefined; }
}

export default function ResearchWorkspace({ title, report, sources, loading, sidebarCollapsed, sessionId, onWidthChange }: ResearchWorkspaceProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [desktopWidth, setDesktopWidth] = useState<number>();
  useEffect(() => {
    const available = window.innerWidth - (sidebarCollapsed ? 56 : 288);
    const restored = readWidth(sessionId);
    const width = Math.min(Math.max(restored ?? available * 0.52, MIN_WIDTH), Math.max(MIN_WIDTH, available * 0.72));
    setDesktopWidth(width);
    onWidthChange?.(width);
  }, [onWidthChange, sessionId, sidebarCollapsed]);
  const resize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    let pendingWidth = desktopWidth;
    const update = (clientX: number) => {
      const available = window.innerWidth - (sidebarCollapsed ? 56 : 288);
      const width = Math.min(Math.max(window.innerWidth - clientX, MIN_WIDTH), Math.max(MIN_WIDTH, available * 0.72));
      setDesktopWidth(width);
      pendingWidth = width;
      onWidthChange?.(width);
    };
    const handleMove = (moveEvent: PointerEvent) => update(moveEvent.clientX);
    const handleUp = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      try {
        const preferences = JSON.parse(localStorage.getItem(PREFERENCES_KEY) || '{}') as Record<string, { width?: number }>;
        preferences[sessionId || 'draft'] = { ...preferences[sessionId || 'draft'], width: pendingWidth };
        localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
      } catch { /* Preferences are optional when storage is unavailable. */ }
    };
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp, { once: true });
  };
  return <div data-research-workspace>
    <aside className="fixed bottom-0 right-0 top-0 z-40 hidden min-w-[560px] border-l border-slate-200 bg-white xl:block" style={{ width: desktopWidth }}><div role="separator" aria-label="调整调研报告宽度" aria-orientation="vertical" onPointerDown={resize} className="group absolute inset-y-0 left-0 z-50 w-2 -translate-x-1/2 cursor-col-resize touch-none"><span className="absolute inset-y-0 left-1/2 w-px bg-transparent transition group-hover:bg-blue-400"/></div><ResearchReportPane title={title} report={report} sources={sources} loading={loading}/></aside>
    <button type="button" onClick={() => setMobileOpen(true)} className="fixed bottom-28 right-4 z-50 inline-flex h-11 items-center gap-2 rounded-full bg-slate-950 px-4 text-sm font-medium text-white shadow-xl xl:hidden" aria-label="打开调研报告"><FileText size={17}/>报告</button>
    {mobileOpen && <div className="fixed inset-0 z-[120] bg-white xl:hidden"><ResearchReportPane title={title} report={report} sources={sources} loading={loading} onClose={() => setMobileOpen(false)}/></div>}
  </div>;
}
