import { strToU8, zipSync } from 'fflate';
import { serialize, sentenceText } from '../pipeline/parse';
import type { Doc } from '../pipeline/types';

export type ExportFormat = 'md' | 'txt' | 'docx';

export function toMarkdown(doc: Doc): string {
  return serialize(doc);
}

export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, '$1 ($2)')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(?<![\p{L}\p{N}])([*_])(.+?)\1(?![\p{L}\p{N}])/gu, '$2')
    .replace(/`([^`]+)`/g, '$1');
}

export function toPlainText(doc: Doc): string {
  let out = '';
  for (const b of doc.blocks) {
    let body = '';
    for (const s of b.sentences) {
      const t = sentenceText(s);
      if (t) body += t + s.trailing;
    }
    if (b.kind === 'heading') out += stripInlineMarkdown(body.trim());
    else if (b.kind === 'list-item') out += b.lead.replace(/^(\s*)[-*+]\s+/, '$1• ') + stripInlineMarkdown(body.trimEnd());
    else if (b.kind === 'code') out += b.lead.replace(/^\s*(```|~~~).*\n?/, '').replace(/\n?\s*(```|~~~)\s*$/, '');
    else if (b.kind === 'quote') out += b.lead.replace(/^\s{0,3}>\s?/gm, '');
    else if (b.kind === 'rule') out += '';
    else out += b.editable ? stripInlineMarkdown(body.trimEnd()) : b.lead;
    out += b.tail;
  }
  return out;
}

const xml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

function runs(text: string): Run[] {
  const out: Run[] = [];
  const re = /(\*\*|__)(.+?)\1|(?<![\p{L}\p{N}])([*_])(.+?)\3(?![\p{L}\p{N}])/gu;
  let pos = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > pos) out.push({ text: text.slice(pos, m.index) });
    if (m[2] !== undefined) out.push({ text: m[2], bold: true });
    else out.push({ text: m[4]!, italic: true });
    pos = m.index + m[0].length;
  }
  if (pos < text.length) out.push({ text: text.slice(pos) });
  return out.map((r) => ({ ...r, text: stripInlineMarkdown(r.text) }));
}

function paragraph(text: string, style?: string): string {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : '';
  const body = runs(text)
    .map((r) => {
      const rPr = r.bold || r.italic ? `<w:rPr>${r.bold ? '<w:b/>' : ''}${r.italic ? '<w:i/>' : ''}</w:rPr>` : '';
      return `<w:r>${rPr}<w:t xml:space="preserve">${xml(r.text)}</w:t></w:r>`;
    })
    .join('');
  return `<w:p>${pPr}${body}</w:p>`;
}

export function toDocx(doc: Doc): Uint8Array {
  const paras: string[] = [];
  for (const b of doc.blocks) {
    const body = b.sentences
      .map((s) => sentenceText(s) && sentenceText(s) + s.trailing)
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    if (b.kind === 'heading') {
      const level = Math.min(3, (b.lead.match(/#/g) ?? ['#']).length);
      paras.push(paragraph(body, `Heading${level}`));
    } else if (b.kind === 'list-item') {
      paras.push(paragraph(`• ${body}`, 'ListParagraph'));
    } else if (b.kind === 'paragraph') {
      paras.push(paragraph(body));
    } else if (b.kind === 'code' || b.kind === 'quote' || b.kind === 'table') {
      for (const line of b.lead.split('\n')) paras.push(paragraph(line.replace(/^\s{0,3}>\s?/, ''), b.kind === 'quote' ? 'Quote' : 'Code'));
    }
  }

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paras.join('')}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>`;

  const style = (id: string, name: string, extra: string) =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>${extra}</w:style>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="300" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
${style('Heading1', 'heading 1', '<w:pPr><w:keepNext/><w:spacing w:before="360"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/></w:rPr>')}
${style('Heading2', 'heading 2', '<w:pPr><w:keepNext/><w:spacing w:before="280"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/></w:rPr>')}
${style('Heading3', 'heading 3', '<w:pPr><w:keepNext/><w:spacing w:before="240"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr>')}
${style('ListParagraph', 'List Paragraph', '<w:pPr><w:ind w:left="360"/><w:spacing w:after="60"/></w:pPr>')}
${style('Quote', 'Quote', '<w:pPr><w:ind w:left="720"/></w:pPr><w:rPr><w:i/></w:rPr>')}
${style('Code', 'Code', '<w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr>')}
</w:styles>`;

  return zipSync({
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`),
    'word/_rels/document.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    'word/document.xml': strToU8(document),
    'word/styles.xml': strToU8(styles),
  });
}

export function download(doc: Doc, format: ExportFormat, name = 'forsakeai'): void {
  const blob =
    format === 'docx'
      ? new Blob([toDocx(doc) as Uint8Array<ArrayBuffer>], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        })
      : new Blob([format === 'md' ? toMarkdown(doc) : toPlainText(doc)], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name}.${format}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
