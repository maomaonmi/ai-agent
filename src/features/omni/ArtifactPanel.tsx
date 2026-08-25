'use client';

import { ExternalLink, Maximize2, Minimize2, RotateCw, X } from 'lucide-react';
import { useEffect, useState, type CSSProperties } from 'react';
import { getArtifact, getArtifactVersion } from './api';
import ArtifactRenderer from './ArtifactRenderer';
import { artifactPanelWidthFromPointer, clampArtifactPanelWidth } from './artifactResize';
import type { Artifact, ArtifactPanelState, ArtifactVersion } from './types';

interface ArtifactPanelProps {
  state: Exclude<ArtifactPanelState, { status: 'closed' }>;
  onLoaded: () => void;
  onClose: () => void;
  onDisplayModeChange: (mode: 'split' | 'maximized') => void;
  onOpenVersion: (artifact: Artifact, versionId: Artifact['currentVersionId']) => void;
  onOpenProfessional?: (artifact: Artifact, version: ArtifactVersion) => void;
  panelWidth: number;
  onPanelWidthChange: (width: number) => void;
}

export default function ArtifactPanel({ state, onLoaded, onClose, onDisplayModeChange, onOpenVersion, onOpenProfessional, panelWidth, onPanelWidthChange }: ArtifactPanelProps) {
  const [artifact, setArtifact] = useState<Artifact | null>(null);
  const [version, setVersion] = useState<ArtifactVersion | null>(null);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setArtifact(null); setVersion(null); setError('');
    Promise.all([getArtifact(state.artifactId), getArtifactVersion(state.artifactId, state.versionId)])
      .then(([nextArtifact, nextVersion]) => { if (!cancelled) { setArtifact(nextArtifact); setVersion(nextVersion); onLoaded(); } })
      .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : '作品加载失败'); });
    return () => { cancelled = true; };
  }, [onLoaded, retryKey, state.artifactId, state.versionId]);

  useEffect(() => {
    if (!isResizing) return undefined;
    const handlePointerMove = (event: PointerEvent) => {
      onPanelWidthChange(artifactPanelWidthFromPointer(event.clientX, window.innerWidth));
    };
    const stopResizing = () => setIsResizing(false);
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResizing, { once: true });
    window.addEventListener('pointercancel', stopResizing, { once: true });
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResizing);
      window.removeEventListener('pointercancel', stopResizing);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isResizing, onPanelWidthChange]);

  const handleResizeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    // Moving the divider left makes the right panel wider; moving it right narrows it.
    onPanelWidthChange(clampArtifactPanelWidth(panelWidth + (event.key === 'ArrowLeft' ? 2 : -2)));
  };

  const historical = Boolean(artifact && version && artifact.currentVersionId !== version.id);
  const panelStyle = state.displayMode === 'maximized'
    ? undefined
    : ({ '--artifact-panel-width': `${panelWidth}vw` } as CSSProperties);
  return <aside aria-label="作品预览" style={panelStyle} className={`fixed inset-y-0 right-0 z-[90] flex flex-col border-l border-slate-200 bg-white shadow-[-16px_0_40px_rgba(15,23,42,0.08)] ${state.displayMode === 'maximized' ? 'left-0' : 'w-full md:w-[var(--artifact-panel-width)]'}`}>
    {state.displayMode === 'split' && <div
      role="separator"
      aria-label="调整聊天与作品面板宽度"
      aria-orientation="vertical"
      aria-valuemin={32}
      aria-valuemax={70}
      aria-valuenow={panelWidth}
      tabIndex={0}
      onPointerDown={(event) => { event.preventDefault(); setIsResizing(true); }}
      onKeyDown={handleResizeKeyDown}
      className="group absolute inset-y-0 left-[-6px] z-10 hidden w-3 cursor-col-resize items-center justify-center touch-none outline-none md:flex"
    >
      <span className="h-16 w-1 rounded-full bg-slate-300 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
    </div>}
    <header className="flex min-h-16 items-center gap-3 border-b border-slate-200 px-4">
      <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold text-slate-900">{artifact?.title || '正在打开作品…'}</h2>{version && <p className="mt-0.5 text-xs text-slate-500">版本 {version.versionNumber}{historical ? ' · 这不是最新版本' : ' · 最新版'}</p>}</div>
      {historical && artifact && <button type="button" onClick={() => onOpenVersion(artifact, artifact.currentVersionId)} className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700 hover:bg-amber-100">查看最新版</button>}
      {artifact && version && onOpenProfessional && (artifact.kind === 'document' || artifact.kind === 'thesis' || artifact.kind === 'image' || artifact.kind === 'video' || artifact.kind === 'presentation') && <button type="button" onClick={() => onOpenProfessional(artifact, version)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"><ExternalLink size={14} />{artifact.kind === 'image' ? '生图工作台' : artifact.kind === 'video' ? '视频工作台' : artifact.kind === 'presentation' ? 'PPT 工作台' : '写作工作台'}</button>}
      <button type="button" aria-label={state.displayMode === 'maximized' ? '恢复分栏' : '最大化作品'} onClick={() => onDisplayModeChange(state.displayMode === 'maximized' ? 'split' : 'maximized')} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100">{state.displayMode === 'maximized' ? <Minimize2 size={18} /> : <Maximize2 size={18} />}</button>
      <button type="button" aria-label="关闭作品" onClick={onClose} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"><X size={19} /></button>
    </header>
    <div className="min-h-0 flex-1">{error ? <div role="alert" className="flex h-full flex-col items-center justify-center px-6 text-center"><p className="text-sm text-rose-600">{error}</p><button type="button" onClick={() => setRetryKey((value) => value + 1)} className="mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm"><RotateCw size={15} />重试</button></div> : artifact && version ? <ArtifactRenderer artifact={artifact} version={version} /> : <div role="status" className="flex h-full items-center justify-center text-sm text-slate-400">正在加载作品…</div>}</div>
  </aside>;
}
