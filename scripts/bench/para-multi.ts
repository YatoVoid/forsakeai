// Experiment: several paragraph-rewrite setups on one loaded model.
// Usage: node --import ./scripts/ts-register.mjs scripts/bench/para-multi.ts <model> <configs.json> <file.md>...
// configs.json: [{ "name": "...", "system": "...", "passes": 1, "temperature": 0.6, "repeat": 1 }]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename } from 'node:path';
import { webllmEngine } from './browser-engine';

interface Config { name: string; system: string; passes?: number; temperature?: number; top_p?: number; repeat?: number }
const [model, configPath, ...files] = process.argv.slice(2);
const configs = JSON.parse(readFileSync(configPath!, 'utf8')) as Config[];
const engine = await webllmEngine(model!, { noThinking: true });
const signal = new AbortController().signal;

for (const c of configs) {
  for (let r = 0; r < (c.repeat ?? 1); r++) {
    const dir = `${homedir()}/.cache/forsakeai-eval/runs/${c.name}${c.repeat && c.repeat > 1 ? `-r${r}` : ''}`;
    mkdirSync(dir, { recursive: true });
    const t = Date.now();
    for (const f of files) {
      let paras = readFileSync(f, 'utf8').split(/\n{2,}/);
      for (let pass = 0; pass < (c.passes ?? 1); pass++) {
        const next: string[] = [];
        for (const p of paras) {
          if (p.startsWith('#') || p.split(/\s+/).length < 12) {
            next.push(p);
            continue;
          }
          const reply = await engine.complete({ system: c.system, user: `Paragraph:\n${p}`, signal, maxTokens: Math.ceil(p.length / 2) + 64, ...({ temperature: c.temperature, top_p: c.top_p } as object) });
          next.push(reply.replace(/<think>[\s\S]*?<\/think>/g, '').trim() || p);
        }
        paras = next;
      }
      writeFileSync(`${dir}/${basename(f, '.md')}.txt`, paras.join('\n\n'));
    }
    console.log(c.name, r, Math.round((Date.now() - t) / 1000), 's');
  }
}
await engine.close();
