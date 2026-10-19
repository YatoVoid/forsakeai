import { describe, expect, it } from 'vitest';
import { analyze, band, pickFlags, units, type CheckBlock } from '../src/detector/analyze';

const words = (n: number, w = 'word') => Array.from({ length: n }, () => w).join(' ');

describe('units', () => {
  it('skips short blocks and splits long ones', () => {
    const blocks: CheckBlock[] = [
      { id: 'h', sentences: [{ id: 'h1', text: 'What method does Socrates use?' }] },
      { id: 'p', sentences: [{ id: 'a', text: words(200) + '.' }, { id: 'b', text: words(200) + '.' }] },
    ];
    const u = units(blocks);
    expect(u.map((x) => x.sentences.map((s) => s.id))).toEqual([['a'], ['b']]);
  });
});

describe('pickFlags', () => {
  it('flags sentences whose removal drops the score a lot', () => {
    expect(pickFlags(['a', 'b', 'c', 'd'], 1, [0.9, -0.9, 0.8, 1.2], 'mixed')).toEqual([{ id: 'b', push: 1.9 }]);
  });

  it('points at the worst sentence when a paragraph reads AI but none stands out', () => {
    expect(pickFlags(['a', 'b', 'c', 'd'], 3, [2.9, 2.7, 3.1, 2.95], 'ai').map((f) => f.id)).toEqual(['b']);
  });

  it('flags nothing in a mixed paragraph without a clear culprit', () => {
    expect(pickFlags(['a', 'b'], 0.2, [0.1, 0.15], 'mixed')).toEqual([]);
  });

  it('never flags more than half the paragraph', () => {
    expect(pickFlags(['a', 'b', 'c', 'd'], 5, [1, 1, 1, 1], 'ai')).toHaveLength(2);
  });
});

describe('analyze', () => {
  it('scores a page at a time and runs leave-one-out only where it reads AI', async () => {
    const human = words(30, 'calm') + '.';
    const robot = words(30, 'delve') + '.';
    const blocks: CheckBlock[] = [
      { id: 'p1', sentences: [{ id: 'h1', text: human }] },
      { id: 'p2', sentences: [{ id: 'r1', text: human }, { id: 'r2', text: robot }] },
      { id: 'q', sentences: [{ id: 'q1', text: 'What was your takeaway?' }] },
    ];
    const calls: string[][] = [];
    // A stand-in detector: each "delve" adds to the logit.
    const score = async (texts: string[], onBatch?: (n: number) => void) => {
      calls.push(texts);
      onBatch?.(texts.length);
      return texts.map((t) => (t.match(/delve/g)?.length ?? 0) / 5 - 2);
    };
    const progress: Array<[number, number]> = [];
    const r = await analyze(blocks, score, (d, t) => progress.push([d, t]));
    expect(r.windows.map((w) => [w.blockIds, w.band])).toEqual([[['p1', 'p2'], 'ai']]);
    expect(calls[0]![0]).toBe(`${human}\n\n${human} ${robot}`);
    expect(calls[1]).toHaveLength(3);
    expect(calls[1]![0]).toBe(`${human} ${robot}`);
    expect(r.flagged.map((f) => f.id)).toEqual(['r2']);
    expect(r.words).toBe(90);
    expect(r.ai).toBeCloseTo(1 / (1 + Math.exp(-4)), 6);
    expect(progress.at(-1)).toEqual([4, 4]);
  });

  it('fills windows to the detector limit and evens out a short last one', () => {
    const para = (i: number) => ({ id: `p${i}`, sentences: [{ id: `s${i}`, text: words(100) + '.' }] });
    expect(units(Array.from({ length: 7 }, (_, i) => para(i))).map((u) => u.words)).toEqual([300, 200, 200]);
    expect(units(Array.from({ length: 5 }, (_, i) => para(i))).map((u) => u.words)).toEqual([300, 200]);
  });

  it('bands', () => {
    expect([band(0.1), band(0.5), band(0.9)]).toEqual(['human', 'mixed', 'ai']);
  });
});

describe('pickBest', () => {
  it('keeps the version the detector scores lowest, and the original when nothing beats it', async () => {
    const { pickBest } = await import('../src/detector/refine');
    const blocks: CheckBlock[] = [
      {
        id: 'p',
        sentences: [
          { id: 'a', text: words(15, 'delve') + '.' },
          { id: 'b', text: words(15, 'calm') + '.' },
        ],
      },
    ];
    const score = async (texts: string[]) => texts.map((t) => (t.match(/delve/g)?.length ?? 0) - (t.match(/plain/g)?.length ?? 0));
    const versions = new Map([
      ['a', [words(15, 'delve') + ' delve.', words(15, 'plain') + '.', words(10, 'delve') + '.']],
      ['b', [words(15, 'delve') + '.']],
    ]);
    const picks = await pickBest(blocks, versions, score);
    expect(picks.get('a')?.text).toBe(words(15, 'plain') + '.');
    expect(picks.get('a')?.gain).toBe(30);
    expect(picks.has('b')).toBe(false);
  });
});
