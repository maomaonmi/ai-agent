'use client';

import { BarChart3, Image as ImageIcon, LineChart, PieChart, RefreshCw } from 'lucide-react';
import MarkdownMessage from '../../components/MarkdownMessage';
import type { PlanFigure } from '../../lib/api';
import type { PlanReportChart, PlanReportDocument } from './planReportAdapter';

function Chart({ chart }: { chart: PlanReportChart }) {
  const max = Math.max(...chart.values, 1);
  const colors = ['#2563eb', '#7c3aed', '#0891b2', '#059669', '#ea580c', '#db2777'];
  if (chart.kind === 'progress') {
    return <div data-plan-chart={chart.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-800"><BarChart3 size={16} />{chart.title}</div>
      <div className="space-y-3">{chart.values.map((value, index) => <div key={`${chart.labels[index]}-${index}`}><div className="mb-1 flex justify-between gap-3 text-xs text-slate-600"><span className="truncate">{chart.labels[index]}</span><strong className="text-slate-900">{value}{chart.unit || ''}</strong></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-500" style={{ width: `${Math.max(4, (value / max) * 100)}%` }} /></div></div>)}</div>
    </div>;
  }
  if (chart.kind === 'line') {
    const points = chart.values.map((value, index) => {
      const x = chart.values.length === 1 ? 160 : (index / (chart.values.length - 1)) * 300 + 10;
      const y = 112 - (value / max) * 92;
      return `${x},${y}`;
    }).join(' ');
    return <div data-plan-chart={chart.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800"><LineChart size={16} />{chart.title}</div>
      <svg viewBox="0 0 320 140" className="h-36 w-full" role="img" aria-label={`${chart.title} 折线图`} preserveAspectRatio="none"><path d="M10 112H310" stroke="#e2e8f0" /><polyline points={points} fill="none" stroke="#7c3aed" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />{chart.values.map((value, index) => { const x = chart.values.length === 1 ? 160 : (index / (chart.values.length - 1)) * 300 + 10; const y = 112 - (value / max) * 92; return <circle key={`${chart.labels[index]}-${index}`} cx={x} cy={y} r="4" fill="#fff" stroke="#7c3aed" strokeWidth="2"><title>{chart.labels[index]}：{value}{chart.unit || ''}</title></circle>; })}</svg>
      <div className="mt-2 flex justify-between gap-2 text-[10px] text-slate-500">{chart.labels.map((label) => <span key={label} className="truncate">{label}</span>)}</div>
    </div>;
  }
  if (chart.kind === 'donut') {
    const total = chart.values.reduce((sum, value) => sum + value, 0) || 1;
    let cursor = 0;
    const segments = chart.values.map((value, index) => {
      const start = cursor;
      cursor += (value / total) * 360;
      return `${colors[index % colors.length]} ${start}deg ${cursor}deg`;
    }).join(', ');
    return <div data-plan-chart={chart.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-800"><PieChart size={16} />{chart.title}</div>
      <div className="flex items-center gap-5">
        <div className="h-28 w-28 shrink-0 rounded-full" style={{ background: `conic-gradient(${segments})` }} aria-label={`${chart.title} 环形图`} />
        <div className="grid min-w-0 gap-1 text-xs text-slate-600">{chart.labels.map((label, index) => <div key={label} className="flex items-center gap-2"><i className="h-2 w-2 rounded-full" style={{ background: colors[index % colors.length] }} /> <span className="truncate">{label}</span><strong className="ml-auto text-slate-900">{chart.values[index]}</strong></div>)}</div>
      </div>
    </div>;
  }
  return <div data-plan-chart={chart.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-800"><BarChart3 size={16} />{chart.title}</div>
    <div className="flex h-36 items-end gap-2" role="img" aria-label={`${chart.title} 柱状图`}>
      {chart.values.map((value, index) => <div key={`${chart.labels[index]}-${index}`} className="group relative flex h-full flex-1 flex-col justify-end">
        <div className="absolute bottom-[calc(var(--chart-h)+6px)] left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[11px] text-white group-hover:block group-focus-within:block">{chart.labels[index]}：{value}{chart.unit || ''}</div>
        <div tabIndex={0} className="w-full rounded-t-md bg-gradient-to-t from-blue-600 to-cyan-400 transition-all focus:outline-none focus:ring-2 focus:ring-blue-400" style={{ '--chart-h': `${Math.max(8, (value / max) * 110)}px`, height: `max(8px, ${(value / max) * 110}px)` } as React.CSSProperties} />
        <span className="mt-2 truncate text-center text-[10px] text-slate-500">{chart.labels[index]}</span>
      </div>)}
    </div>
  </div>;
}

function FigureSlot({ figure, onRetry }: { figure: PlanFigure; onRetry?: (figureId: string) => void }) {
  const isReady = Boolean(figure.image_url);
  const isFailed = figure.status === 'failed';
  return <figure data-plan-figure className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    {isReady ? <img src={figure.image_url} alt={figure.alt || figure.caption || '任务报告配图'} className="w-full object-cover" /> : <div className="flex min-h-44 flex-col items-center justify-center gap-3 bg-gradient-to-br from-slate-50 to-blue-50 px-6 text-center">{isFailed ? <><span className="text-2xl">⚠️</span><p className="text-sm text-slate-600">{figure.error_message || '图片生成失败'}</p>{onRetry && <button type="button" onClick={() => onRetry(figure.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50"><RefreshCw size={13} />重试配图</button>}</> : <><div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-200 border-t-blue-600" aria-hidden="true" /><p className="text-sm text-slate-500">正在生成配图…</p><p className="text-xs text-slate-400">图片任务会在后台完成，不影响报告阅读</p></>}</div>}
    <figcaption className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs text-slate-500"><ImageIcon size={14} />{figure.caption || '任务报告配图'}{figure.image_origin === 'source' && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">资料原图</span>}{figure.source_url && <a href={figure.source_url} target="_blank" rel="noreferrer" className="ml-auto text-blue-600 hover:underline">查看来源</a>}</figcaption>
  </figure>;
}

function spreadIndex(itemIndex: number, itemCount: number, bucketCount: number) {
  if (itemCount <= 0 || bucketCount <= 0) return -1;
  return Math.min(bucketCount - 1, Math.max(0, Math.round(((itemIndex + 0.5) * bucketCount) / itemCount - 0.5)));
}

export default function PlanReportDocument({ document, onRetryFigure }: { document: PlanReportDocument; onRetryFigure?: (figureId: string) => void }) {
  const chartBySection = new Map<number, PlanReportChart>();
  document.charts.forEach((chart, index) => chartBySection.set(spreadIndex(index, document.charts.length, document.sections.length), chart));
  const figureBySection = new Map<number, PlanFigure>();
  document.figures.forEach((figure, index) => figureBySection.set(spreadIndex(index, document.figures.length, document.sections.length), figure));
  const hasConclusion = document.sections.some((section) => /结论与下一步|下一步/.test(section.heading));
  return <article data-plan-report className="space-y-6 pb-8 text-slate-800">
    <header className="rounded-3xl bg-gradient-to-br from-slate-950 via-slate-900 to-blue-950 px-6 py-8 text-white shadow-xl">
      <div className="mb-3 inline-flex rounded-full bg-white/10 px-3 py-1 text-[11px] tracking-[0.18em] text-blue-200">AUTONOMOUS PLAN REPORT</div>
      <h1 className="text-3xl font-semibold tracking-tight">{document.title}</h1>
      <p className="mt-2 text-sm text-slate-300">由任务规划、专家执行与最终汇总共同生成</p>
    </header>
    {document.summary.length > 0 && <section className="rounded-3xl bg-slate-950 p-6 text-white shadow-lg"><h2 className="mb-4 text-lg font-semibold">⚡ 核心总结</h2><div className="grid gap-4 md:grid-cols-3">{document.summary.map((item, index) => <div key={item} className="border-l border-blue-400/60 pl-4"><div className="mb-1 text-xs text-blue-300">要点 {index + 1}</div><p className="text-sm leading-6 text-slate-100">{item}</p></div>)}</div></section>}
    {document.sections.map((section, index) => <section key={`${section.heading}-${index}`} className="space-y-4"><h2 className="border-b border-slate-200 pb-2 text-xl font-semibold">{section.heading}</h2><MarkdownMessage className="text-[15px] leading-7" content={section.body} />{chartBySection.get(index) && <Chart chart={chartBySection.get(index)!} />}{figureBySection.get(index) && <FigureSlot figure={figureBySection.get(index)!} onRetry={onRetryFigure} />}</section>)}
    {document.figures.length > document.sections.length && <section className="grid gap-4 md:grid-cols-2">{document.figures.slice(document.sections.length).map((figure) => <FigureSlot key={figure.id} figure={figure} onRetry={onRetryFigure} />)}</section>}
    {!hasConclusion && <section className="rounded-2xl border border-blue-100 bg-blue-50/70 p-5"><h2 className="text-xl font-semibold text-slate-900">结论与下一步</h2><p className="mt-3 text-sm leading-7 text-slate-700">以上分析应结合正文证据与任务产出理解，结论不替代对原始资料的复核。</p><ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-slate-700"><li>优先复核报告中标注的来源与关键数字。</li><li>根据风险与限制补充必要的验证数据。</li></ul></section>}
  </article>;
}
