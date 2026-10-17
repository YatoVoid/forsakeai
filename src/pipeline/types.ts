export type BlockKind =
  | 'paragraph'
  | 'heading'
  | 'list-item'
  | 'quote'
  | 'code'
  | 'table'
  | 'rule'
  | 'blank';

export interface Sentence {
  id: string;
  /** Text as it was pasted. */
  source: string;
  /** Text after the rule pass. The model rewrite is kept separately. */
  text: string;
  /** Whitespace that follows the sentence inside its block. */
  trailing: string;
  flags: RuleFlag[];
  stiff: boolean;
  rewrite?: string;
  status: SentenceStatus;
  /** Set once the audit pass has looked at this sentence's rewrite. */
  audited?: boolean;
  /** Stock phrasing the audit pass found in the rewrite. */
  auditFlags?: RuleFlag[];
  /** The reader's call on a changed sentence. Unset means the change stands. */
  decision?: 'accepted' | 'rejected';
  /**
   * Sentences rewritten together as one paragraph whose content moved between
   * them (merged or split). Accept and restore apply to the whole group.
   */
  group?: string;
  /** The reader typed this sentence themselves; rewrites leave it alone. */
  edited?: boolean;
  note?: string;
}

export type SentenceStatus = 'clean' | 'fixed' | 'rewritten' | 'kept';

export interface Block {
  id: string;
  kind: BlockKind;
  /** Markdown marker before the prose ("## ", "- ") or the whole raw text for non-prose blocks. */
  lead: string;
  sentences: Sentence[];
  /** Newlines after the block. */
  tail: string;
  editable: boolean;
  lang: string;
}

export interface Doc {
  blocks: Block[];
  lang: string;
}

export interface RuleFlag {
  ruleId: string;
  category: RuleCategory;
  start: number;
  end: number;
  match: string;
  note: string;
  fixed: boolean;
}

export type RuleCategory =
  | 'stock-word'
  | 'filler'
  | 'opener'
  | 'closer'
  | 'transition'
  | 'punctuation'
  | 'format'
  | 'hedge';
