/**
 * desklib/ai-text-detector-v1.01 (MIT), exported to ONNX with its weights stored as
 * int8 and computed in fp32. Plain int8 quantization moves its scores too much;
 * weight-only int8 matches fp32 to within 0.13 logits (scripts/detector-quantize.py).
 */
export const DETECTOR_MODEL = import.meta.env.VITE_DETECTOR_MODEL ?? 'YatoVoid/forsakeai-detector';
/** Overrides the Hugging Face host, for testing against a local copy of the model. */
export const DETECTOR_HOST: string | undefined = import.meta.env.VITE_DETECTOR_HOST;
export const MAX_TOKENS = 512;
/** Texts per forward pass. Padding makes mixed lengths cost the longest one. */
export const BATCH = 6;

export type DetectorDevice = 'webgpu' | 'wasm';

/** Model weights plus the tokenizer, in MB. */
export const DOWNLOAD_MB = 450;

export type WorkerRequest =
  | { type: 'load'; device: DetectorDevice; ortBase: string; model: string; host?: string }
  | { type: 'score'; id: number; texts: string[] };

export type WorkerResponse =
  | { type: 'download'; loaded: number; total: number }
  | { type: 'ready'; device: DetectorDevice }
  | { type: 'batch'; id: number; done: number }
  | { type: 'logits'; id: number; logits: number[] }
  | { type: 'error'; id?: number; message: string };
