import { EngineError, type CompletionRequest, type Engine } from '../types';
import { abortError, errorFromResponse, networkError, sse, withTimeout } from './http';

export type ProviderId = 'openai' | 'anthropic' | 'gemini' | 'openrouter' | 'groq' | 'mistral' | 'local';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  keyRequired: boolean;
  keyUrl?: string;
  defaultModel?: string;
  /** Requests run in parallel up to this limit. */
  concurrency: number;
}

export const PROVIDERS: ProviderInfo[] = [
  // First and default: Gemini Flash has a free tier, so it's the no-cost way to get strong rewrites.
  // Free-tier rate limits are low, hence two requests at a time.
  {
    id: 'gemini',
    label: 'Google Gemini',
    keyRequired: true,
    keyUrl: 'https://aistudio.google.com/apikey',
    defaultModel: 'gemini-3.8-flash',
    concurrency: 2,
  },
  { id: 'openai', label: 'OpenAI', keyRequired: true, keyUrl: 'https://platform.openai.com/api-keys', concurrency: 4 },
  {
    id: 'anthropic',
    label: 'Anthropic',
    keyRequired: true,
    keyUrl: 'https://console.anthropic.com/settings/keys',
    defaultModel: 'claude-opus-5-5',
    concurrency: 4,
  },
  { id: 'openrouter', label: 'OpenRouter', keyRequired: true, keyUrl: 'https://openrouter.ai/keys', concurrency: 4 },
  { id: 'groq', label: 'Groq', keyRequired: true, keyUrl: 'https://console.groq.com/keys', concurrency: 3 },
  { id: 'mistral', label: 'Mistral', keyRequired: true, keyUrl: 'https://console.mistral.ai/api-keys', concurrency: 3 },
  { id: 'local', label: 'Local server (Ollama, LM Studio)', keyRequired: false, concurrency: 1 },
];

export const providerInfo = (id: ProviderId) => PROVIDERS.find((p) => p.id === id)!;

const OPENAI_COMPATIBLE: Partial<Record<ProviderId, string>> = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
  mistral: 'https://api.mistral.ai/v1',
};

export const DEFAULT_LOCAL_URL = 'http://localhost:11434/v1';

/** The page's CSP only allows loopback for custom servers, so check before sending. */
export function isLoopbackUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (url.protocol === 'http:' || url.protocol === 'https:') && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export interface ByokConfig {
  provider: ProviderId;
  key: string;
  model: string;
  baseUrl?: string;
}

function baseUrlFor(cfg: ByokConfig): string {
  if (cfg.provider === 'local') {
    const url = (cfg.baseUrl || DEFAULT_LOCAL_URL).replace(/\/+$/, '');
    if (!isLoopbackUrl(url)) throw new EngineError('bad-request', 'Local server URLs must point to localhost or 127.0.0.1.');
    return url;
  }
  return OPENAI_COMPATIBLE[cfg.provider]!;
}

function openAiHeaders(cfg: ByokConfig): HeadersInit {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cfg.key) headers.authorization = `Bearer ${cfg.key}`;
  if (cfg.provider === 'openrouter') headers['x-title'] = 'ForsakeAI';
  return headers;
}

async function completeOpenAi(cfg: ByokConfig, req: CompletionRequest): Promise<string> {
  const label = providerInfo(cfg.provider).label;
  const signal = withTimeout(req.signal);
  let res: Response;
  try {
    res = await fetch(`${baseUrlFor(cfg)}/chat/completions`, {
      method: 'POST',
      headers: openAiHeaders(cfg),
      signal,
      body: JSON.stringify({
        model: cfg.model,
        stream: true,
        // Hosted reasoning models reject max_tokens, so only local servers get the cap.
        ...(cfg.provider === 'local' && req.maxTokens ? { max_tokens: req.maxTokens } : {}),
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
      }),
    });
  } catch (err) {
    throw networkError(err, signal, label);
  }
  if (!res.ok) throw await errorFromResponse(res, label);

  let text = '';
  try {
    for await (const data of sse(res)) {
      if (data === '[DONE]') break;
      const json = JSON.parse(data) as { choices?: Array<{ delta?: { content?: string } }>; error?: { message?: string } };
      if (json.error) throw new EngineError('server', `${label}: ${json.error.message ?? 'stream error'}`);
      text += json.choices?.[0]?.delta?.content ?? '';
      req.onProgress?.(text.length);
    }
  } catch (err) {
    throw networkError(err, signal, label);
  }
  return text;
}

async function completeGemini(cfg: ByokConfig, req: CompletionRequest): Promise<string> {
  const signal = withTimeout(req.signal);
  const model = cfg.model.replace(/^models\//, '');
  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.key },
        signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: req.system }] },
          contents: [{ role: 'user', parts: [{ text: req.user }] }],
        }),
      },
    );
  } catch (err) {
    throw networkError(err, signal, 'Google');
  }
  if (!res.ok) throw await errorFromResponse(res, 'Google');

  let text = '';
  try {
    for await (const data of sse(res)) {
      const json = JSON.parse(data) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      text += json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      req.onProgress?.(text.length);
    }
  } catch (err) {
    throw networkError(err, signal, 'Google');
  }
  return text;
}

async function completeAnthropic(cfg: ByokConfig, req: CompletionRequest): Promise<string> {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: cfg.key, dangerouslyAllowBrowser: true, maxRetries: 0, timeout: 120_000 });
  const usesEffort = /^claude-(?:opus|sonnet|haiku|fable)-5/.test(cfg.model);
  try {
    const stream = client.messages.stream(
      {
        model: cfg.model,
        max_tokens: 16000,
        system: req.system,
        messages: [{ role: 'user', content: req.user }],
        ...(usesEffort ? { output_config: { effort: 'low' as const } } : {}),
      },
      { signal: req.signal },
    );
    let chars = 0;
    stream.on('text', (delta) => {
      chars += delta.length;
      req.onProgress?.(chars);
    });
    const message = await stream.finalMessage();
    if (message.stop_reason === 'refusal') {
      throw new EngineError('bad-request', 'Anthropic declined to rewrite this passage.', { provider: 'Anthropic' });
    }
    return message.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('');
  } catch (err) {
    throw anthropicError(err, Anthropic, req.signal);
  }
}

type AnthropicModule = typeof import('@anthropic-ai/sdk').default;

function anthropicError(err: unknown, A: AnthropicModule, signal: AbortSignal): EngineError {
  const provider = 'Anthropic';
  if (err instanceof EngineError) return err;
  if (err instanceof A.APIUserAbortError || signal.aborted) return abortError(signal, provider);
  if (err instanceof A.APIConnectionTimeoutError) return new EngineError('timeout', 'Anthropic took too long to answer.', { provider });
  if (err instanceof A.APIConnectionError) return networkError(err, signal, provider);
  if (err instanceof A.AuthenticationError || err instanceof A.PermissionDeniedError) {
    return new EngineError('auth', `That key was rejected by Anthropic (${err.status}).`, { provider, status: err.status });
  }
  if (err instanceof A.NotFoundError) return new EngineError('not-found', "Anthropic doesn't know that model (404).", { provider, status: 404 });
  if (err instanceof A.RateLimitError) {
    const after = Number(err.headers?.get('retry-after'));
    return new EngineError('rate-limit', 'Anthropic is rate-limiting your key.', {
      provider,
      status: 429,
      retryAfterMs: Number.isFinite(after) ? after * 1000 : undefined,
    });
  }
  if (err instanceof A.InternalServerError) return new EngineError('server', `Anthropic had a server error (${err.status}).`, { provider, status: err.status });
  if (err instanceof A.APIError) {
    return new EngineError('bad-request', `Anthropic rejected the request (${err.status ?? 'error'}). ${err.message}`, { provider });
  }
  return new EngineError('network', String(err), { provider });
}

export function createByokEngine(cfg: ByokConfig): Engine {
  const info = providerInfo(cfg.provider);
  const complete =
    cfg.provider === 'anthropic' ? completeAnthropic : cfg.provider === 'gemini' ? completeGemini : completeOpenAi;
  return {
    kind: 'byok',
    label: `${info.label} · ${cfg.model}`,
    concurrency: info.concurrency,
    // Local servers usually run small models that can't follow the passage format.
    granularity: cfg.provider === 'local' ? 'sentence' : 'passage',
    complete: (req) => complete(cfg, req),
  };
}

export async function listModels(cfg: Omit<ByokConfig, 'model'>, signal: AbortSignal): Promise<string[]> {
  const label = providerInfo(cfg.provider).label;
  const timed = withTimeout(signal, 20_000);

  if (cfg.provider === 'anthropic') {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: cfg.key, dangerouslyAllowBrowser: true, maxRetries: 1, timeout: 20_000 });
    try {
      const ids: string[] = [];
      for await (const m of client.models.list({}, { signal })) ids.push(m.id);
      return ids;
    } catch (err) {
      throw anthropicError(err, Anthropic, signal);
    }
  }

  let res: Response;
  try {
    res =
      cfg.provider === 'gemini'
        ? await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
            headers: { 'x-goog-api-key': cfg.key },
            signal: timed,
          })
        : await fetch(`${baseUrlFor({ ...cfg, model: '' })}/models`, { headers: openAiHeaders({ ...cfg, model: '' }), signal: timed });
  } catch (err) {
    throw networkError(err, timed, label);
  }
  if (!res.ok) throw await errorFromResponse(res, label);

  if (cfg.provider === 'gemini') {
    const json = (await res.json()) as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> };
    return (json.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''));
  }
  const json = (await res.json()) as { data?: Array<{ id: string }> };
  return (json.data ?? []).map((m) => m.id).sort();
}
