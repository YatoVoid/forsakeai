import { proposedText } from './parse';
import type { Doc, Sentence } from './types';

export interface Chunk {
  index: number;
  /** Sentence IDs grouped by paragraph, in document order. */
  passage: string[][];
  /** Read-only lead-in from the end of the previous chunk. */
  context: string[];
  /** Sentences the model must rewrite, in document order. */
  targets: string[];
}

export const CHUNK_TOKENS = 450;

export const estimateTokens = (text: string) => Math.ceil(text.length / 4);

export const isStiff = (s: Sentence) => s.stiff && !!s.text;

/**
 * Paragraph-aware: a chunk ends at a paragraph boundary unless one paragraph
 * alone is over budget, in which case it is split between sentences.
 */
export function chunkDoc(doc: Doc, isTarget: (s: Sentence) => boolean = isStiff, maxTokens = CHUNK_TOKENS): Chunk[] {
  const chunks: Chunk[] = [];
  let passage: string[][] = [];
  let tokens = 0;
  let previous: Sentence[] = [];
  let currentSentences: Sentence[] = [];

  const flush = () => {
    if (!currentSentences.length) return;
    chunks.push({
      index: chunks.length,
      passage,
      context: previous.slice(-2).map(proposedText).filter(Boolean),
      targets: currentSentences.filter(isTarget).map((s) => s.id),
    });
    previous = currentSentences;
    currentSentences = [];
    passage = [];
    tokens = 0;
  };

  for (const block of doc.blocks) {
    if (!block.editable || !block.sentences.length) continue;
    const blockTokens = estimateTokens(block.sentences.map(proposedText).join(' '));
    if (tokens > 0 && tokens + blockTokens > maxTokens) flush();

    let group: string[] = [];
    for (const s of block.sentences) {
      const t = estimateTokens(proposedText(s));
      if (tokens > 0 && tokens + t > maxTokens) {
        if (group.length) passage.push(group);
        group = [];
        flush();
      }
      group.push(s.id);
      currentSentences.push(s);
      tokens += t;
    }
    if (group.length) passage.push(group);
  }
  flush();
  return chunks.filter((c) => c.targets.length > 0).map((c, i) => ({ ...c, index: i }));
}
