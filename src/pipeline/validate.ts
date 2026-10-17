import { dominantScript } from '../lib/lang';
import { PLACEHOLDER, placeholderCounts } from './protect';

export type LangDetect = (text: string, only?: string[]) => string;

const MIN_WORDS_FOR_LOWER_BOUND = 8;
/** franc is unreliable on short text, so the language check only runs on long sentences. */
const MIN_CHARS_FOR_LANG_CHECK = 90;
/** Languages small models most often drift into when they translate by mistake. */
const DRIFT_TARGETS = ['eng', 'cmn', 'spa', 'fra', 'deu', 'por', 'rus'];
/** In these languages capitalization doesn't mark names, so the new-name check would misfire. */
const SKIP_NAME_CHECK = new Set(['deu', 'ltz']);

const words = (text: string) => text.replace(PLACEHOLDER, ' X ').split(/\s+/).filter(Boolean);
const stripTokens = (text: string) => text.replace(PLACEHOLDER, ' ');

function capitalizedNames(text: string): string[] {
  const names: string[] = [];
  const re = /(^|[.!?:;]\s+|["“(]\s*)?(\p{Lu}[\p{Ll}\p{M}'’-]+)/gu;
  for (const m of stripTokens(text).matchAll(re)) {
    const atStart = m.index === 0 || m[1] !== undefined;
    if (atStart) continue;
    names.push(m[2]!);
  }
  return names;
}

export function validateRewrite(original: string, rewrite: string, lang: string, detect: LangDetect): string[] {
  const reasons: string[] = [];
  if (!rewrite.trim()) return ['empty rewrite'];
  if (/[\r\n]/.test(rewrite)) reasons.push('line break inside a sentence');

  const expected = placeholderCounts(original);
  const actual = placeholderCounts(rewrite);
  for (const [n, count] of expected) {
    const got = actual.get(n) ?? 0;
    if (got === 0) reasons.push(`dropped locked token [[${n}]]`);
    else if (got > count) reasons.push(`repeated locked token [[${n}]]`);
  }
  for (const n of actual.keys()) if (!expected.has(n)) reasons.push(`invented token [[${n}]]`);

  if (/\d/.test(stripTokens(rewrite))) reasons.push('changed or added a number');

  if (!SKIP_NAME_CHECK.has(lang)) {
    const known = new Set(words(stripTokens(original)).map((w) => w.toLowerCase().replace(/[^\p{L}\p{M}'’-]/gu, '')));
    const added = capitalizedNames(rewrite).filter((n) => !known.has(n.toLowerCase()) && n !== 'I');
    if (added.length) reasons.push(`added a name (${added.slice(0, 2).join(', ')})`);
  }

  const before = words(original).length;
  const after = words(rewrite).length;
  if (before >= MIN_WORDS_FOR_LOWER_BOUND && after < before * 0.5) reasons.push('cut too much');
  if (after > Math.max(before * 1.8, before + 5)) reasons.push('grew too long');

  const plainOriginal = stripTokens(original).trim();
  const plainRewrite = stripTokens(rewrite).trim();
  const scriptBefore = dominantScript(plainOriginal);
  const scriptAfter = dominantScript(plainRewrite);
  if (scriptBefore && scriptAfter && scriptBefore !== scriptAfter) {
    reasons.push('switched language');
  } else if (plainOriginal.length >= MIN_CHARS_FOR_LANG_CHECK && plainRewrite.length >= MIN_CHARS_FOR_LANG_CHECK) {
    const candidates = [...new Set([lang, ...DRIFT_TARGETS])];
    const source = detect(plainOriginal, candidates);
    const target = detect(plainRewrite, candidates);
    if (source === lang && target !== 'und' && target !== source) reasons.push('switched language');
  }
  return reasons;
}
