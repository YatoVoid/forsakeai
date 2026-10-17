export interface CompletionRequest {
  system: string;
  user: string;
  signal: AbortSignal;
  /** Upper bound on generated tokens. Engines that run small models honour it; API engines ignore it. */
  maxTokens?: number;
  /** Called with the running count of generated characters. */
  onProgress?: (chars: number) => void;
}

export interface Engine {
  kind: 'local' | 'byok';
  label: string;
  /** How many chunks may run at once. */
  concurrency: number;
  /**
   * 'sentence' asks for one sentence per request. Small models (1.5B and
   * under) can't follow the multi-sentence tagged format reliably.
   */
  granularity?: 'passage' | 'sentence';
  complete(req: CompletionRequest): Promise<string>;
}

export type EngineErrorCode =
  | 'auth'
  | 'rate-limit'
  | 'network'
  | 'server'
  | 'bad-request'
  | 'not-found'
  | 'aborted'
  | 'timeout';

export class EngineError extends Error {
  constructor(
    readonly code: EngineErrorCode,
    message: string,
    readonly opts: { status?: number; retryAfterMs?: number; provider?: string } = {},
  ) {
    super(message);
    this.name = 'EngineError';
  }

  get retryable(): boolean {
    return this.code === 'rate-limit' || this.code === 'network' || this.code === 'server' || this.code === 'timeout';
  }
}
