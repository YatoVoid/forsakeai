// Browser smoke test against `vite preview` and scripts/mock-llm.mjs.
// Usage: node tests/e2e/flow.mjs [baseUrl] [chromiumPath]
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:4173/plainhand/';
const executablePath = process.argv[3] ?? process.env.CHROMIUM_PATH;
const shots = process.env.SHOTS_DIR ?? '/tmp';

const browser = await chromium.launch({ executablePath });
const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};

async function run(viewport, scheme) {
  const context = await browser.newContext({ viewport, colorScheme: scheme });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
  return { context, page, errors };
}

{
  const { context, page, errors } = await run({ width: 1280, height: 900 }, 'light');
  await page.goto(base);
  check((await page.title()) === 'Plainhand', 'title');
  check((await page.locator('meta[http-equiv="Content-Security-Policy"]').count()) === 1, 'CSP meta present');

  await page.getByRole('button', { name: 'try a sample' }).click();
  await page.screenshot({ path: `${shots}/ph-empty.png` });
  await page.keyboard.press('Control+Enter');
  await page.waitForSelector('.manuscript');
  const status = await page.locator('.status .line').textContent();
  check(/fixes made, \d+ stiff sentences left/.test(status ?? ''), `rule pass status: ${status}`);
  check((await page.locator('.manuscript del').count()) > 0, 'deletions shown');
  check((await page.locator('.manuscript .flag').count()) > 0, 'flags shown');
  check((await page.locator('.manuscript del', { hasText: 'I hope this helps' }).count()) === 1, 'closer struck out');
  await page.screenshot({ path: `${shots}/ph-review.png`, fullPage: true });

  await page.locator('.manuscript .mark').first().click();
  check(await page.locator('.note').isVisible(), 'margin note opens');
  await page.screenshot({ path: `${shots}/ph-note.png` });

  await page.getByRole('tab', { name: 'With my API key' }).click();
  await page.getByLabel('Provider').selectOption('local');
  await page.getByLabel('Server URL').fill('http://127.0.0.1:8787/v1');
  await page.getByRole('button', { name: 'List models' }).click();
  await page.waitForFunction(() => document.querySelectorAll('#model-list option').length > 0, null, { timeout: 5000 });
  check((await page.getByPlaceholder('Model id').inputValue()) === 'mock-editor', 'model list loaded');

  await page.getByRole('button', { name: /^Rewrite \d+ sentences? with/ }).click();
  await page.waitForFunction(() => document.querySelector('.status .line')?.textContent?.startsWith('Done.'), null, { timeout: 30000 });
  const done = await page.locator('.status .line').textContent();
  check(/Done\. \d+ changes in \d+ paragraphs/.test(done ?? ''), `done status: ${done}`);

  await page.getByRole('button', { name: 'Copy' }).click();
  const output = await page.evaluate(() => navigator.clipboard.readText());
  for (const kept of ['64%', '1,200', '2025', '3 steps instead of 7', '## ']) check(output.includes(kept), `output keeps "${kept}"`);
  check(!/In today's fast-paced/.test(output), 'stock opener rewritten');
  check(!output.includes('—'), 'no em dashes in output');
  await page.screenshot({ path: `${shots}/ph-done.png`, fullPage: true });

  const first = page.locator('.manuscript .mark').first();
  await first.click();
  if ((await first.getAttribute('aria-pressed')) !== 'true') await first.click();
  await page.keyboard.press('r');
  check((await first.locator('.rejected').count()) === 1, 'R rejects the selected change');
  await page.keyboard.press('a');
  check((await first.locator('del, ins, .rejected').count()) === 0, 'A accepts the selected change');

  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download .docx' }).click();
  const file = await download;
  check(file.suggestedFilename() === 'plainhand.docx', 'docx download');

  check((await page.evaluate(() => window.__csp)).length === 0, `no CSP violations ${JSON.stringify(await page.evaluate(() => window.__csp))}`);
  check(errors.length === 0, `no console errors ${JSON.stringify(errors)}`);
  await context.close();
}

{
  const { context, page, errors } = await run({ width: 390, height: 844 }, 'dark');
  await page.goto(base);
  await page.getByRole('button', { name: 'try a sample' }).click();
  await page.getByRole('button', { name: /Clean it up/ }).click();
  await page.waitForSelector('.manuscript');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(!overflow, 'no horizontal scroll at 390px');
  await page.locator('.manuscript .mark').nth(1).click();
  await page.screenshot({ path: `${shots}/ph-mobile-dark.png` });
  check(errors.length === 0, `mobile: no console errors ${JSON.stringify(errors)}`);
  await context.close();
}

await browser.close();
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
