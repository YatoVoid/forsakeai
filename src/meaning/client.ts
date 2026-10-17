import type { MeaningScorer } from '../pipeline/run';
import { MEANING_MODEL, type MeaningRequest, type MeaningResponse } from './protocol';

let worker: Worker | null = null;
let loading: Promise<MeaningScorer> | null = null;
let nextId = 0;

export async function isMeaningCached(): Promise<boolean> {
  try {
    const cache = await caches.open('transformers-cache');
    return !!(await cache.match(`https://huggingface.co/${MEANING_MODEL}/resolve/main/onnx/model_int8.onnx`));
  } catch {
    return false;
  }
}

function scorerFor(w: Worker): MeaningScorer {
  return {
    similarity: (text, others) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        const onMessage = (e: MessageEvent<MeaningResponse>) => {
          const m = e.data;
          if ((m.type !== 'similarity' && m.type !== 'error') || m.id !== id) return;
          w.removeEventListener('message', onMessage);
          if (m.type === 'error') reject(new Error(m.message));
          else resolve(m.scores);
        };
        w.addEventListener('message', onMessage);
        w.postMessage({ type: 'compare', id, text, others } satisfies MeaningRequest);
      }),
  };
}

/** Loads the embedding model once per page. Rejects if it can't download; callers fall back to the word check. */
export function loadMeaning(onProgress: (loadedMB: number, totalMB: number) => void): Promise<MeaningScorer> {
  if (loading) return loading;
  const w = new Worker(new URL('./meaning.worker.ts', import.meta.url), { type: 'module' });
  const ortBase = new URL(`${import.meta.env.BASE_URL}ort/`, location.origin).href;
  loading = new Promise<MeaningScorer>((resolve, reject) => {
    const onMessage = (e: MessageEvent<MeaningResponse>) => {
      const m = e.data;
      if (m.type === 'download') onProgress(m.loaded / 2 ** 20, m.total / 2 ** 20);
      else if (m.type === 'ready' || m.type === 'error') {
        w.removeEventListener('message', onMessage);
        w.removeEventListener('error', onError);
        if (m.type === 'ready') resolve(scorerFor(w));
        else reject(new Error(m.message));
      }
    };
    const onError = (e: ErrorEvent) => {
      w.removeEventListener('message', onMessage);
      reject(new Error(e.message || 'The meaning check crashed.'));
    };
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    w.postMessage({ type: 'load', ortBase } satisfies MeaningRequest);
  });
  worker = w;
  loading.catch(() => {
    worker?.terminate();
    worker = null;
    loading = null;
  });
  return loading;
}
