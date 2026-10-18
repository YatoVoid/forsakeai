// The real on-device path on a real GPU: WebLLM download, warm-up, whole-text rewrite.
// Needs a full Chromium with WebGPU (not the headless shell) and a desktop session.
// Usage: CHROMIUM_GPU=/path/to/chrome node tests/e2e/ondevice.mjs <draft.md> <outDir> [baseUrl]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { checker, cleanText, copyOutput, waitDone } from './helpers.mjs';

const [draftPath, outDir, base = 'http://localhost:4173/forsakeai/'] = process.argv.slice(2);
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
await page.goto(base);
// The profile persists for the model cache; start each run from first-visit settings.
await page.evaluate(() => localStorage.removeItem('forsakeai.prefs'));
await page.reload();
await cleanText(page, readFileSync(draftPath, 'utf8'));

const sheet = page.locator('.sheet');
await sheet.getByRole('radio', { name: /Every sentence/ }).click();
await sheet.getByRole('button', { name: /^Rewrite \d+ sentences?/ }).click();
const dialog = page.locator('dialog[open]');
await dialog.waitFor();
await dialog.getByText('On this device').click();
await page.waitForFunction(() => !document.querySelector('dialog[open]')?.textContent?.includes('Checking your graphics card'));
const model = await dialog.locator('#device-model').inputValue();
check(model === 'Qwen3-4B', `recommended model: ${model}`);
await dialog.getByRole('button', { name: /Save and rewrite/ }).click();

const started = Date.now();
let lastStatus = '';
const timer = setInterval(async () => {
  const s = await sheet.locator('.status').textContent().catch(() => '');
  if (s && s !== lastStatus) console.log(Math.round((Date.now() - started) / 1000), 's', (lastStatus = s));
}, 5000);
await waitDone(page, 40 * 60_000);
clearInterval(timer);
const seconds = Math.round((Date.now() - started) / 1000);
const out = await copyOutput(page);
writeFileSync(join(outDir, 'rewritten.md'), out);
await page.screenshot({ path: join(outDir, 'done.png') });
check(out.trim() !== readFileSync(draftPath, 'utf8').trim(), 'text was rewritten');
check(errors.length === 0, `no page errors ${JSON.stringify(errors)}`);
console.log(JSON.stringify({ seconds, headline: await sheet.locator('.headline').textContent() }));
await context.close();
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
