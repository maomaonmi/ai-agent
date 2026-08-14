import type { WritingReference, WritingSection } from '../writingDocumentTypes';

export type LayoutPageKind = 'cover' | 'toc' | 'body' | 'references';

export interface LayoutBlock {
  id: string;
  kind: 'title' | 'heading' | 'paragraph' | 'meta' | 'reference';
  text: string;
  level?: 1 | 2 | 3;
  sectionId?: string;
}

export interface LayoutPage {
  id: string;
  kind: LayoutPageKind;
  blocks: LayoutBlock[];
}

export interface LayoutTocSection {
  id: string;
  title: string;
  level: 1 | 2 | 3;
}

export interface LayoutDocument {
  id: string;
  sourceDocumentId: string;
  templateId: string;
  pageSize: 'A4';
  pageWidth: number;
  pageHeight: number;
  pages: LayoutPage[];
  updatedAt: number;
}

export interface LayoutSource {
  documentId: string;
  title: string;
  sections: WritingSection[];
  tocSections?: LayoutTocSection[];
  references: WritingReference[];
}
