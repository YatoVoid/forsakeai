import type { RuleFlag } from '../../pipeline/types';
import { DELETE_SENTENCE, type Rule } from './types';
import { common } from './lang/common';
import { en } from './lang/en';
import { de } from './lang/de';
import { es } from './lang/es';
import { fr } from './lang/fr';
import { pt } from './lang/pt';

const LIBRARIES: Record<string, Rule[]> = { eng: en, deu: de, spa: es, fra: fr, por: pt };

export const SUPPORTED_RULE_LANGS = Object.keys(LIBRARIES);

interface Compiled {
  rule: Rule;
  re: RegExp;
}

const cache = new Map<string, Compiled[]>();

function compile(rule: Rule): Compiled {
  const source = rule.raw ? rule.pattern : `(?<![\\p{L}\\p{N}])(?:${rule.pattern})(?![\\p{L}\\p{N}])`;
  return { rule, re: new RegExp(source, 'giu') };
}

function rulesFor(lang: string): Compiled[] {
  let list = cache.get(lang);
  if (!list) {
    list = [...common, ...(LIBRARIES[lang] ?? [])].map(compile);
    cache.set(lang, list);
  }
  return list;
}

const isUpper = (ch: string | undefined) => !!ch && ch !== ch.toLowerCase() && ch === ch.toUpperCase();
const capitalize = (s: string) => s.replace(/^(["'“‘(¿¡]?)(\p{L})/u, (_, pre: string, ch: string) => pre + ch.toUpperCase());

function tidy(text: string): string {
  return text
    .replace(/ {2,}/g, ' ')
    .replace(/ ([,.;:!?])/g, '$1')
    .replace(/,([,.;:!?])/g, '$1')
    .replace(/^[,;:]\s*/, '')
    .trim();
}

export interface RuleResult {
  text: string;
  flags: RuleFlag[];
  deleted: boolean;
}

export function runRules(sentence: string, lang: string): RuleResult {
  const rules = rulesFor(lang);
  const flags: RuleFlag[] = [];
  let text = sentence;
  let changed = false;

  for (const { rule, re } of rules) {
    if (rule.replace === undefined) continue;
    re.lastIndex = 0;
    const startedUpper = isUpper(text[0]);
    let hit = false;
    const next = text.replace(re, (match: string, ...rest: unknown[]) => {
      hit = true;
      flags.push({ ruleId: rule.id, category: rule.category, start: -1, end: -1, match, note: rule.note, fixed: true });
      if (rule.replace === DELETE_SENTENCE) return DELETE_SENTENCE;
      const groups = rest.slice(0, -2).filter((g): g is string => typeof g === 'string');
      const out = rule.replace!.replace(/\$(\d)/g, (_, n: string) => groups[Number(n) - 1] ?? '');
      return isUpper(match[0]) ? capitalize(out) : out;
    });
    if (!hit) continue;
    if (next.includes(DELETE_SENTENCE)) return { text: '', flags, deleted: true };
    text = tidy(next);
    if (startedUpper) text = capitalize(text);
    changed = true;
  }

  if (changed && text === '') return { text: '', flags, deleted: true };

  for (const { rule, re } of rules) {
    if (rule.replace !== undefined) continue;
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      flags.push({
        ruleId: rule.id,
        category: rule.category,
        start: m.index,
        end: m.index + m[0].length,
        match: m[0],
        note: rule.note,
        fixed: false,
      });
    }
  }
  return { text, flags, deleted: false };
}
