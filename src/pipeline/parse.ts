import type { Block, BlockKind, Doc, Sentence } from './types';

const FENCE = /^\s{0,3}(```|~~~)/;
const HEADING = /^(\s{0,3}#{1,6}\s+)(.*)$/;
const LIST_ITEM = /^(\s*(?:[-*+]|\d{1,9}[.)])\s+)(.*)$/;
const QUOTE = /^\s{0,3}>/;
const TABLE = /^\s*\|/;
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
const BLANK = /^\s*$/;

interface RawBlock {
  kind: BlockKind;
  lead: string;
  body: string;
  tail: string;
}

let counter = 0;
const nextId = (prefix: string) => `${prefix}${(counter++).toString(36)}`;

function stripNewline(line: string): [string, string] {
  const m = /\r?\n$/.exec(line);
  return m ? [line.slice(0, m.index), m[0]] : [line, ''];
}

function splitBlocks(text: string): RawBlock[] {
  const lines = text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const out: RawBlock[] = [];
  let i = 0;

  const pushRaw = (kind: BlockKind, raw: string) => out.push({ kind, lead: raw, body: '', tail: '' });

  while (i < lines.length) {
    const line = lines[i]!;
    const [content, nl] = stripNewline(line);

    if (BLANK.test(content)) {
      const prev = out.at(-1);
      if (prev) prev.tail += line;
      else pushRaw('blank', line);
      i++;
      continue;
    }

    const fence = FENCE.exec(content);
    if (fence) {
      let raw = line;
      i++;
      while (i < lines.length) {
        raw += lines[i]!;
        const closed = new RegExp(`^\\s{0,3}${fence[1]}`).test(lines[i]!);
        i++;
        if (closed) break;
      }
      const [lead, end] = stripNewline(raw);
      out.push({ kind: 'code', lead, body: '', tail: end });
      continue;
    }

    if (RULE.test(content)) {
      out.push({ kind: 'rule', lead: content, body: '', tail: nl });
      i++;
      continue;
    }

    const h = HEADING.exec(content);
    if (h) {
      out.push({ kind: 'heading', lead: h[1]!, body: h[2]!, tail: nl });
      i++;
      continue;
    }

    if (QUOTE.test(content) || TABLE.test(content)) {
      const kind: BlockKind = QUOTE.test(content) ? 'quote' : 'table';
      const test = kind === 'quote' ? QUOTE : TABLE;
      let raw = line;
      i++;
      while (i < lines.length && test.test(lines[i]!)) raw += lines[i++]!;
      const [lead, end] = stripNewline(raw);
      out.push({ kind, lead, body: '', tail: end });
      continue;
    }

    const li = LIST_ITEM.exec(content);
    if (li) {
      out.push({ kind: 'list-item', lead: li[1]!, body: li[2]!, tail: nl });
      i++;
      continue;
    }

    const prev = out.at(-1);
    if (prev && prev.kind === 'paragraph' && /^\r?\n$/.test(prev.tail)) {
      prev.body += prev.tail + content;
      prev.tail = nl;
    } else {
      out.push({ kind: 'paragraph', lead: '', body: content, tail: nl });
    }
    i++;
  }
  return out;
}

const segmenters = new Map<string, Intl.Segmenter>();
function segmenter(lang: string): Intl.Segmenter {
  let s = segmenters.get(lang);
  if (!s) {
    s = new Intl.Segmenter(toBcp47(lang), { granularity: 'sentence' });
    segmenters.set(lang, s);
  }
  return s;
}

const ISO3_TO_BCP47: Record<string, string> = {
  eng: 'en', deu: 'de', spa: 'es', fra: 'fr', por: 'pt', ita: 'it', nld: 'nl',
  rus: 'ru', jpn: 'ja', cmn: 'zh', arb: 'ar', hin: 'hi', tur: 'tr', pol: 'pl',
};

export function toBcp47(lang: string): string {
  return ISO3_TO_BCP47[lang] ?? 'en';
}

export function splitSentences(body: string, lang: string): Array<{ text: string; trailing: string }> {
  const parts: Array<{ text: string; trailing: string }> = [];
  for (const { segment } of segmenter(lang).segment(body)) {
    const m = /\s*$/.exec(segment)!;
    const text = segment.slice(0, m.index);
    const trailing = m[0];
    if (!text) {
      const last = parts.at(-1);
      if (last) last.trailing += trailing;
      else parts.push({ text: '', trailing });
      continue;
    }
    parts.push({ text, trailing });
  }
  return parts;
}

function makeSentence(text: string, trailing: string): Sentence {
  return { id: nextId('s'), source: text, text, trailing, flags: [], stiff: false, status: 'clean' };
}

export function parse(text: string, detectLang: (s: string) => string): Doc {
  counter = 0;
  const normalized = text.replace(/\r\n?/g, '\n');
  const docLang = detectLang(normalized);
  const blocks: Block[] = splitBlocks(normalized).map((raw) => {
    const editable = raw.kind === 'paragraph' || raw.kind === 'heading' || raw.kind === 'list-item';
    const lang = editable ? detectLang(raw.body) || docLang : docLang;
    const effectiveLang = lang === 'und' ? docLang : lang;
    const sentences = editable
      ? splitSentences(raw.body, effectiveLang).map((p) => makeSentence(p.text, p.trailing))
      : [];
    return {
      id: nextId('b'),
      kind: raw.kind,
      lead: raw.lead,
      sentences,
      tail: raw.tail,
      editable,
      lang: effectiveLang,
    };
  });
  return { blocks, lang: docLang };
}

export function proposedText(s: Sentence): string {
  if (s.status === 'rewritten' && s.rewrite !== undefined) return s.rewrite;
  return s.text;
}

export function sentenceText(s: Sentence): string {
  return s.decision === 'rejected' ? s.source : proposedText(s);
}

export function serialize(doc: Doc, pick: (s: Sentence) => string = sentenceText): string {
  let out = '';
  for (const b of doc.blocks) {
    let body = '';
    for (const s of b.sentences) {
      const text = pick(s);
      if (text) body += text + s.trailing;
    }
    out += b.lead + (b.editable ? body.replace(/[ \t]+$/, '') : body) + b.tail;
  }
  return out;
}

export function serializeSource(doc: Doc): string {
  return serialize(doc, (s) => s.source);
}
