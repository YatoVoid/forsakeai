import { AutoModelForSequenceClassification, AutoTokenizer, env, type PreTrainedModel, type PreTrainedTokenizer, type Tensor } from '@huggingface/transformers';
import { BATCH, MAX_TOKENS, type DetectorDevice, type WorkerRequest, type WorkerResponse } from './protocol';

let tokenizer: PreTrainedTokenizer | null = null;
let model: PreTrainedModel | null = null;

const post = (msg: WorkerResponse) => self.postMessage(msg);

async function load(device: DetectorDevice, ortBase: string, name: string, host?: string): Promise<void> {
  env.allowLocalModels = false;
  // ORT normally loads its runtime from a CDN through blob: URLs. The page's
  // CSP allows neither, so the files ship with the site and load directly.
  env.useWasmCache = false;
  env.backends.onnx.wasm!.wasmPaths = { mjs: `${ortBase}ort-wasm-simd-threaded.asyncify.mjs`, wasm: `${ortBase}ort-wasm-simd-threaded.asyncify.wasm` };
  if (host) {
    env.remoteHost = host;
    env.remotePathTemplate = '{model}/';
  }

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

  tokenizer = await AutoTokenizer.from_pretrained(name, { progress_callback });
  model = await AutoModelForSequenceClassification.from_pretrained(name, { dtype: 'fp32', device, progress_callback });
  post({ type: 'ready', device });
}

async function score(id: number, texts: string[]): Promise<void> {
  if (!tokenizer || !model) throw new Error('The checker is not loaded.');
  // Similar lengths share a batch, so little of each pass goes to padding.
  const order = texts.map((t, i) => ({ t, i })).sort((a, b) => a.t.length - b.t.length);
  const logits = new Array<number>(texts.length);
  for (let start = 0; start < order.length; start += BATCH) {
    const batch = order.slice(start, start + BATCH);
    const enc = tokenizer(
      batch.map((b) => b.t),
      { padding: true, truncation: true, max_length: MAX_TOKENS },
    );
    const out = (await model(enc)) as { logits: Tensor };
    const data = out.logits.data as Float32Array;
    batch.forEach((b, k) => (logits[b.i] = data[k]!));
    post({ type: 'batch', id, done: batch.length });
  }
  post({ type: 'logits', id, logits });
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') await load(msg.device, msg.ortBase, msg.model, msg.host);
    else await score(msg.id, msg.texts);
  } catch (err) {
    post({ type: 'error', id: msg.type === 'score' ? msg.id : undefined, message: err instanceof Error ? err.message : String(err) });
  }
};
