<script lang="ts">
  import type { Session } from '../app/session.svelte';
  import { DEFAULT_LOCAL_URL, isLoopbackUrl, listModels, PROVIDERS, providerInfo, type ProviderId } from './byok/providers';
  import { getKey, lockWithPassphrase, saveKey, unlock, vaultState, forgetAll, type VaultState } from './byok/vault';
  import { LOCAL_MODELS, supportsLanguage } from './local/models';
  import { VOICE_MIN_WORDS } from '../pipeline/voice';
  import { languageName } from '../pipeline/prompt';
  import { formatDuration } from '../status/eta';
  import { REGISTERS, type Register } from '../pipeline/prompt';
  import { EngineError } from './types';

  let { session }: { session: Session } = $props();

  type Mode = 'device' | 'key';
  const prefs = readPrefs();
  let mode = $state<Mode>(prefs.mode ?? 'device');
  let provider = $state<ProviderId>(prefs.provider ?? 'openai');
  let model = $state(prefs.models?.[prefs.provider ?? 'openai'] ?? '');
  let baseUrl = $state(prefs.baseUrl ?? DEFAULT_LOCAL_URL);
  let key = $state('');
  let remember = $state(prefs.remember ?? false);
  let models = $state<string[]>([]);
  let modelsError = $state('');
  let loadingModels = $state(false);
  let vault = $state<VaultState>(vaultState());
  let passphrase = $state('');
  let vaultMessage = $state('');

  const info = $derived(providerInfo(provider));
  const stiff = $derived(session.remaining);
  const words = $derived(
    session.doc?.blocks.flatMap((b) => b.sentences).filter((s) => s.stiff && s.status !== 'rewritten' && s.status !== 'kept').reduce((n, s) => n + s.text.split(/\s+/).length, 0) ?? 0,
  );
  const busy = $derived(session.phase === 'running');
  const docLang = $derived(session.doc?.lang ?? 'eng');
  const sampleWords = $derived(session.voiceSample.trim() ? session.voiceSample.trim().split(/\s+/).length : 0);
  const voiceReady = $derived(session.register !== 'sample' || session.voice !== null);
  const REGISTER_LABELS: Record<Register, string> = {
    keep: 'Keep my tone',
    plain: 'Plain',
    casual: 'Casual',
    academic: 'Academic',
    business: 'Business',
    sample: 'Like my writing sample',
  };

  $effect(() => {
    if (mode === 'device') void session.probeDevice();
  });

  $effect(() => {
    key = getKey(provider) ?? '';
    model = readPrefs().models?.[provider] ?? info.defaultModel ?? '';
    models = [];
    modelsError = '';
  });

  interface Prefs {
    mode?: Mode;
    provider?: ProviderId;
    models?: Partial<Record<ProviderId, string>>;
    baseUrl?: string;
    remember?: boolean;
  }

  function readPrefs(): Prefs {
    try {
      return JSON.parse(localStorage.getItem('plainhand.prefs') ?? '{}') as Prefs;
    } catch {
      return {};
    }
  }

  function writePrefs(patch: Prefs) {
    try {
      const current = readPrefs();
      localStorage.setItem('plainhand.prefs', JSON.stringify({ ...current, ...patch, models: { ...current.models, ...patch.models } }));
    } catch {
      // Preferences are a convenience; private windows may block storage.
    }
  }

  function setMode(m: Mode) {
    mode = m;
    writePrefs({ mode: m });
  }

  async function loadModels() {
    loadingModels = true;
    modelsError = '';
    try {
      models = await listModels({ provider, key, baseUrl }, AbortSignal.timeout(20_000));
      if (!model && models.length) model = models[0]!;
    } catch (err) {
      modelsError = err instanceof EngineError ? err.message : 'Could not load the model list.';
    } finally {
      loadingModels = false;
    }
  }

  async function runWithKey() {
    writePrefs({ provider, models: { [provider]: model }, baseUrl, remember });
    if (remember && key) {
      const ok = await saveKey(provider, key);
      vaultMessage = ok ? '' : 'Saved keys are locked. Unlock them to save this one.';
    }
    await session.rewriteWithKey({ provider, key, model, baseUrl: provider === 'local' ? baseUrl : undefined });
  }

  async function doUnlock() {
    vaultMessage = (await unlock(passphrase)) ? '' : "That passphrase didn't unlock your keys.";
    passphrase = '';
    vault = vaultState();
    key = getKey(provider) ?? key;
  }

  async function doLock() {
    if (passphrase.length < 8) {
      vaultMessage = 'Use at least 8 characters.';
      return;
    }
    await lockWithPassphrase(passphrase);
    passphrase = '';
    vault = vaultState();
    vaultMessage = 'Saved keys are now encrypted. You will need the passphrase next visit.';
  }

  function doForget() {
    forgetAll();
    vault = vaultState();
    key = '';
    vaultMessage = 'Saved keys removed from this browser.';
  }

  const canRunKey = $derived(
    !!model && (!info.keyRequired || !!key) && (provider !== 'local' || isLoopbackUrl(baseUrl)) && !busy,
  );

  function estimate(): string {
    const probe = session.probe;
    if (!probe?.ok) return '';
    const speed = session.localModel.wordsPerSec;
    const time = formatDuration((words / speed) * 1000 * 1.3);
    const download = session.localCached
      ? 'Model already downloaded.'
      : `About ${session.localModel.downloadMB >= 1000 ? (session.localModel.downloadMB / 1000).toFixed(1) + ' GB' : session.localModel.downloadMB + ' MB'} download, once.`;
    return `${download} Roughly ${speed} words/sec here, so about ${time} for ${words.toLocaleString()} words.`;
  }
</script>

<section class="panel" aria-labelledby="engine-heading">
  <h2 id="engine-heading" class="visually-hidden">Rewrite the stiff sentences</h2>

  <div class="row">
    <div class="modes" role="tablist" aria-label="How to rewrite">
      <button role="tab" aria-selected={mode === 'device'} class:on={mode === 'device'} onclick={() => setMode('device')}>
        On this device <small>free, private</small>
      </button>
      <button role="tab" aria-selected={mode === 'key'} class:on={mode === 'key'} onclick={() => setMode('key')}>
        With my API key
      </button>
    </div>
    <label class="voice">
      <span>Voice</span>
      <select class="input" bind:value={session.register} disabled={busy}>
        {#each Object.keys(REGISTERS) as r (r)}
          <option value={r}>{REGISTER_LABELS[r as Register]}</option>
        {/each}
      </select>
    </label>
  </div>

  {#if session.register === 'sample'}
    <div class="sample">
      <label class="field">
        <span>Paste 300 to 1,000 words you wrote yourself</span>
        <textarea
          class="input"
          rows="5"
          value={session.voiceSample}
          oninput={(e) => session.setVoiceSample(e.currentTarget.value)}
          disabled={busy}
          spellcheck="false"
        ></textarea>
      </label>
      <small class="muted">
        {#if sampleWords < VOICE_MIN_WORDS}
          {sampleWords} words. It needs at least {VOICE_MIN_WORDS} to read your style.
        {:else if session.voice}
          Reads as: {session.voice.brief}. Saved in this browser only.
        {/if}
      </small>
    </div>
  {/if}

  {#if mode === 'device'}
    <div class="body" role="tabpanel">
      {#if !session.probe}
        <p class="muted">Checking your graphics card…</p>
      {:else if !session.probe.ok}
        <p>This browser can't run the on-device model. It works in Chrome or Edge, Safari 26+, and Firefox on Windows or Mac. Or use your own API key.</p>
        {#if session.probe.linuxFirefox}
          <p class="muted">Firefox on Linux doesn't ship WebGPU yet. Chrome works on most recent Intel and NVIDIA setups.</p>
        {/if}
        <button class="btn" onclick={() => setMode('key')}>Use an API key instead</button>
      {:else}
        {#if session.probe.weak}
          <p>Your device can run the small model (slower, about 6 words/sec). Long texts may take a while; your place is saved as it goes.</p>
        {/if}
        <label class="field model">
          <span>Model</span>
          <select class="input" value={session.localModel.base} disabled={busy} onchange={(e) => session.chooseLocalModel(LOCAL_MODELS.find((m) => m.base === e.currentTarget.value)!)}>
            {#each LOCAL_MODELS as m (m.base)}
              <option value={m.base} disabled={!supportsLanguage(m, docLang)}>
                {m.label}{supportsLanguage(m, docLang) ? '' : ` (no ${languageName(docLang)})`}
              </option>
            {/each}
          </select>
        </label>
        {#if session.localModel.attribution}
          <p class="muted">
            {session.localModel.attribution}. Use is subject to the
            <a href={session.localModel.licenseUrl} target="_blank" rel="noopener noreferrer">{session.localModel.license}</a>.
          </p>
        {/if}
        <p class="muted">{estimate()}</p>
        <button class="btn btn-primary" disabled={busy || !stiff || !voiceReady || !supportsLanguage(session.localModel, docLang)} onclick={() => session.rewriteOnDevice()}>
          Rewrite {stiff} {stiff === 1 ? 'sentence' : 'sentences'} on this device
        </button>
      {/if}
    </div>
  {:else}
    <div class="body grid" role="tabpanel">
      <label class="field">
        <span>Provider</span>
        <select class="input" bind:value={provider} disabled={busy}>
          {#each PROVIDERS as p (p.id)}
            <option value={p.id}>{p.label}</option>
          {/each}
        </select>
      </label>

      {#if provider === 'local'}
        <label class="field">
          <span>Server URL</span>
          <input class="input" bind:value={baseUrl} spellcheck="false" autocomplete="off" />
          {#if !isLoopbackUrl(baseUrl)}<small class="warn">Only localhost or 127.0.0.1 addresses are allowed.</small>{/if}
        </label>
      {/if}

      {#if vault === 'locked'}
        <div class="field">
          <span>Saved keys are locked</span>
          <div class="inline">
            <input class="input" type="password" bind:value={passphrase} placeholder="Passphrase" autocomplete="current-password" />
            <button class="btn" onclick={doUnlock} disabled={!passphrase}>Unlock</button>
          </div>
        </div>
      {/if}

      <label class="field">
        <span>API key {#if !info.keyRequired}(optional){/if}</span>
        <input class="input" type="password" bind:value={key} autocomplete="off" spellcheck="false" placeholder={info.keyUrl ? 'Paste your key' : ''} />
        {#if info.keyUrl}<small class="muted">Get one at <a href={info.keyUrl} target="_blank" rel="noopener noreferrer">{new URL(info.keyUrl).hostname}</a></small>{/if}
      </label>

      <div class="field">
        <span>Model</span>
        <div class="inline">
          <input class="input" list="model-list" bind:value={model} spellcheck="false" autocomplete="off" placeholder="Model id" />
          <button class="btn" onclick={loadModels} disabled={loadingModels || (info.keyRequired && !key)}>
            {loadingModels ? 'Loading…' : 'List models'}
          </button>
        </div>
        <datalist id="model-list">
          {#each models as m (m)}<option value={m}></option>{/each}
        </datalist>
        {#if modelsError}<small class="warn">{modelsError}</small>{/if}
      </div>

      <label class="check">
        <input type="checkbox" bind:checked={remember} />
        Remember this key in this browser
      </label>

      <p class="muted privacy">Your key and text go straight from this browser to {info.label}. Nothing passes through our servers.</p>

      <details class="vault">
        <summary>Saved key settings</summary>
        {#if vault === 'plain' || vault === 'empty'}
          <p class="muted">Saved keys sit unencrypted in this browser's storage. Add a passphrase to encrypt them.</p>
          <div class="inline">
            <input class="input" type="password" bind:value={passphrase} placeholder="New passphrase" autocomplete="new-password" />
            <button class="btn" onclick={doLock} disabled={!passphrase}>Encrypt</button>
          </div>
        {:else if vault === 'unlocked'}
          <p class="muted">Saved keys are encrypted and unlocked for this tab.</p>
        {/if}
        <button class="btn btn-quiet" onclick={doForget}>Remove saved keys</button>
        {#if vaultMessage}<p class="muted" role="status">{vaultMessage}</p>{/if}
      </details>

      <div>
        <button class="btn btn-primary" disabled={!canRunKey || !stiff || !voiceReady} onclick={runWithKey}>
          Rewrite {stiff} {stiff === 1 ? 'sentence' : 'sentences'} with {info.label}
        </button>
      </div>
    </div>
  {/if}
</section>

<style>
  .panel {
    border-top: 1px solid var(--rule);
    border-bottom: 1px solid var(--rule);
    padding: 1rem 0 1.1rem;
    margin: 0 0 1.5rem;
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: end;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .modes {
    display: flex;
    gap: 1.25rem;
  }

  .modes button {
    border: 0;
    background: none;
    padding: 0.2rem 0;
    cursor: pointer;
    font-weight: 500;
    color: var(--ink-soft);
    border-bottom: 2px solid transparent;
  }

  .modes button.on {
    color: var(--ink);
    border-bottom-color: var(--pencil);
  }

  .modes small {
    font-weight: 400;
    color: var(--ink-soft);
  }

  .voice {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--ink-soft);
  }

  .voice select {
    width: auto;
  }

  .body {
    margin-top: 1rem;
  }

  .sample {
    display: grid;
    gap: 0.35rem;
    margin-top: 1rem;
    max-width: 40rem;
  }

  .sample textarea {
    font-family: var(--serif);
    font-size: 0.85rem;
    line-height: 1.55;
    resize: vertical;
  }

  .body p {
    margin: 0 0 0.75rem;
    max-width: 60ch;
  }

  .grid {
    display: grid;
    gap: 0.8rem;
    max-width: 34rem;
  }

  .model {
    max-width: 22rem;
    margin-bottom: 0.6rem;
  }

  .inline {
    display: flex;
    gap: 0.4rem;
  }

  .inline .btn {
    flex: none;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .muted {
    color: var(--ink-soft);
  }

  .warn {
    color: var(--pencil);
  }

  .privacy {
    margin: 0;
  }

  .vault summary {
    cursor: pointer;
    color: var(--ink-soft);
  }

  .vault {
    display: grid;
    gap: 0.5rem;
  }

  .vault[open] > :not(summary) {
    margin-top: 0.5rem;
  }
</style>
