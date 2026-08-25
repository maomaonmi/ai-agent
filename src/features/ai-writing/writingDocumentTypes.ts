import type { WritingSceneId } from './writingTypes';

export type WritingDocumentView = 'outline' | 'body' | 'layout';
export type WritingSectionStatus = 'pending' | 'generating' | 'complete' | 'failed';
export type WritingResearchStatus = 'idle' | 'planning' | 'searching' | 'writing' | 'verifying' | 'done' | 'failed';
export type CitationStatus = 'verified' | 'partial' | 'unsupported' | 'needs-review';

export interface WritingOutlineNode {
  id: string;
  title: string;
  level: 1 | 2 | 3;
  targetLength?: number;
  status: WritingSectionStatus;
}

export interface WritingSection {
  id: string;
  outlineId: string;
  title: string;
  level: 1 | 2 | 3;
  content: string;
  targetLength?: number;
  status: WritingSectionStatus;
}

export interface WritingReference {
  id: string;
  title: string;
  url?: string;
  excerpt?: string;
  accessedAt?: string;
  status: CitationStatus;
}

export interface WritingCitation {
  id: string;
  sectionId: string;
  referenceId: string;
  quote?: string;
  status: CitationStatus;
}

/** Remove process-oriented boilerplate without touching the document structure. */
export function stripWritingPreamble(content: string): string {
  const value = content.replace(/\r\n/g, '\n').trim();
  if (!/^我将为您/u.test(value)) return value;

  const headingOffset = value.search(/#{1,6}\s+\S/);
  if (headingOffset > 0) {
    return value.slice(headingOffset).trim();
  }

  return value
    .replace(/^我将为您[^\n。！？]*[。！？]\s*/u, '')
    .replace(/^(?:首先|接下来|下面)[^\n。！？]*(?:搜索|检索|撰写|生成|介绍|说明)[^\n。！？]*[。！？]\s*/u, '')
    .trim();
}

/** Normalize legacy/editable writing text while preserving ordinary prose. */
export function normalizeWritingContent(content: string): string {
  return stripWritingPreamble(content)
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/\*\*([\s\S]*?)\*\*/g, '$1')
    .replace(/__([\s\S]*?)__/g, '$1')
    .replace(/^\s*[-*_]{3,}\s*$/gm, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Convert the internal streaming citation token into a reader-facing marker.
 * The model uses stable ids such as `c1-ref-1`; those ids are implementation
 * details and should never leak into the document body or exported files.
 */
export function formatCitationMarkers(content: string, references: Array<Pick<WritingReference, 'id'>>): string {
  if (!content.includes('[ref:')) return content;
  const numbers = new Map(references.map((reference, index) => [reference.id, index + 1]));
  let fallbackNumber = numbers.size + 1;
  return content.replace(/\[ref:([^\]]+)\]/g, (_marker, referenceId: string) => {
    const knownNumber = numbers.get(referenceId);
    if (knownNumber) return `[${knownNumber}]`;
    const number = fallbackNumber;
    fallbackNumber += 1;
    return `[${number}]`;
  });
}

export interface WritingDocumentVersion {
  id: string;
  label: string;
  createdAt: number;
  reason: 'chapter-complete' | 'rewrite-confirmed' | 'manual-save' | 'migration';
  sectionIds: string[];
}

export interface WritingDocumentState {
  documentId: string;
  sessionId?: string;
  title: string;
  scene: WritingSceneId;
  outline: WritingOutlineNode[];
  sections: WritingSection[];
  references: WritingReference[];
  citations: WritingCitation[];
  activeSectionId?: string;
  targetLength?: number;
  generatedLength: number;
  versionId: string;
  versions: WritingDocumentVersion[];
  researchStatus: WritingResearchStatus;
  view: WritingDocumentView;
  layoutTemplateId?: string;
  layoutStatus?: 'idle' | 'formatted';
  layoutMetadata?: {
    school: string;
    major: string;
    className: string;
    author: string;
    studentId: string;
    advisor: string;
    date: string;
    categoryNumber?: string;
    schoolCode?: string;
    securityLevel?: string;
    thesisNumber?: string;
    college?: string;
    professionalTitle?: string;
  };
  updatedAt: number;
}

export function createEmptyWritingDocument(scene: WritingSceneId, title = '未命名写作') : WritingDocumentState {
  const sectionId = 'section-draft';
  return {
    documentId: `writing-doc-${Date.now()}`,
    title,
    scene,
    outline: [{ id: 'outline-draft', title: '正文', level: 1, status: 'pending' }],
    sections: [{ id: sectionId, outlineId: 'outline-draft', title: '正文', level: 1, content: '', status: 'pending' }],
    references: [],
    citations: [],
    activeSectionId: sectionId,
    generatedLength: 0,
    versionId: 'draft',
    versions: [],
    researchStatus: 'idle',
    view: 'outline',
    layoutStatus: 'idle',
    layoutMetadata: { school: '', major: '', className: '', author: '', studentId: '', advisor: '', date: '' },
    updatedAt: Date.now(),
  };
}

/** 将 V1 单篇正文迁移为 V2 的单章节文档，保证旧会话仍可展示。 */
export function documentFromV1Result(scene: WritingSceneId, content: string, title = '未命名写作'): WritingDocumentState {
  const document = createEmptyWritingDocument(scene, title);
  const section = document.sections[0];
  const normalizedContent = normalizeWritingContent(content);
  section.content = normalizedContent;
  section.status = normalizedContent.trim() ? 'complete' : 'pending';
  document.generatedLength = normalizedContent.replace(/\s/g, '').length;
  document.researchStatus = normalizedContent.trim() ? 'done' : 'idle';
  document.view = normalizedContent.trim() ? 'body' : 'outline';
  document.updatedAt = Date.now();
  return document;
}
