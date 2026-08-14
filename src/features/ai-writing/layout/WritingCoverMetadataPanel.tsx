'use client';
import { Settings2, X } from 'lucide-react';
import type { WritingDocumentState } from '../writingDocumentTypes';

type Metadata = NonNullable<WritingDocumentState['layoutMetadata']>;
const fields: Array<[keyof Metadata, string, string]> = [
  ['school','学校名称','例如：北京大学'],
  ['categoryNumber','分类号','例如：R1'],
  ['schoolCode','学校代码','例如：10001'],
  ['securityLevel','密级','例如：公开'],
  ['thesisNumber','论文编号','例如：2026-001'],
  ['college','学院','例如：公共卫生学院'],
  ['major','专业','例如：公共卫生'],
  ['className','年级班级','例如：2023级1班'],
  ['author','姓名','作者姓名'],
  ['studentId','学号','学生学号'],
  ['advisor','指导教师','教师姓名'],
  ['professionalTitle','职称','例如：教授'],
  ['date','提交日期','例如：2026年8月'],
];
export default function WritingCoverMetadataPanel({ open, metadata, onClose, onChange }: { open:boolean; metadata:Metadata; onClose:()=>void; onChange:(value:Metadata)=>void }) { if(!open)return null; return <aside className="absolute right-5 top-20 z-30 w-80 rounded-2xl border border-slate-200 bg-white p-5 shadow-xl" aria-label="封面信息设置"><div className="mb-4 flex items-center justify-between"><h3 className="flex items-center gap-2 font-medium"><Settings2 size={17}/>封面信息</h3><button onClick={onClose} aria-label="关闭封面信息"><X size={18}/></button></div><div className="space-y-3">{fields.map(([key,label,placeholder])=><label key={key} className="block"><span className="mb-1 block text-xs text-slate-500">{label}</span><input value={metadata[key]} placeholder={placeholder} onChange={(event)=>onChange({...metadata,[key]:event.target.value})} className="h-10 w-full rounded-lg border border-slate-200 px-3 text-sm outline-none focus:border-blue-400"/></label>)}</div></aside>; }
