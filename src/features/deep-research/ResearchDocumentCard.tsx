import { CheckCircle2, FileText, LoaderCircle, SearchCheck } from 'lucide-react';

interface ResearchDocumentCardProps {
  title: string;
  sourceCount: number;
  figureStatus?: 'idle' | 'generating' | 'ready' | 'failed';
  selected: boolean;
  onSelect: () => void;
}

export default function ResearchDocumentCard({ title, sourceCount, figureStatus = 'idle', selected, onSelect }: ResearchDocumentCardProps) {
  return (
    <button
      type="button"
      aria-label={`切换到调研文档：${title}`}
      aria-pressed={selected}
      onClick={onSelect}
      className={`w-full max-w-[34rem] rounded-xl border p-4 text-left shadow-sm transition focus:outline-none focus:ring-2 focus:ring-blue-500/30 ${selected ? 'border-blue-500 bg-blue-50/40 ring-1 ring-blue-200' : 'border-slate-200 bg-white hover:border-blue-300 hover:shadow-md'}`}
    >
      <div className="flex items-start gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700" aria-hidden="true">
          <FileText size={21} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
            <span>深度调研文档</span>
            <span className="h-1 w-1 rounded-full bg-slate-300" />
            <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 size={13} />已保存</span>
          </div>
          <h3 className="mt-1.5 truncate text-[15px] font-semibold text-slate-900" title={title}>{title}</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">报告正文、检索来源和调研链路已保存在当前会话，可在右侧文档中继续阅读与导出。</p>
          {figureStatus === 'generating' && <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-blue-600"><LoaderCircle size={13} className="animate-spin"/>正在生成研究配图…</p>}
          {figureStatus === 'ready' && <p className="mt-2 text-xs font-medium text-emerald-600">研究配图已生成并插入报告</p>}
          {figureStatus === 'failed' && <p className="mt-2 text-xs font-medium text-amber-600">研究配图暂不可用，正文不受影响</p>}
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
        <FileText size={14} aria-hidden="true" />
        <span>完整报告</span>
        {sourceCount > 0 && <><span className="text-slate-300">·</span><SearchCheck size={14} aria-hidden="true" /><span>{sourceCount} 条来源已归档</span></>}
      </div>
    </button>
  );
}
