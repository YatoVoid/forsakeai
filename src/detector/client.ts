import { DETECTOR_HOST, DETECTOR_MODEL, DOWNLOAD_MB, type DetectorDevice, type WorkerRequest, type WorkerResponse } from './protocol';

export type LoadProgress = { loadedMB: number; totalMB: number };

let worker: Worker | null = null;
let ready: DetectorDevice | null = null;
let nextId = 1;

export async function pickDevice(): Promise<DetectorDevice> {
  try {
    if (await navigator.gpu?.requestAdapter()) return 'webgpu';
  } catch {
    // Fall through to WASM.
  }
  return 'wasm';
}

export const downloadMB = () => DOWNLOAD_MB;

const weightsUrl = () =>
  DETECTOR_HOST ? `${DETECTOR_HOST}${DETECTOR_MODEL}/onnx/model.onnx_data` : `https://huggingface.co/${DETECTOR_MODEL}/resolve/main/onnx/model.onnx_data`;

/** Whether the model weights are already in the browser cache. */
export async function isCheckerCached(): Promise<boolean> {
  try {
    const cache = await caches.open('transformers-cache');
    return !!(await cache.match(weightsUrl()));
  } catch {
    return false;
  }
}

function send(msg: WorkerRequest, onMessage: (m: WorkerResponse) => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const w = worker!;
    const done = () => {
      w.removeEventListener('message', listener);
      w.removeEventListener('error', onError);
    };
    const listener = (e: MessageEvent<WorkerResponse>) => {
      const m = e.data;
      if (m.type === 'error') {
        done();
        reject(new Error(m.message));
      } else if (onMessage(m)) {
        done();
        resolve();
      }
    };
    const onError = (e: ErrorEvent) => {
      done();
      reject(new Error(e.message || 'The checker crashed.'));
    };
    w.addEventListener('message', listener);
    w.addEventListener('error', onError);
    w.postMessage(msg);
  });
}

export async function loadChecker(device: DetectorDevice, onProgress: (p: LoadProgress) => void): Promise<void> {
  if (ready === device && worker) return;
  worker?.terminate();
  worker = new Worker(new URL('./detector.worker.ts', import.meta.url), { type: 'module' });
  const ortBase = new URL(`${import.meta.env.BASE_URL}ort/`, location.origin).href;
  try {
    await send({ type: 'load', device, ortBase, model: DETECTOR_MODEL, host: DETECTOR_HOST }, (m) => {
      if (m.type === 'download') onProgress({ loadedMB: m.loaded / 2 ** 20, totalMB: m.total / 2 ** 20 });
      return m.type === 'ready';
    });
    ready = device;
  } catch (err) {
    unloadChecker();
    throw err;
  }
}

/** Frees the detector's memory, so the rewrite model has the graphics card to itself. */
export function unloadChecker(): void {
  worker?.terminate();
  worker = null;
  ready = null;
}

export async function scoreTexts(texts: string[], onBatch?: (done: number) => void): Promise<number[]> {
  if (!worker || !ready) throw new Error('Load the checker first.');
  const id = nextId++;
  let logits: number[] = [];
  await send({ type: 'score', id, texts }, (m) => {
    if (m.type === 'batch' && m.id === id) onBatch?.(m.done);
    if (m.type === 'logits' && m.id === id) {
      logits = m.logits;
      return true;
    }
    return false;
  });
  return logits;
}
