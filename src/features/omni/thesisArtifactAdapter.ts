import type { WritingDocumentState } from '../ai-writing/writingDocumentTypes';
import type { ThesisOutlineState } from '../ai-writing/thesis/thesisTypes';
import type { CreateArtifactInput } from './api';

export interface ThesisArtifactPayload {
  format: 'structured_thesis';
  markdown: string;
  document: WritingDocumentState;
  outline: ThesisOutlineState;
}

function thesisMarkdown(document: WritingDocumentState): string {
  return document.sections
    .filter((section) => section.content.trim())
    .map((section) => `# ${section.title}\n\n${section.content.trim()}`)
    .join('\n\n');
}

export function createThesisArtifactInput(input: {
  messageId: string;
  document: WritingDocumentState;
  outline: ThesisOutlineState;
}): CreateArtifactInput {
  const markdown = thesisMarkdown(input.document);
  return {
    messageId: input.messageId,
    kind: 'thesis',
    title: (input.document.title || input.outline.title || '未命名论文').slice(0, 200),
    summary: `${input.document.sections.length} 个章节 · ${input.document.generatedLength} 字 · ${input.document.references.length} 条参考资料`,
    sourceRef: {
      type: 'writing_document',
      documentId: input.document.documentId,
      revision: Math.max(1, input.document.versions.length + 1),
    },
    payload: {
      format: 'structured_thesis',
      markdown,
      document: input.document,
      outline: input.outline,
    } satisfies ThesisArtifactPayload,
    metadata: {
      adapter: 'thesis',
      chapterCount: input.document.sections.length,
      referenceCount: input.document.references.length,
    },
  };
}

export function readThesisArtifactPayload(payload: unknown): ThesisArtifactPayload | null {
  if (!payload || typeof payload !== 'object') return null;
  const candidate = payload as Partial<ThesisArtifactPayload>;
  if (!candidate.document || !candidate.outline || typeof candidate.document !== 'object' || typeof candidate.outline !== 'object') return null;
  const document = candidate.document as WritingDocumentState;
  if (!Array.isArray(document.sections) || !Array.isArray(document.references)) return null;
  const markdown = typeof candidate.markdown === 'string' && candidate.markdown.trim()
    ? candidate.markdown
    : thesisMarkdown(document);
  return {
    format: 'structured_thesis',
    markdown,
    document,
    outline: candidate.outline as ThesisOutlineState,
  };
}
