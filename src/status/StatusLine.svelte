<script lang="ts">
  import type { Status } from '../app/session.svelte';

  let { status }: { status: Status } = $props();
  const percent = $derived(status.fraction === null ? null : Math.round(status.fraction * 100));
</script>

<div class="status">
  <div
    class="track"
    class:active={status.tone === 'working'}
    role={percent === null ? undefined : 'progressbar'}
    aria-label={percent === null ? undefined : 'Progress'}
    aria-valuemin={percent === null ? undefined : 0}
    aria-valuemax={percent === null ? undefined : 100}
    aria-valuenow={percent ?? undefined}
  >
    {#if percent !== null}
      <div class="fill" style:width="{percent}%"></div>
    {/if}
  </div>
  <p class="line" class:error={status.tone === 'error'} aria-live="polite">{status.text}</p>
</div>

<style>
  .status {
    position: sticky;
    top: 0;
    z-index: 5;
    background: var(--paper);
  }

  .track {
    height: 2px;
    background: transparent;
    border-bottom: 1px solid var(--rule);
  }

  .fill {
    height: 2px;
    background: var(--pencil);
    transition: width 300ms ease-out;
  }

  .line {
    margin: 0;
    min-height: 2.4em;
    padding: 0.55rem 0 0.4rem;
    font-family: var(--mono);
    font-size: 0.72rem;
    font-variant-numeric: tabular-nums;
    color: var(--ink-soft);
  }

  .error {
    color: var(--pencil);
  }
</style>
