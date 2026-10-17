import type { InitProgressReport, WebWorkerMLCEngine } from '@mlc-ai/web-llm';
import { EngineError, type Engine } from '../types';
import { modelId, type LocalModel } from './models';

export interface LoadProgress {
  phase: 'download' | 'cache' | 'gpu';
  fraction: number;
  /** MB fetched so far, when downloading. */
  fetchedMB?: number;
  text: string;
}

export function parseProgress(report: InitProgressReport): LoadProgress {
  const fetched = /([\d.]+)\s*MB fetched/.exec(report.text);
  if (/Fetching param cache/i.test(report.text)) {
    return { phase: 'download', fraction: report.progress, fetchedMB: fetched ? Number(fetched[1]) : undefined, text: report.text };
  }
  if (/Loading model from cache/i.test(report.text)) return { phase: 'cache', fraction: report.progress, text: report.text };
  return { phase: 'gpu', fraction: report.progress, text: report.text };
}

let worker: Worker | null = null;
let engine: WebWorkerMLCEngine | null = null;
let loadedId: string | null = null;

/** Asks the browser not to evict the cached weights under storage pressure. */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function isModelCached(model: LocalModel, f16: boolean): Promise<boolean> {
  try {
    const { hasModelInCache } = await import('@mlc-ai/web-llm');
    return await hasModelInCache(modelId(model, f16));
  } catch {
    return false;
  }
}

export async function loadLocalEngine(
  model: LocalModel,
  f16: boolean,
  onProgress: (p: LoadProgress) => void,
): Promise<Engine> {
  const id = modelId(model, f16);
  const webllm = await import('@mlc-ai/web-llm');

  if (!engine || loadedId !== id) {
    worker?.terminate();
    worker = new Worker(new URL('./llm.worker.ts', import.meta.url), { type: 'module' });
    try {
      engine = await webllm.CreateWebWorkerMLCEngine(worker, id, {
        initProgressCallback: (r) => onProgress(parseProgress(r)),
      });
      loadedId = id;
    } catch (err) {
      worker.terminate();
      worker = null;
      engine = null;
      loadedId = null;
      const message = err instanceof Error ? err.message : String(err);
      if (/quota/i.test(message)) {
        throw new EngineError('bad-request', 'Not enough browser storage for the model. Free some space or use an API key.');
      }
      throw new EngineError('bad-request', `The on-device model failed to load: ${message}`);
    }
  }

  const active = engine!;
  return {
    kind: 'local',
    label: model.label,
    concurrency: 1,
    granularity: 'sentence',
    async complete(req) {
      if (req.signal.aborted) throw new EngineError('aborted', 'Stopped');
      const onAbort = () => active.interruptGenerate();
      req.signal.addEventListener('abort', onAbort, { once: true });
      try {
        await active.resetChat();
        const stream = await active.chat.completions.create({
          stream: true,
          temperature: 0.6,
          max_tokens: req.maxTokens ?? 1200,
          messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user },
          ],
        });
        let text = '';
        for await (const part of stream) {
          text += part.choices[0]?.delta?.content ?? '';
          req.onProgress?.(text.length);
        }
        if (req.signal.aborted) throw new EngineError('aborted', 'Stopped');
        return text;
      } catch (err) {
        if (err instanceof EngineError) throw err;
        if (req.signal.aborted) throw new EngineError('aborted', 'Stopped');
        const message = err instanceof Error ? err.message : String(err);
        if (/device (was )?lost/i.test(message)) {
          engine = null;
          loadedId = null;
          throw new EngineError('bad-request', 'The graphics card reset. Press Resume to reload the model.');
        }
        throw new EngineError('bad-request', `The on-device model failed: ${message}`);
      } finally {
        req.signal.removeEventListener('abort', onAbort);
      }
    },
  };
}

export function unloadLocalEngine(): void {
  void engine?.unload();
  worker?.terminate();
  worker = null;
  engine = null;
  loadedId = null;
}
