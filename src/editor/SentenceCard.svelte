<script lang="ts">
  import { Check, Undo2, X } from '@lucide/svelte';
  import { proposedText } from '../pipeline/parse';
  import type { Sentence } from '../pipeline/types';

  let {
    sentence,
    working,
    onDecide,
    onClose,
  }: {
    sentence: Sentence;
    working: boolean;
    onDecide: (d: 'accepted' | 'rejected') => void;
    onClose: () => void;
  } = $props();

  const proposed = $derived(proposedText(sentence));
  const changed = $derived(proposed !== sentence.source);
  const reasons = $derived([...new Map(sentence.flags.map((f) => [f.note + f.match, f])).values()]);

  const verdict = $derived(
    working
      ? 'Being rewritten now'
      : sentence.decision === 'rejected'
        ? 'Change undone. The original stands.'
        : sentence.status === 'rewritten'
          ? 'Rewritten by the model'
          : sentence.status === 'kept'
            ? (sentence.note ?? 'Kept your original.')
            : changed
              ? 'Fixed by the rule list'
              : 'Still reads stiff',
  );
</script>

<section class="card" aria-label="Selected sentence">
  <header>
    <h3>{verdict}</h3>
    <button class="btn btn-ghost close" onclick={onClose} aria-label="Close"><X class="icon" aria-hidden="true" /></button>
  </header>

  {#if changed}
    <p class="was"><span>Was</span> {sentence.source}</p>
    <p class="now"><span>Now</span> {proposed || '(removed)'}</p>
  {/if}

  {#if reasons.length}
    <ul>
      {#each reasons as f (f.ruleId + f.match)}
        <li>{#if f.match.trim()}<q>{f.match.trim()}</q> {/if}<span>{f.note.toLowerCase()}</span></li>
      {/each}
    </ul>
  {/if}

  {#if changed}
    <div class="actions">
      <button class="btn" aria-pressed={sentence.decision === 'accepted'} onclick={() => onDecide('accepted')}>
        <Check class="icon" aria-hidden="true" /> Keep <kbd>A</kbd>
      </button>
      <button class="btn" aria-pressed={sentence.decision === 'rejected'} onclick={() => onDecide('rejected')}>
        <Undo2 class="icon" aria-hidden="true" /> Undo <kbd>R</kbd>
      </button>
    </div>
  {/if}
</section>

<style>
  .card {
    display: grid;
    gap: 0.6rem;
    padding: 0.85rem 0.9rem 0.95rem;
    border: 1px solid var(--ink);
    border-radius: var(--radius);
    background: var(--page);
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 0.5rem;
  }

  h3 {
    margin: 0.2rem 0 0;
    font-size: var(--t-sm);
    font-weight: 700;
  }

  .close {
    min-width: 2.75rem;
    min-height: 2.75rem;
    margin: -0.6rem -0.6rem 0 0;
    padding: 0.3rem;
  }

  p {
    margin: 0;
    font-size: var(--t-sm);
    line-height: 1.5;
  }

  p span {
    display: inline-block;
    min-width: 2.4rem;
    font-size: var(--t-xs);
    font-weight: 700;
    color: var(--ink-2);
  }

  .was {
    color: var(--removed);
  }

  li {
    display: flex;
    flex-wrap: wrap;
    gap: 0 0.4rem;
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 0.2rem;
    font-size: var(--t-xs);
    color: var(--ink-2);
  }

  q {
    color: var(--ink);
    font-weight: 600;
  }

  .actions {
    display: flex;
    gap: 0.4rem;
  }

  .actions .btn {
    flex: 1;
  }

  .actions .btn[aria-pressed='true'] {
    border-color: var(--ink);
    background: var(--ink);
    color: var(--page);
  }

  .actions .btn[aria-pressed='true'] kbd {
    background: transparent;
    color: inherit;
  }
</style>
