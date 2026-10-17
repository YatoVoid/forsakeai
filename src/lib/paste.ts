const BLOCK = new Set(['P', 'DIV', 'LI', 'BLOCKQUOTE', 'PRE', 'TR', 'SECTION', 'ARTICLE', 'TABLE', 'UL', 'OL', 'HR']);

/**
 * Pasted rich text (Gemini, ChatGPT, Google Docs) often arrives as plain
 * text with headings glued to the next paragraph. This rebuilds the
 * structure from the HTML flavour as Markdown. Returns null when the HTML
 * has no block structure worth keeping.
 */
export function htmlToMarkdown(html: string): string | null {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  if (!body.querySelector('p, div, h1, h2, h3, h4, h5, h6, li, br')) return null;

  const blocks: Array<{ text: string; list: Element | null }> = [];
  let line = '';
  let prefix = '';
  let inList: Element | null = null;
  const flush = () => {
    const text = line.replace(/[ \t ]+/g, ' ').trim();
    if (text) blocks.push({ text: prefix + text, list: inList });
    line = '';
    prefix = '';
    inList = null;
  };

  const walk = (node: Node, depth: number) => {
    if (node.nodeType === Node.TEXT_NODE) {
      line += (node.textContent ?? '').replace(/\s+/g, ' ');
      return;
    }
    if (!(node instanceof HTMLElement) || node.tagName === 'SCRIPT' || node.tagName === 'STYLE') return;
    const tag = node.tagName;
    if (tag === 'BR') return flush();
    const heading = /^H([1-6])$/.exec(tag);
    if (!heading && !BLOCK.has(tag)) {
      node.childNodes.forEach((c) => walk(c, depth));
      return;
    }
    flush();
    if (tag === 'PRE') {
      blocks.push({ text: '```\n' + (node.textContent ?? '').replace(/\n$/, '') + '\n```', list: null });
      return;
    }
    if (tag === 'HR') {
      blocks.push({ text: '---', list: null });
      return;
    }
    const nested = tag === 'UL' || tag === 'OL' ? depth + 1 : depth;
    if (heading) prefix = '#'.repeat(Number(heading[1])) + ' ';
    if (tag === 'LI') {
      const ordered = node.parentElement?.tagName === 'OL';
      const n = ordered ? [...node.parentElement!.children].indexOf(node) + 1 : 0;
      prefix = '  '.repeat(Math.max(0, depth - 1)) + (ordered ? `${n}. ` : '- ');
      inList = node.parentElement;
    }
    if (tag === 'BLOCKQUOTE') prefix = '> ';
    const keepPrefix = prefix;
    const keepList = inList;
    for (const c of node.childNodes) {
      walk(c, nested);
      // A nested block flushed the line; later text in this element still belongs to it.
      if (!line && !prefix && c instanceof HTMLElement && (BLOCK.has(c.tagName) || /^H\d$/.test(c.tagName))) inList = keepList;
    }
    if (!prefix && line) prefix = keepPrefix;
    flush();
  };
  body.childNodes.forEach((c) => walk(c, 0));

  let out = '';
  blocks.forEach((b, i) => {
    if (i) out += b.list && b.list === blocks[i - 1]!.list ? '\n' : '\n\n';
    out += b.text;
  });
  return out || null;
}
