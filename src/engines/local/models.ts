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

export const LOCAL_MODELS: LocalModel[] = [
  {
    base: 'Qwen2.5-1.5B-Instruct',
    label: 'Standard (Qwen 2.5 1.5B)',
    downloadMB: 880,
    vramMB: 1630,
    wordsPerSec: 25,
    license: 'Apache 2.0',
  },
  {
    base: 'Llama-3.2-3B-Instruct',
    label: 'Better (Llama 3.2 3B), for 8 GB+ graphics',
    downloadMB: 1817,
    vramMB: 2264,
    wordsPerSec: 15,
    license: 'Llama 3.2 Community License',
    languages: ['eng', 'deu', 'fra', 'ita', 'por', 'hin', 'spa', 'tha'],
    attribution: 'Built with Llama',
    licenseUrl: 'https://github.com/meta-llama/llama-models/blob/main/models/llama3_2/LICENSE',
  },
  {
    base: 'Qwen2.5-0.5B-Instruct',
    label: 'Small (Qwen 2.5 0.5B), for older devices',
    downloadMB: 290,
    vramMB: 945,
    wordsPerSec: 6,
    license: 'Apache 2.0',
  },
];

export function supportsLanguage(model: LocalModel, lang: string): boolean {
  return !model.languages || model.languages.includes(lang);
}

export function modelId(model: LocalModel, f16: boolean): string {
  return `${model.base}-${f16 ? 'q4f16_1' : 'q4f32_1'}-MLC`;
}
