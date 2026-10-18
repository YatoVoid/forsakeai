// Pause responds while loading and mid-run, the bar moves, plain text can be
// rewritten whole, and New text starts over. Needs `node scripts/mock-llm.mjs 8788 700`.
// Usage: node tests/e2e/pause.mjs [baseUrl] [chromiumPath]
import { chromium } from 'playwright-core';
import { checker, cleanText, rewriteWithLocalServer, waitDone } from './helpers.mjs';

const base = process.argv[2] ?? 'http://localhost:4173/forsakeai/';
const executablePath = process.argv[3] ?? process.env.CHROMIUM_PATH;
const shots = process.env.SHOTS_DIR ?? '/tmp';
const browser = await chromium.launch({ executablePath });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const { check, failures } = checker();

const plain = [
  'The tank holds the point while the healers stay behind cover.',
  'Our support player watches the flank and calls out divers early.',
  'Damage heroes push the high ground once the shield goes down.',
  'We rotate through the side door when the enemy sniper is looking away.',
  'Ultimate charge matters more than kills in the last minute of a round.',
  'After a lost fight the whole team regroups at the spawn before walking back.',
].join(' ');
await page.goto(base);
await cleanText(page, plain);

const sheet = page.locator('.sheet');
check((await sheet.getByRole('radio', { name: /Every sentence/ }).getAttribute('aria-checked')) === 'true', 'text with no stock phrases defaults to every sentence');
check(await sheet.getByRole('radio', { name: /Stiff sentences/ }).isDisabled(), 'stiff-only option is off when nothing is stiff');

const headline = () => sheet.locator('.headline').textContent();
const pauseWithin = async (ms, label) => {
  const t = Date.now();
  await sheet.getByRole('button', { name: 'Pause' }).click();
  await page.waitForFunction(() => /^Paused/.test(document.querySelector('.sheet .headline')?.textContent ?? ''), null, { timeout: ms }).catch(() => {});
  check(/^Paused/.test(await headline()), `${label} (${Date.now() - t} ms)`);
};

// The first run downloads the meaning check; Pause must work during that wait.
await rewriteWithLocalServer(page, 'http://127.0.0.1:8788/v1', 'mock-editor');
await sheet.locator('.progress').waitFor();
check((await sheet.locator('.progress.busy').count()) === 1, 'bar shows activity before the first sentence finishes');
await pauseWithin(3000, 'pause works while loading');

await sheet.getByRole('button', { name: /Resume|Try again/ }).click();
await page.waitForFunction(() => /sentence [3-6] of 6/.test(document.querySelector('.sheet .status')?.textContent ?? ''), null, { timeout: 120000 });
const value = Number(await sheet.locator('.progress').getAttribute('aria-valuenow'));
check(value >= 30 && value < 100, `bar fills sentence by sentence (${value}%)`);
await page.screenshot({ path: `${shots}/pause-running.png` });
await pauseWithin(4000, 'pause works mid-run');
const status = await sheet.locator('.status').textContent();
check(/Paused\. [1-4] sentences? left/.test(status), `sentences finished before the pause are kept: ${status}`);

await sheet.getByRole('button', { name: /Resume/ }).click();
await waitDone(page, 120000);
check((await page.locator('.manuscript ins').count()) >= 6, 'every sentence rewritten');

page.once('dialog', (d) => d.accept());
await page.getByRole('button', { name: 'New text' }).click();
check((await page.locator('#draft').inputValue()) === '', 'New text clears the box');
check(await page.locator('#draft').evaluate((el) => el === document.activeElement), 'and focuses it');

check(errors.length === 0, `no page errors ${JSON.stringify(errors)}`);
await browser.close();
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
