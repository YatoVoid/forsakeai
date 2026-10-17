import { DOWNLOAD_MB, MAX_TOKENS, OBSERVER, PERFORMER, type DetectorDevice, type WorkerRequest, type WorkerResponse } from './protocol';

export type CheckerProgress =
  | { phase: 'download'; loadedMB: number; totalMB: number }
  | { phase: 'scoring'; done: number; total: number };

export interface CheckerResult {
  device: DetectorDevice;
  tokens: number;
  score: number;
  sentences: Array<{ id: string; score: number | undefined }>;
}

let worker: Worker | null = null;
let ready: DetectorDevice | null = null;

export async function pickDevice(): Promise<DetectorDevice> {
  try {
    const adapter = await navigator.gpu?.requestAdapter();
    if (adapter?.features.has('shader-f16')) return 'webgpu';
  } catch {
    // Fall through to WASM.
  }
  return 'wasm';
}

export const downloadMB = (device: DetectorDevice) => DOWNLOAD_MB[device];

/** Whether the model files for this device are already in the browser cache. */
export async function isCheckerCached(device: DetectorDevice): Promise<boolean> {
  try {
    const cache = await caches.open('transformers-cache');
    const file = device === 'webgpu' ? 'model_q4f16.onnx' : 'model_int8.onnx';
    const urls = [OBSERVER, PERFORMER].map((m) => `https://huggingface.co/${m}/resolve/main/onnx/${file}`);
    const hits = await Promise.all(urls.map((u) => cache.match(u)));
    return hits.every(Boolean);
  } catch {
    return false;
  }
}

function request(msg: WorkerRequest, onProgress: (p: CheckerProgress) => void): Promise<WorkerResponse> {
  return new Promise((resolve, reject) => {
    const w = worker!;
    const onMessage = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data;
      if (m.type === 'download') onProgress({ phase: 'download', loadedMB: m.loaded / 2 ** 20, totalMB: m.total / 2 ** 20 });
      else if (m.type === 'scoring') onProgress({ phase: 'scoring', done: m.done, total: m.total });
      else {
        w.removeEventListener('message', onMessage);
        w.removeEventListener('error', onError);
        if (m.type === 'error') reject(new Error(m.message));
        else resolve(m);
      }
    };
    const onError = (e: ErrorEvent) => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      reject(new Error(e.message || 'The checker crashed.'));
    };
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    w.postMessage(msg);
  });
}

export async function loadChecker(device: DetectorDevice, onProgress: (p: CheckerProgress) => void): Promise<void> {
  if (ready === device) return;
  worker?.terminate();
  worker = new Worker(new URL('./detector.worker.ts', import.meta.url), { type: 'module' });
  const ortBase = new URL(`${import.meta.env.BASE_URL}ort/`, location.origin).href;
  try {
    await request({ type: 'load', device, ortBase }, onProgress);
    ready = device;
  } catch (err) {
    worker.terminate();
    worker = null;
    ready = null;
    throw err;
  }
}

export async function runChecker(
  sentences: Array<{ id: string; text: string }>,
  onProgress: (p: CheckerProgress) => void,
): Promise<CheckerResult> {
  if (!worker || !ready) throw new Error('Load the checker first.');
  const result = await request({ type: 'score', sentences, maxTokens: MAX_TOKENS }, onProgress);
  if (result.type !== 'result') throw new Error('Unexpected reply from the checker.');
  return { device: result.device, tokens: result.tokens, score: result.score, sentences: result.sentences };
}
