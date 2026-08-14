import { WritingDocumentState, WritingReference, WritingSection, WritingDocumentVersion, CitationStatus } from './writingDocumentTypes';

export type WritingDocumentEvent =
  | { type: 'document_outline'; documentId: string; outline: WritingDocumentState['outline'] }
  | { type: 'document_section'; documentId: string; section: WritingSection }
  | { type: 'reference_found'; documentId: string; reference: WritingReference }
  | { type: 'citation_check'; documentId: string; citationId: string; status: CitationStatus }
  | { type: 'document_version'; documentId: string; version: WritingDocumentVersion }
  | { type: 'writing_status'; documentId: string; status: WritingDocumentState['researchStatus'] };

/**
 * 文档事件是幂等的：同一 section/reference/version 重放时只覆盖对应对象，
 * 这样网络断线重连或历史事件回放不会重复追加正文和引用。
 */
export function applyWritingDocumentEvent(document: WritingDocumentState, event: WritingDocumentEvent): WritingDocumentState {
  if (event.documentId !== document.documentId) return document;
  const next = { ...document, updatedAt: Date.now() };
  switch (event.type) {
    case 'document_outline':
      next.outline = event.outline;
      return next;
    case 'document_section': {
      const index = next.sections.findIndex((section) => section.id === event.section.id);
      next.sections = index === -1 ? [...next.sections, event.section] : next.sections.map((section, currentIndex) => currentIndex === index ? event.section : section);
      next.activeSectionId = event.section.id;
      next.generatedLength = next.sections.reduce((total, section) => total + section.content.replace(/\s/g, '').length, 0);
      return next;
    }
    case 'reference_found':
      next.references = next.references.some((reference) => reference.id === event.reference.id)
        ? next.references.map((reference) => reference.id === event.reference.id ? event.reference : reference)
        : [...next.references, event.reference];
      return next;
    case 'citation_check':
      next.citations = next.citations.map((citation) => citation.id === event.citationId ? { ...citation, status: event.status } : citation);
      return next;
    case 'document_version':
      next.versions = next.versions.some((version) => version.id === event.version.id)
        ? next.versions.map((version) => version.id === event.version.id ? event.version : version)
        : [...next.versions, event.version];
      next.versionId = event.version.id;
      return next;
    case 'writing_status':
      next.researchStatus = event.status;
      return next;
  }
}
