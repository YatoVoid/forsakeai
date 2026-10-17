import { DELETE_SENTENCE, type Rule } from '../types';

export const de: Rule[] = [
  { id: 'de-wichtig-zu-beachten', category: 'hedge', pattern: 'es ist (?:wichtig|erwähnenswert|entscheidend) zu (?:beachten|betonen|erwähnen), dass\\s*', replace: '', note: 'Floskel' },
  { id: 'de-zusammenfassend', category: 'transition', pattern: '^zusammenfassend (?:lässt sich sagen|kann man sagen),? (?:dass\\s*)?', note: 'Zusammenfassungs-Floskel' },
  { id: 'de-abschliessend', category: 'transition', pattern: '^(?:abschließend|zusammenfassend|letztendlich),', note: 'Zusammenfassungs-Floskel' },
  { id: 'de-ich-hoffe', category: 'closer', pattern: '^ich hoffe, (?:das|dies) hilft(?: (?:dir|ihnen|euch))?(?: weiter)?[!.]?$', replace: DELETE_SENTENCE, note: 'Chatbot-Schluss' },
  { id: 'de-gerne', category: 'opener', pattern: '^(?:gerne|natürlich|selbstverständlich)!\\s*', replace: '', note: 'Chatbot-Einstieg' },
  { id: 'de-darueber-hinaus', category: 'transition', pattern: '^(?:darüber hinaus|zudem|des weiteren|außerdem),?', note: 'Stock-Übergang' },
  { id: 'de-heutige-welt', category: 'filler', pattern: 'in der heutigen (?:schnelllebigen |digitalen |modernen )?(?:welt|zeit|gesellschaft)', note: 'Floskel' },
  { id: 'de-rolle', category: 'stock-word', pattern: 'spielt eine (?:entscheidende|zentrale|wichtige|wesentliche|maßgebliche) rolle', note: 'Floskel' },
  { id: 'de-nahtlos', category: 'stock-word', pattern: 'nahtlos(?:e|en|er|es)?', note: 'Modewort' },
  { id: 'de-eintauchen', category: 'stock-word', pattern: '(?:tauchen wir|eintauchen|tauchen sie) (?:ein|in)', note: 'Floskel' },
  { id: 'de-facettenreich', category: 'stock-word', pattern: 'facettenreich(?:e|en|er|es)?|vielschichtig(?:e|en|er|es)?', note: 'Modewort' },
  { id: 'de-massgeblich', category: 'stock-word', pattern: 'maßgeblich(?:e|en|er|es)?', note: 'Modewort' },
  { id: 'de-zeugnis', category: 'stock-word', pattern: 'ein (?:eindrucksvolles )?zeugnis (?:für|von)', note: 'Floskel' },
  { id: 'de-nicht-nur', category: 'filler', pattern: 'nicht nur [^.;]{1,80} sondern auch', note: '"Nicht nur ... sondern auch"' },
  { id: 'de-wenn-es-um', category: 'filler', pattern: 'wenn es um [^,]{1,40} geht', note: 'Füllphrase' },
];
