import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { LANGUAGE_PAGES } from '../src/pages/languages.ts';

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Keeps the JSON from closing its script tag early. */
const escapeJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c');

/**
 * Writes one static entry page per language after the build (dist/de/index.html
 * and so on), plus sitemap.xml. Each page is the app shell with
 * its own lang, title, description, canonical link and a small JSON config the
 * app reads for the intro, placeholder and sample. robots.txt is skipped because
 * crawlers only read it at the domain root, which a project site doesn't own.
 */
export function languagePages(siteUrl: string): Plugin {
  let config: ResolvedConfig;
  const site = siteUrl.replace(/\/+$/, '');

  const alternates = () =>
    [
      `<link rel="alternate" hreflang="en" href="${site}/" />`,
      ...LANGUAGE_PAGES.map((p) => `<link rel="alternate" hreflang="${p.htmlLang}" href="${site}/${p.slug}/" />`),
      `<link rel="alternate" hreflang="x-default" href="${site}/" />`,
    ].join('\n    ');

  return {
    name: 'plainhand-language-pages',
    apply: 'build',
    configResolved(c) {
      config = c;
    },
    transformIndexHtml(html, ctx) {
      if (ctx.path !== '/index.html') return html;
      return html.replace('</head>', `    <link rel="canonical" href="${site}/" />\n    ${alternates()}\n  </head>`);
    },
    closeBundle() {
      if (config.build.ssr) return;
      const out = join(config.root, config.build.outDir);
      const shell = readFileSync(join(out, 'index.html'), 'utf8').replace(/\s*<link rel="(?:canonical|alternate)"[^>]*>/g, '');

      for (const page of LANGUAGE_PAGES) {
        const pageConfig = { lang: page.lang, htmlLang: page.htmlLang, heading: page.heading, intro: page.intro, placeholder: page.placeholder, sample: page.sample };
        const html = shell
          .replace('<html lang="en">', `<html lang="${page.htmlLang}">`)
          .replace(/<title>[^<]*<\/title>/, `<title>${escapeHtml(page.title)}</title>`)
          .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${escapeHtml(page.description)}" />`)
          .replace(
            '</head>',
            `  <link rel="canonical" href="${site}/${page.slug}/" />\n    ${alternates()}\n    <script type="application/json" id="page-config">${escapeJson(pageConfig)}</script>\n  </head>`,
          );
        mkdirSync(join(out, page.slug), { recursive: true });
        writeFileSync(join(out, page.slug, 'index.html'), html);
      }

      const urls = [`${site}/`, ...LANGUAGE_PAGES.map((p) => `${site}/${p.slug}/`), `${site}/privacy.html`];
      writeFileSync(
        join(out, 'sitemap.xml'),
        `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`,
      );
    },
  };
}

const ORT_FILES = ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'];

/**
 * Serves ONNX Runtime's WASM build from our own origin under /ort/. The
 * checker can't load it from a CDN or a blob: URL because of the CSP.
 */
export function ortAssets(root: string): Plugin {
  const dist = join(root, 'node_modules/onnxruntime-web/dist');
  let config: ResolvedConfig;
  return {
    name: 'plainhand-ort-assets',
    configResolved(c) {
      config = c;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split('?')[0]?.split('/ort/')[1];
        if (!name || !ORT_FILES.includes(name)) return next();
        res.setHeader('content-type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript');
        res.end(readFileSync(join(dist, name)));
      });
    },
    closeBundle() {
      if (config.command !== 'build' || config.build.ssr) return;
      const out = join(config.root, config.build.outDir, 'ort');
      mkdirSync(out, { recursive: true });
      for (const f of ORT_FILES) copyFileSync(join(dist, f), join(out, f));
    },
  };
}
