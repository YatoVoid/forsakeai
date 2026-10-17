<script lang="ts">
  import type { Session } from '../app/session.svelte';
  import { CAVEAT, VERDICT_LABEL } from './present';

  let { session }: { session: Session } = $props();

  const CONFIDENCE = { high: 'High confidence', medium: 'Medium confidence', low: 'Low confidence' } as const;
</script>

{#if session.check.kind === 'confirm'}
  <section class="checker" aria-label="AI-likelihood check">
    <p>
      The checker uses its own pair of models. About {session.check.mb.toLocaleString()} MB, downloaded once and kept in this
      browser. {session.check.device === 'wasm' ? 'Without WebGPU it runs on the processor, so a long text can take a minute.' : ''}
    </p>
    <div class="row">
      <button class="btn btn-primary" onclick={() => session.check.kind === 'confirm' && session.runCheck(session.check.device)}>Download and check</button>
      <button class="btn btn-quiet" onclick={() => session.cancelCheck()}>Not now</button>
    </div>
  </section>
{:else if session.check.kind === 'done'}
  {@const r = session.check.result}
  <section class="checker" aria-label="AI-likelihood check">
    <p class="verdict">
      <strong>{VERDICT_LABEL[r.verdict]}</strong>
      <span>{r.low}–{r.high}% AI-likelihood</span>
      <span>{CONFIDENCE[r.confidence]} ({session.check.langName})</span>
    </p>
    {#each r.caveats as c (c)}<p class="muted">{c}</p>{/each}
    {#if session.check.quotes.length && r.verdict !== 'likely-human'}
      <p class="muted">The sentences that read most machine-like:</p>
      <ol>
        {#each session.check.quotes as q (q.id)}
          <li>
            <button class="quote" onclick={() => (session.selectedId = q.id)}>{q.text}</button>
            <button class="btn btn-quiet" onclick={() => session.markForRewrite(q.id)}>Rewrite this one</button>
          </li>
        {/each}
      </ol>
    {/if}
    <p class="caveat">{CAVEAT}</p>
    <button class="btn btn-quiet close" onclick={() => session.cancelCheck()}>Close</button>
  </section>
{:else if session.check.kind === 'error'}
  <section class="checker" aria-label="AI-likelihood check">
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
    margin: 0 0 0.5rem;
    max-width: 62ch;
  }

  .row {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  .verdict {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem 1.25rem;
    align-items: baseline;
    font-size: 0.9rem;
  }

  .verdict strong {
    font-family: var(--serif);
    font-size: var(--step-1);
    font-weight: 600;
  }

  .verdict span {
    font-family: var(--mono);
    font-size: 0.72rem;
    color: var(--ink-soft);
    font-variant-numeric: tabular-nums;
  }

  .muted {
    color: var(--ink-soft);
  }

  ol {
    margin: 0 0 0.75rem;
    padding-left: 1.2rem;
  }

  li {
    margin-bottom: 0.45rem;
  }

  .quote {
    border: 0;
    background: none;
    padding: 0;
    text-align: left;
    cursor: pointer;
    font-family: var(--serif);
    font-size: 0.95rem;
    font-style: italic;
  }

  .quote:hover {
    text-decoration: underline;
    text-decoration-color: var(--rule);
  }

  .caveat {
    font-size: 0.72rem;
    color: var(--ink-soft);
  }

  .close {
    position: absolute;
    top: 0.6rem;
    right: 0;
    font-size: 0.72rem;
    color: var(--ink-soft);
  }
</style>
