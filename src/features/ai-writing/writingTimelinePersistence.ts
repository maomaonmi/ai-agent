import type { WritingDocumentState } from './writingDocumentTypes';
import type { ThesisOutlineState } from './thesis/thesisTypes';

export type BodyArtifactStatus = 'generating' | 'complete' | 'failed' | null;

export function inferBodyArtifactStatus(document: WritingDocumentState): BodyArtifactStatus {
  if (document.view === 'body' && document.researchStatus === 'failed' && document.generatedLength > 0) return 'failed';
  if (document.researchStatus === 'writing' || document.researchStatus === 'verifying' || document.sections.some((section) => section.status === 'generating')) return 'generating';
  if (document.researchStatus === 'done' && document.generatedLength > 0 && document.sections.every((section) => section.status === 'complete')) return 'complete';
  return null;
}

export function inferOutlineArtifactLabel(outline: ThesisOutlineState): string {
  if (outline.status === 'ready') return '大纲已生成并保存';
  if (outline.status === 'failed') return '大纲生成失败';
  if (outline.status === 'generating') return '正在生成大纲并保存';
  return '等待生成大纲';
}
