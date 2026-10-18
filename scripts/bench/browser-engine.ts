// An Engine backed by WebLLM running in a real (headed) Chromium with WebGPU.
// Needs the Vite dev server (npm run dev) serving scripts/bench/webllm.html.
import { homedir } from 'node:os';
import { chromium, type Page } from 'playwright-core';
import type { Engine } from '../../src/engines/types';

export interface BenchOptions {
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  noThinking?: boolean;
}

export interface BrowserEngine extends Engine {
  close(): Promise<void>;
  stats: { calls: number; ms: number; tokens: number };
}

const GPU_ARGS = ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPUService', '--ignore-gpu-blocklist', '--ozone-platform=x11'];

export async function webllmEngine(modelId: string, opts: BenchOptions = {}, devUrl = 'http://localhost:5173/scripts/bench/webllm.html'): Promise<BrowserEngine> {
  // A persistent profile keeps downloaded weights between runs.
  const context = await chromium.launchPersistentContext(`${homedir()}/.cache/forsakeai-eval/chrome-profile`, {
    executablePath: process.env.CHROMIUM_GPU,
    headless: false,
    args: GPU_ARGS,
    viewport: { width: 500, height: 300 },
  });
  const page: Page = context.pages()[0] ?? (await context.newPage());
  await page.goto(devUrl);
  await page.waitForFunction(() => document.getElementById('log')?.textContent === 'ready');
  const t = Date.now();
  await page.evaluate((id) => (window as any).bench.load(id), modelId);
  console.error(`loaded ${modelId} in ${Math.round((Date.now() - t) / 1000)} s`);
  const stats = { calls: 0, ms: 0, tokens: 0 };
  return {
    kind: 'local',
    label: modelId,
    concurrency: 1,
    granularity: 'sentence',
    stats,
    async complete(req) {
      const r = await page.evaluate(
        ([system, user, o]) => (window as any).bench.complete(system, user, o),
        [req.system, req.user, { ...opts, ...pick(req as unknown as Record<string, unknown>), maxTokens: req.maxTokens ?? 1200 }] as const,
      );
      stats.calls++;
      stats.ms += r.ms;
      stats.tokens += r.tokens;
      return r.text;
    },
    close: () => context.close(),
  };
}

/** Per-request sampling overrides used by the experiments. */
function pick(req: Record<string, unknown>): BenchOptions {
  const out: BenchOptions = {};
  if (typeof req.temperature === 'number') out.temperature = req.temperature;
  if (typeof req.top_p === 'number') out.top_p = req.top_p;
  return out;
}
