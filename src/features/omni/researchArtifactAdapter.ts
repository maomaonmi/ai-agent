import type { ResearchChunk } from '../../lib/api';
import type { CreateArtifactInput } from './api';

export interface ResearchArtifactPayload {
  format: 'markdown';
  content: string;
  query: string;
  sources: ResearchChunk[];
}

function reportTitle(report: string): string {
  const heading = report.split(/\r?\n/).find((line) => /^#{1,3}\s+\S/.test(line.trim()));
  return (heading?.trim().replace(/^#{1,3}\s+/, '') || '深度调研报告').slice(0, 200);
}

export function createResearchArtifactInput(input: {
  messageId: string;
  report: string;
  query: string;
  sources: ResearchChunk[];
}): CreateArtifactInput {
  const reportId = `research-${input.messageId}`;
  const sources = input.sources.slice(0, 50).map((source) => ({
    ...source,
    text: source.text.slice(0, 1200),
  }));
  return {
    messageId: input.messageId,
    kind: 'research_report',
    title: reportTitle(input.report),
    summary: input.report.replace(/\s+/g, ' ').trim().slice(0, 280),
    sourceRef: { type: 'research_report', reportId, revision: 1 },
    payload: { format: 'markdown', content: input.report, query: input.query, sources } satisfies ResearchArtifactPayload,
    metadata: { adapter: 'research', sourceCount: sources.length },
  };
}

export function readResearchArtifactPayload(payload: unknown): ResearchArtifactPayload | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as Partial<ResearchArtifactPayload>;
  return candidate.format === 'markdown' && typeof candidate.content === 'string' && typeof candidate.query === 'string' && Array.isArray(candidate.sources)
    ? candidate as ResearchArtifactPayload
    : null;
}
