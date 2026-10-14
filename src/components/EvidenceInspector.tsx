import { useEffect, useRef, useState } from 'react';
import { Eye, FileText, LoaderCircle } from 'lucide-react';
import {
  CodeObservatoryApiError,
  getCodeObservatoryEvidencePreview,
  type CodeObservatoryEvidencePreview,
  type CodeObservatoryEvidenceView,
} from '../lib/codeObservatoryApi';
import {
  evidenceGapLabel,
  evidencePreviewErrorLabel,
  evidenceStatusLabel,
  evidenceStorageLabel,
} from '../Code/evidenceView';

type PreviewState =
  | { evidenceRef: string; state: 'loading' }
  | { evidenceRef: string; state: 'ready'; preview: CodeObservatoryEvidencePreview }
  | { evidenceRef: string; state: 'error'; message: string }
  | null;

function statusTone(status: CodeObservatoryEvidenceView['status']): string {
  if (status === 'available') return 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/30 dark:bg-emerald-400/10 dark:text-emerald-200';
  if (status === 'stale' || status === 'retention_missing') return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200';
  if (status === 'untrusted' || status === 'unavailable' || status === 'missing') return 'border-red-200 bg-red-50 text-red-700 dark:border-red-400/30 dark:bg-red-400/10 dark:text-red-200';
  return 'border-slate-200 bg-slate-100 text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300';
}

export function EvidenceInspector({
  runId,
  evidence,
}: {
  runId: string;
  evidence: CodeObservatoryEvidenceView[];
}) {
  const [expandedRef, setExpandedRef] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<PreviewState>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const togglePreview = async (item: CodeObservatoryEvidenceView) => {
    if (expandedRef === item.evidence_ref) {
      setExpandedRef(null);
      controllerRef.current?.abort();
      return;
    }
    setExpandedRef(item.evidence_ref);
    if (previewState?.evidenceRef === item.evidence_ref && previewState.state !== 'loading') return;

    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setPreviewState({ evidenceRef: item.evidence_ref, state: 'loading' });
    try {
      const preview = await getCodeObservatoryEvidencePreview(
        runId,
        item.evidence_ref,
        controller.signal,
      );
      if (!controller.signal.aborted) {
        setPreviewState({ evidenceRef: item.evidence_ref, state: 'ready', preview });
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      const code = error instanceof CodeObservatoryApiError ? error.code : 'REQUEST_FAILED';
      setPreviewState({
        evidenceRef: item.evidence_ref,
        state: 'error',
        message: evidencePreviewErrorLabel(code),
      });
    }
  };

  if (evidence.length === 0) {
    return (
      <div className="flex h-full min-h-36 items-center justify-center px-5 text-center text-xs text-slate-400">
        后端尚未记录证据引用；这里不会从报告文字推断证据。
      </div>
    );
  }

  return (
    <ol className="divide-y divide-slate-100 dark:divide-slate-800">
      {evidence.map((item, index) => {
        const expanded = expandedRef === item.evidence_ref;
        const preview = previewState?.evidenceRef === item.evidence_ref ? previewState : null;
        const previewPanelId = `code-observatory-evidence-preview-${index}`;
        return (
          <li key={`${item.evidence_ref}:${item.source_ref?.event_key ?? item.source_ref?.stream_sequence ?? index}`} className="px-3 py-3">
            <div className="flex min-w-0 items-start gap-2">
              <FileText size={14} className="mt-0.5 shrink-0 text-cyan-600 dark:text-cyan-300" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={`rounded-full border px-2 py-0.5 text-[9px] ${statusTone(item.status)}`}>
                    {evidenceStatusLabel(item.status)}
                  </span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400">{evidenceStorageLabel(item.storage_kind)}</span>
                </div>
                <div className="mt-1 break-all font-mono text-[10px] font-medium text-slate-700 dark:text-slate-200">
                  {item.artifact_id ?? item.evidence_ref}
                </div>
                <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[9px] text-slate-400">
                  <span>类型 · {item.evidence_kind}</span>
                  {item.relative_path ? <span>路径 · {item.relative_path}</span> : null}
                  {item.producer ? <span>产生者 · {item.producer}</span> : null}
                  {item.artifact_version ? <span>证据版本 · {item.artifact_version}</span> : null}
                  {item.versions.candidate_revision ? <span>候选版本 · {item.versions.candidate_revision}</span> : null}
                  {item.versions.verification_epoch != null ? <span>Epoch · {item.versions.verification_epoch}</span> : null}
                </div>
                {item.source_ref ? (
                  <div className="mt-1 break-all font-mono text-[9px] text-slate-400">
                    来源 · {item.source_ref.stream_key ?? '未记录'} / {item.source_ref.event_key ?? item.source_ref.stream_sequence ?? '未记录'}
                  </div>
                ) : null}
                {item.source_gaps.length > 0 ? (
                  <ul className="mt-2 space-y-0.5 text-[9px] text-amber-700 dark:text-amber-300">
                    {item.source_gaps.map((gap) => <li key={gap}>缺口 · {evidenceGapLabel(gap)}</li>)}
                  </ul>
                ) : null}
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    disabled={!item.preview_available}
                    aria-expanded={expanded}
                    aria-controls={previewPanelId}
                    onClick={() => void togglePreview(item)}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-[9px] font-medium text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    {preview?.state === 'loading'
                      ? <LoaderCircle size={11} className="animate-spin" aria-hidden="true" />
                      : <Eye size={11} aria-hidden="true" />}
                    {expanded ? '收起预览' : '安全预览'}
                  </button>
                  <span className="text-[9px] text-slate-400">
                    {item.retention_status === 'retained' ? '来源在 Runtime 回执中' : '证据正文未绑定为持久 Artifact'}
                  </span>
                </div>
                {expanded ? (
                  <div id={previewPanelId} className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2 dark:border-slate-700 dark:bg-slate-950">
                    {preview?.state === 'loading' ? (
                      <div className="text-[10px] text-slate-400">正在读取已记录的来源回执…</div>
                    ) : preview?.state === 'error' ? (
                      <div role="status" className="text-[10px] text-amber-700 dark:text-amber-300">{preview.message}</div>
                    ) : preview?.state === 'ready' ? (
                      <>
                        <div className="mb-1 flex flex-wrap gap-x-3 text-[9px] text-slate-400">
                          <span>{preview.preview.media_type}</span>
                          {preview.preview.hash_scope ? <span>Hash · {preview.preview.hash_scope}</span> : null}
                          {preview.preview.truncated ? <span>预览已截断</span> : null}
                        </div>
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-5 text-slate-700 dark:text-slate-200">
                          {preview.preview.content}
                        </pre>
                      </>
                    ) : (
                      <div className="text-[10px] text-slate-400">没有加载的预览。</div>
                    )}
                  </div>
                ) : null}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
