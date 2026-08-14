import { formatCitationMarkers } from '../writingDocumentTypes';
import type { LayoutBlock, LayoutDocument, LayoutPage, LayoutSource } from './layoutDocumentTypes';

const A4_WIDTH = 794;
const A4_HEIGHT = 1123;
// Keep a conservative visual budget: the renderer uses a 1.95 line-height and
// must leave enough room for the footer/page number on every A4 page.
const BODY_CHAR_LIMIT = 1180;
const REFERENCE_CHAR_LIMIT = 1050;

function paragraphs(text: string) {
  return text.split(/\n{2,}|\n/).map((value) => value.trim()).filter(Boolean);
}

function splitLongParagraph(text: string) {
  if (text.length <= BODY_CHAR_LIMIT) return [text];
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += BODY_CHAR_LIMIT) chunks.push(text.slice(index, index + BODY_CHAR_LIMIT));
  return chunks;
}

function createBodyPages(source: LayoutSource): LayoutPage[] {
  const pages: LayoutPage[] = [];
  let blocks: LayoutBlock[] = [];
  let size = 0;
  const flush = () => {
    if (!blocks.length) return;
    pages.push({ id: `body-${pages.length + 1}`, kind: 'body', blocks });
    blocks = [];
    size = 0;
  };

  source.sections.forEach((section) => {
    const heading: LayoutBlock = { id: `${section.id}-heading`, kind: 'heading', level: section.level, text: section.title, sectionId: section.id };
    if (blocks.length && size > BODY_CHAR_LIMIT * 0.68) flush();
    blocks.push(heading);
    size += section.title.length + 36;
    paragraphs(formatCitationMarkers(section.content || '正文将在这里生成。', source.references)).flatMap(splitLongParagraph).forEach((text, paragraphIndex) => {
      if (size + text.length > BODY_CHAR_LIMIT * 0.9 && blocks.length > 1) flush();
      blocks.push({ id: `${section.id}-paragraph-${paragraphIndex}-${pages.length}`, kind: 'paragraph', text, sectionId: section.id });
      size += text.length;
    });
  });
  flush();
  return pages.length ? pages : [{ id: 'body-1', kind: 'body', blocks: [{ id: 'body-placeholder', kind: 'paragraph', text: '正文将在这里生成。' }] }];
}

function stripLeadingNumber(title: string) {
  return title.replace(/^\s*\d+(?:\.\d+)*[.)]?\s*/, '').trim();
}

function createTocBlocks(source: LayoutSource): LayoutBlock[] {
  const counters = [0, 0, 0];
  const sections = source.tocSections ?? source.sections;
  return sections.map((section) => {
    const levelIndex = Math.max(0, section.level - 1);
    counters[levelIndex] += 1;
    for (let index = levelIndex + 1; index < counters.length; index += 1) counters[index] = 0;
    const number = counters.slice(0, levelIndex + 1).filter(Boolean).join('.');
    const title = stripLeadingNumber(section.title);
    const isUnnumberedFrontMatter = /^(摘要|abstract|致谢|参考文献)$/i.test(title);
    const text = isUnnumberedFrontMatter ? title : `${number}${levelIndex === 0 ? '.' : ''} ${title}`;
    return { id: `toc-${section.id}`, kind: 'heading', level: section.level, text, sectionId: section.id };
  });
}

function createReferencePages(source: LayoutSource): LayoutPage[] {
  if (!source.references.length) {
    return [{ id: 'references-1', kind: 'references', blocks: [{ id: 'references-empty', kind: 'paragraph', text: '暂无参考文献。' }] }];
  }
  const pages: LayoutPage[] = [];
  let blocks: LayoutBlock[] = [];
  let size = 0;
  const flush = () => {
    if (!blocks.length) return;
    pages.push({ id: `references-${pages.length + 1}`, kind: 'references', blocks });
    blocks = [];
    size = 0;
  };
  source.references.forEach((reference, index) => {
    const text = `[${index + 1}] ${reference.title}${reference.url ? ` · ${reference.url}` : ''}`;
    if (blocks.length && size + text.length > REFERENCE_CHAR_LIMIT) flush();
    blocks.push({ id: `reference-${reference.id}`, kind: 'reference', text });
    size += text.length;
  });
  flush();
  return pages;
}

export function createLayoutDocument(source: LayoutSource, templateId: string): LayoutDocument {
  const bodyPages = createBodyPages(source);
  const tocBlocks = createTocBlocks(source);
  return {
    id: `layout-${source.documentId}-${templateId}`,
    sourceDocumentId: source.documentId,
    templateId,
    pageSize: 'A4',
    pageWidth: A4_WIDTH,
    pageHeight: A4_HEIGHT,
    pages: [
      { id: 'cover', kind: 'cover', blocks: [{ id: 'cover-title', kind: 'title', text: source.title || '未命名论文' }] },
      { id: 'toc', kind: 'toc', blocks: tocBlocks },
      ...bodyPages,
      ...createReferencePages(source),
    ],
    updatedAt: Date.now(),
  };
}
