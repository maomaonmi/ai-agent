import type { ResearchChunk } from '../../../lib/api';

export interface ExplicitMetric {
  label: string;
  value: number;
  percent: number;
  sourceText: string;
}

export interface ResearchOutlineItem {
  id: string;
  level: 1 | 2 | 3;
  title: string;
}

export interface ResearchSummaryItem {
  label: string;
  content: string;
}

export interface ResearchDataTable {
  title: string;
  headers: string[];
  rows: string[][];
}

export interface ResearchDataChart {
  title: string;
  type: 'comparison' | 'trend' | 'donut';
  labels: string[];
  values: number[];
  unit: string;
}

export interface ResearchReportDocument {
  title: string;
  rawReport: string;
  markdown: string;
  summary: ResearchSummaryItem[];
  metrics: ExplicitMetric[];
  tables: ResearchDataTable[];
  dataCharts: ResearchDataChart[];
  sources: ResearchChunk[];
  outline: ResearchOutlineItem[];
  html: string;
}

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

const cleanInlineText = (value: string) => value
  .replace(/!?(?:\[[^\]]*\])?\([^)]*\)/g, '')
  .replace(/[\*_`>#]/g, '')
  .replace(/\s+/g, ' ')
  .replace(/\[\[?\d+(?:[,-]\d+)*\]?\]/g, '')
  .trim();

export function deriveReportTitle(report: string): string {
  const lines = report.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const candidates = lines
    .map((line) => (/^#{1,3}\s+(.+)$/.exec(line)?.[1] ?? (/^(?:标题|题目)\s*[：:]\s*(.+)$/i.exec(line)?.[1] ?? '')))
    .map(cleanInlineText)
    .filter((value) => value.length >= 6 && !/^\d+$/.test(value) && !/^(摘要|引言|目录|参考文献)$/.test(value));
  if (candidates.length) return candidates[0].slice(0, 42);
  const firstSentence = cleanInlineText(
    report.replace(/(^|\n)\|.*\|/g, ' ').split(/[。！？；\n]/).find((item) => cleanInlineText(item).length >= 8) ?? '',
  );
  return firstSentence ? `${firstSentence.slice(0, 34)}${firstSentence.length > 34 ? '…' : ''}` : '深度调研报告';
}

function splitTableRow(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cleanInlineText(cell));
}

function isTableDivider(line: string): boolean {
  return /^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$/.test(line.trim());
}

export function parseMarkdownTables(report: string): ResearchDataTable[] {
  const lines = report.split(/\r?\n/);
  const tables: ResearchDataTable[] = [];
  for (let index = 0; index < lines.length - 1; index += 1) {
    if (!lines[index].includes('|') || !isTableDivider(lines[index + 1])) continue;
    const headers = splitTableRow(lines[index]);
    const rows: string[][] = [];
    let rowIndex = index + 2;
    while (rowIndex < lines.length && lines[rowIndex].includes('|') && lines[rowIndex].trim()) {
      const row = splitTableRow(lines[rowIndex]);
      if (row.length === headers.length) rows.push(row);
      rowIndex += 1;
    }
    if (headers.length >= 2 && rows.length) {
      const previousText = cleanInlineText(lines.slice(Math.max(0, index - 2), index).reverse().find((line) => line.trim() && !line.includes('|')) ?? '数据对比');
      tables.push({ title: previousText || '数据对比', headers, rows });
    }
    index = rowIndex - 1;
  }
  return tables;
}

function parseNumericValue(value: string): { value: number; unit: string } | undefined {
  const match = /(-?\d+(?:\.\d+)?)\s*(%|万|亿|人|元|倍|x)?/i.exec(value.replace(/,/g, ''));
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? { value: parsed, unit: match[2] ?? '' } : undefined;
}

function createDataCharts(tables: ResearchDataTable[]): ResearchDataChart[] {
  return tables.flatMap((table) => {
    const numericColumn = table.headers.slice(1).findIndex((_, columnOffset) => table.rows.filter((row) => parseNumericValue(row[columnOffset + 1])).length >= 2);
    if (numericColumn < 0) return [];
    const column = numericColumn + 1;
    const points = table.rows.map((row) => ({ label: row[0], numeric: parseNumericValue(row[column]) })).filter((item): item is { label: string; numeric: { value: number; unit: string } } => Boolean(item.numeric)).slice(0, 8);
    if (points.length < 2) return [];
    const timeSeries = /(年|月|季|时间|日期|period|time)/i.test(table.headers[0]) || points.every((point) => /^\d{4}(?:[-/.]\d{1,2})?$/.test(point.label));
    const unit = points.every((point) => point.numeric.unit === points[0].numeric.unit) ? points[0].numeric.unit : '';
    const total = points.reduce((sum, point) => sum + point.numeric.value, 0);
    const type: ResearchDataChart['type'] = timeSeries ? 'trend' : unit === '%' && total >= 99 && total <= 101 ? 'donut' : 'comparison';
    return [{ title: table.headers[column], type, labels: points.map((point) => point.label), values: points.map((point) => point.numeric.value), unit }];
  }).slice(0, 3);
}

function createSummary(report: string): ResearchSummaryItem[] {
  const candidates = report
    .replace(/(^|\n)\|.*\|/g, ' ')
    .split(/(?<=[。！？；])|\n+/)
    .map(cleanInlineText)
    .filter((item) => item.length >= 14 && item.length <= 92 && !/^\d+[.、]?$/.test(item));
  const labels = ['研究结论', '关键证据', '行动启示'];
  return candidates.slice(0, 3).map((content, index) => ({ label: labels[index], content }));
}

export function extractExplicitMetrics(report: string): ExplicitMetric[] {
  const metrics: ExplicitMetric[] = [];
  const seen = new Set<string>();
  const pattern = /([^\n。；:：]{2,42})[：:]?\s*(\d+(?:\.\d+)?)\s*%/g;
  for (const match of report.matchAll(pattern)) {
    const label = match[1].replace(/^[-*#\s\d.、]+/, '').trim();
    const value = Number(match[2]);
    const key = `${label}:${value}`;
    if (!label || !Number.isFinite(value) || value < 0 || value > 100 || seen.has(key)) continue;
    seen.add(key);
    metrics.push({ label, value, percent: value, sourceText: match[0].trim() });
    if (metrics.length === 6) break;
  }
  return metrics;
}

function normalizeHeadingId(index: number): string {
  return `research-section-${index + 1}`;
}

function parseHeading(line: string): { level: 1 | 2 | 3; title: string } | undefined {
  const markdown = /^(#{1,3})\s+(.+)$/.exec(line);
  if (markdown) return { level: markdown[1].length as 1 | 2 | 3, title: markdown[2].trim() };
  const numbered = /^(第[一二三四五六七八九十百]+[章节部分]|[一二三四五六七八九十]+[、.]|\d+(?:\.\d+){0,2}[、.\s])\s*(.+)$/.exec(line);
  if (!numbered) return undefined;
  const prefix = numbered[1];
  const level = /^\d+\.\d+\.\d+/.test(prefix) ? 3 : /^\d+\.\d+/.test(prefix) ? 2 : 1;
  return { level, title: `${prefix}${numbered[2]}`.trim() };
}

function markdownToHtml(report: string): { html: string; outline: ResearchOutlineItem[] } {
  const lines = report.trim().split(/\r?\n/);
  const html: string[] = [];
  const outline: ResearchOutlineItem[] = [];
  let list: 'ul' | 'ol' | null = null;
  const closeList = () => {
    if (list) html.push(`</${list}>`);
    list = null;
  };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { closeList(); continue; }
    const heading = parseHeading(line);
    if (heading) {
      closeList();
      const id = normalizeHeadingId(outline.length);
      outline.push({ id, level: heading.level, title: heading.title });
      const tagLevel = Math.min(heading.level + 1, 4);
      html.push(`<h${tagLevel} id="${id}">${escapeHtml(heading.title)}</h${tagLevel}>`);
      continue;
    }
    const bullet = /^[-*]\s+(.+)$/.exec(line);
    const numbered = /^\d+[.、]\s*(.+)$/.exec(line);
    if (bullet || numbered) {
      const nextList = bullet ? 'ul' : 'ol';
      if (list !== nextList) { closeList(); list = nextList; html.push(`<${list}>`); }
      html.push(`<li>${escapeHtml((bullet ?? numbered)![1])}</li>`);
      continue;
    }
    closeList();
    html.push(`<p>${escapeHtml(line)}</p>`);
  }
  closeList();
  return { html: html.join(''), outline };
}

function normalizeReportMarkdown(report: string): string {
  return report.split(/\r?\n/).map((line) => {
    const trimmed = line.trim();
    if (!trimmed || /^#\s+/.test(trimmed)) return line;
    const heading = parseHeading(trimmed);
    return heading ? `${'#'.repeat(heading.level + 1)} ${heading.title}` : line;
  }).join('\n');
}

export function createResearchReportDocument(
  report: string,
  title: string,
  sources: ResearchChunk[] = [],
): ResearchReportDocument {
  const parsed = markdownToHtml(report);
  const tables = parseMarkdownTables(report);
  return {
    title: deriveReportTitle(report),
    rawReport: report,
    markdown: normalizeReportMarkdown(report),
    summary: createSummary(report),
    metrics: extractExplicitMetrics(report),
    tables,
    dataCharts: createDataCharts(tables),
    sources: sources.slice(0, 12),
    outline: parsed.outline,
    html: parsed.html,
  };
}
