import { createByokEngine, providerInfo, type ByokConfig } from '../engines/byok/providers';
import { isModelCached, loadLocalEngine, requestPersistence, type LoadProgress } from '../engines/local/engine';
import { LOCAL_MODELS, type LocalModel } from '../engines/local/models';
import { probeDevice, type ProbeResult } from '../engines/local/probe';
import { EngineError, type Engine } from '../engines/types';
import { detectLang } from '../lib/lang';
import type { Chunk } from '../pipeline/chunk';
import { applyDialect, type Dialect } from '../pipeline/dialect';
import { parse, proposedText, serialize } from '../pipeline/parse';
import type { PassMode, Register } from '../pipeline/prompt';
import { rulePass, type RulePassSummary } from '../pipeline/rulepass';
import { indexDoc, isChunkDone, rewriteDoc } from '../pipeline/run';
import type { Doc, Sentence } from '../pipeline/types';
import { buildVoiceProfile, type VoiceProfile } from '../pipeline/voice';
import { formatDuration, Pace } from '../status/eta';
import { isCheckerCached, loadChecker, pickDevice, runChecker, downloadMB } from '../detector/client';
import type { DetectorDevice } from '../detector/protocol';
import { present, type Calibration, type Presentation } from '../detector/present';
import calibration from '../detector/calibration.json';
import { languageName } from '../pipeline/prompt';
import { sentenceText } from '../pipeline/parse';
import { claimJob, deleteJob, latestUnfinishedJob, newJobId, pruneJobs, saveJob, type EngineChoice, type Job } from '../store/jobs';

export type Phase = 'empty' | 'review' | 'running' | 'paused' | 'done';

export type CheckState =
  | { kind: 'idle' }
  | { kind: 'confirm'; device: DetectorDevice; mb: number }
  | { kind: 'working' }
  | { kind: 'done'; result: Presentation; langName: string; quotes: Array<{ id: string; text: string }> }
  | { kind: 'error'; message: string };

export interface Status {
  text: string;
  /** 0..1 for the progress line, or null when there is nothing to measure. */
  fraction: number | null;
  tone: 'quiet' | 'working' | 'error';
}

const HEARTBEAT_MS = 10_000;
const VOICE_KEY = 'plainhand.voice';
const DIALECT_KEY = 'plainhand.dialect';

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
const APP_TITLE = 'Plainhand';

export class Session {
  phase = $state<Phase>('empty');
  input = $state('');
  doc = $state<Doc | null>(null);
  summary = $state<RulePassSummary | null>(null);
  register = $state<Register>('keep');
  status = $state<Status>({ text: '', fraction: null, tone: 'quiet' });
  selectedId = $state<string | null>(null);
  probe = $state<ProbeResult | null>(null);
  localModel = $state<LocalModel>(LOCAL_MODELS[0]!);
  localCached = $state(false);
  resumable = $state<Job | null>(null);
  notifyWhenDone = $state(false);
  chunksTotal = $state(0);
  chunksDone = $state(0);
  check = $state<CheckState>({ kind: 'idle' });
  readonly checkerEnabled = typeof location !== 'undefined' && new URLSearchParams(location.search).has('checker');
  voiceSample = $state(readStored(VOICE_KEY));
  dialect = $state<Dialect>((readStored(DIALECT_KEY) as Dialect) || 'as-written');

  voice = $derived<VoiceProfile | null>(buildVoiceProfile(this.voiceSample, this.doc?.lang ?? 'eng'));

  private job: Job | null = null;
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

  /** Stiff sentences the model hasn't handled yet. */
  remaining = $derived.by(() => {
    if (!this.doc) return 0;
    let n = 0;
    for (const b of this.doc.blocks) for (const s of b.sentences) if (s.stiff && s.text && s.status !== 'rewritten' && s.status !== 'kept') n++;
    return n;
  });

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
    this.say(this.reviewLine(), null, 'quiet');
  }

  async chooseLocalModel(model: LocalModel): Promise<void> {
    this.localModel = model;
    if (this.probe?.ok) this.localCached = await isModelCached(model, this.probe.f16);
  }

  clean(): void {
    const text = this.input.trim() ? this.input : '';
    if (!text) {
      this.say('Nothing here yet. Paste something stiff.', null, 'quiet');
      return;
    }
    const doc = parse(text, detectLang);
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
    this.phase = 'review';
    this.say(this.reviewLine(), null, 'quiet');
  }

  private reviewLine(): string {
    const s = this.summary;
    if (!s) return '';
    const parts: string[] = [];
    if (s.fixed) parts.push(`${s.fixed} ${s.fixed === 1 ? 'fix' : 'fixes'} made`);
    if (s.stiffSentences) parts.push(`${s.stiffSentences} stiff ${s.stiffSentences === 1 ? 'sentence' : 'sentences'} left for a rewrite`);
    if (!parts.length) return 'No stiff phrases found. It already reads like a person.';
    return `${parts.join(', ')}.`;
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
      const engine = await loadLocalEngine(this.localModel, (this.probe as { f16: boolean }).f16, (p) => this.onLoad(p));
      this.localCached = true;
      return engine;
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
    this.lastEngine = choice;
    this.job.engine = choice;
    this.job.register = this.register;
    this.phase = 'running';
    this.controller = new AbortController();
    const signal = this.controller.signal;

    let engine: Engine;
    try {
      engine = await makeEngine();
    } catch (err) {
      this.fail(err);
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
      if (Date.now() < waitingUntil) return;
      const left = this.chunksTotal - this.chunksDone;
      const wps = pace.wordsPerSec();
      const eta = pace.etaMs(left, engine.concurrency);
      const last = pace.lastTokenAt();
      const where = current ? `passage ${Math.min(this.chunksDone + 1, this.chunksTotal)} of ${this.chunksTotal}` : '';
      const stalled = engine.kind === 'local' && last !== null && performance.now() - last > HEARTBEAT_MS;
      if (stalled) {
        const secs = Math.round((performance.now() - last!) / 1000);
        this.say(`Still working. Your GPU is busy on a long passage, nothing is stuck · ${secs} s`, this.fraction(), 'working');
        return;
      }
      const parts = [pass === 'audit' ? 'Checking the rewrites' : 'Rewriting', where];
      if (wps) parts.push(`${Math.round(wps)} words/sec`);
      if (eta) parts.push(`~${formatDuration(eta)} left`);
      this.say(parts.filter(Boolean).join(' · '), this.fraction(), 'working');
      document.title = `(${this.chunksDone}/${this.chunksTotal}) ${APP_TITLE}`;
    };

    this.heartbeat = setInterval(render, 1000);
    render();

    try {
      await rewriteDoc(
        this.doc,
        engine,
        { register: this.register, signal, detect: detectLang, voice: this.register === 'sample' ? this.voice : null },
        {
          onPass: (mode, chunks) => {
            pass = mode;
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
            this.selectedId = chunk.targets[0] ?? null;
          },
          onProgress: (chars) => pace.progress(chars),
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
      this.stopTimers();
    }
  }

  private fraction(): number | null {
    return this.chunksTotal ? this.chunksDone / this.chunksTotal : null;
  }

  pause(): void {
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
    this.phase = 'paused';
    if (this.job) this.job.status = 'paused';
    void this.persist();
    this.say(`Paused at passage ${this.chunksDone + 1} of ${this.chunksTotal}. Finished passages are kept.`, this.fraction(), 'quiet');
    document.title = APP_TITLE;
    this.releaseLock();
  }

  private fail(err: unknown): void {
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
    this.say(this.doneLine(), 1, 'quiet');
    document.title = APP_TITLE;
    this.releaseLock();
    if (this.notifyWhenDone && document.hidden && 'Notification' in window && Notification.permission === 'granted') {
      new Notification('Plainhand', { body: this.doneLine() });
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

  private async persist(): Promise<void> {
    if (!this.job || !this.doc) return;
    this.job.doc = $state.snapshot(this.doc) as Doc;
    this.job.chunksDone = this.chunksDone;
    if (!(await saveJob(this.job))) console.warn('Plainhand: could not save progress; resume after reload will not work.');
  }

  async restore(saved: Job): Promise<void> {
    const job = $state.snapshot(saved) as Job;
    this.job = job;
    this.doc = job.doc;
    this.input = job.input;
    this.register = job.register;
    this.lastEngine = job.engine ?? null;
    this.chunksTotal = job.chunksTotal;
    this.chunksDone = job.chunksDone;
    this.resumable = null;
    this.phase = 'paused';
    const ref = this.firstUnfinished();
    this.say(
      `You left mid-edit. Picking up at passage ${job.chunksDone + 1} of ${job.chunksTotal}.`,
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
    if (await isCheckerCached(device)) await this.runCheck(device);
    else this.check = { kind: 'confirm', device, mb: downloadMB(device) };
  }

  cancelCheck(): void {
    this.check = { kind: 'idle' };
  }

  async runCheck(device: DetectorDevice): Promise<void> {
    if (!this.doc) return;
    this.check = { kind: 'working' };
    try {
      this.say('Loading the checker…', null, 'working');
      await loadChecker(device, (p) => {
        if (p.phase === 'download' && p.totalMB > 0) {
          this.say(
            `Downloading the checker · ${Math.round(p.loadedMB).toLocaleString()} / ${Math.round(p.totalMB).toLocaleString()} MB · only once`,
            p.loadedMB / p.totalMB,
            'working',
          );
        }
      });
      const sentences = this.doc.blocks
        .filter((b) => b.editable)
        .flatMap((b) => b.sentences.map((s) => ({ id: s.id, text: sentenceText(s) ? sentenceText(s) + s.trailing : '' })))
        .filter((s) => s.text.trim());
      const raw = await runChecker(sentences, (p) => {
        if (p.phase === 'scoring') this.say(`Checking · part ${p.done} of ${p.total}`, p.done / p.total, 'working');
      });
      const langName = languageName(this.doc.lang);
      const result = present({ ...raw, lang: this.doc.lang }, calibration as Calibration, langName);
      if (!result) throw new Error('The checker has no calibration for this setup.');
      const quotes = result.drivers.map((id) => ({ id, text: this.find(id) ? sentenceText(this.find(id)!) : '' }));
      this.check = { kind: 'done', result, langName, quotes };
      this.say('Checked.', null, 'quiet');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.check = { kind: 'error', message: `The checker failed: ${message}` };
      this.say(this.check.message, null, 'error');
    }
  }

  markForRewrite(id: string): void {
    const s = this.find(id);
    if (!s) return;
    s.stiff = true;
    s.audited = false;
    s.auditFlags = undefined;
    s.decision = undefined;
    if (s.status === 'rewritten' && s.rewrite !== undefined) s.text = s.rewrite;
    s.rewrite = undefined;
    s.status = s.text === s.source ? 'clean' : 'fixed';
    s.flags = [...s.flags, { ruleId: 'checker', category: 'filler', start: -1, end: -1, match: '', note: 'Reads machine-like to the checker', fixed: false }];
    this.check = { kind: 'idle' };
    this.selectedId = id;
    if (this.phase === 'done') this.phase = 'review';
    void this.persist();
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
    if (!s || proposedText(s) === s.source) return;
    s.decision = s.decision === decision ? undefined : decision;
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
