'use client';

import { AlertTriangle, BarChart3, LineChart, PieChart, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import MarkdownMessage from '../../components/MarkdownMessage';
import type { PlanFigure } from '../../lib/api';
import type { PlanReportChart, PlanReportDocument } from './planReportAdapter';

/* Why 编辑部（editorial dossier）方向：最终报告是多智能体协作的"交付文档"，
   排版语言模仿印刷简报——报头双细线、衬线章节数字、发丝线分隔，
   而不是渐变横幅 + 千篇一律的 SaaS 白卡片。深浅双主题完整支持。 */
const INK_COLORS = ['#0e7490', '#155e75', '#475569', '#b45309', '#86198f', '#9f1239'];

function ChartFrame({ chart, icon, children }: { chart: PlanReportChart; icon: ReactNode; children: ReactNode }) {
  return (
    <figure data-plan-chart={chart.id} className="mt-5 rounded-xl border border-slate-200/80 bg-white p-4 dark:border-white/10 dark:bg-white/[0.02]">
      <figcaption className="mb-4 flex items-baseline justify-between gap-3">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-900 dark:text-slate-100">
          {icon}{chart.title}
        </span>
        <span aria-hidden className="font-serif text-[11px] italic tracking-wide text-slate-400 dark:text-slate-500">Fig.</span>
      </figcaption>
      {children}
    </figure>
  );
}

function Chart({ chart }: { chart: PlanReportChart }) {
  const max = Math.max(...chart.values, 1);
  if (chart.kind === 'progress') {
    return (
      <ChartFrame chart={chart} icon={<BarChart3 size={15} className="text-cyan-700 dark:text-cyan-400" />}>
        <div className="space-y-3">
          {chart.values.map((value, index) => (
            <div key={`${chart.labels[index]}-${index}`}>
              <div className="mb-1 flex justify-between gap-3 text-xs text-slate-600 dark:text-slate-400">
                <span className="truncate">{chart.labels[index]}</span>
                <strong className="text-slate-900 dark:text-slate-200">{value}{chart.unit || ''}</strong>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-white/10">
                <div className="h-full rounded-full bg-[#0e7490] dark:bg-cyan-400" style={{ width: `${Math.max(4, (value / max) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </ChartFrame>
    );
  }
  if (chart.kind === 'line') {
    // Why 真坐标系：旧版 preserveAspectRatio="none" 会把圆点/线宽拉变形，
    // x 标签用 flex justify-between 与 SVG 数据点位置也对不齐。改为在 SVG
    // 内直接绘制轴刻度、数值标注与 x 标签（与数据点同 x、textAnchor 对齐）。
    const W = 340; const H = 176;
    const padL = 46; const padR = 16; const padT = 20; const padB = 36;
    const plotW = W - padL - padR; const plotH = H - padT - padB;
    const xAt = (index: number) => (chart.values.length === 1 ? padL + plotW / 2 : padL + (index / (chart.values.length - 1)) * plotW);
    const yAt = (value: number) => padT + plotH - (value / max) * plotH;
    const points = chart.values.map((value, index) => `${xAt(index)},${yAt(value)}`).join(' ');
    const baselineY = padT + plotH;
    const areaPath = `M${xAt(0)},${yAt(chart.values[0])} ${chart.values.map((value, index) => `L${xAt(index)},${yAt(value)}`).join(' ')} L${xAt(chart.values.length - 1)},${baselineY} L${xAt(0)},${baselineY} Z`;
    const fmt = (value: number) => (Number.isInteger(value) ? String(value) : value.toFixed(1));
    const truncateLabel = (label: string) => (label.length > 7 ? `${label.slice(0, 6)}…` : label);
    return (
      <ChartFrame chart={chart} icon={<LineChart size={15} className="text-cyan-700 dark:text-cyan-400" />}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${chart.title} 折线图`}>
          <defs>
            <linearGradient id={`line-fill-${chart.id}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#0e7490" stopOpacity="0.20" />
              <stop offset="100%" stopColor="#0e7490" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[max, max / 2, 0].map((tick) => (
            <g key={tick}>
              <line x1={padL} x2={W - padR} y1={yAt(tick)} y2={yAt(tick)} stroke="currentColor" strokeWidth="1" strokeDasharray={tick === 0 ? undefined : '3 4'} className={tick === 0 ? 'text-slate-300 dark:text-white/15' : 'text-slate-200 dark:text-white/10'} />
              <text x={padL - 7} y={yAt(tick) + 3.5} textAnchor="end" fontSize="10" fill="currentColor" className="text-slate-400 dark:text-slate-500">{fmt(Math.round(tick * 100) / 100)}</text>
            </g>
          ))}
          <path d={areaPath} fill={`url(#line-fill-${chart.id})`} />
          <polyline points={points} fill="none" stroke="#0e7490" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="dark:stroke-cyan-400" />
          {chart.values.map((value, index) => (
            <g key={`${chart.labels[index]}-${index}`}>
              <circle cx={xAt(index)} cy={yAt(value)} r="3.5" className="fill-white stroke-[#0e7490] dark:fill-[#101a26] dark:stroke-cyan-400" strokeWidth="2">
                <title>{chart.labels[index]}：{value}{chart.unit || ''}</title>
              </circle>
              <text x={xAt(index)} y={yAt(value) - 8} textAnchor="middle" fontSize="10" fontWeight="600" fill="currentColor" className="text-slate-700 dark:text-slate-300">{fmt(value)}{chart.unit || ''}</text>
              <text x={xAt(index)} y={H - 12} textAnchor="middle" fontSize="10" fill="currentColor" className="text-slate-500 dark:text-slate-400">{truncateLabel(chart.labels[index])}</text>
            </g>
          ))}
        </svg>
      </ChartFrame>
    );
  }
  if (chart.kind === 'donut') {
    const total = chart.values.reduce((sum, value) => sum + value, 0) || 1;
    let cursor = 0;
    const segments = chart.values.map((value, index) => {
      const start = cursor;
      cursor += (value / total) * 360;
      return `${INK_COLORS[index % INK_COLORS.length]} ${start}deg ${cursor}deg`;
    }).join(', ');
    return (
      <ChartFrame chart={chart} icon={<PieChart size={15} className="text-cyan-700 dark:text-cyan-400" />}>
        <div className="flex items-center gap-6">
          <div className="relative h-28 w-28 shrink-0">
            <div className="h-full w-full rounded-full" style={{ background: `conic-gradient(${segments})` }} aria-label={`${chart.title} 环形图`} role="img" />
            <div className="absolute inset-[28%] flex flex-col items-center justify-center rounded-full bg-white dark:bg-[#101a26]">
              <span className="text-sm font-bold text-slate-900 dark:text-slate-100">{total}</span>
              <span className="text-[9px] text-slate-400 dark:text-slate-500">总量</span>
            </div>
          </div>
          <div className="grid min-w-0 flex-1 gap-1.5 text-xs text-slate-600 dark:text-slate-400">
            {chart.labels.map((label, index) => (
              <div key={label} className="flex items-center gap-2">
                <i aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: INK_COLORS[index % INK_COLORS.length] }} />
                <span className="truncate">{label}</span>
                <strong className="ml-auto text-slate-900 dark:text-slate-200">{chart.values[index]}</strong>
              </div>
            ))}
          </div>
        </div>
      </ChartFrame>
    );
  }
  return (
    <ChartFrame chart={chart} icon={<BarChart3 size={15} className="text-cyan-700 dark:text-cyan-400" />}>
      <div className="flex h-36 items-end gap-2" role="img" aria-label={`${chart.title} 柱状图`}>
        {chart.values.map((value, index) => (
          <div key={`${chart.labels[index]}-${index}`} className="group relative flex h-full flex-1 flex-col justify-end">
            <div className="absolute bottom-[calc(var(--chart-h)+6px)] left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[11px] text-white group-hover:block group-focus-within:block">{chart.labels[index]}：{value}{chart.unit || ''}</div>
            {/* Why 双色柱：墨青为主、琥珀仅标记最大值，呼应报头的墨青主色 */}
            <div tabIndex={0} className={`w-full rounded-t-[3px] transition-all focus:outline-none focus:ring-2 focus:ring-cyan-400 ${value === max ? 'bg-[#b45309] dark:bg-amber-500' : 'bg-[#0e7490] dark:bg-cyan-500'}`} style={{ '--chart-h': `${Math.max(8, (value / max) * 110)}px`, height: `max(8px, ${(value / max) * 110}px)` } as React.CSSProperties} />
            <span className="mt-2 truncate text-center text-[10px] text-slate-500 dark:text-slate-400">{chart.labels[index]}</span>
          </div>
        ))}
      </div>
    </ChartFrame>
  );
}

function FigureSlot({ figure, ordinal, onRetry }: { figure: PlanFigure; ordinal?: number; onRetry?: (figureId: string) => void }) {
  const isReady = Boolean(figure.image_url);
  const isFailed = figure.status === 'failed';
  return (
    <figure data-plan-figure className="overflow-hidden rounded-xl border border-slate-200/80 bg-white transition hover:border-cyan-300/70 dark:border-white/10 dark:bg-white/[0.02] dark:hover:border-cyan-500/40">
      {isReady ? (
        <img src={figure.image_url} alt={figure.alt || figure.caption || '任务报告配图'} className="w-full object-cover" loading="lazy" />
      ) : (
        <div className="flex min-h-44 flex-col items-center justify-center gap-3 bg-slate-50/60 px-6 text-center dark:bg-white/[0.02]">
          {isFailed ? (
            <>
              <AlertTriangle size={20} className="text-amber-500" />
              <p className="text-sm text-slate-600 dark:text-slate-400">{figure.error_message || '图片生成失败'}</p>
              {onRetry && (
                <button type="button" onClick={() => onRetry(figure.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-cyan-300 hover:text-cyan-700 dark:border-white/15 dark:text-slate-300 dark:hover:border-cyan-500/40 dark:hover:text-cyan-300">
                  <RefreshCw size={13} />重试配图
                </button>
              )}
            </>
          ) : (
            <>
              <span className="h-1.5 w-24 animate-pulse rounded-full bg-slate-200 dark:bg-white/10" />
              <p className="text-sm font-medium text-slate-600 dark:text-slate-400">正在生成配图…</p>
              <p className="text-xs text-slate-400 dark:text-slate-500">图片任务在后台完成，不影响报告阅读</p>
            </>
          )}
        </div>
      )}
      <figcaption className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-2.5 text-xs text-slate-500 dark:border-white/10 dark:text-slate-400">
        {ordinal != null && <span className="shrink-0 font-semibold text-cyan-800 dark:text-cyan-300">图 {ordinal}</span>}
        <span className="min-w-0 flex-1 truncate">{figure.caption || '任务报告配图'}</span>
        {figure.image_origin === 'source' && <span className="shrink-0 rounded-full border border-emerald-200 px-2 py-0.5 text-[10px] text-emerald-700 dark:border-emerald-500/30 dark:text-emerald-400">资料原图</span>}
        {figure.source_url && <a href={figure.source_url} target="_blank" rel="noreferrer" className="shrink-0 text-cyan-700 hover:underline dark:text-cyan-400">查看来源</a>}
      </figcaption>
    </figure>
  );
}

function spreadIndex(itemIndex: number, itemCount: number, bucketCount: number) {
  if (itemCount <= 0 || bucketCount <= 0) return -1;
  return Math.min(bucketCount - 1, Math.max(0, Math.round(((itemIndex + 0.5) * bucketCount) / itemCount - 0.5)));
}

const Dot = () => <span aria-hidden className="text-slate-300 dark:text-slate-600">·</span>;

export default function PlanReportDocument({ document, onRetryFigure }: { document: PlanReportDocument; onRetryFigure?: (figureId: string) => void }) {
  const chartBySection = new Map<number, PlanReportChart>();
  document.charts.forEach((chart, index) => chartBySection.set(spreadIndex(index, document.charts.length, document.sections.length), chart));
  const figureBySection = new Map<number, PlanFigure>();
  document.figures.forEach((figure, index) => figureBySection.set(spreadIndex(index, document.figures.length, document.sections.length), figure));
  const hasConclusion = document.sections.some((section) => /结论与下一步|下一步/.test(section.heading));
  // 图序号按"章节内先出现"顺序编号，尾部附加图接续
  const sectionFigureOrdinals = new Map<number, number>();
  let runningOrdinal = 0;
  document.sections.forEach((_, index) => {
    if (figureBySection.has(index)) sectionFigureOrdinals.set(index, ++runningOrdinal);
  });
  const galleryFigures = document.figures.slice(document.sections.length);
  const galleryStartOrdinal = runningOrdinal;
  return (
    <article data-plan-report className="pb-10 text-slate-800 dark:text-slate-300">
      {/* 报头：印刷双细线 + 大标题 + 元信息，替代原渐变大横幅 */}
      <header className="pt-1">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.28em] text-cyan-700 dark:text-cyan-400">Final Report</p>
          <p className="font-serif text-[11px] italic text-slate-400 dark:text-slate-500">多智能体协作产出</p>
        </div>
        <div aria-hidden className="mt-2.5 border-b-2 border-slate-900 dark:border-slate-200" />
        <div aria-hidden className="mt-[3px] border-b border-slate-900/50 dark:border-slate-200/50" />
        <h1 className="mt-5 break-words text-[26px] font-bold leading-snug tracking-tight text-slate-900 dark:text-white">{document.title}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
          <span>由任务规划、专家执行与最终汇总共同生成</span>
          {document.sections.length > 0 && <><Dot /><span>{document.sections.length} 个章节</span></>}
          {document.charts.length > 0 && <><Dot /><span>{document.charts.length} 组数据图表</span></>}
          {document.figures.length > 0 && <><Dot /><span>{document.figures.length} 张配图</span></>}
        </div>
      </header>

      {document.summary.length > 0 && (
        <section aria-label="核心总结" className="mt-8">
          <div className="flex items-baseline gap-3">
            <h2 className="text-sm font-bold tracking-wide text-slate-900 dark:text-slate-100">核心总结</h2>
            <span aria-hidden className="font-serif text-[11px] italic tracking-wide text-slate-400 dark:text-slate-500">Executive Summary</span>
            <span aria-hidden className="ml-1 h-px flex-1 bg-slate-200 dark:bg-white/10" />
          </div>
          <ol className="mt-1 divide-y divide-slate-100 dark:divide-white/[0.06]">
            {document.summary.map((item, index) => (
              <li key={item} className="flex gap-4 py-3.5">
                <span aria-hidden className="w-7 shrink-0 font-serif text-[19px] italic leading-7 text-cyan-700 dark:text-cyan-400">{String(index + 1).padStart(2, '0')}</span>
                <p className="text-sm leading-7 text-slate-700 dark:text-slate-300">{item}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {document.sections.map((section, index) => (
        <section key={`${section.heading}-${index}`} className="mt-10">
          <div className="flex items-baseline gap-3 border-b border-slate-200 pb-2.5 dark:border-white/10">
            <span aria-hidden className="shrink-0 font-serif text-[24px] italic leading-none text-slate-300 dark:text-white/25">{String(index + 1).padStart(2, '0')}</span>
            <h2 className="min-w-0 break-words text-[17px] font-bold tracking-tight text-slate-900 dark:text-slate-100">{section.heading}</h2>
          </div>
          <MarkdownMessage className="mt-4 text-[15px] leading-[1.95]" content={section.body} />
          {chartBySection.get(index) && <Chart chart={chartBySection.get(index)!} />}
          {figureBySection.get(index) && (
            <div className="mt-5">
              <FigureSlot figure={figureBySection.get(index)!} ordinal={sectionFigureOrdinals.get(index)} onRetry={onRetryFigure} />
            </div>
          )}
        </section>
      ))}

      {galleryFigures.length > 0 && (
        <section aria-label="附加配图" className="mt-10">
          <div className="flex items-baseline gap-3">
            <h2 className="text-sm font-bold tracking-wide text-slate-900 dark:text-slate-100">附加配图</h2>
            <span aria-hidden className="h-px flex-1 bg-slate-200 dark:bg-white/10" />
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            {galleryFigures.map((figure, index) => (
              <FigureSlot key={figure.id} figure={figure} ordinal={galleryStartOrdinal + index + 1} onRetry={onRetryFigure} />
            ))}
          </div>
        </section>
      )}

      {!hasConclusion && (
        <section aria-label="结论与下一步" className="mt-10 border-l-2 border-cyan-700 pl-5 dark:border-cyan-400">
          <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100">结论与下一步</h2>
          <p className="mt-2.5 text-sm leading-7 text-slate-600 dark:text-slate-400">以上分析应结合正文证据与任务产出理解，结论不替代对原始资料的复核。</p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm leading-7 text-slate-600 dark:text-slate-400">
            <li>优先复核报告中标注的来源与关键数字。</li>
            <li>根据风险与限制补充必要的验证数据。</li>
          </ul>
        </section>
      )}
    </article>
  );
}
