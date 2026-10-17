<script lang="ts">
  import { ArrowRight, FilePlus2, Monitor, Moon, Pencil, Sun, X } from '@lucide/svelte';
  import { onMount, tick } from 'svelte';
  import Manuscript from '../editor/Manuscript.svelte';
  import SettingsDialog from '../engines/SettingsDialog.svelte';
  import { EnginePrefs } from '../engines/prefs.svelte';
  import { download, type ExportFormat } from '../export/export';
  import { htmlToMarkdown } from '../lib/paste';
  import { languageName } from '../pipeline/prompt';
  import { proposedText } from '../pipeline/parse';
  import { readPageConfig } from './pageConfig';
  import { SAMPLE } from './sample';
  import { Session } from './session.svelte';
  import StyleSheet from './StyleSheet.svelte';

  const session = new Session();
  const prefs = new EnginePrefs();
  const pageConfig = readPageConfig();
  const home = import.meta.env.BASE_URL;
  let textarea = $state<HTMLTextAreaElement | null>(null);
  let page = $state<HTMLDivElement | null>(null);
  let settings = $state<{ open: (andRun?: boolean) => void } | null>(null);
  let copied = $state(false);
  let view = $state<'changes' | 'clean'>('changes');
  let theme = $state<'system' | 'light' | 'dark'>('system');
  let tipSeen = $state(true);

  const showDoc = $derived(session.phase !== 'empty' && session.doc !== null);
  const reviewable = $derived(session.phase === 'review' || session.phase === 'done' || session.phase === 'paused');
  const workingIds = $derived(session.phase === 'running' ? session.workingIds : []);
  const langLabel = $derived(session.doc ? languageName(session.doc.lang) : '');
  const words = $derived(session.input.trim() ? session.input.trim().split(/\s+/).length : 0);

  onMount(() => {
    try {
      const saved = localStorage.getItem('plainhand.theme');
      if (saved === 'light' || saved === 'dark') applyTheme(saved);
      tipSeen = localStorage.getItem(TIP_KEY) === '1';
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

  $effect(() => {
    const id = session.workingIds[0];
    if (session.phase !== 'running' || !id) return;
    void tick().then(() => page?.querySelector<HTMLElement>(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  });

  function changedIds(): string[] {
    if (!session.doc) return [];
    return session.doc.blocks.flatMap((b) => b.sentences).filter((s) => proposedText(s) !== s.source || s.stiff).map((s) => s.id);
  }

  function jumpTo(id: string) {
    view = 'changes';
    session.selectedId = id;
    void tick().then(() => {
      const el = page?.querySelector<HTMLElement>(`[data-id="${id}"]`);
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      el?.focus({ preventScroll: true });
    });
  }

  function step(dir: 1 | -1) {
    const ids = changedIds();
    if (!ids.length) return;
    const at = session.selectedId ? ids.indexOf(session.selectedId) : -1;
    jumpTo(ids[(at + dir + ids.length) % ids.length]!);
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

  /** Runs with the saved engine, or opens settings first when something is missing. */
  async function rewrite() {
    const needsVoice = session.register === 'sample' && !session.voice;
    if (!prefs.chosen || needsVoice) {
      settings?.open(true);
      return;
    }
    if (prefs.mode === 'device') {
      await session.probeDevice();
      if (!session.probe?.ok) {
        settings?.open(true);
        return;
      }
      await session.rewriteOnDevice();
    } else {
      if (prefs.keyProblem) {
        settings?.open(true);
        return;
      }
      await session.rewriteWithKey(prefs.byok());
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (document.querySelector('dialog[open]')) return;
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

  function cleanUp() {
    if (!words) {
      textarea?.focus();
      session.say('Paste a draft first, or try the sample.', null, 'quiet');
      return;
    }
    void session.clean();
  }

  function newText() {
    const rewritten = session.doc?.blocks.some((b) => b.sentences.some((s) => s.status === 'rewritten'));
    if (rewritten && !confirm('Start a new text? The rewrites on this one will be cleared. Copy them first if you need them.')) return;
    session.startOver();
    void tick().then(() => textarea?.focus());
  }

  const TIP_KEY = 'plainhand.review-tip';

  function dismissTip() {
    tipSeen = true;
    try {
      localStorage.setItem(TIP_KEY, '1');
    } catch {
      // Shown again next visit in private windows.
    }
  }

  /** Rich text from chat apps keeps its headings and paragraphs instead of running together. */
  function onPaste(e: ClipboardEvent) {
    const html = e.clipboardData?.getData('text/html');
    const text = html ? htmlToMarkdown(html) : null;
    if (!text || !textarea) return;
    e.preventDefault();
    textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd, 'end');
    session.input = textarea.value;
  }

  function trySample() {
    session.input = pageConfig?.sample ?? SAMPLE;
    textarea?.focus();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="app" bind:this={page}>
  <div class="main">
    <header class="masthead">
      <a class="wordmark" href={home} aria-label="Plainhand home">Plainhand</a>
      <nav class="tools" aria-label="Site">
        {#if langLabel && showDoc}<span class="lang">{langLabel}</span>{/if}
        <a href="{home}privacy.html">Privacy</a>
        <button class="btn btn-ghost" onclick={cycleTheme} aria-label="Theme: {theme}. Change theme" title="Theme: {theme}">
          {#if theme === 'dark'}<Moon class="icon" aria-hidden="true" />{:else if theme === 'light'}<Sun class="icon" aria-hidden="true" />{:else}<Monitor class="icon" aria-hidden="true" />{/if}
        </button>
      </nav>
    </header>

    {#if session.resumable && session.phase === 'empty'}
      <div class="banner" role="region" aria-label="Unfinished edit">
        <p><b>You left mid-edit.</b> {session.resumable.chunksDone} of {session.resumable.chunksTotal} passages are done.</p>
        <div class="banner-actions">
          <button class="btn btn-primary" onclick={() => session.restore(session.resumable!)}>Pick up where I left off</button>
          <button class="btn btn-ghost" onclick={() => session.discardResumable()}>Discard</button>
        </div>
      </div>
    {/if}

    {#if session.phase === 'empty'}
      <section class="intro" lang={pageConfig?.htmlLang}>
        {#if pageConfig}<h1>{pageConfig.heading}</h1>{:else}<h1><span>Paste a draft.</span> <span>See every change.</span></h1>{/if}
        <p>
          {pageConfig?.intro ??
            'Plainhand fixes stock AI phrasing, rewrites what still reads stiff, and writes every decision on a style sheet you can check, keep or undo. Nothing leaves your browser unless you use your own API key.'}
        </p>
      </section>
      <div class="draft-box">
        <label class="visually-hidden" for="draft">Your draft</label>
        <textarea
          id="draft"
          bind:this={textarea}
          bind:value={session.input}
          placeholder={pageConfig?.placeholder ?? 'Paste your draft here. Headings, lists and links are kept.'}
          spellcheck="true"
          onpaste={onPaste}
        ></textarea>
        <div class="draft-foot">
          <span class="meta">
            {#if words}{words.toLocaleString()} words · <kbd>Ctrl</kbd> <kbd>Enter</kbd>{:else}<button class="link" onclick={trySample}>Try a sample draft</button>{/if}
          </span>
          <button class="btn btn-primary" onclick={cleanUp}>Clean it up <ArrowRight class="icon" aria-hidden="true" /></button>
        </div>
      </div>
      {#if !pageConfig}
        <ol class="how" aria-label="How it works">
          <li><b>Paste and clean it up.</b> Stock phrases like “Furthermore” and “plays a crucial role” are fixed or marked on the spot.</li>
          <li><b>Check each change.</b> Click any sentence to see why it changed. Accept it, restore your original, or type your own version.</li>
          <li><b>Rewrite what still reads stiff,</b> on this device or with your own API key. Then copy the text.</li>
        </ol>
      {/if}
    {:else if session.doc}
      <div class="doc-bar">
        <div class="bar-left">
          <button class="btn" onclick={() => session.editDraft()} disabled={session.phase === 'running'} title="Back to the text box, with every change so far applied">
            <Pencil class="icon" aria-hidden="true" /> Edit text
          </button>
          <button class="btn" onclick={newText} disabled={session.phase === 'running'}>
            <FilePlus2 class="icon" aria-hidden="true" /> New text
          </button>
          <div class="view" role="radiogroup" aria-label="Show">
            <button role="radio" aria-checked={view === 'changes'} class:on={view === 'changes'} onclick={() => (view = 'changes')}>Changes</button>
            <button role="radio" aria-checked={view === 'clean'} class:on={view === 'clean'} onclick={() => (view = 'clean')}>Clean copy</button>
          </div>
        </div>
        {#if view === 'changes'}
          <p class="legend" aria-label="Key">
            <span><del class="removed">removed</del></span>
            <span><ins class="added">added</ins></span>
            <span><span class="stiff">still stiff</span></span>
          </p>
        {/if}
      </div>
      {#if !tipSeen && session.phase === 'review'}
        <div class="tip" role="note">
          <p>
            <b>How to review.</b> <del class="removed">Struck</del> words were removed, <ins class="added">underlined</ins> words were added, and
            <span class="stiff">wavy</span> ones still read stiff. Click any sentence to see why, accept it, restore your original, or edit it yourself.
            Then rewrite the rest from the style sheet.
          </p>
          <button class="btn btn-ghost" onclick={dismissTip} aria-label="Got it, hide this tip"><X class="icon" aria-hidden="true" /></button>
        </div>
      {/if}
      <Manuscript doc={session.doc} {view} selectedId={session.selectedId} activeIds={workingIds} onSelect={(id) => (session.selectedId = id)} />
    {/if}

  </div>

  <StyleSheet
    {session}
    {prefs}
    {copied}
    onCopy={copy}
    onExport={exportAs}
    onSettings={(run) => settings?.open(run)}
    onRewrite={rewrite}
    onJump={jumpTo}
  />

  <footer class="foot">
    <p>Stock-phrase list adapted from Wikipedia’s <a href="https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing" rel="noopener noreferrer" target="_blank">Signs of AI writing</a> (CC BY-SA 4.0). No tool can promise how a detector will score your text.</p>
    <p class="foot-links">
      <a href="https://github.com/YatoVoid/plainhand" rel="noopener noreferrer">Source code</a>
      <a href="{home}de/" hreflang="de" lang="de">Deutsch</a>
      <a href="{home}es/" hreflang="es" lang="es">Español</a>
      <a href="{home}fr/" hreflang="fr" lang="fr">Français</a>
      <a href="{home}pt/" hreflang="pt" lang="pt">Português</a>
    </p>
  </footer>
</div>

<SettingsDialog
  bind:this={settings}
  {session}
  {prefs}
  onDone={(run) => {
    if (run) void rewrite();
  }}
/>

<style>
  .app {
    display: grid;
    grid-template-columns: minmax(0, 1fr) var(--sheet-w);
    grid-template-rows: 1fr auto;
    min-height: 100dvh;
  }

  .main {
    grid-column: 1;
    grid-row: 1;
    width: 100%;
    max-width: calc(var(--measure) + 6rem);
    margin: 0 auto;
    padding: 0 clamp(var(--gutter), 4vw, 3rem) 3rem;
  }

  .masthead {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 1.1rem 0;
    margin-bottom: clamp(1.5rem, 4vh, 3rem);
  }

  .wordmark {
    font-size: var(--t-lg);
    font-weight: 850;
    letter-spacing: -0.03em;
    text-decoration: none;
  }

  .tools {
    display: flex;
    align-items: center;
    gap: 1rem;
    font-size: var(--t-sm);
  }

  .tools a {
    display: inline-flex;
    align-items: center;
    min-height: 2.75rem;
    color: var(--ink-2);
    text-decoration: none;
  }

  .tools a:hover {
    color: var(--accent);
  }

  .lang {
    color: var(--ink-2);
  }

  .banner {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem 1.5rem;
    padding: 0.9rem 1rem;
    margin-bottom: 2rem;
    border: 1px solid var(--ink);
    border-radius: var(--radius);
  }

  .banner p {
    margin: 0;
  }

  .banner-actions {
    display: flex;
    gap: 0.4rem;
  }

  .intro h1 span {
    display: block;
  }

  .intro h1 {
    margin: 0 0 0.9rem;
    font-size: var(--t-display);
    font-weight: 850;
    line-height: 1;
    letter-spacing: -0.035em;
    text-wrap: balance;
  }

  .intro p {
    margin: 0 0 2rem;
    max-width: 54ch;
    font-size: var(--t-text);
    line-height: 1.6;
    color: var(--ink-2);
  }

  .draft-box {
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius);
    background: var(--page);
  }

  .draft-box:focus-within {
    border-color: var(--ink);
  }

  textarea {
    display: block;
    width: 100%;
    min-height: 42vh;
    resize: vertical;
    border: 0;
    background: transparent;
    font-size: var(--t-text);
    line-height: 1.7;
    padding: 1.1rem 1.2rem;
  }

  textarea:focus {
    outline: none;
  }

  textarea::placeholder {
    color: var(--ink-2);
  }

  .draft-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.55rem 0.6rem 0.55rem 1.2rem;
    border-top: 1px solid var(--rule);
  }

  .meta {
    font-size: var(--t-sm);
    color: var(--ink-2);
  }

  .doc-bar {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem 1.25rem;
    padding: 0.6rem 0;
    margin-bottom: 1.5rem;
    background: var(--page);
    border-bottom: 1px solid var(--rule);
  }

  .bar-left {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .how {
    display: grid;
    gap: 0.6rem;
    margin: 1.5rem 0 0;
    padding: 0 0 0 1.25rem;
    max-width: 62ch;
    font-size: var(--t-sm);
    line-height: 1.55;
    color: var(--ink-2);
  }

  .how b {
    color: var(--ink);
    font-weight: 650;
  }

  .tip {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    padding: 0.75rem 0.5rem 0.75rem 1rem;
    margin: -0.5rem 0 1.5rem;
    border: 1px solid var(--accent);
    border-radius: var(--radius);
    font-size: var(--t-sm);
    line-height: 1.55;
  }

  .tip p {
    margin: 0;
  }

  .tip .btn {
    flex: none;
    min-width: 2.75rem;
    padding: 0.3rem;
  }

  .view {
    display: inline-grid;
    grid-template-columns: 1fr 1fr;
    padding: 2px;
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius);
  }

  .view button {
    min-height: 2.75rem;
    padding: 0.3rem 0.85rem;
    border: 0;
    border-radius: 2px;
    background: none;
    font-size: var(--t-sm);
    font-weight: 600;
    color: var(--ink-2);
    cursor: pointer;
  }

  .view button.on {
    background: var(--ink);
    color: var(--page);
  }

  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem 1rem;
    margin: 0;
    font-size: var(--t-sm);
  }

  .foot {
    grid-column: 1;
    width: 100%;
    max-width: calc(var(--measure) + 6rem);
    margin: 0 auto;
    padding: 1rem clamp(var(--gutter), 4vw, 3rem) 2rem;
    color: var(--ink-2);
  }

  .foot p {
    font-size: var(--t-xs);
  }

  .foot p {
    margin: 0;
  }

  .foot p:first-child {
    padding-top: 1rem;
    border-top: 1px solid var(--rule);
  }

  .foot-links {
    display: flex;
    flex-wrap: wrap;
    gap: 0 1.1rem;
  }

  .foot-links a {
    display: inline-flex;
    align-items: center;
    min-height: 2.75rem;
  }

  @media (max-width: 960px) {
    .app {
      grid-template-columns: minmax(0, 1fr);
    }

    .app {
      padding-bottom: 9rem;
    }

    .app:has(:global(.col.idle)) {
      padding-bottom: 0;
    }

    .masthead {
      margin-bottom: 1.5rem;
    }

    textarea {
      min-height: 36vh;
    }
  }
</style>
