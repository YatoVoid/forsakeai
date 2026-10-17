import type { Rule } from '../types';

export const common: Rule[] = [
  {
    // A short aside between two dashes reads more naturally in parentheses than between commas.
    id: 'em-dash-pair',
    category: 'punctuation',
    pattern: '\\s*\u2014\\s*([^\u2014.!?;:()]{1,90}?)\\s*\u2014\\s*',
    raw: true,
    replace: ' ($1) ',
    note: 'Em dashes are a common tell in model output',
  },
  {
    id: 'em-dash',
    category: 'punctuation',
    pattern: '\\s*\u2014\\s*',
    raw: true,
    replace: ', ',
    note: 'Em dashes are a common tell in model output',
  },
  {
    id: 'leading-emoji',
    category: 'format',
    pattern: '^(?:\\p{Extended_Pictographic}\\uFE0F?\\s*)+',
    raw: true,
    replace: '',
    note: 'Emoji at the start of a heading or list item',
  },
  {
    id: 'sparkles',
    category: 'format',
    pattern: '\\s*[\u2728\u{1F680}\u{1F4A1}]\\uFE0F?',
    raw: true,
    replace: '',
    note: 'Decorative emoji',
  },
];
