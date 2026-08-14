import { FileText } from 'lucide-react';
import type { LayoutTemplate } from './layoutTemplates';

type Props = { template: LayoutTemplate };

/** The picker preview intentionally mirrors the hierarchy of the rendered A4 cover. */
export default function TemplateCoverThumbnail({ template }: Props) {
  const isDegree = template.id === 'degree-thesis';
  const isModern = template.id === 'modern-report';
  const isAcademic = template.id === 'apa-paper' || template.id === 'ieee-paper';

  return (
    <div className={`relative h-full overflow-hidden rounded-lg border p-4 shadow-sm ${isModern ? 'border-indigo-300/40 bg-slate-950 text-white' : 'border-slate-200 bg-white'}`}>
      {isModern && <div className="absolute -right-8 -top-8 h-28 w-28 rounded-full bg-indigo-500/40 blur-2xl" />}
      {!isModern && <div className="absolute inset-x-0 top-0 h-1.5" style={{ backgroundColor: template.accent }} />}
      <div className="relative flex items-center justify-between text-[8px] tracking-[0.16em]">
        <span className={isModern ? 'text-indigo-200' : 'text-slate-500'}>{isModern ? 'MODERN RESEARCH' : template.name.toUpperCase()}</span>
        <FileText size={11} className={isModern ? 'text-indigo-300' : 'text-slate-300'} />
      </div>
      {isDegree && <div className="relative mx-auto mt-5 flex h-8 w-8 items-center justify-center rounded-full border text-[8px] font-medium" style={{ borderColor: template.accent, color: template.accent }}>校徽</div>}
      <div className={`relative mx-auto max-w-[92%] ${isAcademic ? 'mt-5 text-left' : 'mt-7 text-center'}`}>
        {isDegree && <p className="text-[8px] text-slate-500">学校名称</p>}
        {isDegree && <p className="mt-1 text-[10px] font-semibold text-slate-700">本科 / 硕士毕业论文</p>}
        <p className={`mt-3 font-serif text-sm font-semibold leading-5 ${isModern ? 'text-white' : 'text-slate-800'}`}>{isDegree ? '论文题目' : template.name}</p>
        <p className={`mt-1 text-[9px] leading-4 ${isModern ? 'text-slate-300' : 'text-slate-400'}`}>{template.subtitle}</p>
      </div>
      <div className="relative mx-auto mt-6 max-w-[82%] space-y-1.5">
        <span className={`block h-1 rounded ${isModern ? 'bg-white/15' : 'bg-slate-100'}`} />
        <span className={`block h-1 w-5/6 rounded ${isModern ? 'bg-white/15' : 'bg-slate-100'}`} />
        <span className={`block h-1 w-4/6 rounded ${isModern ? 'bg-white/15' : 'bg-slate-100'}`} />
      </div>
      <div className={`relative mx-auto mt-5 max-w-[82%] space-y-1 text-[8px] ${isModern ? 'text-slate-300' : 'text-slate-500'}`}>
        <p>专业：__________</p><p>姓名：__________</p><p>指导教师：______</p>
      </div>
    </div>
  );
}
