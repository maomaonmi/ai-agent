'use client';

import { useEffect, useId, useState } from 'react';
import { CheckCircle2, Clock, History, Layers, RotateCcw, X } from 'lucide-react';

import type { VersionSnapshot } from './versionManager';

interface VersionTimelineDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  snapshots: VersionSnapshot[];
  activeVersionId: string;
  onRollback: (snapshot: VersionSnapshot) => void;
}

export function VersionTimelineDrawer({
  isOpen,
  onClose,
  snapshots,
  activeVersionId,
  onRollback,
}: VersionTimelineDrawerProps) {
  const titleId = useId();
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [pendingRollbackId, setPendingRollbackId] = useState<string | null>(null);
  const orderedSnapshots = [...snapshots].reverse();

  useEffect(() => {
    if (!isOpen) {
      setPendingRollbackId(null);
      return;
    }
    setSelectedVersionId((current) => {
      if (current && snapshots.some((snapshot) => snapshot.versionId === current)) return current;
      return activeVersionId || snapshots.at(-1)?.versionId || null;
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeVersionId, isOpen, onClose, snapshots]);

  if (!isOpen) return null;

  const confirmRollback = (snapshot: VersionSnapshot) => {
    onRollback(snapshot);
    setSelectedVersionId(snapshot.versionId);
    setPendingRollbackId(null);
  };

  return (
    <>
      <button
        type="button"
        aria-label="关闭版本时间线"
        onClick={onClose}
        className="fixed inset-0 z-[60] bg-slate-950/45 backdrop-blur-sm lg:hidden"
      />
      <aside
        aria-labelledby={titleId}
        className="fixed inset-y-0 right-0 z-[70] flex w-[min(90vw,22rem)] shrink-0 flex-col overflow-hidden border-l border-slate-800 bg-slate-900 shadow-2xl lg:static lg:z-auto lg:h-full lg:w-80 lg:shadow-none xl:w-96"
      >
        <header className="flex items-start justify-between gap-3 border-b border-slate-800 px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <History aria-hidden="true" className="h-4 w-4 text-emerald-400" />
              <h2 id={titleId} className="text-sm font-semibold text-slate-100">版本时间线</h2>
              <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">
                {snapshots.length}
              </span>
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-500">选择节点查看，再决定是否回溯。</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭版本时间线"
            className="shrink-0 rounded-md p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          {orderedSnapshots.length === 0 ? (
            <div role="status" className="py-14 text-center">
              <History aria-hidden="true" className="mx-auto mb-3 h-8 w-8 text-slate-700" />
              <p className="text-sm font-medium text-slate-400">还没有版本节点</p>
              <p className="mt-1 text-xs leading-5 text-slate-600">生成或修改代码后会自动建立节点。</p>
            </div>
          ) : (
            <ol aria-label="版本快照时间线">
              {orderedSnapshots.map((snapshot) => {
                const isActive = snapshot.versionId === activeVersionId;
                const isSelected = snapshot.versionId === selectedVersionId;
                const isPending = snapshot.versionId === pendingRollbackId;
                return (
                  <li
                    key={snapshot.versionId}
                    aria-current={isActive ? 'step' : undefined}
                    className={`relative ml-2 border-l pb-4 pl-5 last:pb-0 ${
                      isActive ? 'border-emerald-500' : 'border-slate-700'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`absolute -left-2 top-1 h-4 w-4 rounded-full border-2 ${
                        isActive
                          ? 'border-emerald-300 bg-emerald-500 shadow shadow-emerald-500/40'
                          : isSelected
                            ? 'border-blue-300 bg-blue-500'
                            : 'border-slate-600 bg-slate-900'
                      }`}
                    />
                    <article className={`overflow-hidden rounded-lg border transition-colors ${
                      isSelected
                        ? 'border-blue-500/60 bg-slate-800'
                        : 'border-slate-800 bg-slate-950/50 hover:border-slate-700'
                    }`}>
                      <button
                        type="button"
                        aria-expanded={isSelected}
                        onClick={() => {
                          setSelectedVersionId(snapshot.versionId);
                          setPendingRollbackId(null);
                        }}
                        className="w-full px-3 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-400"
                      >
                        <span className="flex items-center justify-between gap-2">
                          <span className="flex items-center gap-2">
                            <span className={`rounded px-2 py-0.5 font-mono text-xs font-bold ${
                              isActive ? 'bg-emerald-500 text-slate-950' : 'bg-slate-700 text-slate-200'
                            }`}>{snapshot.versionId}</span>
                            {isActive && (
                              <span className="flex items-center gap-1 text-[11px] text-emerald-400">
                                <CheckCircle2 aria-hidden="true" className="h-3 w-3" /> 当前
                              </span>
                            )}
                          </span>
                          <time className="flex items-center gap-1 font-mono text-[10px] text-slate-500">
                            <Clock aria-hidden="true" className="h-3 w-3" /> {snapshot.timestamp}
                          </time>
                        </span>
                        <span className="mt-2 block line-clamp-2 text-xs font-medium leading-5 text-slate-300">
                          {snapshot.summary}
                        </span>
                      </button>

                      {isSelected && (
                        <div className="border-t border-slate-700 px-3 py-3">
                          <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400">
                            <span className="flex items-center gap-1">
                              <Layers aria-hidden="true" className="h-3 w-3" /> {snapshot.fileCount} 个文件
                            </span>
                            <span>{isActive ? '当前正在使用' : '历史快照'}</span>
                          </div>
                          {!isActive && !isPending && (
                            <button
                              type="button"
                              onClick={() => setPendingRollbackId(snapshot.versionId)}
                              className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                            >
                              <RotateCcw aria-hidden="true" className="h-3.5 w-3.5" /> 回溯到此版本
                            </button>
                          )}
                          {isPending && (
                            <div role="alert" className="mt-3 rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5">
                              <p className="text-xs leading-5 text-amber-100">确认将项目恢复到 {snapshot.versionId}？</p>
                              <div className="mt-2 flex justify-end gap-2">
                                <button type="button" onClick={() => setPendingRollbackId(null)} className="rounded px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-700">取消</button>
                                <button type="button" onClick={() => confirmRollback(snapshot)} className="rounded bg-emerald-500 px-2.5 py-1 text-xs font-medium text-slate-950 hover:bg-emerald-400">确认回溯</button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </article>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
        <footer className="border-t border-slate-800 px-4 py-2.5 text-[10px] leading-4 text-slate-500">
          回溯不会删除后续节点，可以随时切换回来。
        </footer>
      </aside>
    </>
  );
}
