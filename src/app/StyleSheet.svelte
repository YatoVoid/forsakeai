<script lang="ts">
  import { ArrowRight, Check, ClipboardCopy, Download, KeyRound, Laptop, Pause, Play, ScanSearch, SlidersHorizontal, Undo2 } from '@lucide/svelte';
  import CheckerPanel from '../detector/CheckerPanel.svelte';
  import SentenceCard from '../editor/SentenceCard.svelte';
  import type { EnginePrefs } from '../engines/prefs.svelte';
  import type { ExportFormat } from '../export/export';
  import { proposedText } from '../pipeline/parse';
  import { buildSheet, EXAMPLE_ENTRIES, groupSheet, STATUS_LABEL, type SheetEntry } from './sheet';
  import type { Session } from './session.svelte';

  let {
    session,
    prefs,
    copied,
    onCopy,
    onExport,
    onSettings,
    onRewrite,
    onJump,
  }: {
    session: Session;
    prefs: EnginePrefs;
    copied: boolean;
    onCopy: () => void;
    onExport: (f: ExportFormat) => void;
    onSettings: (andRun: boolean) => void;
    onRewrite: () => void;
    onJump: (id: string) => void;
  } = $props();

  const strunk = `${import.meta.env.BASE_URL}media/strunk-1918-omit-needless-words.png`;
  let open = $state(false);
  let downloadMenu = $state<HTMLDetailsElement | null>(null);

  const phase = $derived(session.phase);
  const entries = $derived(session.doc ? buildSheet(session.doc) : []);
  const groups = $derived(groupSheet(entries));
  const selected = $derived(session.selectedId ? session.find(session.selectedId) : undefined);
  const selectedChanged = $derived(!!selected && proposedText(selected) !== selected.source);
  const left = $derived(session.remaining);
  const percent = $derived(session.status.fraction === null ? null : Math.round(session.status.fraction * 100));
  const engineLabel = $derived(
    prefs.mode === 'device' ? `On this device, ${session.localModel.label.replace(/\s*\(.*$/, '').toLowerCase()} model` : `${prefs.info.label}${prefs.model ? `, ${prefs.model}` : ''}`,
  );
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  const headline = $derived.by(() => {
    if (phase === 'running') return 'Rewriting';
    if (phase === 'paused') return session.status.tone === 'error' ? 'Stopped' : 'Paused';
    if (phase === 'done') return session.changes ? `${plural(session.changes, 'sentence', 'sentences')} changed. Read it through.` : 'Nothing needed changing.';
    if (left > 0) return `${plural(left, 'sentence', 'sentences')} to rewrite`;
    return session.changes ? 'Nothing else reads stiff.' : 'Nothing reads stiff here.';
  });

  let cursor = 0;
  function jump(entry: SheetEntry) {
    const id = entry.sentenceIds[cursor % entry.sentenceIds.length]!;
    cursor++;
    onJump(id);
  }

  function download(f: ExportFormat) {
    onExport(f);
    if (downloadMenu) downloadMenu.open = false;
  }
</script>

<div class="col" class:idle={phase === 'empty'}>
  <aside class="sheet" class:open class:idle={phase === 'empty'} aria-label="Style sheet">
    {#if phase === 'empty'}
      <h2 class="title">Style sheet</h2>
      <figure class="strunk">
        <img src={strunk} width="1133" height="772" alt="Page 24 of The Elements of Style: rule 13, Omit needless words, with a table of wordy expressions and their shorter forms." loading="lazy" />
        <figcaption>William Strunk Jr., <cite>The Elements of Style</cite>, 1918. Rule 13, the one this tool runs on. Public domain scan, Cornell University Library.</figcaption>
      </figure>
      <p class="lede">After you clean a draft, every phrase the rules catch is entered here: where it is, why it reads stiff, and what it became.</p>
      <ol class="entries example" aria-label="Example entries">
        {#each EXAMPLE_ENTRIES as e, i (e.phrase)}
          <li class="row">
            <span class="loc">¶{i + 1}</span>
            <span class="phrase" class:struck={e.status !== 'to-rewrite'} class:pending={e.status === 'to-rewrite'}>{e.phrase}</span>
            <span class="why">{e.note}</span>
            <span class="state">{STATUS_LABEL[e.status]}</span>
          </li>
        {/each}
      </ol>
    {:else}
      <div class="next">
        <div class="next-head">
          <h2 class="headline">{headline}</h2>
          <button class="btn btn-ghost toggle" aria-expanded={open} onclick={() => (open = !open)}>{open ? 'Hide sheet' : 'Sheet'}</button>
        </div>
        <p class="counts">
          {phase !== 'done' ? `${plural(session.changes, 'sentence', 'sentences')} changed · ${left} left to rewrite · ` : ''}{plural(entries.length, 'entry', 'entries')} on the sheet
        </p>

        {#if phase === 'running'}
          <div class="progress" role="progressbar" aria-label="Rewrite progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? 0}>
            <div class="fill" style:transform="scaleX({(percent ?? 0) / 100})"></div>
          </div>
        {/if}
        <p class="status" class:error={session.status.tone === 'error'} aria-live="polite">{session.status.text}</p>

        {#if phase === 'review' && left > 0}
          <button class="btn btn-primary wide" onclick={onRewrite}>Rewrite {plural(left, 'sentence', 'sentences')} <ArrowRight class="icon" aria-hidden="true" /></button>
          <p class="engine">
            {#if prefs.mode === 'device'}<Laptop class="icon" aria-hidden="true" />{:else}<KeyRound class="icon" aria-hidden="true" />{/if}
            <span>{prefs.chosen ? engineLabel : 'Choose where the rewrite runs'}</span>
            <button class="link" onclick={() => onSettings(false)}>{prefs.chosen ? 'Change' : 'Choose'}</button>
          </p>
        {:else if phase === 'running'}
          <button class="btn wide" onclick={() => session.pause()}><Pause class="icon" aria-hidden="true" /> Pause</button>
          <label class="check">
            <input type="checkbox" checked={session.notifyWhenDone} onchange={(e) => session.setNotify(e.currentTarget.checked)} />
            Notify me when it’s done
          </label>
        {:else if phase === 'paused'}
          <button class="btn btn-primary wide" onclick={onRewrite}><Play class="icon" aria-hidden="true" /> {session.status.tone === 'error' ? 'Try again' : 'Resume'}</button>
          <p class="engine"><SlidersHorizontal class="icon" aria-hidden="true" /><span>{engineLabel}</span><button class="link" onclick={() => onSettings(false)}>Change</button></p>
        {:else}
          <button class="btn btn-primary wide" onclick={onCopy}><ClipboardCopy class="icon" aria-hidden="true" /> {copied ? 'Copied' : 'Copy the text'}</button>
        {/if}

        {#if selected && selectedChanged && !open}
          <div class="mini" aria-label="Selected sentence">
            <span>Selected change</span>
            <button class="btn" aria-pressed={selected.decision === 'accepted'} onclick={() => session.decide(selected.id, 'accepted')}><Check class="icon" aria-hidden="true" /> Keep</button>
            <button class="btn" aria-pressed={selected.decision === 'rejected'} onclick={() => session.decide(selected.id, 'rejected')}><Undo2 class="icon" aria-hidden="true" /> Undo</button>
            <button class="link" onclick={() => (open = true)}>Why</button>
          </div>
        {/if}
      </div>

      <div class="body">
        {#if selected}
          <SentenceCard
            sentence={selected}
            working={phase === 'running' && session.selectedId === selected.id}
            onDecide={(d) => session.decide(selected.id, d)}
            onClose={() => (session.selectedId = null)}
          />
        {/if}

        <CheckerPanel {session} />

        {#if entries.length}
          {#each groups as g (g.status)}
            <section class="group">
              <h3>{STATUS_LABEL[g.status]} <span>{plural(g.entries.length, 'phrase', 'phrases')}</span></h3>
              <ol class="entries">
                {#each g.entries as e (e.key)}
                  <li>
                    <button class="row entry" class:current={!!session.selectedId && e.sentenceIds.includes(session.selectedId)} onclick={() => jump(e)}>
                      <span class="loc">¶{e.para}</span>
                      <span class="phrase" class:struck={e.status === 'removed' || e.status === 'fixed' || e.status === 'rewritten'} class:pending={e.status === 'to-rewrite'}>{e.phrase}</span>
                      <span class="why">{e.note}</span>
                      {#if e.sentenceIds.length > 1}<span class="state">{e.sentenceIds.length}×</span>{/if}
                      {#if e.now}<span class="now">{e.now}</span>{/if}
                    </button>
                  </li>
                {/each}
              </ol>
            </section>
          {/each}
        {:else}
          <p class="lede">No stock phrases found.</p>
        {/if}

        <div class="tools">
          {#if phase !== 'done' && phase !== 'running'}
            <button class="btn" onclick={onCopy}><ClipboardCopy class="icon" aria-hidden="true" /> {copied ? 'Copied' : 'Copy as is'}</button>
          {/if}
          <details class="menu" bind:this={downloadMenu}>
            <summary class="btn"><Download class="icon" aria-hidden="true" /> Download</summary>
            <div class="menu-items" role="menu">
              <button role="menuitem" onclick={() => download('docx')}>Word document (.docx)</button>
              <button role="menuitem" onclick={() => download('md')}>Markdown (.md)</button>
              <button role="menuitem" onclick={() => download('txt')}>Plain text (.txt)</button>
            </div>
          </details>
          {#if session.checkerEnabled && phase !== 'running'}
            <button class="btn" onclick={() => session.startCheck()} disabled={session.check.kind === 'working'}><ScanSearch class="icon" aria-hidden="true" /> Check it</button>
          {/if}
        </div>

        <p class="links">
          {#if session.changes && phase !== 'running'}
            <button class="link" onclick={() => session.decideAll('accepted')}>Keep all</button>
            <button class="link" onclick={() => session.decideAll('rejected')}>Undo all</button>
          {/if}
          <button class="link" onclick={() => session.editDraft()} disabled={phase === 'running'}>Edit the draft</button>
          <button class="link" onclick={() => session.startOver()} disabled={phase === 'running'}>Start over</button>
        </p>
        <p class="keys"><kbd>J</kbd><kbd>K</kbd> next and previous · <kbd>A</kbd> keep · <kbd>R</kbd> undo</p>
      </div>
    {/if}
  </aside>
</div>

<style>
  .col {
    grid-row: 1 / span 2;
    grid-column: 2;
    background: var(--sheet);
    border-left: 1px solid var(--rule);
  }

  .sheet {
    position: sticky;
    top: 0;
    max-height: 100dvh;
    overflow-y: auto;
    display: grid;
    align-content: start;
    gap: 1.25rem;
    padding: 1.5rem 1.4rem 2rem;
    background: var(--sheet);
    scrollbar-width: thin;
  }

  .title {
    margin: 0;
    font-size: var(--t-xl);
    font-weight: 800;
    letter-spacing: -0.025em;
  }

  .next {
    display: grid;
    gap: 0.7rem;
    padding-bottom: 1.25rem;
    border-bottom: 1px solid var(--rule);
  }

  .next-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .headline {
    margin: 0;
    font-size: var(--t-xl);
    font-weight: 800;
    line-height: 1.1;
    letter-spacing: -0.025em;
    text-wrap: balance;
  }

  .toggle {
    display: none;
  }

  .counts {
    margin: 0;
    font-size: var(--t-sm);
    color: var(--ink-2);
    font-variant-numeric: tabular-nums;
  }

  .wide {
    width: 100%;
    min-height: 3rem;
    font-size: var(--t-base);
  }

  .engine {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    margin: 0;
    font-size: var(--t-sm);
    color: var(--ink-2);
  }

  .engine span {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .engine .link {
    min-height: 2.75rem;
  }

  .progress {
    height: 4px;
    background: var(--rule);
    border-radius: 2px;
    overflow: hidden;
  }

  .fill {
    height: 100%;
    background: var(--accent);
    transform-origin: left;
    transition: transform 400ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  .status {
    margin: 0;
    font-size: var(--t-sm);
    color: var(--ink-2);
  }

  .status:empty {
    display: none;
  }

  .status.error {
    color: var(--ink);
    font-weight: 600;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-height: 2.75rem;
    font-size: var(--t-sm);
    color: var(--ink-2);
  }

  .mini {
    display: none;
  }

  .body {
    display: grid;
    gap: 1.1rem;
  }

  .lede {
    margin: 0;
    font-size: var(--t-sm);
    color: var(--ink-2);
  }

  .group h3 {
    display: flex;
    justify-content: space-between;
    margin: 0 0 0.35rem;
    font-size: var(--t-sm);
    font-weight: 700;
  }

  .group h3 span {
    font-weight: 500;
    color: var(--ink-2);
    font-variant-numeric: tabular-nums;
  }

  .entries {
    margin: 0;
    padding: 0;
    list-style: none;
    border-top: 1px solid var(--ink);
  }

  .entries li,
  .example .row {
    border-bottom: 1px solid var(--rule);
  }

  .row {
    display: grid;
    grid-template-columns: 2.4rem 1fr auto;
    column-gap: 0.5rem;
    width: 100%;
    min-height: 2.75rem;
    padding: 0.55rem 0.35rem 0.55rem 0;
    border: 0;
    background: none;
    text-align: left;
  }

  .entry {
    cursor: pointer;
  }

  .entry:hover {
    background: var(--page);
  }

  .entry.current {
    background: var(--accent-wash);
  }

  .loc {
    grid-row: 1 / span 3;
    padding-left: 0.35rem;
    font-size: var(--t-xs);
    font-weight: 600;
    color: var(--ink-2);
    font-variant-numeric: tabular-nums;
    line-height: 1.6;
  }

  .phrase {
    grid-column: 2;
    font-size: var(--t-sm);
    font-weight: 650;
  }

  .phrase.struck {
    color: var(--removed);
    text-decoration: line-through;
    text-decoration-thickness: 1.5px;
  }

  .phrase.pending {
    text-decoration: underline wavy var(--accent);
    text-decoration-thickness: 1px;
    text-underline-offset: 0.28em;
    text-decoration-skip-ink: none;
  }

  .why {
    grid-column: 2;
    font-size: var(--t-xs);
    color: var(--ink-2);
  }

  .state {
    grid-column: 3;
    grid-row: 1;
    font-size: var(--t-xs);
    font-weight: 700;
    color: var(--ink-2);
    font-variant-numeric: tabular-nums;
  }

  .now {
    grid-column: 2 / span 2;
    margin-top: 0.25rem;
    font-size: var(--t-xs);
    line-height: 1.45;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    text-decoration: underline double var(--accent);
    text-decoration-thickness: 1px;
    text-underline-offset: 0.2em;
  }

  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .menu {
    position: relative;
  }

  .menu summary {
    list-style: none;
  }

  .menu summary::-webkit-details-marker {
    display: none;
  }

  .menu-items {
    position: absolute;
    z-index: 20;
    bottom: calc(100% + 0.35rem);
    left: 0;
    display: grid;
    min-width: 13rem;
    padding: 0.3rem;
    background: var(--page);
    border: 1px solid var(--ink);
    border-radius: var(--radius);
  }

  .menu-items button {
    min-height: 2.75rem;
    border: 0;
    background: none;
    text-align: left;
    padding: 0.45rem 0.6rem;
    border-radius: 2px;
    cursor: pointer;
    font-size: var(--t-sm);
  }

  .menu-items button:hover {
    background: var(--accent-wash);
  }

  .links {
    display: flex;
    flex-wrap: wrap;
    gap: 0 1.1rem;
    margin: 0;
    font-size: var(--t-sm);
  }

  .links .link {
    min-height: 2.75rem;
  }

  .keys {
    margin: 0;
    font-size: var(--t-xs);
    color: var(--ink-2);
  }

  .keys kbd {
    margin-right: 0.2rem;
  }

  .strunk {
    margin: 0;
    padding: 0.9rem 0.9rem 0.75rem;
    background: var(--page);
    border: 1px solid var(--rule);
    border-radius: var(--radius);
  }

  .strunk img {
    display: block;
    width: 100%;
    height: auto;
  }

  .strunk figcaption {
    margin-top: 0.6rem;
    font-size: var(--t-xs);
    color: var(--ink-2);
  }

  .strunk cite {
    font-style: normal;
    font-weight: 600;
    color: var(--ink);
  }

  @media (prefers-color-scheme: dark) {
    :global(:root:not([data-theme='light'])) .strunk img {
      filter: invert(1);
    }
  }

  :global(:root[data-theme='dark']) .strunk img {
    filter: invert(1);
  }

  @media (max-width: 960px) {
    .col {
      grid-row: auto;
      grid-column: auto;
      border-left: 0;
    }

    .col.idle {
      border-top: 1px solid var(--rule);
    }

    .sheet {
      position: fixed;
      top: auto;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 15;
      max-height: 78dvh;
      gap: 0.75rem;
      padding: 0.8rem var(--gutter) calc(0.8rem + env(safe-area-inset-bottom));
      border-top: 1px solid var(--ink);
    }

    .sheet.idle {
      position: static;
      max-height: none;
      border-top: 0;
      padding-top: 1.5rem;
    }

    .next {
      gap: 0.5rem;
      padding-bottom: 0.25rem;
      border-bottom: 0;
    }

    .headline {
      font-size: var(--t-lg);
    }

    .toggle {
      display: inline-flex;
    }

    .sheet:not(.open) .counts,
    .sheet:not(.open) .engine {
      display: none;
    }

    .sheet:not(.open):not(.idle) .body {
      display: none;
    }

    .mini {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: var(--t-sm);
    }

    .mini span {
      flex: 1;
      color: var(--ink-2);
    }

    .mini .btn[aria-pressed='true'] {
      border-color: var(--ink);
      background: var(--ink);
      color: var(--page);
    }
  }
</style>
