/** Tracks generation speed and chunk timing to estimate time left. */
export class Pace {
  private chunkTimes: number[] = [];
  private samples: Array<{ t: number; chars: number }> = [];
  private totalChars = 0;
  private lastChunkChars = 0;

  constructor(private readonly now: () => number = () => performance.now()) {}

  progress(charsInCurrentChunk: number): void {
    const delta = Math.max(0, charsInCurrentChunk - this.lastChunkChars);
    this.lastChunkChars = charsInCurrentChunk;
    this.totalChars += delta;
    const t = this.now();
    this.samples.push({ t, chars: this.totalChars });
    while (this.samples.length > 2 && t - this.samples[0]!.t > 15_000) this.samples.shift();
  }

  chunkStarted(): void {
    this.lastChunkChars = 0;
  }

  chunkFinished(durationMs: number): void {
    this.lastChunkChars = 0;
    this.chunkTimes.push(durationMs);
    if (this.chunkTimes.length > 8) this.chunkTimes.shift();
  }

  /** Words per second over the last 15 s, assuming ~5.5 characters per word. */
  wordsPerSec(): number | null {
    if (this.samples.length < 2) return null;
    const first = this.samples[0]!;
    const last = this.samples.at(-1)!;
    const seconds = (last.t - first.t) / 1000;
    if (seconds < 1) return null;
    return (last.chars - first.chars) / 5.5 / seconds;
  }

  etaMs(chunksLeft: number, concurrency: number): number | null {
    if (!this.chunkTimes.length) return null;
    const avg = this.chunkTimes.reduce((a, b) => a + b, 0) / this.chunkTimes.length;
    return (avg * chunksLeft) / Math.max(1, concurrency);
  }

  lastTokenAt(): number | null {
    return this.samples.at(-1)?.t ?? null;
  }
}

export function formatDuration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${Math.max(1, s)} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}
