export interface Masked {
  masked: string;
  slots: string[];
}

export const PLACEHOLDER = /\[\[(\d+)\]\]/g;

/**
 * Order matters: earlier patterns claim text first, so a URL inside a
 * markdown link is protected as part of the link, not on its own.
 */
const PROTECTED: RegExp[] = [
  /`[^`\n]+`/g,
  /!?\[[^\]\n]*\]\([^)\s]+(?:\s+"[^"]*")?\)/g,
  /\*\*[^*\n]+\*\*|__[^_\n]+__/g,
  /(?<![\p{L}\p{N}*])\*[^*\n]+\*(?![\p{L}\p{N}*])|(?<![\p{L}\p{N}_])_[^_\n]+_(?![\p{L}\p{N}_])/gu,
  /\bhttps?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/g,
  /\bwww\.[^\s<>()]+[^\s<>().,;:!?'"]/g,
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
  /\[\d+(?:[,–-]\s*\d+)*\]/g,
  /\((?:[\p{Lu}][\p{L}'-]+(?: et al\.)?(?:,? (?:and|&) [\p{Lu}][\p{L}'-]+)?),? \d{4}[a-z]?(?:, p+\. ?\d+(?:[–-]\d+)?)?\)/gu,
  /"[^"\n]{1,400}"|“[^”\n]{1,400}”|„[^“”\n]{1,400}[“”]|«[^»\n]{1,400}»|「[^」\n]{1,400}」/g,
  /[$€£¥₹]\s?\d(?:[\d.,]*\d)?(?:\s?(?:k|m|bn|million|billion)(?![\p{L}]))?|\d(?:[\d.,:/]*\d)?(?:\s?%|\s?[$€£¥₹])?/gu,
];

export function protect(text: string, offset = 0): Masked {
  const slots: string[] = [];
  type Span = { start: number; end: number };
  const taken: Span[] = [];
  const overlaps = (a: Span) => taken.some((b) => a.start < b.end && b.start < a.end);

  for (const re of PROTECTED) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const span = { start: m.index, end: m.index + m[0].length };
      if (!m[0] || overlaps(span)) continue;
      taken.push(span);
    }
  }
  taken.sort((a, b) => a.start - b.start);

  let masked = '';
  let pos = 0;
  for (const span of taken) {
    masked += text.slice(pos, span.start);
    slots.push(text.slice(span.start, span.end));
    masked += `[[${offset + slots.length}]]`;
    pos = span.end;
  }
  masked += text.slice(pos);
  return { masked, slots };
}

export function unprotect(masked: string, slots: string[], offset = 0): string {
  return masked
    .replace(PLACEHOLDER, (whole, n: string) => slots[Number(n) - 1 - offset] ?? whole)
    // A locked quote that ends a sentence brings its own full stop; models add another after it.
    .replace(/([.!?…]["”’'»)\]]+)\./g, '$1');
}

export function placeholderCounts(text: string): Map<number, number> {
  const counts = new Map<number, number>();
  for (const m of text.matchAll(PLACEHOLDER)) {
    const n = Number(m[1]);
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  return counts;
}

/**
 * Small models sometimes drop the brackets and write "[[2]]" as "2". A
 * rewrite may not contain digits of its own, so a bare number equal to a
 * missing token's id can only be that token.
 */
export function repairTokens(masked: string, rewrite: string): string {
  const expected = placeholderCounts(masked);
  const present = placeholderCounts(rewrite);
  let out = rewrite;
  for (const n of expected.keys()) {
    if (present.has(n)) continue;
    const bare = new RegExp(`(?<![\\d\\[])${n}(?![\\d\\]])`, 'g');
    if ((out.match(bare) ?? []).length === 1) out = out.replace(bare, `[[${n}]]`);
  }
  return out;
}
