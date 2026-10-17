/**
 * Binoculars (Hans et al., 2024): score = log-perplexity of the text under
 * the performer model, divided by the cross-perplexity between observer and
 * performer. Machine text scores low because both models find it unsurprising
 * relative to how surprised they'd expect each other to be.
 *
 * Pure math with no imports, so the browser worker and the Node calibration
 * script share it. Logits are row-major [positions × vocab].
 */

export interface TokenTerms {
  /** -log p_performer(actual next token) at each position. */
  ppl: Float64Array;
  /** Cross-entropy of observer's distribution against performer's at each position. */
  xppl: Float64Array;
}

function logSoftmaxRow(row: Float32Array, out: Float64Array): void {
  let max = -Infinity;
  for (let i = 0; i < row.length; i++) if (row[i]! > max) max = row[i]!;
  let sum = 0;
  for (let i = 0; i < row.length; i++) sum += Math.exp(row[i]! - max);
  const logZ = max + Math.log(sum);
  for (let i = 0; i < row.length; i++) out[i] = row[i]! - logZ;
}

/**
 * Per-position terms for predicting token t+1 from position t, so the result
 * has `ids.length - 1` entries. Both logit arrays must cover the same ids.
 */
export function tokenTerms(
  observer: Float32Array,
  performer: Float32Array,
  ids: ArrayLike<number>,
  vocab: number,
): TokenTerms {
  const n = ids.length - 1;
  const ppl = new Float64Array(Math.max(0, n));
  const xppl = new Float64Array(Math.max(0, n));
  const lpP = new Float64Array(vocab);
  const lpO = new Float64Array(vocab);
  for (let t = 0; t < n; t++) {
    logSoftmaxRow(performer.subarray(t * vocab, (t + 1) * vocab), lpP);
    logSoftmaxRow(observer.subarray(t * vocab, (t + 1) * vocab), lpO);
    ppl[t] = -lpP[Number(ids[t + 1])]!;
    let x = 0;
    for (let v = 0; v < vocab; v++) x -= Math.exp(lpO[v]!) * lpP[v]!;
    xppl[t] = x;
  }
  return { ppl, xppl };
}

const mean = (a: ArrayLike<number>, from = 0, to = a.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += a[i]!;
  return to > from ? s / (to - from) : NaN;
};

export function binocularsScore(terms: TokenTerms): number {
  return mean(terms.ppl) / mean(terms.xppl);
}

/** Merges terms from several windows of one document. */
export function concatTerms(parts: TokenTerms[]): TokenTerms {
  const total = parts.reduce((n, p) => n + p.ppl.length, 0);
  const ppl = new Float64Array(total);
  const xppl = new Float64Array(total);
  let at = 0;
  for (const p of parts) {
    ppl.set(p.ppl, at);
    xppl.set(p.xppl, at);
    at += p.ppl.length;
  }
  return { ppl, xppl };
}

/** Score for a token range, e.g. one sentence. Undefined when too short to mean anything. */
export function rangeScore(terms: TokenTerms, from: number, to: number, minTokens = 6): number | undefined {
  const a = Math.max(0, from);
  const b = Math.min(terms.ppl.length, to);
  if (b - a < minTokens) return undefined;
  return mean(terms.ppl, a, b) / mean(terms.xppl, a, b);
}
