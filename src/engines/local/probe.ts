import { LOCAL_MODELS, type LocalModel } from './models';

export type ProbeResult =
  | { ok: false; reason: 'no-api' | 'no-adapter'; linuxFirefox: boolean }
  | {
      ok: true;
      f16: boolean;
      maxBufferMB: number;
      deviceMemoryGB?: number;
      vendor: string;
      recommended: LocalModel;
      weak: boolean;
    };

function isLinuxFirefox(): boolean {
  const ua = navigator.userAgent;
  return /Firefox\//.test(ua) && /Linux/.test(ua) && !/Android/.test(ua);
}

export async function probeDevice(): Promise<ProbeResult> {
  const linuxFirefox = isLinuxFirefox();
  if (!('gpu' in navigator) || !navigator.gpu) return { ok: false, reason: 'no-api', linuxFirefox };
  let adapter: GPUAdapter | null = null;
  try {
    adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
  } catch {
    adapter = null;
  }
  if (!adapter) return { ok: false, reason: 'no-adapter', linuxFirefox };

  const maxBufferMB = Math.round(adapter.limits.maxBufferSize / 2 ** 20);
  const deviceMemoryGB = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const weak = (deviceMemoryGB !== undefined && deviceMemoryGB <= 4) || maxBufferMB < 1024;
  return {
    ok: true,
    f16: adapter.features.has('shader-f16'),
    maxBufferMB,
    deviceMemoryGB,
    vendor: adapter.info?.vendor ?? '',
    recommended: weak ? LOCAL_MODELS.find((m) => m.base === 'Qwen3-1.7B')! : LOCAL_MODELS[0]!,
    weak,
  };
}
