import type { InitProgressReport, WebWorkerMLCEngine } from '@mlc-ai/web-llm';
import { EngineError, type CompletionRequest, type Engine } from '../types';
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

/** Errors WebGPU raises when buffers don't fit, at load or on the first generation. */
const OUT_OF_MEMORY = /out of memory|mapAsync|allocat|device (was )?lost|createBuffer/i;

/** The model is no longer on the GPU: WebLLM unloaded it after a device loss, or the device itself is gone. */
const MODEL_GONE = /ModelNotLoaded|not loaded|device (was )?lost/i;

/** Qwen3 thinks before answering unless told not to; a rewrite doesn't need it. */
const thinkingOff = (model: LocalModel) => (model.base.startsWith('Qwen3') ? { extra_body: { enable_thinking: false } } : {});

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
    const w = new Worker(new URL('./llm.worker.ts', import.meta.url), { type: 'module' });
    worker = w;
    try {
      const loaded = await webllm.CreateWebWorkerMLCEngine(w, id, {
        initProgressCallback: (r) => onProgress(parseProgress(r)),
      });
      // Pause during the load unloads it; don't resurrect a terminated worker.
      if (worker !== w) throw new EngineError('aborted', 'Stopped');
      // Weights can load and still not fit once generation allocates its buffers.
      // One token now turns that into a load failure the caller can recover from.
      await loaded.chat.completions.create({ messages: [{ role: 'user', content: 'Hi' }], max_tokens: 1, ...thinkingOff(model) });
      await loaded.resetChat();
      engine = loaded;
      loadedId = id;
    } catch (err) {
      w.terminate();
      if (err instanceof EngineError) throw err;
      if (worker === w) {
        worker = null;
        engine = null;
        loadedId = null;
      }
      const message = err instanceof Error ? err.message : String(err);
      if (/quota/i.test(message)) {
        throw new EngineError('bad-request', 'Not enough browser storage for the model. Free some space or use an API key.');
      }
      if (OUT_OF_MEMORY.test(message)) throw new EngineError('bad-request', `${model.label} doesn't fit in this graphics card's memory.`, { provider: 'memory' });
      throw new EngineError('bad-request', `The on-device model failed to load: ${message}`);
    }
  }

  const active = engine!;
  const generate = async (req: CompletionRequest): Promise<string> => {
    await active.resetChat();
    const stream = await active.chat.completions.create({
      stream: true,
      temperature: req.temperature ?? 0.6,
      max_tokens: req.maxTokens ?? 1200,
      ...thinkingOff(model),
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: req.user },
      ],
    });
    let text = '';
    // Read to the end even after a pause: WebLLM serves one request at a time and only
    // frees itself when a stream finishes. interruptGenerate makes that end quickly;
    // leaving the loop early would leave the next request waiting forever.
    for await (const part of stream) {
      if (req.signal.aborted) continue;
      text += part.choices[0]?.delta?.content ?? '';
      req.onProgress?.(text.length);
    }
    return text;
  };

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
        let text: string;
        try {
          text = await generate(req);
        } catch (err) {
          if (req.signal.aborted || !MODEL_GONE.test(errorText(err))) throw err;
          // The GPU dropped the weights (a device reset, often after sitting idle).
          // They're still in the browser cache, so reload and try this request once more.
          await active.reload(id);
          text = await generate(req);
        }
        if (req.signal.aborted) throw new EngineError('aborted', 'Stopped');
        return text;
      } catch (err) {
        if (err instanceof EngineError) throw err;
        if (req.signal.aborted) throw new EngineError('aborted', 'Stopped');
        const message = errorText(err);
        if (MODEL_GONE.test(message)) {
          // Forget this engine so the next attempt loads the model from scratch.
          if (engine === active) unloadLocalEngine();
          throw new EngineError('bad-request', 'The graphics card dropped the model. Press Try again to reload it.');
        }
        throw new EngineError('bad-request', `The on-device model failed: ${message}`);
      } finally {
        req.signal.removeEventListener('abort', onAbort);
      }
    },
  };
}

const errorText = (err: unknown) => (err instanceof Error ? `${err.name}: ${err.message}` : String(err));

export function unloadLocalEngine(): void {
  void engine?.unload();
  worker?.terminate();
  worker = null;
  engine = null;
  loadedId = null;
}
