<script lang="ts">
  import type { Session } from '../app/session.svelte';
  import type { Dialect } from '../pipeline/dialect';
  import { languageName, REGISTERS, type Register } from '../pipeline/prompt';
  import { VOICE_MIN_WORDS } from '../pipeline/voice';
  import { formatDuration } from '../status/eta';
  import { isLoopbackUrl, listModels, PROVIDERS } from './byok/providers';
  import { forgetAll, lockWithPassphrase, unlock, vaultState, getKey, type VaultState } from './byok/vault';
  import { LOCAL_MODELS, supportsLanguage } from './local/models';
  import type { EnginePrefs } from './prefs.svelte';
  import { EngineError } from './types';

  let {
    session,
    prefs,
    onDone,
  }: { session: Session; prefs: EnginePrefs; onDone: (run: boolean) => void } = $props();

  let dialog = $state<HTMLDialogElement | null>(null);
  let runAfter = $state(false);
  let models = $state<string[]>([]);
  let modelsError = $state('');
  let loadingModels = $state(false);
  let vault = $state<VaultState>(vaultState());
  let passphrase = $state('');
  let vaultMessage = $state('');

  const docLang = $derived(session.doc?.lang ?? 'eng');
  const deviceOk = $derived(session.probe?.ok === true);
  const sampleWords = $derived(session.voiceSample.trim() ? session.voiceSample.trim().split(/\s+/).length : 0);
  const voiceReady = $derived(session.register !== 'sample' || session.voice !== null);
  const deviceProblem = $derived(
    !session.probe
      ? 'Checking your graphics card…'
      : !session.probe.ok
        ? 'This browser can’t run the on-device model.'
        : !supportsLanguage(session.localModel, docLang)
          ? `${session.localModel.label} doesn’t support ${languageName(docLang)}.`
          : null,
  );
  const problem = $derived(!voiceReady ? `Paste at least ${VOICE_MIN_WORDS} words of your writing, or pick another voice.` : prefs.mode === 'device' ? deviceProblem : prefs.keyProblem);

  const REGISTER_LABELS: Record<Register, string> = {
    keep: 'Keep my tone',
    plain: 'Plain',
    casual: 'Casual',
    academic: 'Academic',
    business: 'Business',
    sample: 'Like my writing sample',
  };

  export function open(andRun = false) {
    runAfter = andRun;
    vault = vaultState();
    void session.probeDevice();
    dialog?.showModal();
  }

  async function save() {
    const ok = await prefs.save();
    vaultMessage = ok ? '' : 'Saved keys are locked. Unlock them to save this one.';
    dialog?.close();
    onDone(runAfter && !problem);
  }

  async function loadModels() {
    loadingModels = true;
    modelsError = '';
    try {
      models = await listModels({ provider: prefs.provider, key: prefs.key, baseUrl: prefs.baseUrl }, AbortSignal.timeout(20_000));
      if (!prefs.model && models.length) prefs.model = models[0]!;
    } catch (err) {
      modelsError = err instanceof EngineError ? err.message : 'Could not load the model list.';
    } finally {
      loadingModels = false;
    }
  }

  async function doUnlock() {
    vaultMessage = (await unlock(passphrase)) ? '' : 'That passphrase didn’t unlock your keys.';
    passphrase = '';
    vault = vaultState();
    prefs.key = getKey(prefs.provider) ?? prefs.key;
  }

  async function doLock() {
    if (passphrase.length < 8) {
      vaultMessage = 'Use at least 8 characters.';
      return;
    }
    await lockWithPassphrase(passphrase);
    passphrase = '';
    vault = vaultState();
    vaultMessage = 'Saved keys are encrypted. You’ll need the passphrase next visit.';
  }

  function doForget() {
    forgetAll();
    vault = vaultState();
    prefs.key = '';
    vaultMessage = 'Saved keys removed from this browser.';
  }

  function estimate(): string {
    if (!session.probe?.ok) return '';
    const m = session.localModel;
    const size = session.localCached ? 'Already downloaded.' : `${m.downloadMB >= 1000 ? (m.downloadMB / 1000).toFixed(1) + ' GB' : m.downloadMB + ' MB'} download, once.`;
    const words = session.remainingWords;
    return words ? `${size} About ${formatDuration((words / m.wordsPerSec) * 1300)} for this draft.` : size;
  }
</script>

<dialog bind:this={dialog} aria-labelledby="settings-title" onclose={() => (runAfter = false)}>
  <form method="dialog" onsubmit={(e) => { e.preventDefault(); void save(); }}>
    <header>
      <h2 id="settings-title">How to rewrite</h2>
      <button type="button" class="btn btn-quiet" onclick={() => dialog?.close()}>Cancel</button>
    </header>

    <fieldset class="modes">
      <legend class="visually-hidden">Engine</legend>
      <label class="mode" class:on={prefs.mode === 'device'}>
        <input type="radio" name="mode" value="device" bind:group={prefs.mode} />
        <span class="mode-title">On this device</span>
        <span class="mode-note">Free and private. Downloads a model once.</span>
      </label>
      <label class="mode" class:on={prefs.mode === 'key'}>
        <input type="radio" name="mode" value="key" bind:group={prefs.mode} />
        <span class="mode-title">With my API key</span>
        <span class="mode-note">Faster. Text goes to the provider you pick.</span>
      </label>
    </fieldset>

    {#if prefs.mode === 'device'}
      <section class="group">
        {#if !session.probe}
          <p class="muted">Checking your graphics card…</p>
        {:else if !session.probe.ok}
          <p>This browser can’t run the on-device model. It works in Chrome or Edge, Safari 26+, and Firefox on Windows or Mac.</p>
          {#if session.probe.linuxFirefox}<p class="muted">Firefox on Linux doesn’t ship WebGPU yet. Chrome works on most recent Intel and NVIDIA setups.</p>{/if}
        {:else}
          <div class="field">
            <label for="device-model">Model</label>
            <select id="device-model" class="input" value={session.localModel.base} onchange={(e) => session.chooseLocalModel(LOCAL_MODELS.find((m) => m.base === e.currentTarget.value)!)}>
              {#each LOCAL_MODELS as m (m.base)}
                <option value={m.base} disabled={!supportsLanguage(m, docLang)}>
                  {m.label}{supportsLanguage(m, docLang) ? '' : ` (no ${languageName(docLang)})`}
                </option>
              {/each}
            </select>
          </div>
          <p class="muted">{estimate()}</p>
          {#if session.probe.weak}<p class="muted">This device suits the small model best. It’s slower but your place is saved as it goes.</p>{/if}
          {#if session.localModel.attribution}
            <p class="muted">{session.localModel.attribution}. Use is subject to the <a href={session.localModel.licenseUrl} target="_blank" rel="noopener noreferrer">{session.localModel.license}</a>.</p>
          {/if}
        {/if}
      </section>
    {:else}
      <section class="group grid">
        <div class="field">
          <label for="provider">Provider</label>
          <select id="provider" class="input" bind:value={prefs.provider} onchange={() => { prefs.loadProvider(); models = []; modelsError = ''; }}>
            {#each PROVIDERS as p (p.id)}<option value={p.id}>{p.label}</option>{/each}
          </select>
        </div>
        {#if prefs.provider === 'local'}
          <label class="field">
            <span>Server URL</span>
            <input class="input" bind:value={prefs.baseUrl} spellcheck="false" autocomplete="off" />
            {#if !isLoopbackUrl(prefs.baseUrl)}<small class="warn">Only localhost or 127.0.0.1 addresses are allowed.</small>{/if}
          </label>
        {/if}
        {#if vault === 'locked'}
          <div class="field">
            <span>Saved keys are locked</span>
            <div class="inline">
              <input class="input" type="password" bind:value={passphrase} placeholder="Passphrase" autocomplete="current-password" />
              <button type="button" class="btn" onclick={doUnlock} disabled={!passphrase}>Unlock</button>
            </div>
          </div>
        {/if}
        <label class="field">
          <span>API key{prefs.info.keyRequired ? '' : ' (optional)'}</span>
          <input class="input" type="password" bind:value={prefs.key} autocomplete="off" spellcheck="false" />
          {#if prefs.info.keyUrl}<small class="muted">Get one at <a href={prefs.info.keyUrl} target="_blank" rel="noopener noreferrer">{new URL(prefs.info.keyUrl).hostname}</a></small>{/if}
        </label>
        <div class="field">
          <label for="model-input">Model</label>
          <div class="inline">
            <input id="model-input" class="input" list="model-list" bind:value={prefs.model} spellcheck="false" autocomplete="off" placeholder="Model id" />
            <button type="button" class="btn" onclick={loadModels} disabled={loadingModels || (prefs.info.keyRequired && !prefs.key)}>{loadingModels ? 'Loading…' : 'List models'}</button>
          </div>
          <datalist id="model-list">{#each models as m (m)}<option value={m}></option>{/each}</datalist>
          {#if modelsError}<small class="warn">{modelsError}</small>{/if}
        </div>
        <label class="check"><input type="checkbox" bind:checked={prefs.remember} /> Remember this key in this browser</label>
        <p class="muted">Your key and text go straight from this browser to {prefs.info.label}. Plainhand has no servers.</p>
        <details class="vault">
          <summary>Saved key settings</summary>
          {#if vault === 'plain' || vault === 'empty'}
            <p class="muted">Saved keys sit unencrypted in this browser’s storage. Add a passphrase to encrypt them.</p>
            <div class="inline">
              <input class="input" type="password" bind:value={passphrase} placeholder="New passphrase" autocomplete="new-password" />
              <button type="button" class="btn" onclick={doLock} disabled={!passphrase}>Encrypt</button>
            </div>
          {:else if vault === 'unlocked'}
            <p class="muted">Saved keys are encrypted and unlocked for this tab.</p>
          {/if}
          <button type="button" class="btn btn-quiet" onclick={doForget}>Remove saved keys</button>
          {#if vaultMessage}<p class="muted" role="status">{vaultMessage}</p>{/if}
        </details>
      </section>
    {/if}

    <section class="group style">
      <h3>Style</h3>
      <div class="field">
        <label for="voice">Voice</label>
        <select id="voice" class="input" bind:value={session.register}>
          {#each Object.keys(REGISTERS) as r (r)}<option value={r}>{REGISTER_LABELS[r as Register]}</option>{/each}
        </select>
      </div>
      {#if session.register === 'sample'}
        <label class="field">
          <span>Paste 300 to 1,000 words you wrote yourself</span>
          <textarea class="input sample" rows="5" value={session.voiceSample} oninput={(e) => session.setVoiceSample(e.currentTarget.value)} spellcheck="false"></textarea>
          <small class="muted">
            {#if sampleWords < VOICE_MIN_WORDS}{sampleWords} words. It needs at least {VOICE_MIN_WORDS}.{:else if session.voice}Reads as: {session.voice.brief}. Saved in this browser only.{/if}
          </small>
        </label>
      {/if}
      {#if docLang === 'eng'}
        <div class="field">
          <label for="spelling">Spelling</label>
          <select id="spelling" class="input" value={session.dialect} onchange={(e) => session.setDialect(e.currentTarget.value as Dialect)}>
            <option value="as-written">As written</option>
            <option value="us">US English</option>
            <option value="uk">UK English</option>
          </select>
        </div>
      {/if}
    </section>

    <footer>
      {#if problem}<p class="warn" role="status">{problem}</p>{/if}
      <button type="submit" class="btn btn-primary">{runAfter ? 'Save and rewrite' : 'Save'}</button>
    </footer>
  </form>
</dialog>

<style>
  dialog {
    width: min(36rem, calc(100vw - 2 * var(--gutter)));
    max-height: calc(100dvh - 2rem);
    padding: 0;
    border: 1px solid var(--ink);
    border-radius: var(--radius);
    background: var(--page);
    color: var(--ink);
  }

  dialog::backdrop {
    background: rgb(18 20 23 / 0.45);
  }

  form {
    display: grid;
    gap: 1.1rem;
    padding: 1.25rem 1.4rem 1.4rem;
  }

  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
  }

  h2 {
    margin: 0;
    font-family: var(--sans);
    font-size: var(--t-xl);
    font-weight: 600;
  }

  h3 {
    margin: 0;
    font-size: 0.8rem;
    font-weight: 600;
  }

  .modes {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.6rem;
    margin: 0;
    padding: 0;
    border: 0;
  }

  .mode {
    display: grid;
    gap: 0.2rem;
    padding: 0.75rem 0.85rem;
    border: 1px solid var(--rule);
    border-radius: var(--radius);
    cursor: pointer;
  }

  .mode.on {
    border-color: var(--accent);
    box-shadow: inset 0 0 0 1px var(--accent);
    background: var(--accent-wash);
  }

  .mode input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .mode:has(input:focus-visible) {
    outline: 2px solid var(--focus);
    outline-offset: 2px;
  }

  .mode-title {
    font-weight: 600;
  }

  .mode-note,
  .muted {
    color: var(--ink-2);
    font-size: 0.75rem;
  }

  .group {
    display: grid;
    gap: 0.7rem;
  }

  .group p {
    margin: 0;
  }

  .style {
    padding-top: 1rem;
    border-top: 1px solid var(--rule);
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
    gap: 0.5rem;
    align-items: center;
    min-height: 2.75rem;
  }

  .sample {
    font-family: var(--sans);
    font-size: 0.85rem;
    line-height: 1.55;
    resize: vertical;
  }

  .warn {
    color: var(--accent);
    margin: 0;
  }

  .vault summary {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: 2.75rem;
    color: var(--ink-2);
  }

  .vault summary::before {
    content: '';
    width: 0.4rem;
    height: 0.4rem;
    border-right: 1.5px solid currentColor;
    border-bottom: 1.5px solid currentColor;
    transform: rotate(-45deg);
    transition: transform 150ms;
  }

  .vault[open] summary::before {
    transform: rotate(45deg);
  }

  .vault[open] > :not(summary) {
    margin-top: 0.5rem;
  }

  footer {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 0.75rem;
    padding-top: 0.25rem;
  }

  footer .warn {
    flex: 1 1 14rem;
    font-size: 0.75rem;
  }

  @media (max-width: 520px) {
    .modes {
      grid-template-columns: 1fr;
    }
  }
</style>
