import DiffMatchPatch from 'diff-match-patch';

export type DiffOp = 'equal' | 'insert' | 'delete';
export interface DiffPart {
  op: DiffOp;
  text: string;
}

const dmp = new DiffMatchPatch();

/** Word-level diff: each word or whitespace run is mapped to one character before diffing. */
export function wordDiff(before: string, after: string): DiffPart[] {
  if (before === after) return [{ op: 'equal', text: before }];
  const tokens: string[] = [];
  const index = new Map<string, number>();
  const encode = (text: string) =>
    (text.match(/\s+|[\p{L}\p{N}\p{M}'’_-]+|[^\s\p{L}\p{N}]/gu) ?? [])
      .map((tok) => {
        let i = index.get(tok);
        if (i === undefined) {
          i = tokens.length;
          tokens.push(tok);
          index.set(tok, i);
        }
        return String.fromCharCode(i + 0x100);
      })
      .join('');

  const a = encode(before);
  const b = encode(after);
  const diffs = dmp.diff_main(a, b, false);
  dmp.diff_cleanupSemantic(diffs);
  return diffs.map(([op, chars]) => ({
    op: op === 0 ? 'equal' : op === 1 ? 'insert' : 'delete',
    text: [...chars].map((c) => tokens[c.charCodeAt(0) - 0x100]).join(''),
  }));
}
