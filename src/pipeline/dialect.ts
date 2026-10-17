import { protect, unprotect } from './protect';
import type { Doc } from './types';

export type Dialect = 'as-written' | 'us' | 'uk';

/**
 * US → UK pairs. Explicit lists, not suffix rules: blanket -ize/-our/-er
 * rewriting breaks words like "size", "four" and "meter" (the device).
 * UK here means -ise spelling, which most British publishers use.
 */
const IZE_STEMS = [
  'apolog', 'authori', 'capitali', 'categori', 'centrali', 'characteri', 'civili', 'critici', 'customi', 'digiti',
  'emphasi', 'energi', 'familiari', 'finali', 'generali', 'harmoni', 'hospitali', 'ideali', 'itemi', 'jeopardi',
  'legali', 'locali', 'maximi', 'memori', 'minimi', 'mobili', 'moderni', 'moneti', 'normali', 'optimi', 'organi',
  'patroni', 'penali', 'priori', 'publici', 'reali', 'recogni', 'revolutioni', 'saniti', 'scrutini', 'speciali',
  'stabili', 'standardi', 'summari', 'symboli', 'sympathi', 'synchroni', 'theori', 'utili', 'vapori', 'visuali',
  'commerciali', 'compartmentali', 'contextuali', 'conceptuali', 'decentrali', 'democrati', 'desensiti', 'economi',
  'equali', 'externali', 'fertili', 'formali', 'globali', 'humani', 'immortali', 'immuni', 'industriali', 'initiali',
  'internali', 'marginali', 'materiali', 'motori', 'naturali', 'neutrali', 'personali',
  'polari', 'politici', 'professionali', 'rationali', 'reorgani', 'romantici', 'sensiti', 'sociali', 'subsidi',
  'tokeni', 'triviali', 'urbani', 'vandali', 'verbali', 'victimi', 'vocali',
];

const IZE_SUFFIXES: Array<[string, string]> = [
  ['ze', 'se'], ['zes', 'ses'], ['zed', 'sed'], ['zing', 'sing'], ['zation', 'sation'], ['zations', 'sations'],
  ['zer', 'ser'], ['zers', 'sers'],
];

const YZE = ['analy', 'paraly', 'cataly', 'electroly', 'hydroly', 'dialy'];
const YZE_SUFFIXES: Array<[string, string]> = [['ze', 'se'], ['zes', 'ses'], ['zed', 'sed'], ['zing', 'sing'], ['zer', 'ser'], ['zers', 'sers']];

const OUR = [
  'arbor', 'ardor', 'armor', 'behavior', 'candor', 'clamor', 'color', 'demeanor', 'endeavor', 'favor', 'fervor',
  'flavor', 'harbor', 'honor', 'humor', 'labor', 'neighbor', 'odor', 'parlor', 'rancor', 'rigor', 'rumor', 'savor',
  'splendor', 'tumor', 'valor', 'vapor', 'vigor',
];
const OUR_SUFFIXES = ['', 's', 'ed', 'ing', 'ful', 'fully', 'less', 'able', 'ably', 'ite', 'ites', 'hood', 'hoods', 'ly', 'ers', 'er', 'ist', 'ists'];
/** Derived forms that keep the US -or- in British English too. */
const OUR_EXCEPTIONS = new Set(['honorary', 'humorous', 'humorist', 'humorists', 'laborious', 'vigorous', 'rigorous', 'odorous', 'coloration']);

const RE = ['center', 'theater', 'liter', 'fiber', 'caliber', 'specter', 'somber', 'luster', 'saber', 'meager', 'sepulcher', 'centimeter', 'kilometer', 'millimeter'];
const RE_SUFFIXES: Array<[string, string]> = [['er', 're'], ['ers', 'res'], ['ered', 'red'], ['ering', 'ring']];

const DOUBLE_L = ['travel', 'cancel', 'label', 'model', 'fuel', 'signal', 'channel', 'counsel', 'dial', 'duel', 'level', 'marvel', 'panel', 'pedal', 'quarrel', 'shovel', 'snorkel', 'tunnel', 'total', 'jewel', 'equal', 'funnel', 'grovel', 'libel', 'rival', 'spiral', 'swivel', 'unravel'];

const SINGLE: Array<[string, string]> = [
  ['aluminum', 'aluminium'], ['gray', 'grey'], ['grays', 'greys'],
  ['program', 'programme'], ['programs', 'programmes'], ['check', 'cheque'], ['plow', 'plough'], ['plows', 'ploughs'],
  ['skeptic', 'sceptic'], ['skeptical', 'sceptical'], ['skepticism', 'scepticism'], ['mold', 'mould'], ['molds', 'moulds'],
  ['moldy', 'mouldy'], ['jewelry', 'jewellery'], ['pajamas', 'pyjamas'], ['airplane', 'aeroplane'], ['airplanes', 'aeroplanes'],
  ['cozy', 'cosy'], ['enroll', 'enrol'], ['enrollment', 'enrolment'], ['enrollments', 'enrolments'], ['fulfill', 'fulfil'],
  ['fulfillment', 'fulfilment'], ['skillful', 'skilful'], ['skillfully', 'skilfully'], ['willful', 'wilful'],
  ['installment', 'instalment'], ['installments', 'instalments'], ['aging', 'ageing'], ['catalog', 'catalogue'],
  ['catalogs', 'catalogues'], ['analog', 'analogue'], ['defense', 'defence'], ['defenses', 'defences'], ['offense', 'offence'],
  ['offenses', 'offences'], ['pretense', 'pretence'], ['anemia', 'anaemia'], ['anemic', 'anaemic'], ['anesthesia', 'anaesthesia'],
  ['pediatric', 'paediatric'], ['pediatrician', 'paediatrician'], ['encyclopedia', 'encyclopaedia'], ['maneuver', 'manoeuvre'],
  ['maneuvers', 'manoeuvres'], ['maneuvered', 'manoeuvred'], ['maneuvering', 'manoeuvring'], ['estrogen', 'oestrogen'],
  ['fetus', 'foetus'], ['diarrhea', 'diarrhoea'], ['esophagus', 'oesophagus'], ['mustache', 'moustache'], ['draft', 'draught'],
  ['while', 'whilst'],
];
/** Pairs above that only go one way: "check", "draft" and "while" are also correct British English. */
const US_ONLY_DIRECTION = new Set(['check', 'draft', 'while', 'program', 'programs']);

function buildPairs(): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const stem of IZE_STEMS) for (const [us, uk] of IZE_SUFFIXES) pairs.push([stem + us, stem + uk]);
  for (const stem of YZE) for (const [us, uk] of YZE_SUFFIXES) pairs.push([stem + us, stem + uk]);
  for (const word of OUR) {
    for (const suffix of OUR_SUFFIXES) {
      const us = word + suffix;
      if (!OUR_EXCEPTIONS.has(us)) pairs.push([us, word.replace(/or$/, 'our') + suffix]);
    }
  }
  for (const word of RE) {
    const stem = word.replace(/er$/, '');
    for (const [us, uk] of RE_SUFFIXES) pairs.push([stem + us, stem + uk]);
  }
  for (const word of DOUBLE_L) {
    for (const suffix of ['ed', 'ing', 'er', 'ers']) pairs.push([word + suffix, word + 'l' + suffix]);
  }
  return [...pairs, ...SINGLE];
}

const PAIRS = buildPairs();
const US_TO_UK = new Map(PAIRS.filter(([us]) => !US_ONLY_DIRECTION.has(us)).map(([us, uk]) => [us, uk]));
const UK_TO_US = new Map(PAIRS.map(([us, uk]) => [uk, us]));

function matchCase(source: string, word: string): string {
  if (source === source.toUpperCase() && source.length > 1) return word.toUpperCase();
  if (source[0] === source[0]!.toUpperCase()) return word[0]!.toUpperCase() + word.slice(1);
  return word;
}

export function convertSpelling(text: string, target: Exclude<Dialect, 'as-written'>): string {
  const table = target === 'uk' ? US_TO_UK : UK_TO_US;
  const { masked, slots } = protect(text);
  const converted = masked.replace(/\p{L}+/gu, (word) => {
    const hit = table.get(word.toLowerCase());
    return hit ? matchCase(word, hit) : word;
  });
  return unprotect(converted, slots);
}

/** Converts every editable sentence in place. Returns how many sentences changed. */
export function applyDialect(doc: Doc, target: Dialect): number {
  if (target === 'as-written') return 0;
  let changed = 0;
  for (const b of doc.blocks) {
    if (!b.editable || (b.lang !== 'eng' && b.lang !== 'sco')) continue;
    for (const s of b.sentences) {
      const text = convertSpelling(s.text, target);
      const rewrite = s.rewrite === undefined ? undefined : convertSpelling(s.rewrite, target);
      if (text !== s.text || rewrite !== s.rewrite) {
        changed++;
        s.text = text;
        s.rewrite = rewrite;
        if (s.status === 'clean' && text !== s.source) s.status = 'fixed';
      }
    }
  }
  return changed;
}

export const dialectPairCount = PAIRS.length;
