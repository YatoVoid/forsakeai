// The AI check end to end on a real GPU: rewrite, check, rewrite the flagged sentences, check again.
// Needs a headed Chromium with WebGPU and a build pointed at a copy of the model:
//   VITE_DETECTOR_HOST=http://127.0.0.1:8099/ VITE_DETECTOR_MODEL=<folder> BASE_PATH=/forsakeai/ npm run build
// Usage: node tests/e2e/checker.mjs [baseUrl] [chromiumPath] [file.md]
// CHECK_ONLY=1 checks the pasted text as it is, without the stub rewrite first.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { chromium } from 'playwright-core';
import { checker, cleanText, rewriteWithLocalServer, trackCsp, waitDone } from './helpers.mjs';

const base = process.argv[2] ?? 'http://localhost:4173/forsakeai/';
const executablePath = process.argv[3] ?? process.env.CHROMIUM_PATH;
const text = process.argv[4]
  ? readFileSync(process.argv[4], 'utf8')
  : 'Socrates uses questions to test every definition Euthyphro offers. '.repeat(3) +
    '\n\nIn today’s fast-paced world, it is important to note that this dialogue plays a crucial role in fostering critical thinking. Moreover, it serves as a testament to the enduring power of philosophical inquiry. Ultimately, it underscores the importance of questioning our assumptions.';
const { check, failures } = checker();

// HEADLESS=1 runs without a GPU, which exercises the WASM fallback.
const headless = !!process.env.HEADLESS;
const ctx = await chromium.launchPersistentContext(`${homedir()}/.cache/forsakeai-eval/chrome-${headless ? 'wasm' : 'app'}-profile`, {
  executablePath,
  headless,
  permissions: ['clipboard-read', 'clipboard-write'],
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPUService', '--ignore-gpu-blocklist', '--ozone-platform=x11'],
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await trackCsp(page);
await page.goto(base);
await page.evaluate(() => localStorage.clear());
await page.goto(base);
await cleanText(page, text);
const checkOnly = !!process.env.CHECK_ONLY;
if (!checkOnly) {
  await rewriteWithLocalServer(page, 'http://127.0.0.1:8787/v1', 'mock');
  await waitDone(page);
}

async function runCheck(label) {
  await page.getByRole('button', { name: 'Check for AI' }).click();
  const confirm = page.getByRole('button', { name: 'Download and check' });
  const score = page.locator('.checker .score');
  await Promise.race([confirm.waitFor({ timeout: 900_000 }), score.waitFor({ timeout: 900_000 })]);
  const started = Date.now();
  if (await confirm.isVisible()) await confirm.click();
  await score.waitFor({ timeout: 900_000 });
  const value = (await score.textContent()).replace(/\s+/g, ' ').trim();
  const flagged = await page.locator('.manuscript .flagged').count();
  const bands = await page.locator('.manuscript [class*="band-"]:not(.band-none)').count();
  const titles = await page.locator('.manuscript [class*="band-"]:not(.band-none)').evaluateAll((els) => [...new Set(els.map((e) => e.title))]);
  console.log(`     ${label}: ${value}, ${flagged} flagged, ${bands} paragraphs marked (${Math.round((Date.now() - started) / 1000)} s) ${titles.join(' | ')}`);
  check(/^\d+% (Reads human|Mixed|Reads AI)$/.test(value), `${label}: shows a percentage and band`);
  check(bands > 0, `${label}: marks paragraphs in the margin`);
  return { value, flagged };
}

const first = await runCheck('first check');
if (process.env.SHOT) {
  await page.screenshot({ path: `${process.env.SHOT}-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${process.env.SHOT}-mobile.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
}
if (first.flagged && !checkOnly) {
  check((await page.locator('.checker li').count()) === first.flagged, 'lists every highlighted sentence');
  await page.getByRole('button', { name: /^Rewrite (this sentence|these \d+ sentences)$/ }).click();
  await waitDone(page);
  check((await page.locator('.manuscript .flagged').count()) === 0, 'highlights clear once the rewrite starts');
  await runCheck('after rewriting flagged');
}

check((await page.evaluate(() => window.__csp)).length === 0, `no CSP violations ${JSON.stringify(await page.evaluate(() => window.__csp))}`);
check(errors.length === 0, `no console errors ${JSON.stringify(errors.slice(0, 3))}`);
await ctx.close();
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
