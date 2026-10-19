import { units, windowText, type CheckBlock, type Scorer } from './analyze';

export interface Pick {
  text: string;
  /** How far the window's logit fell with this version in place. */
  gain: number;
}

/**
 * Scores every version of each flagged sentence in its window and keeps the one the
 * detector finds most human, one sentence at a time so later picks see earlier ones.
 * A sentence keeps its current text unless some version scores lower.
 */
export async function pickBest(
  blocks: CheckBlock[],
  versions: Map<string, string[]>,
  score: Scorer,
  onProgress?: (done: number, total: number) => void,
): Promise<Map<string, Pick>> {
  const chosen = new Map<string, Pick>();
  const total = [...versions.values()].reduce((n, v) => n + v.length + 1, 0);
  let done = 0;
  for (const u of units(blocks)) {
    const edits = new Map<number, string>();
    for (const [k, s] of u.sentences.entries()) {
      const options = versions.get(s.id);
      if (!options?.length) continue;
      const all = [s.text, ...options];
      const logits = await score(
        all.map((text) => windowText(u, new Map([...edits, [k, text]]))),
        (n) => onProgress?.((done += n), total),
      );
      let best = 0;
      for (let i = 1; i < all.length; i++) if (logits[i]! < logits[best]!) best = i;
      if (best === 0) continue;
      edits.set(k, all[best]!);
      chosen.set(s.id, { text: all[best]!, gain: logits[0]! - logits[best]! });
    }
  }
  return chosen;
}
