// Scores texts with the same model pair and math the browser checker uses.
// Usage: node scripts/detector-score.mjs <file.jsonl> [dtype=int8] [maxTokens=512]
//   Each input line: {"id": "...", "label": "human"|"ai", "lang": "eng", "text": "..."}
//   Prints one JSON line per text with its Binoculars score.
//   DET_OBSERVER / DET_PERFORMER override the model pair, e.g. to compare the 1.5B models.
import { readFileSync } from 'node:fs';
import { AutoModelForCausalLM, AutoTokenizer, Tensor, env } from '@huggingface/transformers';
import { binocularsScore, concatTerms, rangeScore, tokenTerms } from '../src/detector/binoculars.ts';

const [file, dtype = 'int8', maxTokensArg = '512'] = process.argv.slice(2);
const maxTokens = Number(maxTokensArg);
env.cacheDir = process.env.HF_CACHE ?? `${process.env.HOME}/.cache/plainhand-models`;

const OBSERVER = process.env.DET_OBSERVER ?? 'onnx-community/Qwen2.5-0.5B';
const PERFORMER = process.env.DET_PERFORMER ?? 'onnx-community/Qwen2.5-0.5B-Instruct';
const WINDOW = 256;

const tokenizer = await AutoTokenizer.from_pretrained(PERFORMER);
const observer = await AutoModelForCausalLM.from_pretrained(OBSERVER, { dtype, device: 'cpu' });
const performer = await AutoModelForCausalLM.from_pretrained(PERFORMER, { dtype, device: 'cpu' });

async function logits(model, ids) {
  const input_ids = new Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]);
  const attention_mask = new Tensor('int64', new BigInt64Array(ids.length).fill(1n), [1, ids.length]);
  const out = await model({ input_ids, attention_mask });
  return out.logits;
}

for (const line of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
  const item = JSON.parse(line);
  const ids = Array.from(tokenizer.encode(item.text)).slice(0, maxTokens).map(Number);
  const parts = [];
  for (let start = 0; start < ids.length - 1; start += WINDOW) {
    const window = ids.slice(start, start + WINDOW + 1);
    const o = await logits(observer, window);
    const p = await logits(performer, window);
    const vocab = o.dims[2];
    parts.push(tokenTerms(o.data, p.data, window, vocab));
  }
  const terms = concatTerms(parts);
  const { text: _text, ...meta } = item;
  const half = Math.floor(terms.ppl.length / 2);
  const round = (x) => (x === undefined ? null : Number(x.toFixed(5)));
  console.log(
    JSON.stringify({
      ...meta,
      tokens: ids.length,
      score: round(binocularsScore(terms)),
      // Halves of the same text, used to measure how much a score moves with length.
      firstHalf: round(rangeScore(terms, 0, half)),
      secondHalf: round(rangeScore(terms, half, terms.ppl.length)),
    }),
  );
}
