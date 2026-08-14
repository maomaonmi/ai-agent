import type { ResearchChunk } from '../../../lib/api';

export interface ExplicitMetric {
  label: string;
  value: number;
  percent: number;
  sourceText: string;
}

export interface ResearchReportDocument {
  title: string;
  summary: string[];
  metrics: ExplicitMetric[];
  sources: ResearchChunk[];
  html: string;
}

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;');

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

function markdownToHtml(report: string): string {
  const lines = report.trim().split(/\r?\n/);
  const html: string[] = [];
  let list: 'ul' | 'ol' | null = null;
  const closeList = () => {
    if (list) html.push(`</${list}>`);
    list = null;
  };
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { closeList(); continue; }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      closeList();
      const level = heading[1].length + 1;
      html.push(`<h${level}>${escapeHtml(heading[2])}</h${level}>`);
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
  return html.join('');
}

export function createResearchReportDocument(
  report: string,
  title: string,
  sources: ResearchChunk[] = [],
): ResearchReportDocument {
  const paragraphs = report
    .split(/\n{2,}/)
    .map((item) => item.replace(/^#+\s*/, '').trim())
    .filter((item) => item.length > 24 && !/^https?:\/\//.test(item));
  return {
    title: title.trim() || '深度调研报告',
    summary: paragraphs.slice(0, 3).map((item) => item.slice(0, 180)),
    metrics: extractExplicitMetrics(report),
    sources: sources.slice(0, 12),
    html: markdownToHtml(report),
  };
}

