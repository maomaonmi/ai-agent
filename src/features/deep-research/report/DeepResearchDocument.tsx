'use client';

import { useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { BarChart3, BookOpenCheck, Zap } from 'lucide-react';
import type { ResearchReportDocument } from './researchReportAdapter';

function safeExternalUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch { return undefined; }
}

export default function DeepResearchDocument({ document }: { document: ResearchReportDocument }) {
  const editor = useEditor({
    immediatelyRender: false,
    editable: false,
    extensions: [StarterKit],
    content: document.html,
    editorProps: { attributes: { class: 'research-tiptap-document' } },
  });

  useEffect(() => {
    if (editor && editor.getHTML() !== document.html) editor.commands.setContent(document.html, { emitUpdate: false });
  }, [document.html, editor]);

  return (
    <article data-research-document className="mx-auto max-w-[980px] px-6 pb-20 pt-12 sm:px-10 lg:px-12">
      <header className="mb-8 text-center">
        <div className="mb-5 flex items-center justify-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em]">
          <span className="rounded bg-slate-950 px-3 py-1.5 text-white">Deep Research</span>
          <span className="rounded bg-blue-600 px-3 py-1.5 text-white">深度研报</span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">{document.title}</h1>
        <p className="mt-4 text-sm text-slate-500">生成日期：{new Intl.DateTimeFormat('zh-CN').format(new Date())}</p>
      </header>

      {document.summary.length > 0 && (
        <section aria-labelledby="research-summary-title" className="mb-10 rounded-xl bg-slate-900 px-6 py-6 text-white shadow-sm sm:px-8">
          <h2 id="research-summary-title" className="flex items-center gap-2 text-lg font-semibold"><Zap size={19} className="text-amber-300"/>核心摘要</h2>
          <div className="mt-5 grid gap-5 border-t border-white/10 pt-5 md:grid-cols-3">
            {document.summary.map((item, index) => <div key={`${item.slice(0, 20)}-${index}`}><span className="text-xs font-semibold text-slate-400">要点 {index + 1}</span><p className="mt-2 text-sm leading-6 text-slate-100">{item}</p></div>)}
          </div>
        </section>
      )}

      {document.metrics.length > 0 && (
        <section aria-labelledby="research-metrics-title" className="mb-10 rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 id="research-metrics-title" className="flex items-center gap-2 text-sm font-semibold text-slate-800"><BarChart3 size={17}/>报告中的明确数据</h2>
          <div className="mt-6 space-y-5">
            {document.metrics.map((metric) => <div key={`${metric.label}-${metric.value}`} title={`原文：${metric.sourceText}`}><div className="mb-2 flex items-end justify-between gap-4 text-sm"><span className="line-clamp-1 text-slate-600">{metric.label}</span><strong className="tabular-nums text-slate-950">{metric.value}%</strong></div><div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${metric.percent}%` }}/></div></div>)}
          </div>
          <p className="mt-5 text-xs text-slate-400">仅展示报告原文中明确出现、且数值范围为 0–100% 的指标。</p>
        </section>
      )}

      <EditorContent editor={editor} />

      {document.sources.length > 0 && (
        <section className="mt-12 border-t border-slate-200 pt-8" aria-labelledby="research-sources-title">
          <h2 id="research-sources-title" className="flex items-center gap-2 text-xl font-semibold text-slate-950"><BookOpenCheck size={20}/>参考来源</h2>
          <ol className="mt-5 space-y-3 text-sm text-slate-600">
            {document.sources.map((source, index) => { const href = safeExternalUrl(source.url); return <li key={`${source.url}-${index}`} className="flex gap-3"><span className="text-slate-400">[{index + 1}]</span>{href ? <a href={href} target="_blank" rel="noreferrer noopener" className="min-w-0 underline decoration-slate-200 underline-offset-4 hover:text-blue-700"><span className="block font-medium text-slate-800">{source.title || '未命名来源'}</span><span className="mt-1 block truncate text-xs text-slate-400">{href}</span></a> : <span className="min-w-0"><span className="block font-medium text-slate-800">{source.title || '未命名来源'}</span><span className="mt-1 block text-xs text-slate-400">来源地址不可用</span></span>}</li>; })}
          </ol>
        </section>
      )}
    </article>
  );
}
