import { proposedText } from '../pipeline/parse';
import type { Doc, RuleCategory, Sentence } from '../pipeline/types';

export type EntryStatus = 'fixed' | 'removed' | 'to-rewrite' | 'rewritten' | 'kept' | 'undone';

/** One line on the style sheet: a phrase the rules caught, why, and what happened to it. */
export interface SheetEntry {
  key: string;
  phrase: string;
  note: string;
  category: RuleCategory;
  status: EntryStatus;
  sentenceIds: string[];
  /** Paragraph number of the first hit, counting prose blocks only. */
  para: number;
  /** What the first sentence reads now, for entries the model or rules changed. */
  now?: string;
}

const ORDER: EntryStatus[] = ['to-rewrite', 'kept', 'rewritten', 'fixed', 'removed', 'undone'];

function statusOf(s: Sentence, fixed: boolean): EntryStatus {
  if (s.decision === 'rejected') return 'undone';
  if (!proposedText(s)) return 'removed';
  if (fixed) return 'fixed';
  if (s.status === 'rewritten') return 'rewritten';
  if (s.status === 'kept') return 'kept';
  return 'to-rewrite';
}

/** Groups every rule hit by phrase and outcome, most actionable first, then in reading order. */
export function buildSheet(doc: Doc): SheetEntry[] {
  const entries = new Map<string, SheetEntry>();
  let order = 0;
  const firstSeen = new Map<string, number>();
  let para = 0;
  const shown = new Set<string>();
  for (const block of doc.blocks) {
    if (block.editable && block.sentences.length) para++;
    for (const s of block.sentences) {
      for (const f of s.flags) {
        const phrase = (f.match.trim() || f.match).replace(/\s+/g, ' ');
        const status = statusOf(s, f.fixed);
        const key = `${f.ruleId}|${phrase.toLowerCase()}|${status}`;
        const entry = entries.get(key);
        if (entry) {
          if (!entry.sentenceIds.includes(s.id)) entry.sentenceIds.push(s.id);
          continue;
        }
        const now = (status === 'rewritten' || status === 'fixed') && !shown.has(s.id) ? proposedText(s) : undefined;
        if (now !== undefined) shown.add(s.id);
        entries.set(key, { key, phrase, note: f.note, category: f.category, status, sentenceIds: [s.id], para, now });
        firstSeen.set(key, order++);
      }
    }
  }
  return [...entries.values()].sort(
    (a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || firstSeen.get(a.key)! - firstSeen.get(b.key)!,
  );
}

export interface SheetGroup {
  status: EntryStatus;
  entries: SheetEntry[];
}

export function groupSheet(entries: SheetEntry[]): SheetGroup[] {
  return ORDER.map((status) => ({ status, entries: entries.filter((e) => e.status === status) })).filter((g) => g.entries.length);
}

export const STATUS_LABEL: Record<EntryStatus, string> = {
  fixed: 'Fixed',
  removed: 'Removed',
  'to-rewrite': 'To rewrite',
  rewritten: 'Rewritten',
  kept: 'Left as written',
  undone: 'Restored',
};

/** Real entries from the rule library, shown on the empty sheet so the first screen demonstrates the product. */
export const EXAMPLE_ENTRIES: Array<{ phrase: string; note: string; status: EntryStatus }> = [
  { phrase: 'plays a crucial role', note: 'Stock phrase', status: 'to-rewrite' },
  { phrase: 'delve into', note: 'Stock word', status: 'to-rewrite' },
  { phrase: "It's worth noting that", note: 'Throat-clearing, cut', status: 'removed' },
  { phrase: 'in order to', note: 'Wordy, now “to”', status: 'fixed' },
  { phrase: 'I hope this helps!', note: 'Chatbot closer, cut', status: 'removed' },
];
