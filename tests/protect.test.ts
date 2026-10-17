import { describe, expect, it } from 'vitest';
import { protect, unprotect } from '../src/pipeline/protect';

describe('protect', () => {
  const cases: Array<[string, string[]]> = [
    ['Revenue grew 12.5% to $4.2 million in 2024.', ['12.5%', '$4.2 million', '2024']],
    ['See https://example.com/a?b=1 for details.', ['https://example.com/a?b=1']],
    ['Read [the docs](https://x.dev/docs) first.', ['[the docs](https://x.dev/docs)']],
    ['Run `npm test` before pushing.', ['`npm test`']],
    ['As shown in [12], it holds.', ['[12]']],
    ['This was argued (Smith et al., 2020) before.', ['(Smith et al., 2020)']],
    ['She said "we ship Friday" twice.', ['"we ship Friday"']],
    ['Mail me at a.b@example.org today.', ['a.b@example.org']],
    ['It is **very** important.', ['**very**']],
  ];

  it.each(cases)('locks %s', (input, expected) => {
    const { masked, slots } = protect(input);
    expect(slots).toEqual(expected);
    expect(masked).not.toMatch(/\d(?![^[]*\]\])/);
    expect(unprotect(masked, slots)).toBe(input);
  });

  it('keeps sentence-final periods outside number tokens', () => {
    const { masked } = protect('It happened in 2020.');
    expect(masked).toBe('It happened in [[1]].');
  });

  it('numbers tokens from an offset and reverses with the same offset', () => {
    const { masked, slots } = protect('Up 5% on 3 days.', 4);
    expect(masked).toBe('Up [[5]] on [[6]] days.');
    expect(unprotect(masked, slots, 4)).toBe('Up 5% on 3 days.');
  });

  it('does not treat a URL inside a link as a separate token', () => {
    const { slots } = protect('Go to [site](https://a.com) or https://b.com now.');
    expect(slots).toEqual(['[site](https://a.com)', 'https://b.com']);
  });
});
