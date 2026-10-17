// Runs a real essay through the app with a real model behind the "Local server" provider,
// and saves each stage for the checker.
// Usage: node tests/e2e/essay.mjs <essay.md> <outDir> [serverUrl] [model] [baseUrl] [chromiumPath]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { cleanText, copyOutput, rewriteWithLocalServer, trackCsp, waitDone } from './helpers.mjs';

const [essayPath, outDir, server = 'http://127.0.0.1:8790/v1', model = 'Qwen2.5-1.5B-Instruct', base = 'http://localhost:4173/plainhand/', executablePath = process.env.CHROMIUM_PATH] =
  process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const essay = readFileSync(essayPath, 'utf8');

const browser = await chromium.launch({ executablePath });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await trackCsp(page);

await page.goto(base);
await cleanText(page, essay);
const counts = (await page.locator('.sheet .counts').textContent()).replace(/\s+/g, ' ').trim();
const cleaned = await copyOutput(page);
await page.screenshot({ path: join(outDir, 'review.png'), fullPage: true });

const started = Date.now();
await rewriteWithLocalServer(page, server, model);
await waitDone(page, 45 * 60_000);
const seconds = Math.round((Date.now() - started) / 1000);
const rewritten = await copyOutput(page);
await page.screenshot({ path: join(outDir, 'done.png'), fullPage: true });

const groups = await page.locator('.sheet .group h3').allTextContents();
const meaningLoaded = await page.evaluate(async () => {
  const cache = await caches.open('transformers-cache');
  return !!(await cache.match('https://huggingface.co/Xenova/paraphrase-multilingual-MiniLM-L12-v2/resolve/main/onnx/model_int8.onnx'));
});
const csp = await page.evaluate(() => window.__csp);
const kept = await page.locator('.manuscript .mark.kept').count();

writeFileSync(join(outDir, 'original.md'), essay);
writeFileSync(join(outDir, 'cleaned.md'), cleaned);
writeFileSync(join(outDir, 'rewritten.md'), rewritten);
writeFileSync(join(outDir, 'report.json'), JSON.stringify({ counts, seconds, groups, kept, meaningLoaded, csp, errors }, null, 2));
console.log(JSON.stringify({ counts, seconds, groups, kept, meaningLoaded, csp, errors }, null, 2));
await browser.close();
