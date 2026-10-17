import { EngineError, type Engine } from '../engines/types';
import type { Chunk } from './chunk';
import { buildPrompt, parseResponse, type BuiltPrompt, type Register } from './prompt';
import { unprotect } from './protect';
import type { Doc, Sentence } from './types';
import { validateRewrite, type LangDetect } from './validate';

export interface RunOptions {
  register: Register;
  signal: AbortSignal;
  detect: LangDetect;
  maxTransientRetries?: number;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export interface RunCallbacks {
  onChunkStart?(chunk: Chunk): void;
  onChunkDone?(chunk: Chunk, outcome: ChunkOutcome): void | Promise<void>;
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

export function indexDoc(doc: Doc): Map<string, { sentence: Sentence; lang: string }> {
  const map = new Map<string, { sentence: Sentence; lang: string }>();
  for (const b of doc.blocks) for (const s of b.sentences) map.set(s.id, { sentence: s, lang: b.lang });
  return map;
}

export function isChunkDone(chunk: Chunk, index: Map<string, { sentence: Sentence }>): boolean {
  return chunk.targets.every((id) => {
    const status = index.get(id)?.sentence.status;
    return status === 'rewritten' || status === 'kept';
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
): Promise<string> {
  const max = opts.maxTransientRetries ?? 6;
  const sleep = opts.sleep ?? defaultSleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await engine.complete({
        system: prompt.system,
        user: prompt.user,
        signal: opts.signal,
        onProgress: cb.onProgress,
      });
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

function evaluate(
  prompt: BuiltPrompt,
  response: string,
  index: Map<string, { sentence: Sentence; lang: string }>,
  detect: LangDetect,
): { results: Map<string, TargetResult>; chunkReasons: string[] } {
  const parsed = parseResponse(response);
  const chunkReasons: string[] = [];
  const results = new Map<string, TargetResult>();
  const keys = new Set(prompt.targets.map((t) => t.key));

  for (const key of parsed.keys()) if (!keys.has(key)) chunkReasons.push(`unknown sentence ${key}`);

  for (const t of prompt.targets) {
    const lang = index.get(t.sentenceId)!.lang;
    const candidates = parsed.get(t.key);
    if (!candidates?.length) {
      chunkReasons.push(`missing ${t.key}`);
      results.set(t.sentenceId, { reasons: ['no rewrite returned'] });
      continue;
    }
    if (candidates.length > 1) chunkReasons.push(`${t.key} appeared twice`);
    const candidate = candidates[0]!;
    const reasons = validateRewrite(t.masked, candidate, lang, detect);
    results.set(t.sentenceId, reasons.length ? { reasons } : { rewrite: unprotect(candidate, t.slots, t.offset), reasons });
  }
  return { results, chunkReasons };
}

export async function runChunk(
  chunk: Chunk,
  index: Map<string, { sentence: Sentence; lang: string }>,
  engine: Engine,
  opts: RunOptions,
  cb: RunCallbacks,
): Promise<ChunkOutcome> {
  const lookup = (id: string) => index.get(id)?.sentence;
  const lang = index.get(chunk.targets[0]!)?.lang ?? 'eng';

  const first = buildPrompt(chunk, lookup, { register: opts.register, lang });
  const attempt1 = evaluate(first, await completeWithRetry(engine, first, opts, cb), index, opts.detect);

  let final = attempt1.results;
  const failed = [...attempt1.results.values()].some((r) => !r.rewrite);
  if (attempt1.chunkReasons.length || failed) {
    const reasons = [
      ...attempt1.chunkReasons,
      ...[...attempt1.results.entries()]
        .filter(([, r]) => !r.rewrite)
        .flatMap(([id, r]) => r.reasons.map((x) => `${first.targets.find((t) => t.sentenceId === id)!.key} ${x}`)),
    ];
    const second = buildPrompt(chunk, lookup, { register: opts.register, lang, strictReasons: [...new Set(reasons)] });
    const attempt2 = evaluate(second, await completeWithRetry(engine, second, opts, cb), index, opts.detect);
    final = new Map();
    for (const id of chunk.targets) {
      const a = attempt1.results.get(id);
      const b = attempt2.results.get(id);
      final.set(id, b?.rewrite ? b : a?.rewrite ? a : (b ?? a ?? { reasons: ['no rewrite returned'] }));
    }
  }

  const outcome: ChunkOutcome = { rewritten: 0, kept: 0 };
  for (const id of chunk.targets) {
    const s = lookup(id);
    const r = final.get(id);
    if (!s || !r) continue;
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
 * Runs every unfinished chunk. Local engines run one at a time; API engines
 * use a small pool. Throws on non-retryable engine errors so the caller can
 * pause the job and show the error; finished chunks are already applied.
 */
export async function rewriteDoc(
  doc: Doc,
  chunks: Chunk[],
  engine: Engine,
  opts: RunOptions,
  cb: RunCallbacks = {},
): Promise<void> {
  const index = indexDoc(doc);
  const queue = chunks.filter((c) => !isChunkDone(c, index));
  let next = 0;
  let failure: unknown;

  const worker = async () => {
    while (!failure && next < queue.length) {
      if (opts.signal.aborted) return;
      const chunk = queue[next++]!;
      cb.onChunkStart?.(chunk);
      try {
        const outcome = await runChunk(chunk, index, engine, opts, cb);
        await cb.onChunkDone?.(chunk, outcome);
      } catch (err) {
        failure ??= err;
      }
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.min(engine.concurrency, queue.length)) }, worker));
  if (failure) throw failure;
  if (opts.signal.aborted) throw new EngineError('aborted', 'Stopped');
}
