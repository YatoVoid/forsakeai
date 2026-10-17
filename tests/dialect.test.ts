import { describe, expect, it } from 'vitest';
import { applyDialect, convertSpelling } from '../src/pipeline/dialect';
import { parse, serialize } from '../src/pipeline/parse';

describe('convertSpelling', () => {
  it('converts US to UK and keeps case', () => {
    expect(convertSpelling('Organize the Color program at the center; we traveled.', 'uk')).toBe(
      'Organise the Colour program at the centre; we travelled.',
    );
  });

  it('converts UK to US', () => {
    expect(convertSpelling('Their behaviour was analysed in the theatre whilst we waited.', 'us')).toBe(
      'Their behavior was analyzed in the theater while we waited.',
    );
  });

  it('leaves words that only look similar', () => {
    expect(convertSpelling('The size of the prize at the four corners of the meter.', 'uk')).toBe(
      'The size of the prize at the four corners of the meter.',
    );
    expect(convertSpelling('A humorous honorary laborious draft check.', 'uk')).toBe('A humorous honorary laborious draft check.');
  });

  it('never touches links, code or quotes', () => {
    expect(convertSpelling('See https://example.com/color and `color` and "color" in color.', 'uk')).toBe(
      'See https://example.com/color and `color` and "color" in colour.',
    );
  });

  it('round-trips', () => {
    const us = 'We prioritized the neighborhood program and canceled the catalog.';
    expect(convertSpelling(convertSpelling(us, 'uk'), 'us')).toBe(us);
  });
});

describe('applyDialect', () => {
  it('converts English blocks only and marks changes', () => {
    const doc = parse('We organized it.\n\nNous avons organisé.', (t) => (t.startsWith('Nous') ? 'fra' : 'eng'));
    expect(applyDialect(doc, 'uk')).toBe(1);
    expect(serialize(doc)).toBe('We organised it.\n\nNous avons organisé.');
    expect(doc.blocks[0]!.sentences[0]!.status).toBe('fixed');
  });
});
