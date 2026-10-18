// The AI-likelihood checker end to end (WASM build, ~1 GB download on first run).
// Usage: node tests/e2e/checker.mjs [baseUrl] [chromiumPath]
import { chromium } from 'playwright-core';
import { cleanSample } from './helpers.mjs';

const base = process.argv[2] ?? 'http://localhost:4173/forsakeai/';
const executablePath = process.argv[3] ?? process.env.CHROMIUM_PATH;
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.addInitScript(() => {
  window.__csp = [];
  document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
});
const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};

await page.goto(base);
check((await page.getByRole('button', { name: 'Check it' }).count()) === 0, 'checker hidden without ?checker');

await page.goto(`${base}?checker`);
await cleanSample(page);
await page.getByRole('button', { name: 'Check it' }).click();
const confirm = page.getByRole('button', { name: 'Download and check' });
await confirm.waitFor();
check((await page.locator('.checker').textContent()).includes('MB, downloaded once'), 'asks before downloading');
const started = Date.now();
await confirm.click();
await page.locator('.checker .verdict').waitFor({ timeout: 900_000 });
const verdict = await page.locator('.checker .verdict').textContent();
console.log(`     ${verdict.replace(/\s+/g, ' ').trim()} (${Math.round((Date.now() - started) / 1000)} s)`);
check(/Likely AI-generated|Unclear|Likely human-written/.test(verdict), 'shows a verdict');
check(/\d+–\d+% AI-likelihood/.test(verdict), 'shows a range');
check((await page.locator('.checker .caveat').textContent()).includes('never as proof'), 'shows the caveat');

const rewriteOne = page.getByRole('button', { name: 'Rewrite this one' }).first();
if (await rewriteOne.count()) {
  await rewriteOne.click();
  check((await page.locator('.sheet .card').textContent()).includes('reads machine-like to the checker'), 'rewrite-this-one marks the sentence');
}

check((await page.evaluate(() => window.__csp)).length === 0, `no CSP violations ${JSON.stringify(await page.evaluate(() => window.__csp))}`);
check(errors.length === 0, `no console errors ${JSON.stringify(errors.slice(0, 3))}`);
await browser.close();
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
