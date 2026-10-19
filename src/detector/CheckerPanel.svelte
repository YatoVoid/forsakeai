<script lang="ts">
  import type { Session } from '../app/session.svelte';
  import { sentenceText } from '../pipeline/parse';

  let { session, onRewrite }: { session: Session; onRewrite: () => void } = $props();

  const LABEL = { human: 'Reads human', mixed: 'Mixed', ai: 'Reads AI' } as const;

  function rewriteFlagged() {
    if (session.markFlagged()) onRewrite();
  }
</script>

{#if session.check.kind === 'confirm'}
  <section class="checker" aria-label="AI check">
    <p>
      The AI check runs an open AI-text detector in this browser. It downloads about {session.check.mb.toLocaleString()} MB once and
      keeps it. Your text stays on this device.
    </p>
    <div class="row">
      <button class="btn btn-primary" onclick={() => session.check.kind === 'confirm' && session.runCheck(session.check.device)}>Download and check</button>
      <button class="btn btn-quiet" onclick={() => session.cancelCheck()}>Not now</button>
    </div>
  </section>
{:else if session.check.kind === 'done'}
  {@const r = session.check.result}
  <section class="checker" aria-label="AI check result">
    <p class="score band-{r.band}">
      <strong>{Math.round(r.ai * 100)}%</strong>
      <span>{LABEL[r.band]}</span>
    </p>
    <p class="muted">
      How likely an open detector (desklib) thinks this text is AI-written. It reads a few paragraphs at a time, like a page, and the
      margin shows each part: <span class="key human">human</span>, <span class="key mixed">mixed</span>, <span class="key ai">AI</span>.
    </p>
    {#if r.flagged.length}
      <p>
        {r.flagged.length === 1 ? 'One sentence pushes' : `${r.flagged.length} sentences push`} the score up the most. They’re highlighted in the text.
      </p>
      <ol>
        {#each r.flagged as f (f.id)}
          {@const s = session.find(f.id)}
          {#if s}
            <li><button class="quote" onclick={() => (session.selectedId = f.id)}>{sentenceText(s)}</button></li>
          {/if}
        {/each}
      </ol>
      <button class="btn btn-primary" onclick={rewriteFlagged}>Rewrite {r.flagged.length === 1 ? 'this sentence' : `these ${r.flagged.length} sentences`}</button>
    {:else}
      <p>No sentence stands out.</p>
    {/if}
    <p class="caveat">Other detectors, like GPTZero or Turnitin, give different numbers. Treat this as a guide, not proof.</p>
    <button class="btn btn-quiet close" onclick={() => session.cancelCheck()}>Close</button>
  </section>
{:else if session.check.kind === 'error'}
  <section class="checker" aria-label="AI check">
    <p>{session.check.message}</p>
    <button class="btn btn-quiet" onclick={() => session.cancelCheck()}>Close</button>
  </section>
{/if}

<style>
  .checker {
    position: relative;
    margin: 0 0 1.5rem;
    padding: 0.9rem 0 1rem;
    border-top: 1px solid var(--rule);
    border-bottom: 1px solid var(--rule);
  }

  .checker p {
    margin: 0 0 0.6rem;
    max-width: 62ch;
  }

  .row {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  .score {
    display: flex;
    align-items: baseline;
    gap: 0.6rem;
  }

  .score strong {
    font-size: var(--t-display);
    font-weight: 800;
    line-height: 1;
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
  }

  .score span {
    font-size: var(--t-lg);
    font-weight: 650;
  }

  .band-human {
    color: var(--human);
  }

  .band-mixed {
    color: var(--mixed);
  }

  .band-ai {
    color: var(--ai);
  }

  .muted {
    font-size: var(--t-sm);
    color: var(--ink-2);
  }

  .key {
    font-weight: 650;
  }

  .key.human {
    color: var(--human);
  }

  .key.mixed {
    color: var(--mixed);
  }

  .key.ai {
    color: var(--ai);
  }

  ol {
    margin: 0 0 0.9rem;
    padding-left: 1.2rem;
  }

  li {
    margin-bottom: 0.45rem;
  }

  .quote {
    vertical-align: top;
    border: 0;
    background: none;
    padding: 0;
    text-align: left;
    cursor: pointer;
    font: inherit;
    font-size: var(--t-base);
    color: var(--ink);
    text-decoration: underline 2px var(--ai);
    text-underline-offset: 0.25em;
  }

  .quote:hover {
    background: var(--ai-wash);
  }

  .caveat {
    font-size: var(--t-xs);
    color: var(--ink-2);
    margin-top: 0.8rem;
  }

  .close {
    position: absolute;
    top: 0.6rem;
    right: 0;
    font-size: var(--t-xs);
    color: var(--ink-2);
  }
</style>
