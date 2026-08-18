import { CheckCircle2, FileText, SearchCheck } from 'lucide-react';

interface ResearchDocumentCardProps {
  title: string;
  sourceCount: number;
}

export default function ResearchDocumentCard({ title, sourceCount }: ResearchDocumentCardProps) {
  return (
    <article aria-label={`已生成调研文档：${title}`} className="w-full max-w-[34rem] rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
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
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3 text-xs text-slate-500">
        <FileText size={14} aria-hidden="true" />
        <span>完整报告</span>
        {sourceCount > 0 && <><span className="text-slate-300">·</span><SearchCheck size={14} aria-hidden="true" /><span>{sourceCount} 条来源已归档</span></>}
      </div>
    </article>
  );
}
