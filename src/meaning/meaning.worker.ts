import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers';
import { MEANING_MODEL, type MeaningRequest, type MeaningResponse } from './protocol';

let embed: FeatureExtractionPipeline | null = null;
const post = (msg: MeaningResponse) => self.postMessage(msg);

async function load(ortBase: string): Promise<void> {
  env.allowLocalModels = false;
  // Same CSP constraint as the checker: no CDN or blob: URLs for the ORT runtime.
  env.useWasmCache = false;
  env.backends.onnx.wasm!.wasmPaths = {
    mjs: `${ortBase}ort-wasm-simd-threaded.asyncify.mjs`,
    wasm: `${ortBase}ort-wasm-simd-threaded.asyncify.wasm`,
  };
  const files = new Map<string, { loaded: number; total: number }>();
  embed = await pipeline('feature-extraction', MEANING_MODEL, {
    dtype: 'int8',
    device: 'wasm',
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== 'progress' || !p.file) return;
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total ?? 0 });
      let loaded = 0;
      let total = 0;
      for (const f of files.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      post({ type: 'download', loaded, total });
    },
  });
  post({ type: 'ready' });
}

async function compare(id: number, text: string, others: string[]): Promise<void> {
  if (!embed) throw new Error('The meaning check is not loaded.');
  const out = await embed([text, ...others], { pooling: 'mean', normalize: true });
  const [, dim] = out.dims as [number, number];
  const data = out.data as Float32Array;
  const scores = others.map((_, i) => {
    let dot = 0;
    for (let k = 0; k < dim; k++) dot += data[k]! * data[(i + 1) * dim + k]!;
    return dot;
  });
  post({ type: 'similarity', id, scores });
}

self.onmessage = async (e: MessageEvent<MeaningRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') await load(msg.ortBase);
    else await compare(msg.id, msg.text, msg.others);
  } catch (err) {
    post({ type: 'error', id: msg.type === 'compare' ? msg.id : undefined, message: err instanceof Error ? err.message : String(err) });
  }
};
