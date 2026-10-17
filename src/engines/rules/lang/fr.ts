import { DELETE_SENTENCE, type Rule } from '../types';

const APOS = "(?:'|’)";

export const fr: Rule[] = [
  { id: 'fr-important-noter', category: 'hedge', pattern: `il est (?:important|essentiel|crucial) de (?:noter|souligner|rappeler) qu${APOS}?e?\\s*`, replace: '', note: 'Formule creuse' },
  { id: 'fr-en-conclusion', category: 'transition', pattern: '^(?:en conclusion|en résumé|pour conclure|en somme),\\s*', replace: '', note: 'Formule de résumé' },
  { id: 'fr-jespere', category: 'closer', pattern: `^j${APOS}espère que (?:cela|ceci) (?:vous|t${APOS}|te) (?:aide|aidera|sera utile)[!.]?$`, replace: DELETE_SENTENCE, note: 'Formule de chatbot' },
  { id: 'fr-bien-sur', category: 'opener', pattern: '^(?:bien sûr|absolument|certainement)\\s?!\\s*', replace: '', note: 'Ouverture de chatbot' },
  { id: 'fr-de-plus', category: 'transition', pattern: '^(?:de plus|en outre|par ailleurs|ainsi),', note: 'Transition toute faite' },
  { id: 'fr-monde-actuel', category: 'filler', pattern: `dans le monde (?:actuel|d${APOS}aujourd${APOS}hui|numérique|moderne)`, note: 'Formule toute faite' },
  { id: 'fr-role', category: 'stock-word', pattern: 'joue(?:nt)? un rôle (?:crucial|essentiel|clé|central|déterminant|majeur)', note: 'Formule toute faite' },
  { id: 'fr-plongeons', category: 'stock-word', pattern: 'plongeons|plonger dans', note: 'Formule toute faite' },
  { id: 'fr-temoignage', category: 'stock-word', pattern: 'un témoignage de', note: 'Formule toute faite' },
  { id: 'fr-sans-faille', category: 'stock-word', pattern: 'sans faille|fluide(?:ment)?|harmonieuse(?:ment)?', note: 'Mot passe-partout' },
  { id: 'fr-non-seulement', category: 'filler', pattern: 'non seulement [^.;]{1,80} mais (?:aussi|également)', note: '"Non seulement ... mais aussi"' },
  { id: 'fr-crucial', category: 'stock-word', pattern: 'crucia(?:l|le|ux|les)', note: 'Mot passe-partout' },
];
