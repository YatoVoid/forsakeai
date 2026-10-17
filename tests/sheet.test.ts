import { describe, expect, it } from 'vitest';
import { buildSheet } from '../src/app/sheet';
import { parse } from '../src/pipeline/parse';
import { rulePass } from '../src/pipeline/rulepass';

const setup = (text: string) => {
  const doc = parse(text, () => 'eng');
  rulePass(doc);
  return doc;
};

describe('buildSheet', () => {
  it('lists each rule hit once with every sentence it appears in', () => {
    const doc = setup('This is pivotal. That is also pivotal. We utilize tools.');
    const sheet = buildSheet(doc);
    const pivotal = sheet.find((e) => e.phrase === 'pivotal')!;
    expect(pivotal.sentenceIds).toHaveLength(2);
    expect(pivotal.status).toBe('to-rewrite');
    expect(sheet.find((e) => e.phrase === 'utilize')!.status).toBe('fixed');
    expect(sheet.find((e) => e.phrase === 'utilize')!.now).toBe('We use tools.');
  });

  it('locates entries by paragraph', () => {
    const doc = setup('# Title\n\nPlain first paragraph.\n\nThis one is pivotal.');
    expect(buildSheet(doc).find((e) => e.phrase === 'pivotal')!.para).toBe(3);
  });

  it('puts work still to do first and tracks outcomes', () => {
    const doc = setup('We utilize tools. This is pivotal. I hope this helps!');
    const sheet = buildSheet(doc);
    expect(sheet.map((e) => e.status)).toEqual(['to-rewrite', 'fixed', 'removed']);
    const s = doc.blocks[0]!.sentences[1]!;
    s.status = 'rewritten';
    s.rewrite = 'This matters.';
    expect(buildSheet(doc).find((e) => e.phrase === 'pivotal')!.status).toBe('rewritten');
    s.decision = 'rejected';
    expect(buildSheet(doc).find((e) => e.phrase === 'pivotal')!.status).toBe('undone');
  });
});

describe('sheet "now" text', () => {
  it('shows what a sentence became once, not for every phrase in it', () => {
    const doc = parse('We utilize tools in order to win.', () => 'eng');
    rulePass(doc);
    const withNow = buildSheet(doc).filter((e) => e.now);
    expect(withNow).toHaveLength(1);
  });
});
