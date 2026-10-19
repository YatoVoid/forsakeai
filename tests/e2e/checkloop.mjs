// The full loop on a real GPU: rewrite every sentence on device, check, rewrite the
// flagged sentences, check again. Needs a full Chromium with WebGPU and a build
// pointed at a copy of the detector (see checker.mjs).
// Usage: CHROMIUM_GPU=/path/to/chrome node tests/e2e/checkloop.mjs <draft.md> <outDir> [rounds] [baseUrl]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { checker, cleanText, copyOutput, waitDone } from './helpers.mjs';

const [draftPath, outDir, rounds = '2', base = 'http://localhost:4173/forsakeai/'] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const { check, failures } = checker();
const context = await chromium.launchPersistentContext(`${homedir()}/.cache/forsakeai-eval/chrome-app-profile`, {
  executablePath: process.env.CHROMIUM_GPU,
  headless: false,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPUService', '--ignore-gpu-blocklist', '--ozone-platform=x11'],
  viewport: { width: 1280, height: 900 },
});
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
const page = context.pages()[0] ?? (await context.newPage());
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(base);
await page.evaluate(() => localStorage.clear());
await page.reload();
await cleanText(page, readFileSync(draftPath, 'utf8'));

const sheet = page.locator('.sheet');
const t0 = Date.now();
const log = (s) => console.log(`${String(Math.round((Date.now() - t0) / 1000)).padStart(4)} s  ${s}`);

await sheet.getByRole('radio', { name: /Every sentence/ }).click();
await sheet.getByRole('button', { name: /^Rewrite \d+ sentences?/ }).click();
const dialog = page.locator('dialog[open]');
await dialog.waitFor();
await dialog.getByText('On this device').click();
await page.waitForFunction(() => !document.querySelector('dialog[open]')?.textContent?.includes('Checking your graphics card'));
await dialog.getByRole('button', { name: /Save and rewrite/ }).click();
await waitDone(page, 40 * 60_000);
log('rewrote every sentence');
writeFileSync(join(outDir, 'round0.md'), await copyOutput(page));

const scores = [];
async function readCheck() {
  const score = page.locator('.checker .score');
  await score.waitFor({ timeout: 900_000 });
  const value = (await score.textContent()).replace(/\s+/g, ' ').trim();
  const flagged = await page.locator('.manuscript .flagged').count();
  scores.push(value);
  log(`check: ${value}, ${flagged} flagged · ${(await sheet.locator('.status').textContent()).trim()}`);
  return flagged;
}

await sheet.getByRole('button', { name: 'Check for AI' }).click();
const confirm = page.getByRole('button', { name: 'Download and check' });
await Promise.race([confirm.waitFor({ timeout: 900_000 }), page.locator('.checker .score').waitFor({ timeout: 900_000 })]);
if (await confirm.isVisible()) await confirm.click();
let flagged = await readCheck();

// After the flagged sentences are rewritten, the app checks again by itself.
for (let r = 1; r <= Number(rounds) && flagged; r++) {
  await page.getByRole('button', { name: /^Rewrite (this sentence|these \d+ sentences)$/ }).click();
  await page.locator('.checker .score').waitFor({ state: 'detached', timeout: 60_000 });
  await waitDone(page, 20 * 60_000);
  log(`rewrote flagged, round ${r}`);
  flagged = await readCheck();
  writeFileSync(join(outDir, `round${r}.md`), await copyOutput(page));
}

check(scores.length >= 2, 'checked more than once');
check(errors.length === 0, `no console errors ${JSON.stringify(errors.slice(0, 3))}`);
console.log(JSON.stringify({ scores }));
await context.close();
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
