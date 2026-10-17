import { splitSentences } from './parse';

export const VOICE_MIN_WORDS = 150;
export const VOICE_MAX_WORDS = 1500;
const EXCERPT_WORDS = 120;

export interface VoiceProfile {
  words: number;
  /** One-line description of the author's habits, for the system prompt. */
  brief: string;
  /** Short verbatim excerpts, for the user message. */
  excerpts: string[];
}

const wordsOf = (text: string) => text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? [];

function per1000(count: number, words: number): number {
  return words ? (count / words) * 1000 : 0;
}

/**
 * Turns a writing sample into a compact description plus a few excerpts.
 * Small on-device models have a 4k context, so the whole sample can't go in
 * the prompt; measurable habits travel better than a wall of text.
 */
export function buildVoiceProfile(sample: string, lang: string): VoiceProfile | null {
  const clean = sample.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim();
  const allWords = wordsOf(clean);
  if (allWords.length < VOICE_MIN_WORDS) return null;
  const text = allWords.length > VOICE_MAX_WORDS ? clean.split(/\s+/).slice(0, VOICE_MAX_WORDS).join(' ') : clean;
  const words = wordsOf(text);

  const sentences = text
    .split(/\n{2,}/)
    .flatMap((p) => splitSentences(p.replace(/\s+/g, ' '), lang).map((s) => s.text))
    .filter((s) => wordsOf(s).length > 0);
  const lengths = sentences.map((s) => wordsOf(s).length).sort((a, b) => a - b);
  const median = lengths[Math.floor(lengths.length / 2)] ?? 0;
  const short = lengths.filter((n) => n <= 8).length / Math.max(1, lengths.length);
  const long = lengths.filter((n) => n >= 25).length / Math.max(1, lengths.length);

  const traits: string[] = [];
  traits.push(`sentences usually around ${median} words`);
  if (short > 0.25 && long > 0.15) traits.push('mixes very short sentences with long ones');
  else if (short > 0.3) traits.push('likes short, punchy sentences');
  else if (long > 0.3) traits.push('writes long, flowing sentences');

  if (lang === 'eng') {
    const contractions = (text.match(/\b\w+(?:n't|'re|'ve|'ll|'m|'d|’re|’ve|’ll|’m|’d|n’t)\b/gi) ?? []).length;
    const firstPerson = (text.match(/\b(?:I|me|my|we|our|us)\b/g) ?? []).length;
    const you = (text.match(/\byou(?:r|rs)?\b/gi) ?? []).length;
    const c = per1000(contractions, words.length);
    traits.push(c > 12 ? 'uses contractions freely' : c < 3 ? 'avoids contractions' : 'uses some contractions');
    if (per1000(firstPerson, words.length) > 15) traits.push('writes in the first person');
    if (per1000(you, words.length) > 12) traits.push('speaks to the reader as "you"');
  }

  const questions = sentences.filter((s) => /[?？]\s*$/.test(s)).length / Math.max(1, sentences.length);
  if (questions > 0.08) traits.push('asks the reader questions');
  if (per1000((text.match(/;/g) ?? []).length, words.length) > 4) traits.push('uses semicolons');
  if (per1000((text.match(/\(/g) ?? []).length, words.length) > 4) traits.push('uses parenthetical asides');
  if (per1000((text.match(/!/g) ?? []).length, words.length) > 5) traits.push('uses exclamation marks');
  const avgWord = words.reduce((n, w) => n + w.length, 0) / Math.max(1, words.length);
  if (avgWord < 4.4) traits.push('prefers short, plain words');
  else if (avgWord > 5.4) traits.push('uses a formal, latinate vocabulary');

  const byCloseness = [...sentences].sort(
    (a, b) => Math.abs(wordsOf(a).length - median) - Math.abs(wordsOf(b).length - median),
  );
  const excerpts: string[] = [];
  let budget = EXCERPT_WORDS;
  for (const s of byCloseness) {
    const n = wordsOf(s).length;
    if (n > budget || n < 4) continue;
    excerpts.push(s);
    budget -= n;
    if (excerpts.length >= 4) break;
  }

  return { words: words.length, brief: traits.join('; '), excerpts };
}
