export type Band = 'human' | 'mixed' | 'ai';

export interface CheckBlock {
  id: string;
  sentences: Array<{ id: string; text: string }>;
}

/** Raw detector logits for each text, in order. Above 0 leans AI. */
export type Scorer = (texts: string[], onBatch?: (done: number) => void) => Promise<number[]>;

/** A run of consecutive paragraphs, scored together the way a detector reads a page. */
export interface WindowScore {
  blockIds: string[];
  sentenceIds: string[];
  words: number;
  /** 0..1 */
  ai: number;
  band: Band;
}

export interface SentenceFlag {
  id: string;
  /** How far the paragraph's logit falls when this sentence is left out. */
  push: number;
}

export interface Analysis {
  /** Word-weighted mean of the paragraph scores, 0..1. */
  ai: number;
  band: Band;
  words: number;
  windows: WindowScore[];
  flagged: SentenceFlag[];
}

/** Detectors can't judge a heading or a one-line question, and these would skew the total. */
const MIN_WORDS = 20;
/**
 * The detector reads 512 tokens, about 380 words. Paragraphs scored one at a time
 * look more human than the same text read as a page, so pieces are packed close to that.
 */
const MAX_WORDS = 360;
const MIXED_FROM = 0.35;
const AI_FROM = 0.65;
/** A sentence whose removal drops its window's logit this much is worth rewriting on its own. */
const STRONG_PUSH = 0.75;

const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const join = (parts: Array<{ text: string }>) => parts.map((p) => p.text.trim()).join(' ');

export function band(ai: number): Band {
  return ai >= AI_FROM ? 'ai' : ai >= MIXED_FROM ? 'mixed' : 'human';
}

export interface Unit {
  blockIds: string[];
  sentences: Array<{ id: string; text: string; blockId: string }>;
  words: number;
}

/**
 * Packs paragraphs into windows as full as the detector allows, splitting a long
 * paragraph by sentence. A short last window is evened out with the one before it.
 */
export function units(blocks: CheckBlock[]): Unit[] {
  const items = blocks
    .map((b) => ({ id: b.id, sentences: b.sentences.filter((s) => s.text.trim()) }))
    .filter((b) => wordCount(join(b.sentences)) >= MIN_WORDS)
    .flatMap((b) => b.sentences.map((s) => ({ ...s, blockId: b.id, words: wordCount(s.text) })));
  const groups: Array<typeof items> = [];
  let current: typeof items = [];
  let words = 0;
  for (const x of items) {
    if (words && words + x.words > MAX_WORDS) {
      groups.push(current);
      current = [];
      words = 0;
    }
    current.push(x);
    words += x.words;
  }
  if (current.length) groups.push(current);

  const last = groups.at(-1);
  if (groups.length > 1 && last && sum(last) < MAX_WORDS * 0.4) {
    const both = [...groups[groups.length - 2]!, ...last];
    const half = sum(both) / 2;
    let at = 0;
    for (let acc = 0; at < both.length && acc + both[at]!.words / 2 < half; at++) acc += both[at]!.words;
    groups.splice(-2, 2, both.slice(0, at), both.slice(at));
  }

  return groups.map((g) => ({
    blockIds: [...new Set(g.map((x) => x.blockId))],
    sentences: g.map(({ id, text, blockId }) => ({ id, text, blockId })),
    words: sum(g),
  }));
}

const sum = (g: Array<{ words: number }>) => g.reduce((n, x) => n + x.words, 0);

/**
 * The window's text with paragraph breaks kept, since they're part of what a detector sees.
 * `edits` swaps sentences by position; an empty string leaves one out.
 */
export function windowText(u: Unit, edits: Map<number, string> = new Map()): string {
  let out = '';
  let last = '';
  u.sentences.forEach((s, i) => {
    const text = (edits.get(i) ?? s.text).trim();
    if (!text) return;
    out += (out ? (s.blockId === last ? ' ' : '\n\n') : '') + text;
    last = s.blockId;
  });
  return out;
}

/**
 * Leave-one-out: one sentence alone is too short for any detector to judge,
 * but how much a window's score drops without it says how much it carries.
 */
export function pickFlags(sentenceIds: string[], whole: number, without: number[], paragraphBand: Band): SentenceFlag[] {
  const pushes = sentenceIds.map((id, i) => ({ id, push: whole - without[i]! })).sort((a, b) => b.push - a.push);
  const cap = Math.max(2, Math.ceil(sentenceIds.length / 4));
  const strong = pushes.filter((p) => p.push >= STRONG_PUSH).slice(0, cap);
  if (strong.length || paragraphBand !== 'ai') return strong;
  // The whole paragraph reads AI and no one sentence stands out: point at the worst ones anyway.
  return pushes.filter((p) => p.push > 0).slice(0, Math.max(1, Math.ceil(sentenceIds.length / 4)));
}

export async function analyze(
  blocks: CheckBlock[],
  score: Scorer,
  onProgress?: (done: number, total: number) => void,
): Promise<Analysis> {
  const list = units(blocks);
  let total = list.length;
  let done = 0;
  const tick = (n: number) => {
    done += n;
    onProgress?.(done, total);
  };

  const logits = await score(
    list.map((u) => windowText(u)),
    (n) => tick(n),
  );
  const windows: WindowScore[] = list.map((u, i) => {
    const ai = sigmoid(logits[i]!);
    return { blockIds: u.blockIds, sentenceIds: u.sentences.map((s) => s.id), words: u.words, ai, band: band(ai) };
  });

  const suspects = list.map((u, i) => ({ u, i })).filter(({ i }) => windows[i]!.band !== 'human');
  const variants: string[] = [];
  const owners: number[] = [];
  for (const { u, i } of suspects) {
    if (u.sentences.length < 2) continue;
    for (let k = 0; k < u.sentences.length; k++) {
      variants.push(windowText(u, new Map([[k, '']])));
      owners.push(i);
    }
  }
  total += variants.length;
  const without = variants.length ? await score(variants, (n) => tick(n)) : [];

  const flagged: SentenceFlag[] = [];
  for (const { u, i } of suspects) {
    if (u.sentences.length < 2) {
      flagged.push({ id: u.sentences[0]!.id, push: logits[i]! });
      continue;
    }
    const mine = without.filter((_, k) => owners[k] === i);
    flagged.push(...pickFlags(windows[i]!.sentenceIds, logits[i]!, mine, windows[i]!.band));
  }

  const words = windows.reduce((n, p) => n + p.words, 0);
  const ai = words ? windows.reduce((n, p) => n + p.ai * p.words, 0) / words : 0;
  return { ai, band: band(ai), words, windows, flagged };
}
