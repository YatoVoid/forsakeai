// Browser smoke test against `vite preview` and scripts/mock-llm.mjs.
// Usage: node tests/e2e/flow.mjs [baseUrl] [chromiumPath]
import { chromium } from 'playwright-core';
import { checker, cleanSample, copyOutput, rewriteWithLocalServer, trackCsp, waitDone } from './helpers.mjs';

const base = process.argv[2] ?? 'http://localhost:4173/forsakeai/';
const executablePath = process.argv[3] ?? process.env.CHROMIUM_PATH;
const shots = process.env.SHOTS_DIR ?? '/tmp';
const browser = await chromium.launch({ executablePath });
const { check, failures } = checker();

async function run(viewport, scheme) {
  const context = await browser.newContext({ viewport, colorScheme: scheme });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await trackCsp(page);
  return { context, page, errors };
}

{
  const { context, page, errors } = await run({ width: 1280, height: 900 }, 'light');
  await page.goto(base);
  check((await page.title()) === 'ForsakeAI: Free Local AI Humanizer', 'title');
  check((await page.locator('meta[http-equiv="Content-Security-Policy"]').count()) === 1, 'CSP meta present');
  await page.locator('.strunk img').scrollIntoViewIfNeeded();
check(
  await page.locator('.strunk img').evaluate((img) => (img.complete ? img.naturalWidth > 0 : new Promise((done) => (img.onload = () => done(img.naturalWidth > 0))))),
  'Strunk scan loads',
);

  await cleanSample(page);
  const counts = await page.locator('.sheet .counts').textContent();
  check(/\d+ sentences? changed · \d+ left to rewrite · \d+ entr(y|ies) on the sheet/.test(counts.replace(/\s+/g, ' ')), `sheet counts: ${counts.replace(/\s+/g, ' ').trim()}`);
  check((await page.locator('.manuscript del.removed').count()) > 0, 'deletions shown');
  check((await page.locator('.manuscript .stiff').count()) > 0, 'stiff phrases marked');
  check((await page.locator('.manuscript del', { hasText: 'I hope this helps' }).count()) === 1, 'closer struck out');
  check((await page.locator('.sheet .group h3').first().textContent()).startsWith('To rewrite'), 'sheet lists work to do first');

  await page.locator('.sheet .entry').first().click();
  check((await page.locator('.sheet .card').count()) === 1, 'sheet entry opens the sentence card');

  await page.getByRole('radio', { name: 'Clean copy' }).click();
  check((await page.locator('.manuscript del').count()) === 0, 'clean copy hides marks');
  await page.getByRole('radio', { name: 'Changes' }).click();

  const sheet = page.locator('.sheet');
  check((await sheet.getByRole('radio', { name: /Every sentence/ }).getAttribute('aria-checked')) === 'true', 'every sentence is the default');
  await sheet.getByRole('radio', { name: /Stiff only/ }).click();
  check(/^Rewrite 7 sentences/.test(await sheet.getByRole('button', { name: /^Rewrite \d+/ }).textContent()), 'stiff only offers just the flagged sentences');
  await sheet.getByRole('radio', { name: /Every sentence/ }).click();
  await rewriteWithLocalServer(page, 'http://127.0.0.1:8787/v1', 'mock-editor');
  await waitDone(page);
  check(await page.locator('.sheet .support').isVisible(), 'asks for support after the first finished rewrite');
  const headline = await page.locator('.sheet .headline').textContent();
  check(/\d+ sentences changed\. Read it through\./.test(headline), `done headline: ${headline}`);

  const output = await copyOutput(page);
  check((output.match(/^- /gm) ?? []).length === 3, 'list items kept');
  for (const kept of ['14 days', '$4', '1926', 'https://quietcourier.com', '## ']) check(output.includes(kept), `output keeps "${kept}"`);
  check(!/In today's fast-paced/.test(output), 'stock opener rewritten');
  check(!output.includes('—'), 'no em dashes in output');
  await page.screenshot({ path: `${shots}/ph-done.png`, fullPage: true });

  const first = page.locator('.manuscript .mark').first();
  await first.click();
  if ((await first.getAttribute('aria-pressed')) !== 'true') await first.click();
  await page.keyboard.press('r');
  check((await first.locator('.undone').count()) === 1, 'R undoes the selected change');
  await page.keyboard.press('a');
  check((await first.locator('del, ins, .undone').count()) === 0, 'A keeps the selected change');

  await page.locator('.sheet summary', { hasText: 'Download' }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: /Word document/ }).click();
  check((await download).suggestedFilename() === 'forsakeai.docx', 'docx download');

  await page.locator('.sheet').getByRole('button', { name: 'Start over' }).click();
  check((await page.locator('#draft').count()) === 1, 'start over returns to an empty editor');
  await cleanSample(page);
  await page.locator('.sheet').getByRole('button', { name: /^Rewrite \d+/ }).click();
  await waitDone(page);
  check((await page.locator('.sheet .support').count()) === 0, 'never asks for support twice');
  await page.locator('.sheet').getByRole('button', { name: 'Start over' }).click();

  check((await page.evaluate(() => window.__csp)).length === 0, `no CSP violations ${JSON.stringify(await page.evaluate(() => window.__csp))}`);
  check(errors.length === 0, `no console errors ${JSON.stringify(errors)}`);
  await context.close();
}

{
  const { context, page, errors } = await run({ width: 390, height: 844 }, 'dark');
  await page.goto(base);
  await cleanSample(page);
  check(!(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'no horizontal scroll at 390px');
  const btn = await page.getByRole('button', { name: /^Rewrite \d+ sentences?/ }).boundingBox();
  check(btn && btn.height >= 44, 'primary button is a 44px touch target');
  await page.getByRole('button', { name: 'Sheet', exact: true }).click();
  check(await page.locator('.sheet .entries').first().isVisible(), 'sheet expands on mobile');
  await page.screenshot({ path: `${shots}/ph-mobile-dark.png` });
  check(errors.length === 0, `mobile: no console errors ${JSON.stringify(errors)}`);
  await context.close();
}

await browser.close();
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
