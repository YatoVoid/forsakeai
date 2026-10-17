// Language pages, privacy page, voice sample, spelling and the audit pass.
// Needs `node scripts/mock-llm.mjs 8787` running.
// Usage: node tests/e2e/phase2.mjs [baseUrl] [chromiumPath]
import { chromium } from 'playwright-core';

const base = process.argv[2] ?? 'http://localhost:4173/plainhand/';
const executablePath = process.argv[3] ?? process.env.CHROMIUM_PATH;
const browser = await chromium.launch({ executablePath });
const failures = [];
const check = (ok, label) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
  if (!ok) failures.push(label);
};

async function open(path) {
  const context = await browser.newContext();
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto(new URL(path, base).href);
  return { page, errors, context };
}

{
  const { page, errors, context } = await open('de/');
  check((await page.locator('html').getAttribute('lang')) === 'de', 'German page sets html lang');
  check((await page.getByRole('heading', { level: 1 }).textContent()) === 'KI-Texte, die nach dir klingen', 'German intro heading');
  check((await page.locator('#draft').getAttribute('placeholder')) === 'Füge deinen Entwurf ein.', 'German placeholder');
  check((await page.locator('link[rel="canonical"]').getAttribute('href')).endsWith('/plainhand/de/'), 'German canonical');
  await page.getByRole('button', { name: 'try a sample' }).click();
  check((await page.locator('#draft').inputValue()).includes('spielt ein gutes Onboarding'), 'German sample loads');
  await page.getByRole('button', { name: /Clean it up/ }).click();
  await page.waitForSelector('.manuscript');
  check((await page.locator('.chip').textContent()).startsWith('German'), 'German detected');
  check((await page.locator('.manuscript del', { hasText: 'Es ist wichtig zu beachten' }).count()) === 1, 'German rule fix applied');
  check((await page.locator('.spelling').count()) === 0, 'no spelling setting for German');
  check(errors.length === 0, `German page: no errors ${JSON.stringify(errors)}`);
  await context.close();
}

{
  const { page, errors, context } = await open('privacy.html');
  check((await page.getByRole('heading', { level: 1 }).textContent()) === 'Privacy', 'privacy page renders');
  const font = await page.evaluate(() => getComputedStyle(document.querySelector('.doc')).fontFamily);
  check(font.includes('Newsreader'), 'privacy page styled');
  check(errors.length === 0, `privacy page: no errors ${JSON.stringify(errors)}`);
  await context.close();
}

{
  const { page, errors, context } = await open('');
  await page.locator('#draft').fill('We organized the color program. This is a pivotal moment for the team.');
  await page.getByRole('button', { name: /Clean it up/ }).click();
  await page.waitForSelector('.manuscript');
  await page.getByLabel('Spelling').selectOption('uk');
  check((await page.locator('.manuscript ins', { hasText: 'organised' }).count()) === 1, 'UK spelling applied');
  check((await page.locator('.status .line').textContent()).startsWith('Spelling switched to UK'), 'spelling status line');

  await page.getByLabel('Voice').selectOption('sample');
  const rewrite = page.getByRole('button', { name: /^Rewrite \d+ sentences? on|^Rewrite \d+ sentences? with/ });
  await page.getByRole('tab', { name: 'With my API key' }).click();
  await page.getByLabel('Provider').selectOption('local');
  await page.getByLabel('Server URL').fill('http://127.0.0.1:8787/v1');
  await page.getByPlaceholder('Model id').fill('mock-editor');
  check(await rewrite.isDisabled(), 'rewrite waits for a long enough sample');
  const sample = Array.from({ length: 30 }, (_, i) => `I don't buy it. We'll try plan ${i} and see what sticks.`).join(' ');
  await page.getByLabel(/Paste 300 to 1,000 words/).fill(sample);
  check((await page.locator('.sample small').textContent()).includes('uses contractions freely'), 'voice brief shown');
  check(await rewrite.isEnabled(), 'rewrite enabled with sample');
  await rewrite.click();
  await page.waitForFunction(() => document.querySelector('.status .line')?.textContent?.startsWith('Done.'), null, { timeout: 30000 });
  await page.getByRole('button', { name: 'Copy' }).click();
  const out = await page.evaluate(() => navigator.clipboard.readText());
  check(out.includes('organised the colour'), 'UK spelling survives the rewrite');
  check(!out.includes('pivotal'), 'stiff sentence rewritten');
  check(errors.length === 0, `voice and spelling: no errors ${JSON.stringify(errors)}`);
  await context.close();
}

await browser.close();
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
