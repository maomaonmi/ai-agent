import { formatCitationMarkers, type WritingDocumentState } from '../writingDocumentTypes';
import { createLayoutDocument } from '../layout/layoutDocumentFactory';
import type { LayoutPage, LayoutTocSection } from '../layout/layoutDocumentTypes';
import { LAYOUT_TEMPLATES } from '../layout/layoutTemplates';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const A4_WIDTH_TWIPS = 11906;
const A4_HEIGHT_TWIPS = 16838;
const PAGE_MARGIN_TWIPS = 1440;
const BODY_FONT = 'SimSun';

function escapeXml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;', '"': '&quot;' }[character] ?? character));
}

function runProperties(options: { bold?: boolean; italic?: boolean; size?: number; color?: string; font?: string } = {}) {
  return `<w:rPr>${options.bold ? '<w:b/>' : ''}${options.italic ? '<w:i/>' : ''}${options.color ? `<w:color w:val="${options.color}"/>` : ''}<w:rFonts w:ascii="${options.font ?? BODY_FONT}" w:hAnsi="${options.font ?? BODY_FONT}" w:eastAsia="${options.font ?? BODY_FONT}"/><w:sz w:val="${options.size ?? 24}"/><w:szCs w:val="${options.size ?? 24}"/></w:rPr>`;
}

function paragraph(text: string, options: {
  style?: string;
  align?: 'left' | 'center' | 'right' | 'both';
  before?: number;
  after?: number;
  line?: number;
  firstLine?: number;
  left?: number;
  pageBreakBefore?: boolean;
  keepNext?: boolean;
  tabs?: string;
  run?: { bold?: boolean; italic?: boolean; size?: number; color?: string; font?: string };
} = {}) {
  const pPr = [
    options.style ? `<w:pStyle w:val="${options.style}"/>` : '',
    options.align ? `<w:jc w:val="${options.align}"/>` : '',
    options.before !== undefined || options.after !== undefined || options.line !== undefined ? `<w:spacing${options.before !== undefined ? ` w:before="${options.before}"` : ''}${options.after !== undefined ? ` w:after="${options.after}"` : ''}${options.line !== undefined ? ` w:line="${options.line}" w:lineRule="auto"` : ''}/>` : '',
    options.firstLine !== undefined || options.left !== undefined ? `<w:ind${options.firstLine !== undefined ? ` w:firstLine="${options.firstLine}"` : ''}${options.left !== undefined ? ` w:left="${options.left}"` : ''}/>` : '',
    options.tabs ? `<w:tabs>${options.tabs}</w:tabs>` : '',
    options.pageBreakBefore ? '<w:pageBreakBefore/>' : '',
    options.keepNext ? '<w:keepNext/>' : '',
  ].join('');
  return `<w:p><w:pPr>${pPr}</w:pPr><w:r>${runProperties(options.run)}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function pageBreak() {
  return paragraph('', { pageBreakBefore: true });
}

function tocLabels(sections: LayoutTocSection[]) {
  const counters = [0, 0, 0];
  return sections.map((section) => {
    const index = Math.max(0, Math.min(2, section.level - 1));
    counters[index] += 1;
    for (let cursor = index + 1; cursor < counters.length; cursor += 1) counters[cursor] = 0;
    const title = section.title.replace(/^\s*\d+(?:\.\d+)*[.)]?\s*/, '').trim();
    if (/^(摘要|abstract|致谢|参考文献)$/i.test(title)) return { label: title, level: section.level };
    const number = counters.slice(0, index + 1).filter(Boolean).join('.');
    return { label: `${number}${index === 0 ? '.' : ''} ${title}`, level: section.level };
  });
}

function formalCover(document: WritingDocumentState, accent: string) {
  const metadata = document.layoutMetadata ?? { school: '', major: '', className: '', author: '', studentId: '', advisor: '', date: '' };
  const template = LAYOUT_TEMPLATES.find((item) => item.id === document.layoutTemplateId) ?? LAYOUT_TEMPLATES[0];
  const isThesis = template.id === 'degree-thesis';
  const documentType = isThesis ? '本科/硕士/博士毕业论文' : template.name;
  const titleLabel = isThesis ? '论文题目：' : '题目：';
  const infoTabs = '<w:tab w:val="left" w:pos="3600"/><w:tab w:val="left" w:pos="5800"/>';
  const rows = [
    `学　　院：\t${metadata.college ?? ''}`,
    `专　　业：\t${metadata.major || '________________'}`,
    `年级班级：\t${metadata.className || '________________'}`,
    `姓　　名：\t${metadata.author || '________________'}`,
    `学　　号：\t${metadata.studentId || '________________'}`,
    `指导教师：\t${metadata.advisor || '________________'}`,
    `职　　称：\t${metadata.professionalTitle ?? ''}`,
  ];
  return [
    paragraph(`分类号：\t\t\t密　级：`, { tabs: '<w:tab w:val="left" w:pos="4300"/>', before: 0, after: 0, line: 360, run: { size: 22 } }),
    paragraph(`学校代码：\t\t\t论文编号：`, { tabs: '<w:tab w:val="left" w:pos="4300"/>', before: 0, after: 0, line: 360, run: { size: 22 } }),
    paragraph('校徽', { align: 'center', before: 640, after: 180, run: { bold: true, size: 22, color: accent } }),
    paragraph(metadata.school || '学校名称', { align: 'center', before: 0, after: 260, run: { size: 32 } }),
    paragraph(documentType, { align: 'center', before: 0, after: 460, run: { bold: true, size: 30 } }),
    paragraph(`${titleLabel}${document.title || '未命名论文'}`, { align: 'center', before: 0, after: 980, line: 480, run: { bold: true, size: 30 } }),
    ...rows.map((row) => paragraph(row, { tabs: infoTabs, before: 0, after: 120, line: 360, run: { size: 24 } })),
    paragraph(metadata.date || '年　月　日', { align: 'center', before: 600, after: 0, run: { size: 24 } }),
  ];
}

function genericCover(document: WritingDocumentState, accent: string) {
  const metadata = document.layoutMetadata ?? { school: '', major: '', className: '', author: '', studentId: '', advisor: '', date: '' };
  return [
    paragraph(document.title || '论文正文', { align: 'center', before: 1800, after: 320, run: { bold: true, size: 34, color: accent } }),
    paragraph(metadata.school || '学校名称', { align: 'center', after: 240, run: { size: 24 } }),
    paragraph(metadata.date || '年　月　日', { align: 'center', before: 5200, run: { size: 24 } }),
  ];
}

function pageContent(page: LayoutPage, document: WritingDocumentState, accent: string, tocSections: LayoutTocSection[]) {
  if (page.kind === 'cover') {
    const template = LAYOUT_TEMPLATES.find((item) => item.id === document.layoutTemplateId) ?? LAYOUT_TEMPLATES[0];
    return template.category === 'university' || template.id === 'degree-thesis' ? formalCover(document, accent) : genericCover(document, accent);
  }
  if (page.kind === 'toc') {
    return [
      paragraph('目　录', { align: 'center', before: 360, after: 720, run: { size: 30 } }),
      ...tocLabels(tocSections).map(({ label, level }, index) => paragraph(`${label}\t${index + 3}`, {
        left: level > 1 ? 360 : 0,
        tabs: '<w:tab w:val="right" w:leader="dot" w:pos="9360"/>',
        before: 0,
        after: 80,
        line: 360,
        run: { size: level > 1 ? 22 : 24 },
      })),
    ];
  }
  if (page.kind === 'references') {
    return [
      paragraph('参考文献', { align: 'left', before: 260, after: 420, run: { bold: true, size: 30, color: accent } }),
      ...page.blocks.map((block) => paragraph(block.text, { before: 0, after: 220, line: 360, run: { size: 22 } })),
    ];
  }
  return [
    ...page.blocks.map((block) => block.kind === 'heading'
      ? paragraph(block.text, { style: block.level === 1 ? 'Heading1' : 'Heading2', before: block.level === 1 ? 360 : 240, after: 180, keepNext: true, run: { bold: true, size: block.level === 1 ? 28 : 24, color: block.level === 1 ? accent : '172033' } })
      : paragraph(block.text, { align: 'both', before: 0, after: 180, line: 420, firstLine: 480, run: { size: 24, color: '172033' } })),
  ];
}

function stylesXml(accent: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr>${runProperties({ size: 24, font: BODY_FONT })}</w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="180" w:line="420" w:lineRule="auto"/><w:ind w:firstLine="480"/></w:pPr><w:rPr>${runProperties({ size: 24 })}</w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="420" w:after="180"/></w:pPr><w:rPr>${runProperties({ bold: true, size: 30, color: accent })}</w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="260" w:after="120"/></w:pPr><w:rPr>${runProperties({ bold: true, size: 24, color: '172033' })}</w:rPr></w:style></w:styles>`;
}

function headerXml(title: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="right"/></w:pPr><w:r>${runProperties({ size: 18, color: '8793A7' })}<w:t>${escapeXml(title)}</w:t></w:r></w:p></w:hdr>`;
}

function footerXml() {
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>';
}

function contentTypesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="${DOCX_MIME}.main+xml"/><Override PartName="/word/styles.xml" ContentType="${DOCX_MIME}.styles+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/></Types>`;
}

function documentXml(content: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${content}<w:sectPr><w:headerReference w:type="default" r:id="rId2" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><w:footerReference w:type="default" r:id="rId3" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><w:pgSz w:w="${A4_WIDTH_TWIPS}" w:h="${A4_HEIGHT_TWIPS}"/><w:pgMar w:top="${PAGE_MARGIN_TWIPS}" w:right="${PAGE_MARGIN_TWIPS}" w:bottom="${PAGE_MARGIN_TWIPS}" w:left="${PAGE_MARGIN_TWIPS}"/></w:sectPr></w:body></w:document>`;
}

/** Exports the same paginated layout model used by the browser preview. */
export async function createThesisWordDocument(document: WritingDocumentState, tocSections: LayoutTocSection[] = document.sections.map(({ id, title, level }) => ({ id, title, level })), formatted = document.layoutStatus === 'formatted'): Promise<Blob> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const template = LAYOUT_TEMPLATES.find((item) => item.id === document.layoutTemplateId) ?? LAYOUT_TEMPLATES[0];
  const accent = template.accent.replace('#', '').toUpperCase();
  const layout = formatted ? createLayoutDocument({ documentId: document.documentId, title: document.title, sections: document.sections, tocSections, references: document.references }, template.id) : null;
  const pages = layout?.pages ?? [{ id: 'raw', kind: 'body' as const, blocks: document.sections.flatMap((section) => [{ id: `${section.id}-heading`, kind: 'heading' as const, level: section.level, text: section.title }, ...formatCitationMarkers(section.content, document.references).split(/\r?\n/).filter(Boolean).map((text, index) => ({ id: `${section.id}-paragraph-${index}`, kind: 'paragraph' as const, text }))]) }];
  const content = `${formatted ? '' : paragraph(document.title || '论文正文', { align: 'center', before: 360, after: 540, run: { bold: true, size: 32 } })}${pages.flatMap((page, index) => [index > 0 ? pageBreak() : '', ...pageContent(page, document, accent, tocSections)]).join('')}`;
  zip.file('[Content_Types].xml', contentTypesXml());
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>');
  zip.file('word/styles.xml', stylesXml(accent));
  zip.file('word/header1.xml', headerXml(document.title));
  zip.file('word/footer1.xml', footerXml());
  zip.file('word/document.xml', documentXml(content));
  return zip.generateAsync({ type: 'blob', mimeType: DOCX_MIME });
}

export const THESIS_WORD_MIME = DOCX_MIME;
