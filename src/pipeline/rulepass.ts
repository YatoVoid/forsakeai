import { runRules } from '../engines/rules/run';
import { protect, unprotect } from './protect';
import type { Doc, RuleFlag } from './types';

export interface RulePassSummary {
  fixed: number;
  flagged: number;
  stiffSentences: number;
}

function locate(flags: RuleFlag[], text: string, slots: string[]): RuleFlag[] {
  let cursor = 0;
  return flags.map((f) => {
    if (f.fixed) return f;
    const match = unprotect(f.match, slots);
    const at = text.indexOf(match, cursor);
    if (at < 0) return { ...f, match, start: -1, end: -1 };
    cursor = at;
    return { ...f, match, start: at, end: at + match.length };
  });
}

export function rulePass(doc: Doc): RulePassSummary {
  const summary: RulePassSummary = { fixed: 0, flagged: 0, stiffSentences: 0 };
  for (const block of doc.blocks) {
    if (!block.editable) continue;
    for (const s of block.sentences) {
      if (!s.source) continue;
      const { masked, slots } = protect(s.source);
      const result = runRules(masked, block.lang);
      s.text = result.deleted ? '' : unprotect(result.text, slots);
      s.flags = locate(result.flags, s.text, slots).sort((a, b) => a.start - b.start);
      s.stiff = !result.deleted && s.flags.some((f) => !f.fixed);
      s.status = s.text === s.source ? 'clean' : 'fixed';
      summary.fixed += s.flags.filter((f) => f.fixed).length;
      summary.flagged += s.flags.filter((f) => !f.fixed).length;
      if (s.stiff) summary.stiffSentences++;
    }
  }
  return summary;
}
