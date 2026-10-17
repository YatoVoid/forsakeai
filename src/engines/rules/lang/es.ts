import { DELETE_SENTENCE, type Rule } from '../types';

export const es: Rule[] = [
  { id: 'es-cabe-destacar', category: 'hedge', pattern: '(?:cabe (?:destacar|mencionar|señalar)|es importante (?:señalar|destacar|mencionar|tener en cuenta)) que\\s*', replace: '', note: 'Muletilla' },
  { id: 'es-en-conclusion', category: 'transition', pattern: '^(?:en conclusión|en resumen|en definitiva|para concluir),\\s*', replace: '', note: 'Cierre de resumen' },
  { id: 'es-espero-ayude', category: 'closer', pattern: '^espero que (?:esto|esta información) (?:te|le|os|les) (?:ayude|sea útil)[!.]?$', replace: DELETE_SENTENCE, note: 'Cierre de chatbot' },
  { id: 'es-claro', category: 'opener', pattern: '^(?:¡)?(?:claro|por supuesto|desde luego)!\\s*', replace: '', note: 'Apertura de chatbot' },
  { id: 'es-ademas', category: 'transition', pattern: '^(?:además|asimismo|por otro lado|en este sentido),', note: 'Transición de plantilla' },
  { id: 'es-mundo-actual', category: 'filler', pattern: 'en el (?:mundo|panorama) (?:actual|de hoy|digital|moderno)', note: 'Frase hecha' },
  { id: 'es-papel', category: 'stock-word', pattern: 'juega(?:n)? un papel (?:crucial|fundamental|clave|esencial|vital|importante)', note: 'Frase hecha' },
  { id: 'es-fluido', category: 'stock-word', pattern: 'sin (?:fisuras|problemas)|de manera fluida', note: 'Muletilla' },
  { id: 'es-sumergirnos', category: 'stock-word', pattern: 'sumerg(?:irnos|ámonos|irse)|profundizar en', note: 'Frase hecha' },
  { id: 'es-testimonio', category: 'stock-word', pattern: 'un testimonio de', note: 'Frase hecha' },
  { id: 'es-no-solo', category: 'filler', pattern: 'no solo [^.;]{1,80} sino también', note: '"No solo ... sino también"' },
  { id: 'es-crucial', category: 'stock-word', pattern: 'crucial(?:es)?|fundamental(?:es)?', note: 'Palabra comodín' },
  { id: 'es-potenciar', category: 'stock-word', pattern: 'potenci(?:ar|a|an)|aprovechar al máximo', note: 'Palabra comodín' },
];
