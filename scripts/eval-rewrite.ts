// Runs the rewrite pipeline on a document against an OpenAI-compatible server and
// reports what happened to every stiff sentence.
// Usage: node --import ./scripts/ts-register.mjs scripts/eval-rewrite.ts <file.md> [baseUrl] [model] [out.json]
// NO_MEANING=1 skips the embedding check and falls back to word overlap. SCOPE=all rewrites every sentence.
import { readFileSync, writeFileSync } from 'node:fs';
import { createByokEngine } from '../src/engines/byok/providers';
import type { Engine } from '../src/engines/types';
import { detectLang } from '../src/lib/lang';
import { parse, serialize } from '../src/pipeline/parse';
import { rulePass } from '../src/pipeline/rulepass';
import { rewriteDoc, type MeaningScorer } from '../src/pipeline/run';
import { MEANING_MODEL } from '../src/meaning/protocol';

const [file, baseUrl = 'http://127.0.0.1:8790/v1', model = 'Qwen2.5-1.5B-Instruct', out] = process.argv.slice(2);
if (!file) throw new Error('usage: eval-rewrite.ts <file.md> [baseUrl] [model] [out.json]');
const text = readFileSync(file, 'utf8');
const doc = parse(text, detectLang);
rulePass(doc);

const inner = createByokEngine({ provider: 'local', key: '', model, baseUrl });
let calls = 0;
const log: Array<{ sentence: string; reply: string }> = [];
const engine: Engine = {
  ...inner,
  async complete(req) {
    calls++;
    const reply = await inner.complete(req);
    log.push({ sentence: /Sentence to rewrite: (.*)/.exec(req.user)?.[1] ?? '(passage)', reply: reply.trim() });
    if (process.env.VERBOSE) console.log(`  · ${reply.trim().split('\n')[0]}`);
    return reply;
  },
};

let meaning: MeaningScorer | null = null;
if (!process.env.NO_MEANING) {
  const { pipeline } = await import('@huggingface/transformers');
  const embed = await pipeline('feature-extraction', MEANING_MODEL, { dtype: 'int8' });
  meaning = {
    async similarity(text, others) {
      const out = await embed([text, ...others], { pooling: 'mean', normalize: true });
      const rows = out.tolist() as number[][];
      return rows.slice(1).map((r) => r.reduce((sum, v, i) => sum + v * rows[0]![i]!, 0));
    },
  };
}

const started = performance.now();
await rewriteDoc(doc, engine, { register: 'keep', scope: process.env.SCOPE === 'all' ? 'all' : 'stiff', signal: new AbortController().signal, detect: detectLang, meaning });
const seconds = (performance.now() - started) / 1000;

const sentences = doc.blocks.flatMap((b) => b.sentences).filter((s) => s.stiff || process.env.SCOPE === 'all');
const rows = sentences.map((s) => ({ status: s.status, text: s.text, rewrite: s.rewrite, note: s.note }));
for (const r of rows) {
  console.log(`\n[${r.status}] ${r.text}`);
  if (r.rewrite) console.log(`  -> ${r.rewrite}`);
  if (r.note) console.log(`  !! ${r.note}`);
}
const rewritten = rows.filter((r) => r.status === 'rewritten').length;
const summary = { stiff: rows.length, rewritten, kept: rows.length - rewritten, calls, seconds: Math.round(seconds) };
console.log('\n' + JSON.stringify(summary));
if (out) writeFileSync(out, JSON.stringify({ summary, rows, log, output: serialize(doc) }, null, 2));
