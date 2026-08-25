import type { PlanFigure, PlanProgressEvent } from '../../lib/api';

export interface PlanReportTable {
  headers: string[];
  rows: string[][];
}

export type PlanReportChartKind = 'bar' | 'line' | 'donut' | 'progress';

export interface PlanReportChart {
  id: string;
  kind: PlanReportChartKind;
  title: string;
  labels: string[];
  values: number[];
  unit?: string;
}

export interface PlanReportDocument {
  title: string;
  summary: string[];
  sections: { heading: string; body: string }[];
  tables: PlanReportTable[];
  charts: PlanReportChart[];
  figures: PlanFigure[];
}

function cleanCell(value: string) {
  return value.replace(/^\s*\|\s*/, '').replace(/\s*\|\s*$/, '').trim();
}

export function parsePlanTables(markdown: string): PlanReportTable[] {
  const lines = markdown.split(/\r?\n/);
  const tables: PlanReportTable[] = [];
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (!lines[i].trim().startsWith('|') || !/^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) continue;
    const headers = lines[i].split('|').map(cleanCell).filter(Boolean);
    const rows: string[][] = [];
    i += 1;
    while (i + 1 < lines.length && lines[i + 1].trim().startsWith('|')) {
      i += 1;
      const row = lines[i].split('|').map(cleanCell).filter(Boolean);
      if (row.length) rows.push(row);
    }
    if (headers.length && rows.length) tables.push({ headers, rows });
  }
  return tables;
}

function numberFromCell(value: string | undefined | null): number | null {
  if (!value) return null;
  const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function buildCharts(tables: PlanReportTable[]): PlanReportChart[] {
  const charts: PlanReportChart[] = [];
  tables.forEach((table, tableIndex) => {
    const valueColumn = table.rows[0]?.findIndex((cell) => numberFromCell(cell) !== null) ?? -1;
    if (valueColumn < 0) return;
    const pairs = table.rows.map((row) => ({ label: row[0] || `项目 ${row.length}`, value: numberFromCell(row[valueColumn]) }))
      .filter((pair): pair is { label: string; value: number } => pair.value !== null)
      .slice(0, 8);
    if (pairs.length < 2) return;
    charts.push({
      id: `plan-chart-${tableIndex}`,
      kind: tableIndex % 4 === 0 ? 'bar' : tableIndex % 4 === 1 ? 'line' : tableIndex % 4 === 2 ? 'donut' : 'progress',
      title: table.headers[valueColumn] || '关键指标对比',
      labels: pairs.map((pair) => pair.label),
      values: pairs.map((pair) => pair.value),
    });
  });
  return charts;
}

function parseChartBlocks(markdown: string): PlanReportChart[] {
  const charts: PlanReportChart[] = [];
  for (const match of markdown.matchAll(/```chart\s*([\s\S]*?)```/gi)) {
    try {
      const value = JSON.parse(match[1].trim()) as Partial<PlanReportChart>;
      if (!value.title || !Array.isArray(value.labels) || !Array.isArray(value.values)) continue;
      const kind = value.kind === 'line' || value.kind === 'donut' || value.kind === 'progress' ? value.kind : 'bar';
      const values = value.values.map(Number).filter(Number.isFinite);
      if (values.length < 2 || values.length !== value.labels.length) continue;
      charts.push({ id: `plan-chart-block-${charts.length}`, kind, title: String(value.title), labels: value.labels.map(String), values, unit: value.unit });
    } catch { /* malformed chart blocks remain visible as Markdown code */ }
  }
  return charts;
}

function extractTitle(markdown: string) {
  const headings = [...markdown.matchAll(/^#{1,2}\s+(.+)$/gm)]
    .map((match) => match[1].replace(/[*_`]/g, '').trim())
    .filter((heading) => heading.length > 2 && !/[?？]$/.test(heading));
  return headings[0] || '自主任务规划报告';
}

function extractSummary(markdown: string) {
  const match = markdown.match(/##\s*结论摘要([\s\S]*?)(?=\n##\s|$)/i);
  const block = match?.[1] || markdown.slice(0, 900);
  const items = block.split(/\n+/).map((line) => line.replace(/^\s*[-*•]\s*/, '').replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);
  return items.slice(0, 3).map((item) => item.length > 180 ? `${item.slice(0, 177)}…` : item);
}

function extractSections(markdown: string) {
  return markdown.split(/(?=^##\s)/m).map((block) => {
    const match = block.match(/^##\s+(.+?)(?:\n|$)/);
    return match ? { heading: match[1].trim(), body: block.slice(match[0].length).replace(/```chart\s*[\s\S]*?```/gi, '').trim() } : null;
  }).filter((section): section is { heading: string; body: string } => Boolean(section));
}

export function adaptPlanReport(markdown: string, figures: PlanFigure[] = [], progress?: PlanProgressEvent | null): PlanReportDocument {
  const tables = parsePlanTables(markdown);
  const summary = extractSummary(markdown);
  const sections = extractSections(markdown);
  const title = extractTitle(markdown);
  if (summary.length === 0 && progress?.tasks.length) summary.push(`已完成 ${progress.tasks.filter((task) => task.status === 'completed').length}/${progress.tasks.length} 个拆解任务。`);
  return { title, summary, sections, tables, charts: [...parseChartBlocks(markdown), ...buildCharts(tables)].slice(0, 6), figures };
}
