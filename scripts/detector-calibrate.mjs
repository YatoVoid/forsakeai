// Fits the checker's score → AI-likelihood mapping and writes the benchmark.
// Usage: node scripts/detector-calibrate.mjs <device>=<scores.jsonl> [...] [--out src/detector/calibration.json] [--report docs/detector-benchmark.md]
//   Each scores line comes from scripts/detector-score.mjs and must carry label, lang, split ("fit" or "test") and score.
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args.splice(i, 2)[1] : fallback;
};
const outPath = flag('--out', 'src/detector/calibration.json');
const reportPath = flag('--report', 'docs/detector-benchmark.md');
/** Share of fit-half human texts allowed under the "likely AI" cutoff. */
const HUMAN_FLAG_RATE = 0.02;
/** Share of fit-half AI texts allowed over the "likely human" cutoff. */
const AI_PASS_RATE = 0.05;
const MIN_PER_CLASS = 20;

function quantile(values, q) {
  const v = [...values].sort((a, b) => a - b);
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

const NAMES = { eng: 'English', deu: 'German', ita: 'Italian', rus: 'Russian', bul: 'Bulgarian', cmn: 'Chinese', arb: 'Arabic', urd: 'Urdu', ind: 'Indonesian' };

function fitLogistic(points) {
  // Class-balanced logistic regression P(ai) = sigmoid(b0 + b1 * s), fitted by Newton's method,
  // then rewritten as 1 / (1 + exp(slope * (s - midpoint))).
  const nAi = points.filter((p) => p.y === 1).length;
  const nHu = points.length - nAi;
  const weight = (y) => (y === 1 ? points.length / (2 * nAi) : points.length / (2 * nHu));
  let b0 = 0;
  let b1 = 0;
  for (let it = 0; it < 100; it++) {
    let g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0;
    for (const { s, y } of points) {
      const p = 1 / (1 + Math.exp(-(b0 + b1 * s)));
      const w = weight(y);
      g0 += w * (y - p);
      g1 += w * (y - p) * s;
      const v = w * p * (1 - p) + 1e-9;
      h00 += v;
      h01 += v * s;
      h11 += v * s * s;
    }
    const det = h00 * h11 - h01 * h01;
    const d0 = (h11 * g0 - h01 * g1) / det;
    const d1 = (h00 * g1 - h01 * g0) / det;
    b0 += d0;
    b1 += d1;
    if (Math.abs(d0) + Math.abs(d1) < 1e-9) break;
  }
  const slope = -b1;
  return { slope, midpoint: b0 / slope };
}

function auc(points) {
  const ai = points.filter((p) => p.y === 1).map((p) => p.s);
  const hu = points.filter((p) => p.y === 0).map((p) => p.s);
  let wins = 0;
  for (const a of ai) for (const h of hu) wins += a < h ? 1 : a === h ? 0.5 : 0;
  return wins / (ai.length * hu.length);
}

const builds = {};
const rows = [];
for (const arg of args) {
  const [device, file] = arg.split('=');
  const data = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((d) => Number.isFinite(d.score));
  builds[device] = {};
  for (const lang of [...new Set(data.map((d) => d.lang))].sort()) {
    const pts = (split) => data.filter((d) => d.lang === lang && d.split === split).map((d) => ({ s: d.score, y: d.label === 'ai' ? 1 : 0 }));
    const fit = pts('fit');
    const test = pts('test');
    const count = (p, y) => p.filter((x) => x.y === y).length;
    if (count(fit, 0) < MIN_PER_CLASS / 2 || count(fit, 1) < MIN_PER_CLASS / 2 || count(test, 0) < MIN_PER_CLASS / 2 || count(test, 1) < MIN_PER_CLASS / 2) continue;
    const params = fitLogistic(fit);
    const aiBelow = quantile(fit.filter((x) => x.y === 0).map((x) => x.s), HUMAN_FLAG_RATE);
    const humanAbove = Math.max(aiBelow, quantile(fit.filter((x) => x.y === 1).map((x) => x.s), 1 - AI_PASS_RATE));
    const fpr = test.filter((x) => x.y === 0 && x.s < aiBelow).length / count(test, 0);
    const tpr = test.filter((x) => x.y === 1 && x.s < aiBelow).length / count(test, 1);
    const humanRight = test.filter((x) => x.y === 0 && x.s > humanAbove).length / count(test, 0);
    const entry = {
      slope: Number(params.slope.toFixed(3)),
      midpoint: Number(params.midpoint.toFixed(4)),
      auc: Number(auc(test).toFixed(3)),
      aiBelow: Number(aiBelow.toFixed(4)),
      humanAbove: Number(humanAbove.toFixed(4)),
      humanCleared: Number(humanRight.toFixed(3)),
      falsePositiveRate: Number(fpr.toFixed(3)),
      truePositiveRate: Number(tpr.toFixed(3)),
      humanTexts: count(fit, 0) + count(test, 0),
      aiTexts: count(fit, 1) + count(test, 1),
    };
    builds[device][lang] = entry;
    rows.push({ device, lang, ...entry });
  }
}

// sd of a mean over n tokens ≈ noise / sqrt(n). Two halves of n/2 tokens differ with sd 2·noise/sqrt(n).
const halves = args
  .flatMap((arg) => readFileSync(arg.split('=')[1], 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)))
  .filter((d) => Number.isFinite(d.firstHalf) && Number.isFinite(d.secondHalf));
const noise = halves.length >= 30
  ? Math.sqrt(halves.reduce((a, d) => a + ((d.firstHalf - d.secondHalf) * Math.sqrt(d.tokens)) ** 2 / 4, 0) / halves.length)
  : 0.5;
const calibration = { created: new Date().toISOString().slice(0, 10), noise: Number(noise.toFixed(3)), builds };
writeFileSync(outPath, JSON.stringify(calibration, null, 2) + '\n');

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const report = `# Checker benchmark

Generated ${calibration.created} by \`scripts/detector-calibrate.mjs\`. Score noise constant: ${calibration.noise} (from ${halves.length} texts split in half). Model pair: Qwen2.5-0.5B (observer) and Qwen2.5-0.5B-Instruct (performer), Binoculars score, first 384 tokens of each text.

Data: a stratified sample of the dev split of the COLING 2025 multilingual machine-generated text task (\`Jinyan1/COLING_2025_MGT_multingual\`). English AI texts are limited to chat models (GPT-3.5, GPT-4, GPT-4o, Llama 3, Mixtral, Gemma, Cohere). Each language is split in half: one half fits the curve, the other half produces the numbers below.

The checker only says "likely AI-generated" below a cutoff that ${HUMAN_FLAG_RATE * 100}% of the fit-half human texts fall under, and "likely human-written" above one that ${AI_PASS_RATE * 100}% of the fit-half AI texts exceed. Everything between is "unclear". On the held-out half: "Flags human as AI" is the false-positive rate, "Catches AI" is the share of AI texts called likely AI, and "Clears human" is the share of human texts called likely human.

| Build | Language | Human texts | AI texts | AUC | Flags human as AI | Catches AI | Clears human |
| --- | --- | --- | --- | --- | --- | --- | --- |
${rows.map((r) => `| ${r.device} | ${NAMES[r.lang] ?? r.lang} | ${r.humanTexts} | ${r.aiTexts} | ${r.auc} | ${pct(r.falsePositiveRate)} | ${pct(r.truePositiveRate)} | ${pct(r.humanCleared)} |`).join('\n')}

The held-out halves are small (about 15–75 human texts per language), so a 0% rate means none were seen, and the true rate could still be a few percent. A language whose held-out false-positive rate is above 5% never gets a "likely AI-generated" verdict in the app.

Not measured: Spanish, French and Portuguese (no human texts in the dataset), text written by non-native English speakers, text that was AI-written and then edited by a person, and comparison against ZeroGPT or GPTZero. Languages missing from the table are shown to users as "not tested yet" with low confidence.
`;
writeFileSync(reportPath, report);
console.log(report);
