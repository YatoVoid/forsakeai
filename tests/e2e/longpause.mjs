// Pause an on-device rewrite, leave it idle, then resume. Needs a real GPU (headed Chromium).
// Usage: CHROMIUM_GPU=/path/to/chrome node tests/e2e/longpause.mjs [idleMinutes] [baseUrl]
import { homedir } from 'node:os';
import { chromium } from 'playwright-core';
import { checker, cleanSample, waitDone } from './helpers.mjs';

const minutes = Number(process.argv[2] ?? 5);
const base = process.argv[3] ?? 'http://localhost:4173/forsakeai/';
const { check, failures } = checker();
const context = await chromium.launchPersistentContext(`${homedir()}/.cache/forsakeai-eval/chrome-app-profile`, {
  executablePath: process.env.CHROMIUM_GPU,
  headless: false,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,WebGPUService', '--ignore-gpu-blocklist', '--ozone-platform=x11'],
});
const page = context.pages()[0] ?? (await context.newPage());
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() !== 'debug') console.log('[console]', m.type(), m.text().slice(0, 200)); });
await page.goto(base);
await page.evaluate(() => localStorage.setItem('forsakeai.prefs', JSON.stringify({ mode: 'device', provider: 'gemini', models: {}, remember: false })));
await page.reload();
await cleanSample(page);
const sheet = page.locator('.sheet');
await sheet.getByRole('button', { name: /^Rewrite \d+/ }).click();
await page.waitForFunction(() => /sentence [2-9]\d* of/.test(document.querySelector('.sheet .status')?.textContent ?? ''), null, { timeout: 600000 });
await sheet.getByRole('button', { name: 'Pause' }).click();
await page.waitForFunction(() => /^Paused/.test(document.querySelector('.sheet .headline')?.textContent ?? ''), null, { timeout: 60000 });
console.log('paused:', await sheet.locator('.status').textContent());
await page.waitForTimeout(minutes * 60_000);
await sheet.getByRole('button', { name: /Resume|Try again/ }).click();
await waitDone(page, Number(process.env.RESUME_TIMEOUT_MIN ?? 15) * 60_000).catch(() => {});
const headline = await sheet.locator('.headline').textContent();
const status = await sheet.locator('.status').textContent();
console.log('after resume:', headline, '|', status);
check(/Read it through/.test(headline), 'resumes and finishes after the idle pause');
check(errors.length === 0, `no page errors ${JSON.stringify(errors)}`);
await context.close();
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
