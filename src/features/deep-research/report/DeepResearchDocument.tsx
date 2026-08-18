'use client';

import { useId, useMemo, useState } from 'react';
import { BarChart3, BookOpenCheck, PieChart, TrendingUp, Zap } from 'lucide-react';
import MarkdownMessage from '../../../components/MarkdownMessage';
import type { ResearchDataChart, ResearchReportDocument } from './researchReportAdapter';

const CHART_COLORS = ['#2563eb', '#0ea5e9', '#14b8a6', '#f59e0b', '#8b5cf6', '#f43f5e'];

function safeExternalUrl(value: string): string | undefined {
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined; } catch { return undefined; }
}

function shortLabel(value: string): string { return value.length > 9 ? `${value.slice(0, 9)}…` : value; }

function splitReportSections(markdown: string): string[] {
  const sections: string[] = [];
  let current: string[] = [];
  const lines = markdown.split(/\r?\n/);
  lines.forEach((line, index) => {
    const isHeading = /^#{1,3}\s+/.test(line.trim());
    const hasBody = current.some((item) => item.trim() && !/^#{1,3}\s+/.test(item.trim()));
    const isBreak = !line.trim() && hasBody && lines.slice(index + 1).some((item) => item.trim());
    if ((isHeading && current.some((item) => item.trim())) || isBreak) { sections.push(current.join('\n')); current = isHeading ? [line] : []; }
    else current.push(line);
  });
  if (current.some((item) => item.trim())) sections.push(current.join('\n'));
  return sections.length ? sections : [markdown];
}

function ChartTooltip({ chart, index }: { chart: ResearchDataChart; index: number | null }) {
  if (index === null) return null;
  return <div role="status" className="pointer-events-none absolute right-4 top-4 z-10 rounded-md bg-slate-900 px-2.5 py-1.5 text-xs text-white shadow-lg">{chart.labels[index]}：{chart.values[index]}{chart.unit}</div>;
}

function ComparisonChart({ chart }: { chart: ResearchDataChart }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...chart.values, 1);
  return <div className="relative mt-4"><ChartTooltip chart={chart} index={active}/><div className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-3">{chart.values.map((value, index) => <button type="button" key={`${chart.labels[index]}-${value}`} title={`${chart.labels[index]}：${value}${chart.unit}`} onMouseEnter={() => setActive(index)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} aria-label={`${chart.labels[index]}：${value}${chart.unit}`} className="min-w-0 text-left outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><div className="flex h-20 items-end border-b border-slate-100"><div className="w-full rounded-t bg-blue-600/90 transition-[height,background-color] hover:bg-blue-500" style={{ height: `${Math.max((value / max) * 100, 8)}%` }}/></div><div className="mt-1.5 flex justify-between gap-2 text-xs"><span className="truncate text-slate-400">{shortLabel(chart.labels[index])}</span><strong className="shrink-0 tabular-nums text-slate-700">{value}{chart.unit}</strong></div></button>)}</div></div>;
}

function TrendChart({ chart }: { chart: ResearchDataChart }) {
  const [active, setActive] = useState<number | null>(null);
  const gradientId = useId();
  const max = Math.max(...chart.values, 1); const min = Math.min(...chart.values, 0); const span = Math.max(max - min, 1);
  const point = (value: number, index: number) => ({ x: 14 + (index * 272) / Math.max(chart.values.length - 1, 1), y: 90 - ((value - min) / span) * 66 });
  const points = chart.values.map((value, index) => { const next = point(value, index); return `${next.x},${next.y}`; }).join(' ');
  return <div className="relative mt-4"><ChartTooltip chart={chart} index={active}/><svg viewBox="0 0 300 108" className="h-32 w-full overflow-visible" role="img" aria-label={`${chart.title}趋势图`}><defs><linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1"><stop stopColor="#2563eb" stopOpacity=".22"/><stop offset="1" stopColor="#2563eb" stopOpacity="0"/></linearGradient></defs><path d="M14 90H286" stroke="#e2e8f0"/><polygon points={`14,90 ${points} 286,90`} fill={`url(#${gradientId})`}/><polyline points={points} fill="none" stroke="#2563eb" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>{chart.values.map((value, index) => { const item = point(value, index); return <circle key={`${item.x}-${item.y}`} cx={item.x} cy={item.y} r="7" fill="transparent" tabIndex={0} role="button" aria-label={`${chart.labels[index]}：${value}${chart.unit}`} onMouseEnter={() => setActive(index)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(index)} onBlur={() => setActive(null)}/>; })}</svg><div className="flex justify-between gap-2 text-xs text-slate-400">{chart.labels.map((label) => <span key={label} className="truncate">{shortLabel(label)}</span>)}</div></div>;
}

function DonutChart({ chart }: { chart: ResearchDataChart }) {
  const [active, setActive] = useState<number | null>(null);
  let offset = 0;
  const stops = chart.values.map((value, index) => { const start = offset; offset += value; return `${CHART_COLORS[index % CHART_COLORS.length]} ${start}% ${offset}%`; }).join(', ');
  return <div className="relative mt-4 flex items-center gap-5"><ChartTooltip chart={chart} index={active}/><div className="relative h-28 w-28 shrink-0 rounded-full" style={{ background: `conic-gradient(${stops})` }}><div className="absolute inset-5 rounded-full bg-white"/></div><div className="min-w-0 space-y-1.5">{chart.values.map((value, index) => <button type="button" key={`${chart.labels[index]}-${value}`} onMouseEnter={() => setActive(index)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(index)} onBlur={() => setActive(null)} className="flex w-full items-center gap-2 text-left text-xs outline-none focus-visible:ring-2 focus-visible:ring-blue-500"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}/><span className="min-w-0 flex-1 truncate text-slate-500">{shortLabel(chart.labels[index])}</span><strong className="tabular-nums text-slate-700">{value}{chart.unit}</strong></button>)}</div></div>;
}

function EvidenceChart({ chart }: { chart: ResearchDataChart }) {
  const icon = chart.type === 'trend' ? <TrendingUp size={16}/> : chart.type === 'donut' ? <PieChart size={16}/> : <BarChart3 size={16}/>;
  return <figure data-research-chart className="my-8 w-full rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:max-w-[42rem] sm:p-5"><figcaption className="flex items-center gap-2 text-sm font-medium text-slate-700">{icon}<span>{chart.title}</span><span className="ml-auto text-[11px] font-normal text-slate-400">悬停查看数据</span></figcaption>{chart.type === 'trend' ? <TrendChart chart={chart}/> : chart.type === 'donut' ? <DonutChart chart={chart}/> : <ComparisonChart chart={chart}/>}</figure>;
}

function ReportBody({ markdown, charts }: { markdown: string; charts: ResearchDataChart[] }) {
  const sections = useMemo(() => splitReportSections(markdown), [markdown]);
  const chartMap = useMemo(() => charts.reduce<Record<number, ResearchDataChart[]>>((map, chart, index) => { const sectionIndex = Math.min(sections.length - 1, Math.max(0, Math.round(((index + 1) * sections.length) / (charts.length + 1)) - 1)); (map[sectionIndex] ??= []).push(chart); return map; }, {}), [charts, sections.length]);
  return <div data-research-markdown className="research-markdown-document">{sections.map((section, index) => <div key={`${index}-${section.slice(0, 20)}`}><MarkdownMessage content={section} className="text-[15px] leading-8 text-slate-800 [&_h1]:mt-10 [&_h1]:text-2xl [&_h2]:mt-10 [&_h2]:border-b [&_h2]:border-slate-200 [&_h2]:pb-3 [&_h2]:text-xl [&_h3]:mt-8 [&_h3]:text-lg"/>{chartMap[index]?.map((chart) => <EvidenceChart key={`${chart.title}-${chart.labels.join('-')}`} chart={chart}/>)}</div>)}</div>;
}

export default function DeepResearchDocument({ document }: { document: ResearchReportDocument }) {
  return <article data-research-document className="mx-auto max-w-[980px] px-6 pb-20 pt-12 sm:px-10 lg:px-12"><header className="mb-8 text-center"><div className="mb-5 flex items-center justify-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em]"><span className="rounded bg-slate-950 px-3 py-1.5 text-white">Deep Research</span><span className="rounded bg-blue-600 px-3 py-1.5 text-white">深度研报</span></div><h1 className="text-3xl font-bold tracking-tight text-slate-950 sm:text-4xl">{document.title}</h1><p className="mt-4 text-sm text-slate-500">生成日期：{new Intl.DateTimeFormat('zh-CN').format(new Date())}</p></header>
    {document.summary.length > 0 && <section aria-labelledby="research-summary-title" className="mb-10 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"><div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 text-amber-600"><Zap size={17}/></span><div><h2 id="research-summary-title" className="text-base font-semibold text-slate-900">核心结论</h2><p className="text-xs text-slate-400">从报告正文提取，不截断原句</p></div></div><div className="grid divide-y divide-slate-100 md:grid-cols-3 md:divide-x md:divide-y-0">{document.summary.map((item) => <div key={item.content} className="p-5"><p className="text-xs font-semibold tracking-wide text-blue-600">{item.label}</p><p className="mt-3 text-sm leading-7 text-slate-700">{item.content}</p></div>)}</div></section>}
    {document.metrics.length > 0 && <section aria-labelledby="research-metrics-title" className="mb-10 rounded-xl border border-slate-200 bg-white p-5 shadow-sm"><h2 id="research-metrics-title" className="flex items-center gap-2 text-sm font-semibold text-slate-800"><BarChart3 size={17}/>关键百分比</h2><div className="mt-4 grid gap-x-6 gap-y-4 sm:grid-cols-2">{document.metrics.map((metric) => <div key={`${metric.label}-${metric.value}`} title={`原文：${metric.sourceText}`}><div className="mb-1.5 flex items-end justify-between gap-3 text-xs"><span className="truncate text-slate-500">{metric.label}</span><strong className="tabular-nums text-slate-800">{metric.value}%</strong></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-blue-600" style={{ width: `${metric.percent}%` }}/></div></div>)}</div></section>}
    <ReportBody markdown={document.markdown} charts={document.dataCharts}/>
    {document.sources.length > 0 && <section className="mt-12 border-t border-slate-200 pt-8" aria-labelledby="research-sources-title"><h2 id="research-sources-title" className="flex items-center gap-2 text-xl font-semibold text-slate-950"><BookOpenCheck size={20}/>参考来源</h2><ol className="mt-5 space-y-3 text-sm text-slate-600">{document.sources.map((source, index) => { const href = safeExternalUrl(source.url); return <li key={`${source.url}-${index}`} className="flex gap-3"><span className="text-slate-400">[{index + 1}]</span>{href ? <a href={href} target="_blank" rel="noreferrer noopener" className="min-w-0 underline decoration-slate-200 underline-offset-4 hover:text-blue-700"><span className="block font-medium text-slate-800">{source.title || '未命名来源'}</span><span className="mt-1 block truncate text-xs text-slate-400">{href}</span></a> : <span className="min-w-0"><span className="block font-medium text-slate-800">{source.title || '未命名来源'}</span><span className="mt-1 block text-xs text-slate-400">来源地址不可用</span></span>}</li>; })}</ol></section>}
  </article>;
}
