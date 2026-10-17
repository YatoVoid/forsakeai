import { describe, expect, it } from 'vitest';
import { parse, serialize, serializeSource } from '../src/pipeline/parse';

const eng = () => 'eng';

describe('parse', () => {
  const md = [
    '# Title here',
    '',
    'First sentence of the intro. Second one follows it!',
    'A soft-wrapped line in the same paragraph.',
    '',
    '- List item one. With two sentences.',
    '- Item two',
    '',
    '```js',
    'const x = 1. // not prose',
    '```',
    '',
    '> A quoted line. Should not be edited.',
    '',
    '| a | b |',
    '|---|---|',
    '',
    '---',
    'Last paragraph without trailing newline.',
  ].join('\n');

  it('round-trips markdown exactly', () => {
    const doc = parse(md, eng);
    expect(serializeSource(doc)).toBe(md);
    expect(serialize(doc)).toBe(md);
  });

  it('marks only prose blocks editable', () => {
    const doc = parse(md, eng);
    const kinds = doc.blocks.map((b) => `${b.kind}:${b.editable}`);
    expect(kinds).toEqual([
      'heading:true',
      'paragraph:true',
      'list-item:true',
      'list-item:true',
      'code:false',
      'quote:false',
      'table:false',
      'rule:false',
      'paragraph:true',
    ]);
  });

  it('splits sentences and keeps soft wraps inside the paragraph', () => {
    const doc = parse(md, eng);
    const para = doc.blocks[1]!;
    expect(para.sentences.map((s) => s.text)).toEqual([
      'First sentence of the intro.',
      'Second one follows it!',
      'A soft-wrapped line in the same paragraph.',
    ]);
    expect(para.sentences[1]!.trailing).toBe('\n');
  });

  it('gives every sentence a unique id', () => {
    const doc = parse(md, eng);
    const ids = doc.blocks.flatMap((b) => b.sentences.map((s) => s.id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('normalizes CRLF', () => {
    const doc = parse('One. Two.\r\n\r\nThree.', eng);
    expect(serializeSource(doc)).toBe('One. Two.\n\nThree.');
  });

  it('drops deleted sentences without leaving stray spaces', () => {
    const doc = parse('Keep this. Drop this.\n', eng);
    doc.blocks[0]!.sentences[1]!.text = '';
    expect(serialize(doc)).toBe('Keep this.\n');
  });

  it('uses the source text for rejected sentences', () => {
    const doc = parse('Original text here.', eng);
    const s = doc.blocks[0]!.sentences[0]!;
    s.rewrite = 'Rewritten.';
    s.status = 'rewritten';
    expect(serialize(doc)).toBe('Rewritten.');
    s.decision = 'rejected';
    expect(serialize(doc)).toBe('Original text here.');
  });
});
