import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EngineError } from '../src/engines/types';

interface FakeEngine {
  loaded: boolean;
  reloadFails: boolean;
  reloads: number;
  chat: { completions: { create: (req: { stream?: boolean }) => Promise<unknown> } };
  resetChat(): Promise<void>;
  reload(id: string): Promise<void>;
  interruptGenerate(): void;
  unload(): Promise<void>;
}

const engines: FakeEngine[] = [];

function fakeEngine(): FakeEngine {
  const e: FakeEngine = {
    loaded: true,
    reloadFails: false,
    reloads: 0,
    chat: {
      completions: {
        async create(req) {
          if (!e.loaded) throw Object.assign(new Error('Model not loaded before trying to complete ChatCompletionRequest.'), { name: 'ModelNotLoadedError' });
          if (!req.stream) return { choices: [{ message: { content: 'H' } }] };
          return (async function* () {
            yield { choices: [{ delta: { content: 'Rewritten.' } }] };
          })();
        },
      },
    },
    async resetChat() {},
    async reload() {
      e.reloads++;
      if (e.reloadFails) throw new Error('device was lost');
      e.loaded = true;
    },
    interruptGenerate() {},
    async unload() {},
  };
  engines.push(e);
  return e;
}

vi.mock('@mlc-ai/web-llm', () => ({ CreateWebWorkerMLCEngine: vi.fn(async () => fakeEngine()), hasModelInCache: vi.fn() }));
vi.stubGlobal('Worker', class { terminate() {} });

const { loadLocalEngine, unloadLocalEngine } = await import('../src/engines/local/engine');
const { LOCAL_MODELS } = await import('../src/engines/local/models');
const request = () => ({ system: 's', user: 'u', signal: new AbortController().signal });

describe('on-device engine after the GPU drops the model', () => {
  beforeEach(() => {
    unloadLocalEngine();
    engines.length = 0;
  });

  it('reloads the cached model and finishes the request', async () => {
    const engine = await loadLocalEngine(LOCAL_MODELS[0]!, true, () => {});
    engines[0]!.loaded = false;
    await expect(engine.complete(request())).resolves.toBe('Rewritten.');
    expect(engines[0]!.reloads).toBe(1);
  });

  it('forgets a dead engine so Try again loads a fresh one', async () => {
    const engine = await loadLocalEngine(LOCAL_MODELS[0]!, true, () => {});
    engines[0]!.loaded = false;
    engines[0]!.reloadFails = true;
    const err = await engine.complete(request()).catch((e) => e);
    expect(err).toBeInstanceOf(EngineError);
    expect(err.message).toContain('Press Try again');
    const again = await loadLocalEngine(LOCAL_MODELS[0]!, true, () => {});
    expect(engines).toHaveLength(2);
    await expect(again.complete(request())).resolves.toBe('Rewritten.');
  });

  it('still stops on pause instead of reloading', async () => {
    const engine = await loadLocalEngine(LOCAL_MODELS[0]!, true, () => {});
    const controller = new AbortController();
    controller.abort();
    await expect(engine.complete({ ...request(), signal: controller.signal })).rejects.toThrow('Stopped');
    expect(engines[0]!.reloads).toBe(0);
  });
});
