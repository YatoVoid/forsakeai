export interface LocalModel {
  /** WebLLM model id without the quantization suffix. */
  base: string;
  label: string;
  /** Download size measured from the Hugging Face shards. */
  downloadMB: number;
  /** GPU memory from WebLLM's prebuilt config (q4f16 build). */
  vramMB: number;
  /** Rough generation speed on a mid-range laptop GPU; refined at runtime. */
  wordsPerSec: number;
  license: string;
  /** ISO 639-3 codes the model officially supports; unset means broadly multilingual. */
  languages?: string[];
  /** Text the license requires us to show when the model is in use. */
  attribution?: string;
  licenseUrl?: string;
}

// Chosen by scoring rewrites with an open AI-text detector and a meaning check
// (docs/local-rewrite-eval.md). Llama 3.2 3B and Phi 3.5 scored worse than Qwen3 4B.
export const LOCAL_MODELS: LocalModel[] = [
  {
    base: 'Qwen3-4B',
    label: 'Best (Qwen3 4B)',
    downloadMB: 2174,
    vramMB: 3432,
    wordsPerSec: 12,
    license: 'Apache 2.0',
  },
  {
    base: 'Qwen3-1.7B',
    label: 'Faster (Qwen3 1.7B)',
    downloadMB: 939,
    vramMB: 2037,
    wordsPerSec: 25,
    license: 'Apache 2.0',
  },
  {
    base: 'Qwen3-0.6B',
    label: 'Small (Qwen3 0.6B), for older devices',
    downloadMB: 335,
    vramMB: 1403,
    wordsPerSec: 35,
    license: 'Apache 2.0',
  },
];

/** What to try when the chosen model doesn't fit in graphics memory. */
export function smallerModel(model: LocalModel): LocalModel | undefined {
  const at = LOCAL_MODELS.indexOf(model);
  return at >= 0 ? LOCAL_MODELS[at + 1] : undefined;
}

export function supportsLanguage(model: LocalModel, lang: string): boolean {
  return !model.languages || model.languages.includes(lang);
}

export function modelId(model: LocalModel, f16: boolean): string {
  return `${model.base}-${f16 ? 'q4f16_1' : 'q4f32_1'}-MLC`;
}
