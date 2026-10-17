<script lang="ts">
  import { Check, Pencil, Undo2, X } from '@lucide/svelte';
  import { tick } from 'svelte';
  import { proposedText, sentenceText } from '../pipeline/parse';
  import type { Sentence } from '../pipeline/types';

  let {
    sentence,
    working,
    canEdit,
    onDecide,
    onEdit,
    onClose,
  }: {
    sentence: Sentence;
    working: boolean;
    canEdit: boolean;
    onDecide: (d: 'accepted' | 'rejected') => void;
    onEdit: (text: string) => void;
    onClose: () => void;
  } = $props();

  let editing = $state(false);
  let draft = $state('');
  let box = $state<HTMLTextAreaElement | null>(null);

  const proposed = $derived(proposedText(sentence));
  const changed = $derived(proposed !== sentence.source);
  const reasons = $derived([...new Map(sentence.flags.map((f) => [f.note + f.match, f])).values()]);

  $effect(() => {
    void sentence.id;
    editing = false;
  });

  const verdict = $derived(
    working
      ? 'Being rewritten now'
      : sentence.edited && sentence.decision !== 'rejected'
        ? 'Your wording'
        : sentence.decision === 'rejected'
          ? 'Original restored'
          : sentence.status === 'rewritten'
            ? 'Rewritten by the model'
            : sentence.status === 'kept'
              ? (sentence.note ?? 'Left as you wrote it.')
              : changed
                ? 'Fixed by the rule list'
                : sentence.stiff
                  ? 'Still reads stiff'
                  : 'Nothing to fix here',
  );

  async function startEdit() {
    draft = sentenceText(sentence);
    editing = true;
    await tick();
    box?.focus();
    box?.setSelectionRange(draft.length, draft.length);
  }

  function save() {
    onEdit(draft);
    editing = false;
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      editing = false;
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      save();
    }
  }
</script>

<section class="card" aria-label="Selected sentence">
  <header>
    <h3>{verdict}</h3>
    <button class="btn btn-ghost close" onclick={onClose} aria-label="Close"><X class="icon" aria-hidden="true" /></button>
  </header>

  {#if editing}
    <label class="visually-hidden" for="sentence-edit">Your version of this sentence</label>
    <textarea id="sentence-edit" bind:this={box} bind:value={draft} onkeydown={onKey} rows="4"></textarea>
    <div class="actions">
      <button class="btn btn-primary" onclick={save}>Save</button>
      <button class="btn" onclick={() => (editing = false)}>Cancel</button>
    </div>
    <p class="hint"><kbd>Enter</kbd> saves · <kbd>Esc</kbd> cancels</p>
  {:else}
    {#if changed}
      <p class="was"><span>Before</span> {sentence.source}</p>
      <p class="now"><span>After</span> {proposed || '(removed)'}</p>
    {:else}
      <p class="now">{sentence.source}</p>
    {/if}

    {#if reasons.length}
      <ul>
        {#each reasons as f (f.ruleId + f.match)}
          <li>{#if f.match.trim()}<q>{f.match.trim()}</q> {/if}<span>{f.note.toLowerCase()}</span></li>
        {/each}
      </ul>
    {/if}

    <div class="actions">
      {#if changed && !sentence.edited}
        <button class="btn" aria-pressed={sentence.decision === 'accepted'} onclick={() => onDecide('accepted')} title="Use the new wording (A)">
          <Check class="icon" aria-hidden="true" /> Accept
        </button>
      {/if}
      {#if changed}
        <button class="btn" aria-pressed={sentence.decision === 'rejected'} onclick={() => onDecide('rejected')} title="Go back to what you pasted (R)">
          <Undo2 class="icon" aria-hidden="true" /> Restore original
        </button>
      {/if}
      {#if canEdit}
        <button class="btn" onclick={startEdit}><Pencil class="icon" aria-hidden="true" /> Edit</button>
      {/if}
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
    min-width: 3.2rem;
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

  textarea {
    width: 100%;
    resize: vertical;
    padding: 0.55rem 0.65rem;
    border: 1px solid var(--rule-strong);
    border-radius: var(--radius);
    background: var(--page);
    font-size: var(--t-sm);
    line-height: 1.5;
  }

  textarea:focus {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .hint {
    font-size: var(--t-xs);
    color: var(--ink-2);
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .actions .btn {
    flex: 1 1 auto;
  }

  .actions .btn[aria-pressed='true'] {
    border-color: var(--ink);
    background: var(--ink);
    color: var(--page);
  }
</style>
