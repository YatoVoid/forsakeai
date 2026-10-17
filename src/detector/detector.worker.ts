import { AutoModelForCausalLM, AutoTokenizer, Tensor, env, type PreTrainedModel, type PreTrainedTokenizer } from '@huggingface/transformers';
import { binocularsScore, concatTerms, rangeScore, tokenTerms, type TokenTerms } from './binoculars';
import { OBSERVER, PERFORMER, WINDOW, type DetectorDevice, type WorkerRequest, type WorkerResponse } from './protocol';

let tokenizer: PreTrainedTokenizer | null = null;
let observer: PreTrainedModel | null = null;
let performer: PreTrainedModel | null = null;
let device: DetectorDevice = 'wasm';

const post = (msg: WorkerResponse) => self.postMessage(msg);

async function load(want: DetectorDevice, ortBase: string): Promise<void> {
  env.allowLocalModels = false;
  // ORT normally loads its runtime from a CDN through blob: URLs. The page's
  // CSP allows neither, so the files ship with the site and load directly.
  env.useWasmCache = false;
  const wasm = env.backends.onnx.wasm!;
  wasm.wasmPaths = { mjs: `${ortBase}ort-wasm-simd-threaded.asyncify.mjs`, wasm: `${ortBase}ort-wasm-simd-threaded.asyncify.wasm` };

  const files = new Map<string, { loaded: number; total: number }>();
  const progress_callback = (p: { status: string; file?: string; loaded?: number; total?: number }) => {
    if (p.status !== 'progress' || !p.file) return;
    files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
    let loaded = 0;
    let total = 0;
    for (const f of files.values()) {
      loaded += f.loaded;
      total += f.total;
    }
    post({ type: 'download', loaded, total });
  };

  const dtype = want === 'webgpu' ? 'q4f16' : 'int8';
  tokenizer = await AutoTokenizer.from_pretrained(PERFORMER, { progress_callback });
  observer = await AutoModelForCausalLM.from_pretrained(OBSERVER, { dtype, device: want, progress_callback });
  performer = await AutoModelForCausalLM.from_pretrained(PERFORMER, { dtype, device: want, progress_callback });
  device = want;
  post({ type: 'ready', device });
}

async function logits(model: PreTrainedModel, ids: number[]): Promise<{ data: Float32Array; vocab: number }> {
  const input_ids = new Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]);
  const attention_mask = new Tensor('int64', new BigInt64Array(ids.length).fill(1n), [1, ids.length]);
  const out = (await model({ input_ids, attention_mask })) as { logits: Tensor };
  const data = out.logits.data as Float32Array;
  const vocab = out.logits.dims[2]!;
  return { data, vocab };
}

async function score(sentences: Array<{ id: string; text: string }>, maxTokens: number): Promise<void> {
  if (!tokenizer || !observer || !performer) throw new Error('Checker is not loaded.');
  const ids: number[] = [];
  const ranges: Array<{ id: string; from: number; to: number }> = [];
  for (const s of sentences) {
    if (ids.length >= maxTokens) break;
    const encoded = Array.from(tokenizer.encode(s.text, { add_special_tokens: false }) as ArrayLike<number>, Number);
    const take = encoded.slice(0, maxTokens - ids.length);
    // Terms are indexed by the token being predicted, minus one.
    ranges.push({ id: s.id, from: Math.max(0, ids.length - 1), to: ids.length + take.length - 1 });
    ids.push(...take);
  }

  const parts: TokenTerms[] = [];
  const windows = Math.max(1, Math.ceil((ids.length - 1) / WINDOW));
  for (let start = 0, w = 0; start < ids.length - 1; start += WINDOW, w++) {
    const window = ids.slice(start, start + WINDOW + 1);
    const o = await logits(observer, window);
    const p = await logits(performer, window);
    parts.push(tokenTerms(o.data, p.data, window, o.vocab));
    post({ type: 'scoring', done: w + 1, total: windows });
  }
  const terms = concatTerms(parts);
  post({
    type: 'result',
    device,
    tokens: ids.length,
    score: binocularsScore(terms),
    sentences: ranges.map((r) => ({ id: r.id, score: rangeScore(terms, r.from, r.to) })),
  });
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  try {
    if (e.data.type === 'load') await load(e.data.device, e.data.ortBase);
    else await score(e.data.sentences, e.data.maxTokens);
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
