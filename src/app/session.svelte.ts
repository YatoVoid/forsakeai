import { createByokEngine, providerInfo, type ByokConfig } from '../engines/byok/providers';
import { isModelCached, loadLocalEngine, requestPersistence, unloadLocalEngine, type LoadProgress } from '../engines/local/engine';
import { LOCAL_MODELS, smallerModel, type LocalModel } from '../engines/local/models';
import { probeDevice, type ProbeResult } from '../engines/local/probe';
import { EngineError, type Engine } from '../engines/types';
import type { Chunk } from '../pipeline/chunk';
import { applyDialect, type Dialect } from '../pipeline/dialect';
import { parse, proposedText, serialize } from '../pipeline/parse';
import type { PassMode, Register } from '../pipeline/prompt';
import { rulePass, type RulePassSummary } from '../pipeline/rulepass';
import { indexDoc, isChunkDone, isProse, rewriteDoc, sentenceVariants, type MeaningScorer, type RewriteScope } from '../pipeline/run';
import { MEANING_DOWNLOAD_MB } from '../meaning/protocol';
import type { Doc, Sentence } from '../pipeline/types';
import type { LangDetect } from '../pipeline/validate';
import { buildVoiceProfile, type VoiceProfile } from '../pipeline/voice';
import { formatDuration, Pace } from '../status/eta';
import { analyze, type Analysis, type Band } from '../detector/analyze';
import { downloadMB, isCheckerCached, loadChecker, pickDevice, scoreTexts, unloadChecker, type LoadProgress as CheckerLoad } from '../detector/client';
import { pickBest } from '../detector/refine';
import type { DetectorDevice } from '../detector/protocol';
import { sentenceText } from '../pipeline/parse';
import { claimJob, deleteJob, latestUnfinishedJob, newJobId, pruneJobs, saveJob, type EngineChoice, type Job } from '../store/jobs';

export type Phase = 'empty' | 'review' | 'running' | 'paused' | 'done';

export type CheckState =
  | { kind: 'idle' }
  | { kind: 'confirm'; device: DetectorDevice; mb: number }
  | { kind: 'working' }
  | { kind: 'done'; result: Analysis }
  | { kind: 'error'; message: string };

export interface Status {
  text: string;
  /** 0..1 for the progress line, or null when there is nothing to measure. */
  fraction: number | null;
  tone: 'quiet' | 'working' | 'error';
}

const HEARTBEAT_MS = 10_000;
const VOICE_KEY = 'forsakeai.voice';
const DIALECT_KEY = 'forsakeai.dialect';

function readStored(key: string): string {
  try {
    return localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writeStored(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Remembering settings is a convenience; private windows may block it.
  }
}
// Whatever the page shipped with, so language pages keep their own titles.
const SAVE_INTERVAL_MS = 1000;
const APP_TITLE = typeof document === 'undefined' ? 'ForsakeAI' : document.title;

export class Session {
  phase = $state<Phase>('empty');
  input = $state('');
  doc = $state<Doc | null>(null);
  summary = $state<RulePassSummary | null>(null);
  register = $state<Register>('keep');
  scope = $state<RewriteScope>('all');
  /** Target sentences in the current run, for the progress bar. */
  sentencesTotal = $state(0);
  sentencesDone = $state(0);
  stopping = $state(false);
  status = $state<Status>({ text: '', fraction: null, tone: 'quiet' });
  selectedId = $state<string | null>(null);
  /** Sentences the model is on right now; separate from the reader's selection. */
  workingIds = $state<string[]>([]);
  probe = $state<ProbeResult | null>(null);
  localModel = $state<LocalModel>(LOCAL_MODELS[0]!);
  localCached = $state(false);
  resumable = $state<Job | null>(null);
  notifyWhenDone = $state(false);
  chunksTotal = $state(0);
  chunksDone = $state(0);
  check = $state<CheckState>({ kind: 'idle' });
  /** Worst band per paragraph from the last check, for the margin colours. */
  checkBands = $derived.by(() => {
    const out = new Map<string, { band: Band; ai: number }>();
    if (this.check.kind !== 'done') return out;
    for (const p of this.check.result.windows) {
      for (const id of p.blockIds) {
        const was = out.get(id);
        if (!was || p.ai > was.ai) out.set(id, { band: p.band, ai: p.ai });
      }
    }
    return out;
  });
  checkFlags = $derived(new Set(this.check.kind === 'done' ? this.check.result.flagged.map((f) => f.id) : []));
  voiceSample = $state(readStored(VOICE_KEY));
  dialect = $state<Dialect>((readStored(DIALECT_KEY) as Dialect) || 'as-written');

  voice = $derived<VoiceProfile | null>(buildVoiceProfile(this.voiceSample, this.doc?.lang ?? 'eng'));

  private job: Job | null = null;
  /** Sentences the last check flagged, waiting for detector-picked rewrites on the next run. */
  private refineIds: string[] | null = null;
  private lastScore: number | null = null;
  /** franc's trigram tables are large, so detection loads on first use. */
  private detect: LangDetect | null = null;
  private controller: AbortController | null = null;
  private release: (() => void) | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private lastEngine: EngineChoice | null = null;
  private lastByok: ByokConfig | null = null;

  changes = $derived.by(() => {
    if (!this.doc) return 0;
    let n = 0;
    for (const b of this.doc.blocks) for (const s of b.sentences) if (proposedText(s) !== s.source) n++;
    return n;
  });

  private waiting(scope: RewriteScope): Sentence[] {
    if (!this.doc) return [];
    const out: Sentence[] = [];
    for (const b of this.doc.blocks) {
      if (scope === 'all' && !isProse(b)) continue;
      for (const s of b.sentences) {
        if (!s.text || s.edited || s.status === 'rewritten' || s.status === 'kept') continue;
        if (scope === 'all' || s.stiff) out.push(s);
      }
    }
    return out;
  }

  /** Stiff sentences the model hasn't handled yet. */
  stiffLeft = $derived(this.waiting('stiff').length);
  /** Every prose sentence the model hasn't handled yet. */
  allLeft = $derived(this.waiting('all').length);
  remaining = $derived(this.scope === 'all' ? this.allLeft : this.stiffLeft);

  /** Words in the sentences still waiting for a rewrite, for time estimates. */
  remainingWords = $derived(this.waiting(this.scope).reduce((n, s) => n + s.text.split(/\s+/).length, 0));

  paragraphsChanged = $derived.by(() => {
    if (!this.doc) return 0;
    return this.doc.blocks.filter((b) => b.sentences.some((s) => proposedText(s) !== s.source)).length;
  });

  async init(): Promise<void> {
    this.resumable = (await latestUnfinishedJob()) ?? null;
    void pruneJobs();
  }

  async probeDevice(): Promise<void> {
    if (this.probe) return;
    this.say('Checking your graphics card…', null, 'working');
    this.probe = await probeDevice();
    if (this.probe.ok) {
      this.localModel = this.probe.recommended;
      this.localCached = await isModelCached(this.localModel, this.probe.f16);
    }
    this.say('', null, 'quiet');
  }

  async chooseLocalModel(model: LocalModel): Promise<void> {
    this.localModel = model;
    if (this.probe?.ok) this.localCached = await isModelCached(model, this.probe.f16);
  }

  private async lang(): Promise<LangDetect> {
    this.detect ??= (await import('../lib/lang')).detectLang;
    return this.detect;
  }

  async clean(): Promise<void> {
    const text = this.input.trim() ? this.input : '';
    if (!text) {
      this.say('Nothing here yet. Paste something stiff.', null, 'quiet');
      return;
    }
    const doc = parse(text, await this.lang());
    const summary = rulePass(doc);
    applyDialect(doc, this.dialect);
    this.doc = doc;
    this.summary = summary;
    this.selectedId = null;
    this.job = {
      id: newJobId(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      input: text,
      doc: $state.snapshot(doc) as Doc,
      register: this.register,
      status: 'reviewing',
      chunksTotal: 0,
      chunksDone: 0,
    };
    // Rewriting everything is what moves AI detectors; fixing only flagged phrases is the lighter option.
    this.scope = 'all';
    this.phase = 'review';
    this.say('', null, 'quiet');
  }

  editDraft(): void {
    if (this.phase === 'running') return;
    if (this.doc) this.input = serialize(this.doc);
    this.doc = null;
    this.summary = null;
    this.phase = 'empty';
    this.say('', null, 'quiet');
    document.title = APP_TITLE;
  }

  async rewriteOnDevice(): Promise<void> {
    if (!this.probe?.ok) return;
    const choice: EngineChoice = { kind: 'local', model: this.localModel.base };
    await this.start(choice, async () => {
      await requestPersistence();
      const f16 = (this.probe as { f16: boolean }).f16;
      for (;;) {
        try {
          const engine = await loadLocalEngine(this.localModel, f16, (p) => this.onLoad(p));
          this.localCached = true;
          return engine;
        } catch (err) {
          const next = smallerModel(this.localModel);
          if (!(err instanceof EngineError) || err.opts.provider !== 'memory' || !next) throw err;
          this.say(`${this.localModel.label} doesn’t fit on this graphics card. Switching to ${next.label}.`, null, 'working');
          this.localModel = next;
          this.lastEngine = { kind: 'local', model: next.base };
          if (this.job?.engine?.kind === 'local') this.job.engine = this.lastEngine;
        }
      }
    });
  }

  async rewriteWithKey(cfg: ByokConfig): Promise<void> {
    this.lastByok = cfg;
    const choice: EngineChoice = { kind: 'byok', provider: cfg.provider, model: cfg.model, baseUrl: cfg.baseUrl };
    await this.start(choice, async () => createByokEngine(cfg));
  }

  private onLoad(p: LoadProgress): void {
    const total = this.localModel.downloadMB;
    if (p.phase === 'download') {
      const fetched = p.fetchedMB ?? Math.round(p.fraction * total);
      this.say(`Downloading model · ${fetched.toLocaleString()} / ${total.toLocaleString()} MB · only once, it stays in your browser`, p.fraction, 'working');
    } else if (p.phase === 'cache') {
      this.say('Warming up the model · 1 of 2 steps', p.fraction, 'working');
    } else {
      this.say('Warming up the model · 2 of 2 steps', p.fraction, 'working');
    }
  }

  private async start(choice: EngineChoice, makeEngine: () => Promise<Engine>): Promise<void> {
    if (!this.doc || !this.job || this.phase === 'running') return;
    const release = await claimJob(this.job.id);
    if (!release) {
      this.say('This draft is already being rewritten in another tab.', null, 'error');
      return;
    }
    this.release = release;
    // A check describes the text before this run, and its model would crowd the graphics card.
    this.check = { kind: 'idle' };
    unloadChecker();
    this.lastEngine = choice;
    this.job.engine = choice;
    this.job.register = this.register;
    this.job.scope = this.scope;
    this.phase = 'running';
    this.stopping = false;
    this.sentencesTotal = 0;
    this.sentencesDone = 0;
    this.controller = new AbortController();
    const signal = this.controller.signal;

    let engine: Engine;
    try {
      engine = await untilAborted(makeEngine(), signal);
    } catch (err) {
      if (err instanceof EngineError && err.code === 'aborted') {
        if (choice.kind === 'local') unloadLocalEngine();
        this.pauseState();
      } else {
        this.fail(err);
      }
      return;
    }

    // Small models drift in meaning, so their rewrites get an embedding check.
    // If it can't download, the word-overlap check still runs.
    let meaning: MeaningScorer | null = null;
    if (engine.granularity === 'sentence') {
      try {
        const { loadMeaning } = await import('../meaning/client');
        meaning = await untilAborted(
          loadMeaning((mb, total) => {
            if (signal.aborted) return;
            // The small config files report first; show sizes once the model file is counted.
            const all = total > 10 ? total : MEANING_DOWNLOAD_MB;
            this.say(`Downloading the meaning check · ${Math.round(mb)} / ${Math.round(all)} MB · only once`, Math.min(1, mb / all), 'working');
          }),
          signal,
        );
      } catch {
        meaning = null;
      }
    }

    if (this.refineIds) {
      const ids = this.refineIds;
      this.refineIds = null;
      await this.refine(ids, engine, meaning, signal, choice);
      return;
    }

    const index = indexDoc(this.doc);
    const pace = new Pace();
    const started = new Map<string, number>();
    let current: Chunk | null = null;
    let pass: PassMode = 'rewrite';
    let waitingUntil = 0;
    this.job.status = 'rewriting';
    await this.persist();

    const render = () => {
      if (Date.now() < waitingUntil || this.stopping) return;
      const left = this.chunksTotal - this.chunksDone;
      const wps = pace.wordsPerSec();
      const eta = pace.etaMs(left, engine.concurrency);
      const last = pace.lastTokenAt();
      const where = current && this.sentencesTotal ? `sentence ${Math.min(this.sentencesDone + 1, this.sentencesTotal)} of ${this.sentencesTotal}` : '';
      const stalled = engine.kind === 'local' && last !== null && performance.now() - last > HEARTBEAT_MS;
      if (stalled) {
        const secs = Math.round((performance.now() - last!) / 1000);
        this.say(`Still working. Your GPU is busy on a long sentence, nothing is stuck · ${secs} s`, this.fraction(), 'working');
        return;
      }
      const parts = [pass === 'audit' ? 'Checking the rewrites' : 'Rewriting', where];
      if (wps) parts.push(`${Math.round(wps)} words/sec`);
      if (eta) parts.push(`~${formatDuration(eta)} left`);
      this.say(parts.filter(Boolean).join(' · '), this.fraction(), 'working');
      document.title = `(${this.sentencesDone}/${this.sentencesTotal}) ${APP_TITLE}`;
    };

    this.heartbeat = setInterval(render, 1000);
    render();

    try {
      await rewriteDoc(
        this.doc,
        engine,
        { register: this.register, scope: this.scope, signal, detect: await this.lang(), voice: this.register === 'sample' ? this.voice : null, meaning },
        {
          onPass: (mode, chunks) => {
            pass = mode;
            const targets = chunks.flatMap((c) => c.targets).filter((id) => {
              const s = index.get(id)?.sentence;
              return s && (mode === 'audit' ? !s.audited : s.status !== 'rewritten' && s.status !== 'kept');
            }).length;
            this.sentencesTotal = (mode === 'rewrite' ? 0 : this.sentencesDone) + targets;
            if (mode === 'rewrite') this.sentencesDone = 0;
            const done = chunks.filter((c) => isChunkDone(c, index, mode)).length;
            if (mode === 'rewrite') {
              this.chunksTotal = chunks.length;
              this.chunksDone = done;
            } else {
              this.chunksTotal += chunks.length;
              this.chunksDone += done;
            }
            if (this.job) this.job.chunksTotal = this.chunksTotal;
          },
          onChunkStart: (chunk, mode) => {
            current = chunk;
            started.set(mode + chunk.index, performance.now());
            pace.chunkStarted();
            if (engine.granularity !== 'sentence') this.workingIds = chunk.targets.slice(0, 1);
          },
          onProgress: (chars) => pace.progress(chars),
          onSentenceStart: (id) => (this.workingIds = [...this.workingIds, id]),
          onSentenceDone: async (id) => {
            this.workingIds = this.workingIds.filter((w) => w !== id);
            this.sentencesDone++;
            render();
            await this.persistSoon();
          },
          onWait: (ms, err) => {
            waitingUntil = Date.now() + ms;
            const secs = Math.ceil(ms / 1000);
            const text = !navigator.onLine
              ? "You're offline. Waiting for the connection, then continuing."
              : err.code === 'rate-limit'
                ? `${err.opts.provider ?? 'The provider'} is rate-limiting your key. Waiting ${secs} s, then continuing automatically.`
                : `${err.message} Trying again in ${secs} s.`;
            this.say(text, this.fraction(), 'working');
          },
          onChunkDone: async (chunk, _outcome, mode) => {
            pace.chunkFinished(performance.now() - (started.get(mode + chunk.index) ?? performance.now()));
            this.chunksDone++;
            await this.persist();
            render();
          },
        },
      );
      applyDialect(this.doc, this.dialect);
      this.finish();
    } catch (err) {
      if (err instanceof EngineError && err.code === 'aborted') this.pauseState();
      else this.fail(err);
    } finally {
      this.workingIds = [];
      this.stopTimers();
    }
  }

  private fraction(): number | null {
    if (this.sentencesTotal) return this.sentencesDone / this.sentencesTotal;
    return this.chunksTotal ? this.chunksDone / this.chunksTotal : null;
  }

  /** Stops at once while loading; mid-sentence the model is interrupted and the sentence stays as it was. */
  pause(): void {
    if (this.phase !== 'running' || this.stopping) return;
    this.stopping = true;
    this.say('Pausing…', this.fraction(), 'working');
    this.controller?.abort();
  }

  async resume(): Promise<void> {
    const choice = this.lastEngine ?? this.job?.engine;
    if (!choice) return;
    if (choice.kind === 'local') {
      await this.probeDevice();
      const model = LOCAL_MODELS.find((m) => m.base === choice.model);
      if (model) this.localModel = model;
      await this.rewriteOnDevice();
    } else if (this.lastByok) {
      await this.rewriteWithKey(this.lastByok);
    } else {
      this.phase = 'paused';
      this.say(`Add your ${providerInfo(choice.provider as never)?.label ?? ''} key again to continue.`, this.fraction(), 'quiet');
    }
  }

  private pauseState(): void {
    this.stopping = false;
    this.phase = 'paused';
    if (this.job) this.job.status = 'paused';
    void this.persist();
    this.say(`Paused. ${this.remaining} ${this.remaining === 1 ? 'sentence' : 'sentences'} left; finished ones are kept.`, this.fraction(), 'quiet');
    document.title = APP_TITLE;
    this.releaseLock();
  }

  private fail(err: unknown): void {
    this.stopping = false;
    this.phase = 'paused';
    if (this.job) this.job.status = 'paused';
    void this.persist();
    const message = err instanceof Error ? err.message : String(err);
    this.say(message, this.fraction(), 'error');
    document.title = APP_TITLE;
    this.releaseLock();
  }

  private finish(): void {
    this.phase = 'done';
    if (this.job) this.job.status = 'done';
    void this.persist();
    this.say('', null, 'quiet');
    document.title = APP_TITLE;
    this.releaseLock();
    if (this.notifyWhenDone && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('ForsakeAI', { body: this.doneLine() });
    }
  }

  doneLine(): string {
    const n = this.changes;
    if (!n) return 'Done. Nothing needed changing.';
    return `Done. ${n} ${n === 1 ? 'change' : 'changes'} in ${this.paragraphsChanged} ${this.paragraphsChanged === 1 ? 'paragraph' : 'paragraphs'}. Read it before you send it.`;
  }

  private stopTimers(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private releaseLock(): void {
    this.release?.();
    this.release = null;
  }

  private lastSaved = 0;

  /**
   * Saving copies the whole document, so per-sentence progress on a long text
   * saves at most about once a second. Passages, pauses and the end of a run
   * still save straight away.
   */
  private async persistSoon(): Promise<void> {
    const now = performance.now();
    if (now - this.lastSaved < SAVE_INTERVAL_MS) return;
    this.lastSaved = now;
    await this.persist();
  }

  private async persist(): Promise<void> {
    if (!this.job || !this.doc) return;
    this.job.doc = $state.snapshot(this.doc) as Doc;
    this.job.chunksDone = this.chunksDone;
    if (!(await saveJob(this.job))) console.warn('ForsakeAI: could not save progress; resume after reload will not work.');
  }

  async restore(saved: Job): Promise<void> {
    const job = $state.snapshot(saved) as Job;
    this.job = job;
    this.doc = job.doc;
    this.input = job.input;
    this.register = job.register;
    this.scope = job.scope ?? 'all';
    this.lastEngine = job.engine ?? null;
    this.chunksTotal = job.chunksTotal;
    this.chunksDone = job.chunksDone;
    this.resumable = null;
    this.phase = 'paused';
    const ref = this.firstUnfinished();
    this.say(
      `You left mid-edit. ${this.remaining} ${this.remaining === 1 ? 'sentence' : 'sentences'} still to rewrite.`,
      this.fraction(),
      'quiet',
    );
    if (ref) this.selectedId = ref.id;
  }

  async discardResumable(): Promise<void> {
    if (this.resumable) await deleteJob(this.resumable.id);
    this.resumable = null;
  }

  private firstUnfinished(): Sentence | undefined {
    if (!this.doc) return undefined;
    for (const b of this.doc.blocks) for (const s of b.sentences) if (s.stiff && s.status !== 'rewritten' && s.status !== 'kept') return s;
    return undefined;
  }

  async startCheck(): Promise<void> {
    if (!this.doc || this.phase === 'running') return;
    const device = await pickDevice();
    // On the processor the detector took over 15 minutes for a 500-word text.
    if (device !== 'webgpu') {
      this.check = { kind: 'error', message: 'The AI check needs WebGPU, which this browser or device doesn’t have. It works in recent Chrome, Edge and Safari on a computer with a graphics card.' };
      return;
    }
    if (await isCheckerCached()) await this.runCheck(device);
    else this.check = { kind: 'confirm', device, mb: downloadMB() };
  }

  cancelCheck(): void {
    this.check = { kind: 'idle' };
  }

  async runCheck(device: DetectorDevice): Promise<void> {
    if (!this.doc) return;
    this.check = { kind: 'working' };
    try {
      // The rewrite model and the detector don't both fit on most graphics cards.
      if (device === 'webgpu') unloadLocalEngine();
      const result = await this.checkNow(device);
      this.check = { kind: 'done', result };
      const n = result.flagged.length;
      this.say(`AI check: ${Math.round(result.ai * 100)}%${n ? `, ${n} ${n === 1 ? 'sentence' : 'sentences'} flagged` : ''}.`, null, 'quiet');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.check = { kind: 'error', message: `The AI check failed: ${message}` };
      this.say(this.check.message, null, 'error');
    }
  }

  private checkBlocks() {
    return (this.doc?.blocks ?? []).filter(isProse).map((b) => ({
      id: b.id,
      sentences: b.sentences.map((s) => ({ id: s.id, text: sentenceText(s) })),
    }));
  }

  private async loadCheck(device: DetectorDevice): Promise<void> {
    this.say('Loading the AI check…', null, 'working');
    // Transformers.js reports progress for cached files too; only a real download gets the download line.
    const cached = await isCheckerCached();
    await loadChecker(device, (p: CheckerLoad) => {
      if (!cached && p.totalMB > 0) {
        this.say(
          `Downloading the AI check · ${Math.round(p.loadedMB).toLocaleString()} / ${Math.round(p.totalMB).toLocaleString()} MB · only once`,
          p.loadedMB / p.totalMB,
          'working',
        );
      }
    });
  }

  private async checkNow(device: DetectorDevice): Promise<Analysis> {
    await this.loadCheck(device);
    this.say('Checking…', 0, 'working');
    const result = await analyze(this.checkBlocks(), scoreTexts, (done, total) => this.say(`Checking · ${done} of ${total} passes`, done / total, 'working'));
    if (!result.windows.length) throw new Error('There is not enough prose to check. It needs paragraphs of about 20 words or more.');
    return result;
  }

  /**
   * Writes several versions of each flagged sentence, then lets the detector pick.
   * The two models take turns on the graphics card: all versions first, then the scoring.
   */
  private async refine(ids: string[], engine: Engine, meaning: MeaningScorer | null, signal: AbortSignal, choice: EngineChoice): Promise<void> {
    const doc = this.doc!;
    const before = this.lastScore;
    this.sentencesTotal = ids.length;
    this.sentencesDone = 0;
    try {
      const detect = await this.lang();
      const versions = new Map<string, string[]>();
      for (const id of ids) {
        this.workingIds = [id];
        this.say(`Writing versions · sentence ${this.sentencesDone + 1} of ${ids.length}`, this.fraction(), 'working');
        versions.set(id, await sentenceVariants(doc, id, engine, { register: this.register, signal, detect, voice: this.register === 'sample' ? this.voice : null, meaning }));
        this.sentencesDone++;
      }
      this.workingIds = [];
      if (choice.kind === 'local') unloadLocalEngine();
      const device = await pickDevice();
      await untilAborted(this.loadCheck(device), signal);
      const picks = await untilAborted(
        pickBest(this.checkBlocks(), versions, scoreTexts, (done, total) => this.say(`Scoring the versions · ${done} of ${total}`, done / total, 'working')),
        signal,
      );
      for (const id of ids) {
        const s = this.find(id);
        if (!s) continue;
        const pick = picks.get(id);
        s.note = undefined;
        if (pick) {
          s.rewrite = pick.text;
          s.status = 'rewritten';
        } else {
          s.status = 'kept';
          s.note = versions.get(id)?.length ? 'None of the new versions scored lower with the AI check.' : 'No new version kept the meaning.';
        }
      }
      this.finish();
      this.check = { kind: 'working' };
      const result = await this.checkNow(device);
      this.check = { kind: 'done', result };
      const now = Math.round(result.ai * 100);
      this.say(`AI check: ${before !== null ? `${before}% → ` : ''}${now}%. ${picks.size} of ${ids.length} sentences changed.`, null, 'quiet');
    } catch (err) {
      if (err instanceof EngineError && err.code === 'aborted') this.pauseState();
      else if (this.phase === 'running') this.fail(err);
      else {
        this.check = { kind: 'error', message: `The AI check failed: ${err instanceof Error ? err.message : String(err)}` };
        this.say(this.check.message, null, 'error');
      }
    } finally {
      this.workingIds = [];
    }
  }

  private markOne(id: string): void {
    const s = this.find(id);
    if (!s) return;
    // Rewrite what the reader sees now: an accepted rewrite, their own edit or a restored original.
    s.text = sentenceText(s);
    s.stiff = true;
    s.audited = false;
    s.auditFlags = undefined;
    s.decision = undefined;
    s.edited = false;
    s.rewrite = undefined;
    s.status = s.text === s.source ? 'clean' : 'fixed';
    s.flags = [...s.flags.filter((f) => f.ruleId !== 'checker'), { ruleId: 'checker', category: 'filler', start: -1, end: -1, match: '', note: 'An AI detector flags this sentence', fixed: false }];
  }

  markForRewrite(id: string): void {
    this.markOne(id);
    this.selectedId = id;
    if (this.phase === 'done') this.phase = 'review';
    void this.persist();
  }

  /** Queues every sentence the last check flagged; the caller starts the rewrite. */
  markFlagged(): number {
    if (this.check.kind !== 'done') return 0;
    const ids = this.check.result.flagged.map((f) => f.id);
    this.lastScore = Math.round(this.check.result.ai * 100);
    this.refineIds = ids;
    for (const id of ids) this.markOne(id);
    this.check = { kind: 'idle' };
    this.scope = 'stiff';
    if (this.phase === 'done') this.phase = 'review';
    void this.persist();
    return ids.length;
  }

  async setNotify(on: boolean): Promise<void> {
    if (on && 'Notification' in window && Notification.permission === 'default') {
      this.notifyWhenDone = (await Notification.requestPermission()) === 'granted';
    } else {
      this.notifyWhenDone = on && 'Notification' in window && Notification.permission === 'granted';
    }
  }

  startOver(): void {
    if (this.phase === 'running') return;
    this.input = '';
    this.doc = null;
    this.summary = null;
    this.selectedId = null;
    this.check = { kind: 'idle' };
    this.phase = 'empty';
    this.say('', null, 'quiet');
    document.title = APP_TITLE;
  }

  setVoiceSample(text: string): void {
    this.voiceSample = text;
    writeStored(VOICE_KEY, text);
  }

  setDialect(d: Dialect): void {
    this.dialect = d;
    writeStored(DIALECT_KEY, d === 'as-written' ? '' : d);
    if (this.doc && this.phase !== 'running' && d !== 'as-written') {
      const n = applyDialect(this.doc, d);
      void this.persist();
      this.say(n ? `Spelling switched to ${d === 'us' ? 'US' : 'UK'} English in ${n} ${n === 1 ? 'sentence' : 'sentences'}.` : 'Spelling already matches.', null, 'quiet');
    }
  }

  find(id: string): Sentence | undefined {
    if (!this.doc) return undefined;
    for (const b of this.doc.blocks) for (const s of b.sentences) if (s.id === id) return s;
    return undefined;
  }

  decide(id: string, decision: 'accepted' | 'rejected'): void {
    const s = this.find(id);
    if (!s || (proposedText(s) === s.source && !s.group)) return;
    const next = s.decision === decision ? undefined : decision;
    // Text moved between grouped sentences, so restoring one alone would duplicate or drop it.
    const members = s.group && this.doc ? this.doc.blocks.flatMap((b) => b.sentences).filter((x) => x.group === s.group) : [s];
    for (const m of members) m.decision = next;
    void this.persist();
  }

  /** The reader's own wording. It counts as done, so later rewrites skip it. */
  editSentence(id: string, text: string): void {
    const s = this.find(id);
    if (!s || this.phase === 'running') return;
    const next = text.replace(/\s+/g, ' ').trim();
    if (next === sentenceText(s)) return;
    s.rewrite = next;
    s.status = 'rewritten';
    s.edited = true;
    s.audited = true;
    s.decision = undefined;
    s.note = undefined;
    void this.persist();
  }

  decideAll(decision: 'accepted' | 'rejected'): void {
    if (!this.doc) return;
    for (const b of this.doc.blocks) for (const s of b.sentences) if (proposedText(s) !== s.source) s.decision = decision;
    void this.persist();
  }

  output(): string {
    return this.doc ? serialize(this.doc) : this.input;
  }

  say(text: string, fraction: number | null, tone: Status['tone']): void {
    this.status = { text, fraction, tone };
  }
}

/** Lets Pause stop the wait for a slow load. The load itself may finish in the background. */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new EngineError('aborted', 'Stopped'));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new EngineError('aborted', 'Stopped'));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}
