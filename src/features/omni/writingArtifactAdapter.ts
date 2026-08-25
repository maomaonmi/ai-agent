import type { CreateArtifactInput } from './api';
import { stripWritingPreamble, type WritingDocumentState } from '../ai-writing/writingDocumentTypes.ts';

function titleFromMarkdown(content: string, fallback: string): string {
  const heading = content.split(/\r?\n/).find((line) => /^#{1,3}\s+\S/.test(line));
  const title = heading?.replace(/^#{1,3}\s+/, '').trim() || fallback.trim();
  return (title || '未命名文档').slice(0, 200);
}

export function writingDocumentToMarkdown(document: WritingDocumentState): string {
  return document.sections
    .filter((section) => section.content.trim())
    .map((section) => document.sections.length > 1
      ? `${'#'.repeat(Math.min(3, section.level))} ${section.title}\n\n${section.content.trim()}`
      : section.content.trim())
    .join('\n\n');
}

export function createWritingArtifactInput(input: {
  messageId: string;
  content: string;
  prompt: string;
}): CreateArtifactInput {
  const content = stripWritingPreamble(input.content);
  const title = titleFromMarkdown(content, input.prompt.slice(0, 48));
  const compact = content.replace(/\s+/g, ' ').trim();
  return {
    messageId: input.messageId,
    kind: 'document',
    title,
    summary: compact.slice(0, 240),
    sourceRef: {
      type: 'writing_document',
      documentId: `omni-writing-${input.messageId}`,
      revision: 1,
    },
    payload: {
      format: 'markdown',
      content,
    },
    metadata: {
      adapter: 'writing',
      workspace: 'ai-writing',
    },
  };
}
