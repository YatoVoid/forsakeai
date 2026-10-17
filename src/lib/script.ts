const SCRIPTS: Array<[string, RegExp]> = [
  ['Latin', /\p{Script=Latin}/u],
  ['Cyrillic', /\p{Script=Cyrillic}/u],
  ['Greek', /\p{Script=Greek}/u],
  ['Arabic', /\p{Script=Arabic}/u],
  ['Hebrew', /\p{Script=Hebrew}/u],
  ['Devanagari', /\p{Script=Devanagari}/u],
  ['Han', /\p{Script=Han}/u],
  ['Hiragana', /\p{Script=Hiragana}/u],
  ['Katakana', /\p{Script=Katakana}/u],
  ['Hangul', /\p{Script=Hangul}/u],
  ['Thai', /\p{Script=Thai}/u],
];

/** The writing system most letters in the text belong to, or null for no letters. */
export function dominantScript(text: string): string | null {
  const counts = new Map<string, number>();
  for (const ch of text) {
    for (const [name, re] of SCRIPTS) {
      if (re.test(ch)) {
        // Japanese mixes kanji and kana sentence by sentence, so all three count as one group.
        const key = name === 'Han' || name === 'Hiragana' || name === 'Katakana' ? 'CJK' : name;
        counts.set(key, (counts.get(key) ?? 0) + 1);
        break;
      }
    }
  }
  let best: string | null = null;
  let max = 0;
  for (const [name, n] of counts) if (n > max) [best, max] = [name, n];
  return best;
}
