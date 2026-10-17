import type { RuleCategory } from '../../pipeline/types';

export interface Rule {
  id: string;
  category: RuleCategory;
  /** Regex source. Wrapped in Unicode-aware word boundaries unless `raw` is set. */
  pattern: string;
  raw?: boolean;
  /**
   * Deterministic fix. '' removes the match; DELETE_SENTENCE removes the whole sentence.
   * Rules without a fix only flag the sentence for the model.
   */
  replace?: string;
  note: string;
}

export const DELETE_SENTENCE = '\u0000delete';
