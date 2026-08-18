import type { ResearchReportDocument } from '../report/researchReportAdapter';

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const escapeXml = (value: string) => value.replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;', '"': '&quot;' }[character] ?? character));

function paragraph(text: string, style?: 'Title' | 'Heading1' | 'Heading2' | 'List') {
  const properties = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '<w:pPr><w:spacing w:after="160" w:line="420" w:lineRule="auto"/></w:pPr>';
  return `<w:p>${properties}<w:r><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft YaHei"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function reportBody(report: string) {
  return report.split(/\r?\n/).filter((line) => line.trim()).map((line) => {
    const value = line.trim();
    const heading = /^(#{1,3})\s+(.+)$/.exec(value);
    if (heading) return paragraph(heading[2], heading[1].length === 1 ? 'Heading1' : 'Heading2');
    const list = /^(?:[-*]|\d+[.、])\s*(.+)$/.exec(value);
    return paragraph(list ? `• ${list[1]}` : value, list ? 'List' : undefined);
  }).join('');
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:eastAsia="Microsoft YaHei"/></w:rPr></w:rPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:pPr><w:jc w:val="center"/><w:spacing w:before="360" w:after="420"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="180"/></w:pPr><w:rPr><w:b/><w:color w:val="0F172A"/><w:sz w:val="30"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:pPr><w:keepNext/><w:spacing w:before="260" w:after="140"/></w:pPr><w:rPr><w:b/><w:sz w:val="25"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="List"><w:name w:val="List"/><w:pPr><w:ind w:left="420" w:hanging="240"/><w:spacing w:after="100"/></w:pPr></w:style></w:styles>`;
}

export async function createResearchWordDocument(document: ResearchReportDocument): Promise<Blob> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  const references = document.sources.length ? `${paragraph('参考来源', 'Heading1')}${document.sources.map((source, index) => paragraph(`[${index + 1}] ${source.title || '未命名来源'} — ${source.url}`)).join('')}` : '';
  const body = `${paragraph(document.title, 'Title')}${paragraph(`生成日期：${new Intl.DateTimeFormat('zh-CN').format(new Date())}`)}${reportBody(document.rawReport)}${references}`;
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="${DOCX_MIME}.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`);
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
  zip.file('word/styles.xml', stylesXml());
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1260" w:right="1440" w:bottom="1260" w:left="1440"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: 'blob', mimeType: DOCX_MIME });
}
