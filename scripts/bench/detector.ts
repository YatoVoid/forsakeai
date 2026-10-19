// Times the weight-only int8 desklib detector on WebGPU. Needs `npm run dev` and
// scripts/static-cors.mjs serving ~/.cache/forsakeai-eval/models on :8099.
import { AutoModelForSequenceClassification, AutoTokenizer, env } from '@huggingface/transformers';

const log = (s: string) => {
  document.getElementById('log')!.textContent += s + '\n';
  console.log(s);
};

async function main() {
  const host = 'http://127.0.0.1:8099/';
  env.allowLocalModels = false;
  env.remoteHost = host;
  env.remotePathTemplate = '{model}/';
  const { paras, ref } = (await (await fetch(host + 'bench.json')).json()) as { paras: string[]; ref: number[] };
  let t = performance.now();
  log('page up');
  const progress_callback = (p: { status: string; file?: string; progress?: number }) => {
    if (p.status !== 'progress') log(`${p.status} ${p.file ?? ''}`);
  };
  const tok = await AutoTokenizer.from_pretrained('q8w', { progress_callback });
  log('tokenizer ready');
  const model = await AutoModelForSequenceClassification.from_pretrained('q8w', { dtype: 'fp32', device: 'webgpu', progress_callback });
  log(`loaded ${Math.round(performance.now() - t)} ms`);

  const one = async (texts: string[]) => {
    const enc = tok(texts, { padding: true, truncation: true, max_length: 512 });
    const out = (await model(enc)) as { logits: { data: Float32Array } };
    return Array.from(out.logits.data);
  };
  await one([paras[0]!]);
  t = performance.now();
  const got: number[] = [];
  for (const p of paras) got.push((await one([p]))[0]!);
  const each = (performance.now() - t) / paras.length;
  const diffs = got.map((g, i) => Math.abs(g - ref[i]!));
  log(`single: ${each.toFixed(0)} ms/para, mean|d| ${(diffs.reduce((a, b) => a + b) / diffs.length).toFixed(3)} max ${Math.max(...diffs).toFixed(3)}`);

  // Leave-one-out for one paragraph, as one padded batch.
  const sentences = paras[1]!.split(/(?<=[.!?])\s+/);
  const variants = sentences.map((_, i) => sentences.filter((__, k) => k !== i).join(' '));
  t = performance.now();
  const batched = await one(variants);
  log(`batch of ${variants.length}: ${Math.round(performance.now() - t)} ms`);
  t = performance.now();
  const serial: number[] = [];
  for (const v of variants) serial.push((await one([v]))[0]!);
  log(`serial ${variants.length}: ${Math.round(performance.now() - t)} ms, batch vs serial max|d| ${Math.max(...batched.map((b, i) => Math.abs(b - serial[i]!))).toFixed(3)}`);
  log('done');
}
main().catch((e) => log('ERROR ' + (e?.stack ?? e)));
