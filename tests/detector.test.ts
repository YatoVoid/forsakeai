import { describe, expect, it } from 'vitest';
import { binocularsScore, concatTerms, rangeScore, tokenTerms } from '../src/detector/binoculars';
import { present, type Calibration } from '../src/detector/present';

describe('binoculars math', () => {
  it('matches a hand-computed two-token example', () => {
    const vocab = 3;
    const observer = Float32Array.from([0, 0, 0, 1, 2, 3]);
    const performer = Float32Array.from([1, 0, 0, 0, 0, 0]);
    const terms = tokenTerms(observer, performer, [0, 0], vocab);
    const lse = Math.log(Math.exp(1) + 2);
    expect(terms.ppl[0]).toBeCloseTo(-(1 - lse), 10);
    const lp = [1 - lse, -lse, -lse];
    expect(terms.xppl[0]).toBeCloseTo(-(lp[0]! + lp[1]! + lp[2]!) / 3, 10);
    expect(terms.ppl.length).toBe(1);
  });

  it('scores lower when the performer finds the text unsurprising', () => {
    const vocab = 4;
    const flat = new Float32Array(vocab * 3);
    const confident = Float32Array.from([9, 0, 0, 0, 9, 0, 0, 0, 9, 0, 0, 0]);
    const predictable = binocularsScore(tokenTerms(flat, confident, [0, 0, 0, 0], vocab));
    const surprising = binocularsScore(tokenTerms(flat, confident, [0, 1, 2, 3], vocab));
    expect(predictable).toBeLessThan(surprising);
  });

  it('merges windows and scores ranges', () => {
    const a = { ppl: Float64Array.from([1, 2]), xppl: Float64Array.from([2, 2]) };
    const b = { ppl: Float64Array.from([3]), xppl: Float64Array.from([2]) };
    const all = concatTerms([a, b]);
    expect(Array.from(all.ppl)).toEqual([1, 2, 3]);
    expect(binocularsScore(all)).toBeCloseTo(1, 10);
    expect(rangeScore(all, 0, 2, 1)).toBeCloseTo(0.75, 10);
    expect(rangeScore(all, 0, 2)).toBeUndefined();
  });
});

describe('present', () => {
  const calibration: Calibration = {
    created: '2026-10-17',
    noise: 0.5,
    builds: {
      wasm: {
        eng: { slope: 40, midpoint: 0.85, auc: 0.97, aiBelow: 0.78, humanAbove: 0.9, falsePositiveRate: 0.01, truePositiveRate: 0.9, humanTexts: 200, aiTexts: 200 },
        rus: { slope: 20, midpoint: 0.85, auc: 0.8, aiBelow: 0.7, humanAbove: 0.95, falsePositiveRate: 0.1, truePositiveRate: 0.6, humanTexts: 60, aiTexts: 60 },
      },
    },
  };
  const base = { device: 'wasm' as const, sentences: [] };

  it('calls a low score likely AI with high confidence on long English text', () => {
    const p = present({ ...base, score: 0.7, tokens: 400, lang: 'eng' }, calibration, 'English')!;
    expect(p.verdict).toBe('likely-ai');
    expect(p.confidence).toBe('high');
    expect(p.low).toBeGreaterThan(90);
  });

  it('stays unclear between the cutoffs even when the curve leans one way', () => {
    const p = present({ ...base, score: 0.8, tokens: 400, lang: 'eng' }, calibration, 'English')!;
    expect(p.verdict).toBe('unclear');
  });

  it('keeps the range consistent with the verdict', () => {
    const p = present({ ...base, score: 0.7, tokens: 400, lang: 'eng' }, calibration, 'English')!;
    expect(p.low).toBeGreaterThanOrEqual(50);
  });

  it('calls a high score likely human', () => {
    const p = present({ ...base, score: 1.0, tokens: 400, lang: 'eng' }, calibration, 'English')!;
    expect(p.verdict).toBe('likely-human');
    expect(p.high).toBeLessThan(10);
  });

  it('widens the range and lowers confidence on short text', () => {
    const long = present({ ...base, score: 0.85, tokens: 400, lang: 'eng' }, calibration, 'English')!;
    const short = present({ ...base, score: 0.85, tokens: 60, lang: 'eng' }, calibration, 'English')!;
    expect(short.high - short.low).toBeGreaterThan(long.high - long.low);
    expect(short.confidence).toBe('low');
    expect(long.verdict).toBe('unclear');
  });

  it('says when a language is untested or unreliable', () => {
    const untested = present({ ...base, score: 0.7, tokens: 400, lang: 'spa' }, calibration, 'Spanish')!;
    expect(untested.confidence).toBe('low');
    expect(untested.verdict).toBe('unclear');
    expect(untested.caveats[0]).toContain("hasn't been tested on Spanish");
    const weak = present({ ...base, score: 0.7, tokens: 400, lang: 'rus' }, calibration, 'Russian')!;
    expect(weak.confidence).toBe('low');
    expect(weak.caveats[0]).toContain('unreliable on Russian');
  });

  it('never accuses in a language with a high false-positive rate, or an untested one', () => {
    const weak = present({ ...base, score: 0.5, tokens: 400, lang: 'rus' }, calibration, 'Russian')!;
    expect(weak.verdict).toBe('unclear');
    expect(weak.caveats.join(' ')).toContain('wrongly flagged too much human writing');
    const untested = present({ ...base, score: 0.5, tokens: 400, lang: 'spa' }, calibration, 'Spanish')!;
    expect(untested.verdict).toBe('unclear');
  });

  it('picks the three most machine-like sentences', () => {
    const p = present(
      { ...base, score: 0.8, tokens: 400, lang: 'eng', sentences: [{ id: 'a', score: 0.9 }, { id: 'b', score: 0.6 }, { id: 'c', score: undefined }, { id: 'd', score: 0.7 }, { id: 'e', score: 0.8 }] },
      calibration,
      'English',
    )!;
    expect(p.drivers).toEqual(['b', 'd', 'e']);
  });
});
