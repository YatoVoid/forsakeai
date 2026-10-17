// Reload mid-job and resume. Needs `node scripts/mock-llm.mjs 8788 700` running.
// Usage: node tests/e2e/resume.mjs [baseUrl] [chromiumPath]
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:4173/plainhand/';
const executablePath = process.argv[3] ?? process.env.CHROMIUM_PATH;
const browser = await chromium.launch({ executablePath });
const context = await browser.newContext();
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};

const paragraph = (i) =>
  `Section ${i} plays a crucial role in the plan. ${'The team reviewed the numbers and agreed on next steps. '.repeat(22)}`;
const text = Array.from({ length: 8 }, (_, i) => paragraph(i + 1)).join('\n\n');

await page.goto(base);
await page.locator('#draft').fill(text);
await page.getByRole('button', { name: /Clean it up/ }).click();
await page.getByRole('tab', { name: 'With my API key' }).click();
await page.getByLabel('Provider').selectOption('local');
await page.getByLabel('Server URL').fill('http://127.0.0.1:8788/v1');
await page.getByPlaceholder('Model id').fill('mock-editor');
await page.getByRole('button', { name: /^Rewrite \d+ sentences? with/ }).click();

await page.waitForFunction(() => /^\(([2-9])\/\d+\)/.test(document.title), null, { timeout: 30000 });
const before = await page.title();
await page.reload();

const banner = page.getByRole('region', { name: 'Unfinished edit' });
await banner.waitFor({ timeout: 5000 });
check(/You left mid-edit\. Picking up at passage \d+ of \d+/.test(await banner.textContent()), `resume banner after "${before}"`);
await banner.getByRole('button', { name: 'Resume' }).click();
const rewrittenBefore = await page.locator('.manuscript ins').count();
check(rewrittenBefore >= 2, `finished passages kept after reload (${rewrittenBefore})`);

await page.getByRole('tab', { name: 'With my API key' }).click();
check((await page.getByLabel('Server URL').inputValue()) === 'http://127.0.0.1:8788/v1', 'provider settings remembered');
await page.getByRole('button', { name: /^Rewrite \d+ sentences? with/ }).click();
await page.waitForFunction(() => document.querySelector('.status .line')?.textContent?.startsWith('Done.'), null, { timeout: 60000 });
await page.getByRole('button', { name: 'Copy' }).click();
const output = await page.evaluate(() => navigator.clipboard.readText());
const sections = output.split('\n\n');
check(sections.length === 8, 'all eight sections present');
check(sections.every((p) => !p.includes('plays a crucial role')), 'every section rewritten');
check(sections.every((p) => (p.match(/matters for/g) ?? []).length === 1), 'no section rewritten twice');

const second = await context.newPage();
await second.goto(base);
check(!(await second.getByRole('region', { name: 'Unfinished edit' }).isVisible()), 'finished job no longer offered for resume');

check(errors.length === 0, `no page errors ${JSON.stringify(errors)}`);
await browser.close();
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
