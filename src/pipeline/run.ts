import { runRules } from '../engines/rules/run';
import { EngineError, type Engine } from '../engines/types';
import { chunkDoc, estimateTokens, isStiff, type Chunk } from './chunk';
import {
  buildParagraphPrompt,
  buildPrompt,
  buildSentencePrompt,
  parseParagraphResponse,
  parseResponse,
  parseSentenceResponse,
  type BuiltPrompt,
  type PassMode,
  type Register,
} from './prompt';
import { protect, unprotect } from './protect';
import { splitSentences } from './parse';
import type { Block, Doc, Sentence } from './types';
import { contentStems, droppedNames, stockDiff, validateRewrite, type LangDetect } from './validate';
import type { VoiceProfile } from './voice';

export interface MeaningScorer {
  /** Cosine similarity between `text` and each of `others`. */
  similarity(text: string, others: string[]): Promise<number[]>;
}

/** Below this embedding similarity to the original, a rewrite has probably changed the meaning. */
export const MIN_SIMILARITY = 0.62;
/** Sentence mode asks again while a rewrite fails validation or still carries a stock phrase. */
const MAX_SENTENCE_ATTEMPTS = 3;
/** Paragraph rewrites move more words around, so the bar is lower than for one sentence. */
export const MIN_PARAGRAPH_SIMILARITY = 0.72;
const MAX_PARAGRAPH_ATTEMPTS = 3;

export interface RunOptions {
  register: Register;
  signal: AbortSignal;
  detect: LangDetect;
  voice?: VoiceProfile | null;
  /** Embedding check for sentence mode. Without it, meaning is judged by word overlap. */
  meaning?: MeaningScorer | null;
  /** 'stiff' rewrites flagged sentences; 'all' rewrites every prose sentence. Default 'stiff'. */
  scope?: RewriteScope;
  /** Re-check rewrites with the rule list and send leftovers back once. Default on. */
  audit?: boolean;
  maxTransientRetries?: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export type RewriteScope = 'stiff' | 'all';

export interface RunCallbacks {
  onPass?(mode: PassMode, chunks: Chunk[]): void;
  /** Sentence mode is about to work on this sentence. */
  onSentenceStart?(id: string, mode: PassMode): void;
  /** One target sentence finished, whatever the outcome. */
  onSentenceDone?(id: string, mode: PassMode): void | Promise<void>;
  onChunkStart?(chunk: Chunk, mode: PassMode): void;
  onChunkDone?(chunk: Chunk, outcome: ChunkOutcome, mode: PassMode): void | Promise<void>;
  onProgress?(chars: number): void;
  onWait?(ms: number, error: EngineError): void;
}

export interface ChunkOutcome {
  rewritten: number;
  kept: number;
}

interface TargetResult {
  rewrite?: string;
  reasons: string[];
}

type Index = Map<string, { sentence: Sentence; lang: string }>;

export function indexDoc(doc: Doc): Index {
  const map: Index = new Map();
  for (const b of doc.blocks) for (const s of b.sentences) map.set(s.id, { sentence: s, lang: b.lang });
  return map;
}

/**
 * Blocks a whole-text rewrite may touch. A short line without closing
 * punctuation is a title pasted as plain text, not prose.
 */
export function isProse(b: Block): boolean {
  if (b.kind !== 'paragraph' && b.kind !== 'list-item') return false;
  if (b.sentences.length !== 1) return true;
  const text = b.sentences[0]!.text.trim();
  return /[.!?…]["”’')\]]*$/.test(text) || text.split(/\s+/).length > 12;
}

const rewriteDone = (s: Sentence) => s.status === 'rewritten' || s.status === 'kept';

export function isChunkDone(chunk: Chunk, index: Map<string, { sentence: Sentence }>, mode: PassMode = 'rewrite'): boolean {
  return chunk.targets.every((id) => {
    const s = index.get(id)?.sentence;
    if (!s) return true;
    return mode === 'audit' ? !!s.audited : rewriteDone(s);
  });
}

export const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(new EngineError('aborted', 'Stopped'));
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new EngineError('aborted', 'Stopped'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

async function completeWithRetry(
  engine: Engine,
  prompt: BuiltPrompt,
  opts: RunOptions,
  cb: RunCallbacks,
  maxTokens?: number,
): Promise<string> {
  const max = opts.maxTransientRetries ?? 6;
  const sleep = opts.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await engine.complete({ system: prompt.system, user: prompt.user, signal: opts.signal, onProgress: cb.onProgress, maxTokens });
    } catch (err) {
      if (opts.signal.aborted) throw new EngineError('aborted', 'Stopped');
      if (!(err instanceof EngineError) || !err.retryable || attempt >= max) throw err;
      const backoff = Math.min(60_000, 1000 * 2 ** attempt) + Math.random() * 500;
      const wait = err.opts.retryAfterMs ?? backoff;
      cb.onWait?.(wait, err);
      await sleep(wait, opts.signal);
    }
  }
}

/** The sentences either side of each target, for the neighbour check. */
function neighbours(chunk: Chunk, index: Index, id: string): string[] {
  const order = chunk.passage.flat();
  const at = order.indexOf(id);
  return [order[at - 1], order[at + 1]]
    .map((n) => (n ? index.get(n)?.sentence : undefined))
    .filter((s): s is Sentence => !!s)
    .map((s) => s.rewrite ?? s.text);
}

/** The flagged phrases the model was asked to fix in this sentence. */
function stockOf(s: Sentence, mode: PassMode): string[] {
  const flags = mode === 'audit' ? (s.auditFlags ?? []) : s.flags;
  return flags.filter((f) => !f.fixed && f.match).map((f) => f.match);
}

/** Room for a rewrite up to twice the original's length, so a rambling small model stops early. */
const sentenceTokenCap = (masked: string) => Math.max(96, estimateTokens(masked) * 2 + 48);

function evaluate(prompt: BuiltPrompt, response: string, index: Index, detect: LangDetect, chunk: Chunk, mode: PassMode) {
  const parsed = parseResponse(response);
  const chunkReasons: string[] = [];
  const results = new Map<string, TargetResult>();
  const keys = new Set(prompt.targets.map((t) => t.key));

  for (const key of parsed.keys()) if (!keys.has(key)) chunkReasons.push(`unknown sentence ${key}`);

  for (const t of prompt.targets) {
    const { lang, sentence } = index.get(t.sentenceId)!;
    const candidates = parsed.get(t.key);
    if (!candidates?.length) {
      chunkReasons.push(`missing ${t.key}`);
      results.set(t.sentenceId, { reasons: ['no rewrite returned'] });
      continue;
    }
    if (candidates.length > 1) chunkReasons.push(`${t.key} appeared twice`);
    const candidate = candidates[0]!;
    const reasons = validateRewrite(t.masked, candidate, lang, detect, neighbours(chunk, index, t.sentenceId), {
      stock: stockOf(sentence, mode),
    });
    results.set(t.sentenceId, reasons.length ? { reasons } : { rewrite: unprotect(candidate, t.slots, t.offset), reasons });
  }
  return { results, chunkReasons };
}

export async function runChunk(
  chunk: Chunk,
  index: Index,
  engine: Engine,
  opts: RunOptions,
  cb: RunCallbacks,
  mode: PassMode = 'rewrite',
): Promise<ChunkOutcome> {
  const lookup = (id: string) => index.get(id)?.sentence;
  const lang = index.get(chunk.targets[0]!)?.lang ?? 'eng';
  const base = { register: opts.register, lang, voice: opts.voice, mode };

  if (engine.granularity === 'sentence' && opts.scope === 'all' && mode === 'rewrite') {
    const total: ChunkOutcome = { rewritten: 0, kept: 0 };
    const targets = new Set(chunk.targets);
    for (const group of chunk.passage) {
      const ids = group.filter((id) => lookup(id)?.text);
      const pending = ids.filter((id) => targets.has(id) && !isChunkDone({ ...chunk, targets: [id] }, index, mode));
      if (!pending.length) continue;
      // A paragraph goes whole only when every sentence in it is still open;
      // otherwise the open ones go one at a time around the finished ones.
      const whole = pending.length === ids.length && ids.length > 1 && (await rewriteParagraph(chunk, ids, index, engine, opts, cb, base));
      if (whole) {
        total.rewritten += ids.length;
        continue;
      }
      for (const id of pending) {
        if (isChunkDone({ ...chunk, targets: [id] }, index, mode)) continue;
        cb.onSentenceStart?.(id, mode);
        const result = await rewriteSentence(chunk, id, index, engine, opts, cb, base);
        const outcome = applyResults({ ...chunk, targets: [id] }, lookup, new Map([[id, result]]), mode);
        total.rewritten += outcome.rewritten;
        total.kept += outcome.kept;
        await cb.onSentenceDone?.(id, mode);
      }
    }
    return total;
  }

  if (engine.granularity === 'sentence') {
    // Each sentence is applied as soon as it's done, so a pause keeps it.
    const total: ChunkOutcome = { rewritten: 0, kept: 0 };
    for (const id of chunk.targets) {
      if (isChunkDone({ ...chunk, targets: [id] }, index, mode)) continue;
      cb.onSentenceStart?.(id, mode);
      const result = await rewriteSentence(chunk, id, index, engine, opts, cb, base);
      const outcome = applyResults({ ...chunk, targets: [id] }, lookup, new Map([[id, result]]), mode);
      total.rewritten += outcome.rewritten;
      total.kept += outcome.kept;
      await cb.onSentenceDone?.(id, mode);
    }
    return total;
  }

  const first = buildPrompt(chunk, lookup, base);
  const attempt1 = evaluate(first, await completeWithRetry(engine, first, opts, cb), index, opts.detect, chunk, mode);

  let final = attempt1.results;
  const failed = [...attempt1.results.values()].some((r) => !r.rewrite);
  if (attempt1.chunkReasons.length || failed) {
    const reasons = [
      ...attempt1.chunkReasons,
      ...[...attempt1.results.entries()]
        .filter(([, r]) => !r.rewrite)
        .flatMap(([id, r]) => r.reasons.map((x) => `${first.targets.find((t) => t.sentenceId === id)!.key} ${x}`)),
    ];
    const second = buildPrompt(chunk, lookup, { ...base, strictReasons: [...new Set(reasons)] });
    const attempt2 = evaluate(second, await completeWithRetry(engine, second, opts, cb), index, opts.detect, chunk, mode);
    final = new Map();
    for (const id of chunk.targets) {
      const a = attempt1.results.get(id);
      const b = attempt2.results.get(id);
      final.set(id, b?.rewrite ? b : a?.rewrite ? a : (b ?? a ?? { reasons: ['no rewrite returned'] }));
    }
  }

  for (const id of chunk.targets) cb.onSentenceDone?.(id, mode);
  return applyResults(chunk, lookup, final, mode);
}

interface Candidate {
  rewrite: string;
  /** Stock phrases from the original that the rewrite still uses. */
  left: string[];
  similarity: number;
}

/**
 * One sentence at a time, for small models. Keeps every valid answer and
 * returns the one with the fewest leftover stock phrases, then the closest
 * in meaning. Asks again with the rejection reasons, up to a fixed limit.
 */
async function rewriteSentence(
  chunk: Chunk,
  id: string,
  index: Index,
  engine: Engine,
  opts: RunOptions,
  cb: RunCallbacks,
  base: { register: Register; lang: string; voice?: VoiceProfile | null; mode: PassMode },
): Promise<TargetResult> {
  const lookup = (sid: string) => index.get(sid)?.sentence;
  const { sentence, lang } = index.get(id)!;
  const stock = stockOf(sentence, base.mode);
  const near = neighbours(chunk, index, id);
  const valid: Candidate[] = [];
  let reasons: string[] = [];
  let strictReasons: string[] | undefined;

  for (let attempt = 0; attempt < MAX_SENTENCE_ATTEMPTS; attempt++) {
    if (opts.signal.aborted) throw new EngineError('aborted', 'Stopped');
    const prompt = buildSentencePrompt(chunk, id, lookup, { ...base, strictReasons });
    const target = prompt.targets[0]!;
    const reply = parseSentenceResponse(await completeWithRetry(engine, prompt, opts, cb, sentenceTokenCap(target.masked))) ?? '';
    reasons = validateRewrite(target.masked, reply, lang, opts.detect, near, { stock, lexicalMeaning: !opts.meaning });
    let similarity = 1;
    if (!reasons.length && opts.meaning) {
      const [own = 0, ...others] = await opts.meaning.similarity(reply, [target.masked, ...near]);
      similarity = own;
      if (own < MIN_SIMILARITY) reasons.push('changed the meaning');
      else if (others.some((o) => o > own)) reasons.push('rewrote a neighbouring sentence');
    }
    if (reasons.length) {
      strictReasons = reasons;
      continue;
    }
    const left = stockDiff(target.masked, reply, lang).left;
    valid.push({ rewrite: unprotect(reply, target.slots, target.offset), left, similarity });
    if (!left.length) break;
    strictReasons = [`it still says "${left[0]}"`];
  }

  if (!valid.length) return { reasons };
  valid.sort((a, b) => a.left.length - b.left.length || b.similarity - a.similarity);
  return { rewrite: valid[0]!.rewrite, reasons: [] };
}

/** Room for a rewrite up to about twice the paragraph's length. */
const paragraphTokenCap = (masked: string) => Math.max(160, estimateTokens(masked) * 2 + 64);

/**
 * Rewrites a whole paragraph in one request, then maps the new sentences
 * back onto the old ones so review still works sentence by sentence.
 * Returns false when no attempt passed validation; the caller then falls
 * back to one sentence at a time.
 */
async function rewriteParagraph(
  chunk: Chunk,
  ids: string[],
  index: Index,
  engine: Engine,
  opts: RunOptions,
  cb: RunCallbacks,
  base: { register: Register; lang: string; voice?: VoiceProfile | null; mode: PassMode },
): Promise<boolean> {
  const sentences = ids.map((id) => index.get(id)!.sentence);
  const { lang } = index.get(ids[0]!)!;
  const text = sentences.map((s, i) => s.text + (i < sentences.length - 1 ? s.trailing : '')).join('');
  const { masked, slots } = protect(text);
  const stock = sentences.flatMap((s) => stockOf(s, base.mode));
  const valid: Candidate[] = [];
  let strictReasons: string[] | undefined;

  for (const id of ids) cb.onSentenceStart?.(id, base.mode);
  for (let attempt = 0; attempt < MAX_PARAGRAPH_ATTEMPTS; attempt++) {
    if (opts.signal.aborted) throw new EngineError('aborted', 'Stopped');
    const prompt = buildParagraphPrompt(masked, { ...base, strictReasons });
    const reply = parseParagraphResponse(
      await completeWithRetry(engine, { ...prompt, targets: [] }, opts, cb, paragraphTokenCap(masked)),
    );
    const reasons = validateRewrite(masked, reply, lang, opts.detect, [], { stock, lexicalMeaning: !opts.meaning, softStock: true });
    let similarity = 1;
    if (!reasons.length && opts.meaning) {
      similarity = (await opts.meaning.similarity(reply, [masked]))[0] ?? 0;
      if (similarity < MIN_PARAGRAPH_SIMILARITY) reasons.push('changed the meaning');
    }
    if (reasons.length) {
      strictReasons = reasons;
      continue;
    }
    // Soft problems: a dropped name or a leftover stock phrase. Ask again, but keep the
    // answer, since falling back to one sentence at a time does worse overall.
    // A pronoun may stand in for a name within a paragraph, but the name has to appear somewhere.
    const dropped = lang === 'deu' ? [] : droppedNames(masked, reply);
    const { left, added } = stockDiff(masked, reply, lang);
    const issues = [...dropped.map((n) => `dropped the name ${n}`), ...left.map((p) => `still says "${p}"`), ...added.map((p) => `added "${p}"`)];
    valid.push({ rewrite: unprotect(reply, slots), left: issues, similarity });
    // One more try for soft problems at most; each try is a whole paragraph of generation.
    if (!issues.length || valid.length > 1) break;
    strictReasons = issues.slice(0, 3);
  }
  if (!valid.length) return false;
  valid.sort((a, b) => a.left.length - b.left.length || b.similarity - a.similarity);

  const parts = splitSentences(valid[0]!.rewrite, lang).map((p) => p.text).filter(Boolean);
  const spans = alignSentences(
    sentences.map((s) => s.text),
    parts,
  );
  const regrouped = spans.some((span) => span.length !== 1);
  for (const [i, s] of sentences.entries()) {
    s.rewrite = spans[i]!.map((k) => parts[k]).join(' ');
    s.status = 'rewritten';
    s.note = undefined;
    s.decision = undefined;
    s.group = regrouped ? `p-${ids[0]}` : undefined;
  }
  for (const id of ids) await cb.onSentenceDone?.(id, base.mode);
  return true;
}

/**
 * Assigns each new sentence to one old sentence, in order, so that every
 * old sentence gets the new text that shares the most content with it.
 * An old sentence may get none (merged into a neighbour) or several (split).
 * Returns, per old sentence, the indices of the new sentences it gets.
 */
export function alignSentences(original: string[], rewritten: string[]): number[][] {
  const n = original.length;
  const m = rewritten.length;
  if (!n) return [];
  const maxSpan = Math.max(3, Math.ceil(m / n) + 1);
  const o = original.map(contentStems);
  const score = (i: number, from: number, to: number) => {
    if (to === from) return -0.2;
    const stems = new Set<string>();
    for (let k = from; k < to; k++) for (const x of contentStems(rewritten[k]!)) stems.add(x);
    let shared = 0;
    for (const x of o[i]!) if (stems.has(x)) shared++;
    const union = o[i]!.size + stems.size - shared;
    return union ? shared / union : 0.01;
  };
  const best: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(-Infinity));
  const back: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(-1));
  best[0]![0] = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= m; j++) {
      if (best[i]![j] === -Infinity) continue;
      for (let len = 0; len <= maxSpan && j + len <= m; len++) {
        const v = best[i]![j]! + score(i, j, j + len);
        if (v > best[i + 1]![j + len]!) {
          best[i + 1]![j + len] = v;
          back[i + 1]![j + len] = j;
        }
      }
    }
  }
  if (best[n]![m] === -Infinity) return original.map((_, i) => (i === 0 ? rewritten.map((_, k) => k) : []));
  const spans: number[][] = [];
  for (let i = n, j = m; i > 0; i--) {
    const from = back[i]![j]!;
    spans.unshift(Array.from({ length: j - from }, (_, k) => from + k));
    j = from;
  }
  return spans;
}

function applyResults(
  chunk: Chunk,
  lookup: (id: string) => Sentence | undefined,
  final: Map<string, TargetResult>,
  mode: PassMode,
): ChunkOutcome {
  const outcome: ChunkOutcome = { rewritten: 0, kept: 0 };
  for (const id of chunk.targets) {
    const s = lookup(id);
    const r = final.get(id);
    if (!s || !r) continue;
    if (mode === 'audit') {
      s.audited = true;
      if (r.rewrite && r.rewrite !== s.rewrite) {
        s.rewrite = r.rewrite;
        outcome.rewritten++;
      } else {
        outcome.kept++;
      }
      continue;
    }
    if (r.rewrite && r.rewrite !== s.text) {
      s.rewrite = r.rewrite;
      s.status = 'rewritten';
      s.note = undefined;
      outcome.rewritten++;
    } else {
      s.status = 'kept';
      s.note = r.rewrite ? 'The model returned it unchanged.' : describeReasons(r.reasons);
      outcome.kept++;
    }
  }
  return outcome;
}

export function describeReasons(reasons: string[]): string {
  const first = reasons[0] ?? 'it failed validation';
  return `Kept your original. The rewrite ${first.replace(/^(dropped|repeated|invented)/, '$1 a')}.`;
}

/**
 * Runs the rule list over each rewrite. Deterministic fixes (em dashes and
 * the like) are applied straight away; anything only the model can fix is
 * recorded so the audit pass can send it back. Returns the IDs to audit.
 */
export function auditRewrites(doc: Doc): Set<string> {
  const ids = new Set<string>();
  for (const b of doc.blocks) {
    for (const s of b.sentences) {
      if (s.status !== 'rewritten' || s.rewrite === undefined || s.audited) continue;
      const { masked, slots } = protect(s.rewrite);
      const result = runRules(masked, b.lang);
      if (!result.deleted) s.rewrite = unprotect(result.text, slots);
      const open = result.flags.filter((f) => !f.fixed).map((f) => ({ ...f, match: unprotect(f.match, slots) }));
      if (open.length) {
        s.auditFlags = open;
        ids.add(s.id);
      } else {
        s.audited = true;
      }
    }
  }
  return ids;
}

async function runQueue(
  chunks: Chunk[],
  index: Index,
  engine: Engine,
  opts: RunOptions,
  cb: RunCallbacks,
  mode: PassMode,
): Promise<void> {
  const queue = chunks.filter((c) => !isChunkDone(c, index, mode));
  let next = 0;
  let failure: unknown;

  const worker = async () => {
    while (!failure && next < queue.length) {
      if (opts.signal.aborted) return;
      const chunk = queue[next++]!;
      cb.onChunkStart?.(chunk, mode);
      try {
        const outcome = await runChunk(chunk, index, engine, opts, cb, mode);
        await cb.onChunkDone?.(chunk, outcome, mode);
      } catch (err) {
        failure ??= err;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.min(engine.concurrency, queue.length)) }, worker));
  if (failure) throw failure;
  if (opts.signal.aborted) throw new EngineError('aborted', 'Stopped');
}

/**
 * Rewrites every unfinished chunk, then audits the rewrites once. Local
 * engines run one chunk at a time; API engines use a small pool. Throws on
 * non-retryable engine errors so the caller can pause; finished chunks are
 * already applied, and a rerun picks up where it stopped.
 */
export async function rewriteDoc(doc: Doc, engine: Engine, opts: RunOptions, cb: RunCallbacks = {}): Promise<void> {
  const index = indexDoc(doc);
  // Finished sentences stay as context; only unfinished ones become targets.
  // Chunk boundaries shift as rewrites change lengths, so this can't rely on
  // whole chunks being done.
  const prose = new Set(doc.blocks.filter(isProse).flatMap((b) => b.sentences.map((s) => s.id)));
  const wanted = (s: Sentence) => (opts.scope === 'all' ? prose.has(s.id) && !!s.text && !s.edited : isStiff(s));
  const main = chunkDoc(doc, (s) => wanted(s) && !rewriteDone(s));
  cb.onPass?.('rewrite', main);
  await runQueue(main, index, engine, opts, cb, 'rewrite');

  if (opts.audit === false) return;
  const targets = auditRewrites(doc);
  // Sentence mode already retried each leftover stock phrase.
  if (engine.granularity === 'sentence') return;
  for (const s of index.values()) if (s.sentence.auditFlags?.length && !s.sentence.audited) targets.add(s.sentence.id);
  if (!targets.size) return;
  const audit = chunkDoc(doc, (s) => targets.has(s.id));
  cb.onPass?.('audit', audit);
  await runQueue(audit, index, engine, opts, cb, 'audit');
}

