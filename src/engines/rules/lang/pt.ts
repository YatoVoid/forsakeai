import { DELETE_SENTENCE, type Rule } from '../types';

export const pt: Rule[] = [
  { id: 'pt-vale-ressaltar', category: 'hedge', pattern: '(?:vale (?:ressaltar|destacar|mencionar)|é importante (?:notar|ressaltar|destacar|lembrar)) que\\s*', replace: '', note: 'Muleta' },
  { id: 'pt-em-conclusao', category: 'transition', pattern: '^(?:em conclusão|em resumo|em suma|para concluir),\\s*', replace: '', note: 'Fecho de resumo' },
  { id: 'pt-espero-ajude', category: 'closer', pattern: '^espero que (?:isso|isto|esta informação) (?:te |lhe |o |a )?(?:ajude|seja útil)[!.]?$', replace: DELETE_SENTENCE, note: 'Fecho de chatbot' },
  { id: 'pt-claro', category: 'opener', pattern: '^(?:claro|com certeza|certamente)!\\s*', replace: '', note: 'Abertura de chatbot' },
  { id: 'pt-alem-disso', category: 'transition', pattern: '^(?:além disso|ademais|por outro lado|nesse sentido),', note: 'Transição pronta' },
  { id: 'pt-mundo-atual', category: 'filler', pattern: 'no (?:mundo|cenário) (?:atual|de hoje|digital|moderno)', note: 'Frase feita' },
  { id: 'pt-papel', category: 'stock-word', pattern: 'desempenha(?:m)? um papel (?:crucial|fundamental|essencial|vital|importante|central)', note: 'Frase feita' },
  { id: 'pt-mergulhar', category: 'stock-word', pattern: 'mergulh(?:ar|amos|e) (?:em|no|na|fundo)', note: 'Frase feita' },
  { id: 'pt-testemunho', category: 'stock-word', pattern: 'um testemunho de', note: 'Frase feita' },
  { id: 'pt-nao-apenas', category: 'filler', pattern: 'não (?:apenas|só) [^.;]{1,80} mas também', note: '"Não apenas ... mas também"' },
  { id: 'pt-crucial', category: 'stock-word', pattern: 'cruciais|crucial|fundamentais', note: 'Palavra coringa' },
  { id: 'pt-potencializar', category: 'stock-word', pattern: 'potencializ(?:ar|a|am)|alavanc(?:ar|a|am)', note: 'Palavra coringa' },
];
