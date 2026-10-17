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
    base: 'Qwen2.5-0.5B-Instruct',
    label: 'Small (Qwen 2.5 0.5B), for older devices',
    downloadMB: 290,
    vramMB: 945,
    wordsPerSec: 6,
    license: 'Apache 2.0',
  },
];

export function modelId(model: LocalModel, f16: boolean): string {
  return `${model.base}-${f16 ? 'q4f16_1' : 'q4f32_1'}-MLC`;
}
