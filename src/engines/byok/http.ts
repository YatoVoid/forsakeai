import { EngineError } from '../types';

export const REQUEST_TIMEOUT_MS = 120_000;

export function withTimeout(signal: AbortSignal, ms = REQUEST_TIMEOUT_MS): AbortSignal {
  return AbortSignal.any([signal, AbortSignal.timeout(ms)]);
}

export function abortError(signal: AbortSignal, provider: string): EngineError {
  if (signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError') {
    return new EngineError('timeout', `${provider} took too long to answer.`, { provider });
  }
  return new EngineError('aborted', 'Stopped', { provider });
}

function retryAfterMs(res: Response): number | undefined {
  const raw = res.headers.get('retry-after');
  if (!raw) return undefined;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return seconds * 1000;
  const date = Date.parse(raw);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

export async function errorFromResponse(res: Response, provider: string): Promise<EngineError> {
  let detail = '';
  try {
    const body = (await res.json()) as { error?: { message?: string } | string; message?: string };
    detail = typeof body.error === 'string' ? body.error : (body.error?.message ?? body.message ?? '');
  } catch {
    // Body wasn't JSON; the status code is enough.
  }
  const status = res.status;
  const opts = { status, provider, retryAfterMs: retryAfterMs(res) };
  const suffix = detail ? ` ${detail}` : '';
  if (status === 401 || status === 403) return new EngineError('auth', `That key was rejected by ${provider} (${status}).${suffix}`, opts);
  if (status === 404) return new EngineError('not-found', `${provider} doesn't know that model (404).${suffix}`, opts);
  if (status === 429) return new EngineError('rate-limit', `${provider} is rate-limiting your key.`, opts);
  if (status >= 500) return new EngineError('server', `${provider} had a server error (${status}).`, opts);
  return new EngineError('bad-request', `${provider} rejected the request (${status}).${suffix}`, opts);
}

export function networkError(err: unknown, signal: AbortSignal, provider: string): EngineError {
  if (signal.aborted) return abortError(signal, provider);
  if (err instanceof EngineError) return err;
  return new EngineError(
    'network',
    navigator.onLine
      ? `Couldn't reach ${provider}. It may block requests from browsers, or the network dropped.`
      : "You're offline.",
    { provider },
  );
}

/** Reads a `text/event-stream` body and yields each `data:` payload. */
export async function* sse(res: Response): AsyncGenerator<string> {
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let idx: number;
    while ((idx = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const event = buffer.slice(0, idx);
      buffer = buffer.slice(idx).replace(/^\r?\n\r?\n/, '');
      const data = event
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (data) yield data;
    }
  }
}
