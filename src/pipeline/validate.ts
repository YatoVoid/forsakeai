import { runRules } from '../engines/rules/run';
import { dominantScript } from '../lib/script';
import { PLACEHOLDER, placeholderCounts } from './protect';

export type LangDetect = (text: string, only?: string[]) => string;

const MIN_WORDS_FOR_LOWER_BOUND = 8;
/** franc is unreliable on short text, so the language check only runs on long sentences. */
const MIN_CHARS_FOR_LANG_CHECK = 90;
/** Languages small models most often drift into when they translate by mistake. */
const DRIFT_TARGETS = ['eng', 'cmn', 'spa', 'fra', 'deu', 'por', 'rus'];
/** In these languages capitalization doesn't mark names, so the new-name check would misfire. */
const SKIP_NAME_CHECK = new Set(['deu', 'ltz']);

const STOPWORDS = new Set(
  'about above after again against also although among another because been before being below between both cannot could does doing down during each even every from further have having here into itself just more most much must only other over same should since some such than that their them then there these they this those through under until very were what when where which while will with within without would your yours'.split(' '),
);
/** Below this share of the original's content words, a rewrite has probably changed the meaning. */
const MIN_CONTENT_OVERLAP = 0.25;
const MIN_CONTENT_WORDS = 5;

/** Crude stems: lower-cased first five letters of words four letters or longer, minus stopwords. */
export function contentStems(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of stripTokens(text).toLowerCase().match(/\p{L}[\p{L}\p{M}'’-]*/gu) ?? []) {
    if (w.length < 4 || STOPWORDS.has(w)) continue;
    out.add(w.slice(0, 5));
  }
  return out;
}

function overlap(source: Set<string>, other: Set<string>): number {
  if (!source.size) return 1;
  let hit = 0;
  for (const s of source) if (other.has(s)) hit++;
  return hit / source.size;
}

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

export interface ValidateOptions {
  /** Flagged stock phrases in the original. Their words don't count toward the meaning overlap. */
  stock?: string[];
  /** Word-overlap meaning checks. Off when an embedding check runs instead. Default on. */
  lexicalMeaning?: boolean;
}

export function validateRewrite(
  original: string,
  rewrite: string,
  lang: string,
  detect: LangDetect,
  neighbors: string[] = [],
  opts: ValidateOptions = {},
): string[] {
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
    // Split on anything that isn't a letter, so "D.Va" in the original covers "Va" in the rewrite.
    const known = new Set(stripTokens(original).toLowerCase().split(/[^\p{L}\p{M}'’-]+/u).filter(Boolean));
    const bare = (w: string) => w.toLowerCase().replace(/['’]s$/, '');
    const knownBare = new Set([...known].map(bare));
    const added = capitalizedNames(rewrite).filter((n) => !knownBare.has(bare(n)) && n !== 'I');
    if (added.length) reasons.push(`added a name (${added.slice(0, 2).join(', ')})`);
  }

  const before = words(original).length;
  const after = words(rewrite).length;
  if (before >= MIN_WORDS_FOR_LOWER_BOUND && after < before * 0.5) reasons.push('cut too much');
  if (after > Math.max(before * 1.8, before + 5)) reasons.push('grew too long');

  const stock = new Set((opts.stock ?? []).flatMap((p) => [...contentStems(p)]));
  const stemsBefore = new Set([...contentStems(original)].filter((s) => !stock.has(s)));
  const stemsAfter = contentStems(rewrite);
  if (opts.lexicalMeaning !== false && stemsBefore.size >= MIN_CONTENT_WORDS) {
    const kept = overlap(stemsBefore, stemsAfter);
    if (kept < MIN_CONTENT_OVERLAP) reasons.push('changed the meaning');
    else if (neighbors.some((n) => overlap(stemsAfter, contentStems(n)) > overlap(stemsAfter, stemsBefore) + 0.15)) {
      reasons.push('rewrote a neighbouring sentence');
    }
  }

  // A rewrite may not swap one stock phrase for another ("Moreover" → "Furthermore").
  const added = stockDiff(original, rewrite, lang).added;
  if (added.length) reasons.push(`added stock phrasing ("${added[0]}")`);

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

/** Stock phrases the rewrite added, and ones from the original it still uses. */
export function stockDiff(original: string, rewrite: string, lang: string): { added: string[]; left: string[] } {
  const open = (text: string) => runRules(text, lang).flags.filter((f) => !f.fixed);
  const had = new Set(open(original).map((f) => f.ruleId));
  const now = open(rewrite);
  return {
    added: now.filter((f) => !had.has(f.ruleId)).map((f) => f.match.trim()),
    left: now.filter((f) => had.has(f.ruleId)).map((f) => f.match.trim()),
  };
}
