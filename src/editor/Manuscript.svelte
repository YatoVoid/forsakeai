<script lang="ts">
  import { wordDiff } from '../lib/diff';
  import { proposedText } from '../pipeline/parse';
  import type { Block, Doc, Sentence } from '../pipeline/types';

  let {
    doc,
    selectedId,
    activeIds = [],
    onSelect,
  }: {
    doc: Doc;
    selectedId: string | null;
    activeIds?: string[];
    onSelect: (id: string | null) => void;
  } = $props();

  const active = $derived(new Set(activeIds));

  function interactive(s: Sentence): boolean {
    return proposedText(s) !== s.source || s.stiff || s.status === 'kept';
  }

  function headingLevel(b: Block): number {
    return Math.min(4, (b.lead.match(/#/g) ?? ['#']).length + 1);
  }

  function marker(b: Block): string {
    const m = b.lead.trim();
    return /^[-*+]$/.test(m) ? '•' : m;
  }

  function indent(b: Block): number {
    return (/^\s*/.exec(b.lead)?.[0].length ?? 0) / 2;
  }

  function flagged(s: Sentence): Array<{ text: string; flag?: string }> {
    const flags = s.flags.filter((f) => !f.fixed && f.start >= 0).sort((a, b) => a.start - b.start);
    const out: Array<{ text: string; flag?: string }> = [];
    let pos = 0;
    for (const f of flags) {
      if (f.start < pos) continue;
      if (f.start > pos) out.push({ text: s.text.slice(pos, f.start) });
      out.push({ text: s.text.slice(f.start, f.end), flag: f.note });
      pos = f.end;
    }
    if (pos < s.text.length) out.push({ text: s.text.slice(pos) });
    return out;
  }

  function onKey(e: KeyboardEvent, id: string) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(selectedId === id ? null : id);
    }
  }
</script>

{#snippet sentence(s: Sentence)}
  {@const proposed = proposedText(s)}
  {@const changed = proposed !== s.source}
  {#if !interactive(s)}<span class="s">{s.source}</span>{s.trailing}{:else}<span
      class="s mark"
      class:selected={selectedId === s.id}
      class:working={active.has(s.id)}
      class:kept={s.status === 'kept' && !changed}
      data-id={s.id}
      role="button"
      tabindex="0"
      aria-pressed={selectedId === s.id}
      onclick={() => onSelect(selectedId === s.id ? null : s.id)}
      onkeydown={(e) => onKey(e, s.id)}
    >{#if changed && s.decision === 'rejected'}<span class="rejected">{s.source}</span>{:else if changed && s.decision === 'accepted'}{proposed}{:else if changed}{#each wordDiff(s.source, proposed) as part, i (i)}{#if part.op === 'delete'}<del>{part.text}</del>{:else if part.op === 'insert'}<ins>{part.text}</ins>{:else}{part.text}{/if}{/each}{#if !proposed}<span class="visually-hidden">(sentence removed)</span>{/if}{:else}{#each flagged(s) as seg, i (i)}{#if seg.flag}<span class="flag" title={seg.flag}>{seg.text}</span>{:else}{seg.text}{/if}{/each}{/if}</span>{s.trailing}{/if}
{/snippet}

{#snippet sentences(b: Block)}
  {#each b.sentences as s (s.id)}{@render sentence(s)}{/each}
{/snippet}

<article class="manuscript">
  {#each doc.blocks as b (b.id)}
    {#if b.kind === 'heading'}
      <svelte:element this={`h${headingLevel(b)}`} class="h">{@render sentences(b)}</svelte:element>
    {:else if b.kind === 'paragraph'}
      <p>{@render sentences(b)}</p>
    {:else if b.kind === 'list-item'}
      <p class="li" style:margin-inline-start="{indent(b) * 1.25}rem">
        <span class="marker" aria-hidden="true">{marker(b)}</span>{@render sentences(b)}
      </p>
    {:else if b.kind === 'code' || b.kind === 'table'}
      <pre>{b.lead}</pre>
    {:else if b.kind === 'quote'}
      <blockquote>{b.lead.replace(/^\s{0,3}>\s?/gm, '')}</blockquote>
    {:else if b.kind === 'rule'}
      <hr />
    {/if}
  {/each}
</article>

<style>
  .manuscript {
    font-family: var(--serif);
    font-size: var(--step-0);
    font-optical-sizing: auto;
    line-height: 1.7;
    max-width: var(--measure);
    overflow-wrap: anywhere;
  }

  p,
  .h {
    white-space: pre-wrap;
  }

  p {
    margin: 0 0 1em;
  }

  .h {
    font-weight: 600;
    line-height: 1.25;
    margin: 1.4em 0 0.5em;
    letter-spacing: -0.01em;
  }

  :global(.manuscript h2) {
    font-size: var(--step-3);
  }

  :global(.manuscript h3) {
    font-size: var(--step-2);
  }

  :global(.manuscript h4) {
    font-size: var(--step-1);
  }

  .li {
    display: flex;
    gap: 0.6em;
    margin-bottom: 0.35em;
  }

  .marker {
    flex: none;
    min-width: 1ch;
    color: var(--ink-soft);
  }

  pre {
    font-family: var(--mono);
    font-size: 0.78rem;
    line-height: 1.55;
    background: var(--paper-sunk);
    border-radius: var(--radius);
    padding: 0.8rem 1rem;
    overflow-x: auto;
    white-space: pre;
  }

  blockquote {
    margin: 0 0 1em;
    padding-left: 1rem;
    border-left: 2px solid var(--rule);
    color: var(--ink-soft);
    font-style: italic;
  }

  hr {
    border: 0;
    border-top: 1px solid var(--rule);
    margin: 2em 0;
  }

  .mark {
    cursor: pointer;
    border-radius: 2px;
    transition: background-color 150ms;
  }

  .mark:hover {
    background: var(--paper-sunk);
  }

  .selected {
    background: var(--pencil-wash);
    box-shadow: 0 0 0 2px var(--pencil-wash);
  }

  .selected:hover {
    background: var(--pencil-wash);
  }

  .working {
    text-decoration: underline wavy var(--pencil);
    text-decoration-thickness: 1px;
    text-underline-offset: 0.3em;
  }

  .flag {
    text-decoration: underline dotted var(--pencil);
    text-decoration-thickness: 2px;
    text-underline-offset: 0.25em;
  }

  .kept {
    text-decoration: underline dotted var(--ink-soft);
    text-underline-offset: 0.25em;
  }

  del {
    color: var(--pencil);
    text-decoration: line-through;
    text-decoration-color: var(--pencil);
    text-decoration-thickness: 1.5px;
  }

  ins {
    color: var(--insert);
    text-decoration: none;
    background: var(--insert-wash);
    border-radius: 2px;
    animation: ink 150ms ease-out;
  }

  del + ins {
    margin-left: 0.2em;
  }

  .rejected {
    color: var(--ink-soft);
  }

  @keyframes ink {
    from {
      opacity: 0;
    }
  }
</style>
