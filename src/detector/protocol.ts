export const OBSERVER = 'onnx-community/Qwen2.5-0.5B';
export const PERFORMER = 'onnx-community/Qwen2.5-0.5B-Instruct';
/** Tokens per forward pass; longer windows cost memory for 152k-wide logits. */
export const WINDOW = 256;
export const MAX_TOKENS = 512;

export type DetectorDevice = 'webgpu' | 'wasm';

/** Download size for both models plus the tokenizer, in MB. */
export const DOWNLOAD_MB: Record<DetectorDevice, number> = { webgpu: 970, wasm: 1030 };

export type WorkerRequest =
  | { type: 'load'; device: DetectorDevice; ortBase: string }
  | { type: 'score'; sentences: Array<{ id: string; text: string }>; maxTokens: number };

export type WorkerResponse =
  | { type: 'download'; loaded: number; total: number }
  | { type: 'ready'; device: DetectorDevice }
  | { type: 'scoring'; done: number; total: number }
  | {
      type: 'result';
      device: DetectorDevice;
      tokens: number;
      score: number;
      sentences: Array<{ id: string; score: number | undefined }>;
    }
  | { type: 'error'; message: string };
