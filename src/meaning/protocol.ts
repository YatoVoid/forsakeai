/** Multilingual sentence embeddings (Apache-2.0), used to check that a rewrite kept its meaning. */
export const MEANING_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
export const MEANING_DOWNLOAD_MB = 118;

export type MeaningRequest =
  | { type: 'load'; ortBase: string }
  | { type: 'compare'; id: number; text: string; others: string[] };

export type MeaningResponse =
  | { type: 'download'; loaded: number; total: number }
  | { type: 'ready' }
  | { type: 'similarity'; id: number; scores: number[] }
  | { type: 'error'; id?: number; message: string };
