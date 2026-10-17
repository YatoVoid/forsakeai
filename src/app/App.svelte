<script lang="ts">
  import { onMount, tick } from 'svelte';
  import Manuscript from '../editor/Manuscript.svelte';
  import MarginNote from '../editor/MarginNote.svelte';
  import EnginePanel from '../engines/EnginePanel.svelte';
  import CheckerPanel from '../detector/CheckerPanel.svelte';
  import StatusLine from '../status/StatusLine.svelte';
  import { download, type ExportFormat } from '../export/export';
  import { languageName } from '../pipeline/prompt';
  import { proposedText } from '../pipeline/parse';
  import { SAMPLE } from './sample';
  import { readPageConfig } from './pageConfig';
  import { Session } from './session.svelte';
  import type { Dialect } from '../pipeline/dialect';

  const session = new Session();
  const pageConfig = readPageConfig();
  const home = import.meta.env.BASE_URL;
  let textarea = $state<HTMLTextAreaElement | null>(null);
  let page = $state<HTMLDivElement | null>(null);
  let noteTop = $state(0);
  let copied = $state(false);
  let theme = $state<'system' | 'light' | 'dark'>('system');

  const selected = $derived(session.selectedId ? session.find(session.selectedId) : undefined);
  const showDoc = $derived(session.phase !== 'empty' && session.doc !== null);
  const reviewable = $derived(session.phase === 'review' || session.phase === 'done' || session.phase === 'paused');
  const workingIds = $derived(session.phase === 'running' && session.selectedId ? [session.selectedId] : []);
  const langLabel = $derived(session.doc ? languageName(session.doc.lang) : '');

  onMount(() => {
    try {
      const saved = localStorage.getItem('plainhand.theme');
      if (saved === 'light' || saved === 'dark') applyTheme(saved);
    } catch {
      // Theme falls back to the system setting.
    }
    void session.init();
  });

  function applyTheme(t: typeof theme) {
    theme = t;
    if (t === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    try {
      if (t === 'system') localStorage.removeItem('plainhand.theme');
      else localStorage.setItem('plainhand.theme', t);
    } catch {
      // Not persisted in private windows.
    }
  }

  function cycleTheme() {
    applyTheme(theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system');
  }

  let layoutTick = $state(0);

  $effect(() => {
    if (!page) return;
    const column = page.querySelector('.column');
    if (!column) return;
    const observer = new ResizeObserver(() => layoutTick++);
    observer.observe(column);
    return () => observer.disconnect();
  });

  $effect(() => {
    const id = session.selectedId;
    void session.doc;
    void session.phase;
    void layoutTick;
    if (!id || !page) return;
    void tick().then(() => {
      const el = page?.querySelector<HTMLElement>(`[data-id="${id}"]`);
      const host = page?.querySelector<HTMLElement>('.sheet');
      if (!el || !host) return;
      noteTop = el.getBoundingClientRect().top - host.getBoundingClientRect().top;
    });
  });

  $effect(() => {
    const id = session.selectedId;
    if (session.phase !== 'running' || !id) return;
    void tick().then(() => page?.querySelector<HTMLElement>(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  });

  function changedIds(): string[] {
    if (!session.doc) return [];
    return session.doc.blocks.flatMap((b) => b.sentences).filter((s) => proposedText(s) !== s.source || s.stiff).map((s) => s.id);
  }

  function step(dir: 1 | -1) {
    const ids = changedIds();
    if (!ids.length) return;
    const at = session.selectedId ? ids.indexOf(session.selectedId) : -1;
    const next = ids[(at + dir + ids.length) % ids.length]!;
    session.selectedId = next;
    page?.querySelector<HTMLElement>(`[data-id="${next}"]`)?.focus();
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(session.output());
      copied = true;
      setTimeout(() => (copied = false), 1600);
    } catch {
      session.say("Couldn't reach the clipboard. Select the text and copy it by hand.", null, 'error');
    }
  }

  function exportAs(format: ExportFormat) {
    if (session.doc) download(session.doc, format);
  }

  function onKeydown(e: KeyboardEvent) {
    const typing = e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]');
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && session.phase === 'empty') {
      e.preventDefault();
      session.clean();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'c' && showDoc) {
      e.preventDefault();
      void copy();
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey || !showDoc || !reviewable) return;
    const key = e.key.toLowerCase();
    if (key === 'a' && session.selectedId) session.decide(session.selectedId, 'accepted');
    else if (key === 'r' && session.selectedId) session.decide(session.selectedId, 'rejected');
    else if (key === 'j') step(1);
    else if (key === 'k') step(-1);
    else if (e.key === 'Escape') session.selectedId = null;
    else return;
    e.preventDefault();
  }

  async function enableNotifications(e: Event) {
    const on = (e.currentTarget as HTMLInputElement).checked;
    if (on && 'Notification' in window && Notification.permission === 'default') {
      session.notifyWhenDone = (await Notification.requestPermission()) === 'granted';
    } else {
      session.notifyWhenDone = on && 'Notification' in window && Notification.permission === 'granted';
    }
  }

  function trySample() {
    session.input = pageConfig?.sample ?? SAMPLE;
    textarea?.focus();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="page" bind:this={page}>
  <header class="masthead">
    <a class="wordmark" href={home} aria-label="Plainhand home">Plainhand</a>
    <div class="tools">
      {#if langLabel && showDoc}<span class="chip">{langLabel} · detected</span>{/if}
      <button class="btn btn-quiet" onclick={cycleTheme} aria-label="Theme: {theme}. Change theme">
        {theme === 'system' ? 'Auto' : theme === 'dark' ? 'Dark' : 'Light'}
      </button>
    </div>
  </header>

  {#if session.resumable && session.phase === 'empty'}
    <div class="banner" role="region" aria-label="Unfinished edit">
      <p>You left mid-edit. Picking up at passage {session.resumable.chunksDone + 1} of {session.resumable.chunksTotal}.</p>
      <div>
        <button class="btn" onclick={() => session.restore(session.resumable!)}>Resume</button>
        <button class="btn btn-quiet" onclick={() => session.discardResumable()}>Discard</button>
      </div>
    </div>
  {/if}

  <main class="sheet">
    <div class="column">
      <StatusLine status={session.status} />

      {#if session.phase === 'empty'}
        {#if pageConfig}
          <div class="intro" lang={pageConfig.htmlLang}>
            <h1>{pageConfig.heading}</h1>
            <p>{pageConfig.intro}</p>
          </div>
        {/if}
        <label class="visually-hidden" for="draft">Your draft</label>
        <textarea
          id="draft"
          class="draft"
          bind:this={textarea}
          bind:value={session.input}
          placeholder={pageConfig?.placeholder ?? 'Paste your draft.'}
          spellcheck="true"
        ></textarea>
        <div class="actions">
          <button class="btn btn-primary" onclick={() => session.clean()} disabled={!session.input.trim()}>
            Clean it up <kbd>Ctrl Enter</kbd>
          </button>
          {#if !session.input.trim()}
            <span class="hint">Nothing here yet. Paste something stiff, or <button class="btn btn-quiet inline" onclick={trySample}>try a sample</button>.</span>
          {/if}
        </div>
      {:else if session.doc}
        {#if session.phase === 'review' || session.phase === 'paused'}
          {#if session.phase === 'paused' && session.status.tone !== 'error' && session.chunksTotal}
            <div class="actions">
              <button class="btn btn-primary" onclick={() => session.resume()}>Resume</button>
            </div>
          {/if}
          {#if session.remaining > 0}
            <EnginePanel {session} />
          {/if}
        {/if}

        {#if session.phase === 'running'}
          <div class="actions">
            <button class="btn" onclick={() => session.pause()}>Pause</button>
            <label class="check">
              <input type="checkbox" checked={session.notifyWhenDone} onchange={enableNotifications} />
              Notify me when it's done
            </label>
          </div>
        {/if}

        <CheckerPanel {session} />

        <Manuscript doc={session.doc} selectedId={session.selectedId} activeIds={workingIds} onSelect={(id) => (session.selectedId = id)} />

        <div class="toolbar">
          <button class="btn btn-primary" onclick={copy}>{copied ? 'Copied' : 'Copy'}</button>
          <button class="btn" onclick={() => exportAs('docx')}>Download .docx</button>
          <button class="btn" onclick={() => exportAs('md')}>.md</button>
          <button class="btn" onclick={() => exportAs('txt')}>.txt</button>
          {#if session.checkerEnabled}
            <button class="btn" onclick={() => session.startCheck()} disabled={session.phase === 'running' || session.check.kind === 'working'}>Check it</button>
          {/if}
          {#if session.doc.lang === 'eng'}
            <label class="spelling">
              <span>Spelling</span>
              <select class="input" value={session.dialect} disabled={session.phase === 'running'} onchange={(e) => session.setDialect(e.currentTarget.value as Dialect)}>
                <option value="as-written">As written</option>
                <option value="us">US</option>
                <option value="uk">UK</option>
              </select>
            </label>
          {/if}
          <span class="spacer"></span>
          {#if session.changes && reviewable}
            <button class="btn btn-quiet" onclick={() => session.decideAll('accepted')}>Accept all</button>
            <button class="btn btn-quiet" onclick={() => session.decideAll('rejected')}>Reject all</button>
          {/if}
          <button class="btn btn-quiet" onclick={() => session.editDraft()} disabled={session.phase === 'running'}>Edit draft</button>
        </div>
      {/if}
    </div>

    <aside class="rail" aria-label="Notes">
      {#if selected && showDoc}
        <div class="note-slot" style:--top="{noteTop}px">
          <MarginNote
            sentence={selected}
            working={workingIds.includes(selected.id)}
            onDecide={(d) => session.decide(selected.id, d)}
            onClose={() => (session.selectedId = null)}
          />
        </div>
      {:else if showDoc && reviewable}
        <p class="rail-hint">Click a marked sentence to see why. <kbd>J</kbd> <kbd>K</kbd> move between them, <kbd>A</kbd> accepts, <kbd>R</kbd> rejects.</p>
      {/if}
    </aside>
  </main>

  <footer class="foot">
    <p>Your text stays in this browser. On-device mode never sends it anywhere. With your own API key, it goes straight to that provider.</p>
    <p>
      Rule list adapted from Wikipedia's <a href="https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing" rel="noopener noreferrer" target="_blank">Signs of AI writing</a> (CC BY-SA 4.0).
      No tool can promise how a detector will score your text. Read it before you send it.
    </p>
    <p>
      <a href="{home}privacy.html">Privacy</a> ·
      <a href="https://github.com/YatoVoid/plainhand" rel="noopener noreferrer">Source code</a> ·
      In other languages:
      <a href="{home}de/" hreflang="de" lang="de">Deutsch</a>,
      <a href="{home}es/" hreflang="es" lang="es">Español</a>,
      <a href="{home}fr/" hreflang="fr" lang="fr">Français</a>,
      <a href="{home}pt/" hreflang="pt" lang="pt">Português</a>
    </p>
  </footer>
</div>

<style>
  .page {
    max-width: calc(var(--measure) + var(--rail) + 6rem);
    margin: 0 auto;
    padding: 0 var(--gutter) 3rem;
  }

  .masthead {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 1.4rem 0 0.9rem;
  }

  .wordmark {
    font-family: var(--serif);
    font-size: var(--step-2);
    font-weight: 500;
    letter-spacing: -0.015em;
    text-decoration: none;
  }

  .tools {
    display: flex;
    align-items: baseline;
    gap: 0.75rem;
  }

  .chip {
    color: var(--ink-soft);
  }

  .intro h1 {
    font-family: var(--serif);
    font-size: var(--step-2);
    font-weight: 600;
    line-height: 1.25;
    margin: 0.75rem 0 0.35rem;
  }

  .intro p {
    margin: 0 0 0.75rem;
    max-width: 60ch;
    color: var(--ink-soft);
  }

  .banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.75rem 0;
    border-top: 1px solid var(--rule);
  }

  .banner p {
    margin: 0;
  }

  .sheet {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, var(--measure)) var(--rail);
    gap: 3rem;
  }

  .column {
    min-width: 0;
  }

  .draft {
    display: block;
    width: 100%;
    min-height: 55vh;
    resize: vertical;
    border: 0;
    border-bottom: 1px solid var(--rule);
    background: transparent;
    font-family: var(--serif);
    font-size: var(--step-0);
    line-height: 1.7;
    padding: 0.5rem 0 1rem;
  }

  .draft:focus {
    outline: none;
    border-bottom-color: var(--ink);
  }

  .draft::placeholder {
    color: var(--ink-soft);
    font-style: italic;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.9rem;
    margin: 1rem 0 1.25rem;
  }

  .hint {
    color: var(--ink-soft);
  }

  .inline {
    padding: 0;
    color: var(--ink);
  }

  .check {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    color: var(--ink-soft);
  }

  .toolbar {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin-top: 2rem;
    padding-top: 1rem;
    border-top: 1px solid var(--rule);
  }

  .spacer {
    flex: 1;
  }

  .spelling {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    color: var(--ink-soft);
  }

  .spelling select {
    width: auto;
    padding-block: 0.35em;
  }

  .rail {
    position: relative;
    padding-top: 3.4rem;
  }

  .note-slot {
    position: absolute;
    top: max(3.4rem, var(--top));
    left: 0;
    right: 0;
    transition: top 150ms ease-out;
  }

  .rail-hint {
    margin: 0;
    color: var(--ink-soft);
    font-size: 0.75rem;
    position: sticky;
    top: 4rem;
  }

  .foot {
    margin-top: 4rem;
    padding-top: 1rem;
    border-top: 1px solid var(--rule);
    color: var(--ink-soft);
    font-size: 0.72rem;
    max-width: var(--measure);
  }

  .foot p {
    margin: 0 0 0.4rem;
  }

  @media (max-width: 960px) {
    .sheet {
      grid-template-columns: minmax(0, 1fr);
      gap: 0;
    }

    .rail {
      padding: 0;
    }

    .rail-hint {
      display: none;
    }

    .note-slot {
      position: fixed;
      top: auto;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 10;
      max-height: 45vh;
      overflow-y: auto;
      padding: 1rem var(--gutter) 1.25rem;
      background: var(--paper);
      border-top: 1px solid var(--ink);
      transition: none;
    }
  }
</style>
