// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { htmlToMarkdown } from '../src/lib/paste';

describe('htmlToMarkdown', () => {
  it('keeps headings apart from the paragraph after them', () => {
    const html = '<h3>The Universal Contender: D.Va</h3><p>While no single hero is immune.</p><h3>Why Other Tanks Fall Short</h3><p>Anchor tanks lack mobility.</p>';
    expect(htmlToMarkdown(html)).toBe('### The Universal Contender: D.Va\n\nWhile no single hero is immune.\n\n### Why Other Tanks Fall Short\n\nAnchor tanks lack mobility.');
  });

  it('turns lists into Markdown lists and keeps inline formatting as text', () => {
    const html = '<p>Pick one:</p><ul><li><b>Sigma</b> on poke maps</li><li>Winston on dive maps</li></ul><ol><li>First</li><li>Second</li></ol>';
    expect(htmlToMarkdown(html)).toBe('Pick one:\n\n- Sigma on poke maps\n- Winston on dive maps\n\n1. First\n2. Second');
  });

  it('returns null for plain inline HTML', () => {
    expect(htmlToMarkdown('<span>just text</span>')).toBeNull();
  });
});
