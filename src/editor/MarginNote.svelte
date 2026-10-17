<script lang="ts">
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

  const changed = $derived(proposedText(sentence) !== sentence.source);
  const fixed = $derived(sentence.flags.filter((f) => f.fixed));
  const open = $derived(sentence.flags.filter((f) => !f.fixed));
  const unique = (list: typeof open) => [...new Map(list.map((f) => [f.note + f.match, f])).values()];
</script>

<div class="note">
  <button class="close btn-quiet btn" onclick={onClose} aria-label="Close note">Close</button>

  {#if working}
    <p class="lede">Being rewritten now.</p>
  {:else if sentence.status === 'rewritten'}
    <p class="lede">Rewritten by the model.</p>
  {:else if sentence.status === 'kept'}
    <p class="lede">{sentence.note ?? 'Kept your original.'}</p>
  {:else if changed}
    <p class="lede">Fixed by the rule pass.</p>
  {:else}
    <p class="lede">Reads stiff. A rewrite will fix it.</p>
  {/if}

  {#if fixed.length}
    <ul>
      {#each unique(fixed) as f (f.ruleId + f.match)}
        <li><span class="quote">{f.match.trim() || f.match}</span> {f.note.toLowerCase()}</li>
      {/each}
    </ul>
  {/if}
  {#if open.length}
    <ul>
      {#each unique(open) as f (f.ruleId + f.match)}
        <li><span class="quote">{f.match}</span> {f.note.toLowerCase()}</li>
      {/each}
    </ul>
  {/if}

  {#if changed}
    <div class="actions">
      <button class="btn" aria-pressed={sentence.decision === 'accepted'} onclick={() => onDecide('accepted')}>
        Accept <kbd>A</kbd>
      </button>
      <button class="btn" aria-pressed={sentence.decision === 'rejected'} onclick={() => onDecide('rejected')}>
        Reject <kbd>R</kbd>
      </button>
    </div>
  {/if}
</div>

<style>
  .note {
    position: relative;
    padding: 0.2rem 0 0.2rem 0.9rem;
    border-left: 2px solid var(--pencil);
    font-size: 0.75rem;
  }

  .close {
    position: absolute;
    top: -0.2rem;
    right: 0;
    font-size: 0.7rem;
    color: var(--ink-soft);
  }

  .lede {
    margin: 0 3.5rem 0.4rem 0;
    font-weight: 500;
  }

  ul {
    margin: 0 0 0.5rem;
    padding: 0;
    list-style: none;
    color: var(--ink-soft);
  }

  li {
    margin-bottom: 0.2rem;
  }

  .quote {
    font-family: var(--serif);
    font-style: italic;
    color: var(--ink);
  }

  .actions {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.5rem;
  }

  .actions .btn {
    padding: 0.3em 0.6em;
    font-size: 0.72rem;
  }

  .actions .btn[aria-pressed='true'] {
    background: var(--ink);
    color: var(--paper);
  }
</style>
