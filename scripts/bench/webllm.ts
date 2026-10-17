// Dev-only page: exposes WebLLM to a Playwright driver so the rewrite pipeline
// can be evaluated on the real on-device models.
import { CreateMLCEngine, type MLCEngine } from '@mlc-ai/web-llm';

let engine: MLCEngine | null = null;
const log = (t: string) => (document.getElementById('log')!.textContent = t);

interface Opts {
  temperature?: number;
  top_p?: number;
  maxTokens?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  noThinking?: boolean;
}

Object.assign(window, {
  bench: {
    async load(id: string) {
      await engine?.unload();
      engine = await CreateMLCEngine(id, { initProgressCallback: (r) => log(r.text) });
      return true;
    },
    async complete(system: string, user: string, opts: Opts = {}) {
      await engine!.resetChat();
      const started = performance.now();
      const r = await engine!.chat.completions.create({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: opts.temperature ?? 0.6,
        top_p: opts.top_p,
        frequency_penalty: opts.frequency_penalty,
        presence_penalty: opts.presence_penalty,
        max_tokens: opts.maxTokens ?? 400,
        ...(opts.noThinking ? { extra_body: { enable_thinking: false } } : {}),
      });
      return { text: r.choices[0]?.message.content ?? '', ms: performance.now() - started, tokens: r.usage?.completion_tokens ?? 0 };
    },
  },
});
log('ready');
