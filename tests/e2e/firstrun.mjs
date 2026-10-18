// First-run paths: rich-text paste, the review tip, going back to edit, clicking
// near a sentence, and typing your own version of one.
// Usage: node tests/e2e/firstrun.mjs [baseUrl] [chromiumPath]
import { chromium } from 'playwright-core';
import { checker, copyOutput } from './helpers.mjs';

const base = process.argv[2] ?? 'http://localhost:4173/forsakeai/';
const executablePath = process.argv[3] ?? process.env.CHROMIUM_PATH;
const shots = process.env.SHOTS_DIR ?? '/tmp';
const browser = await chromium.launch({ executablePath });
const { check, failures } = checker();

const GEMINI_HTML =
  '<h3>The Universal Contender: D.Va</h3><p>While no single hero in Overwatch is completely immune to counter-picks, D.Va stands out as the most adaptable tank. Furthermore, her Defense Matrix remains one of the most powerful utility abilities in the game.</p>' +
  '<h3>Why Other Tanks Fall Short</h3><p>Specialized tanks can outperform D.Va in specific scenarios—such as Sigma on poke maps—but they carry severe vulnerabilities. Anchor tanks like Sigma or Orisa lack mobility.</p>';
const GLUED_TEXT = 'The Universal Contender: D.VaWhile no single hero in Overwatch is completely immune to counter-picks.';

const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(base).origin });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(base);

check(await page.getByRole('list', { name: 'How it works' }).isVisible(), 'how-it-works steps on the first screen');

await page.locator('#draft').focus();
await page.evaluate(
  ({ html, text }) => {
    const dt = new DataTransfer();
    dt.setData('text/html', html);
    dt.setData('text/plain', text);
    document.querySelector('#draft').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  },
  { html: GEMINI_HTML, text: GLUED_TEXT },
);
const pasted = await page.locator('#draft').inputValue();
check(pasted.startsWith('### The Universal Contender: D.Va\n\nWhile'), 'rich paste keeps the heading on its own line');

await page.getByRole('button', { name: /Clean it up/ }).click();
await page.waitForSelector('.manuscript');
check((await page.locator('.manuscript h4, .manuscript h3').count()) === 2, 'headings render as headings');
check(await page.getByRole('note').isVisible(), 'review tip shows the first time');
await page.screenshot({ path: `${shots}/fr-review.png` });

const para = page.locator('.manuscript p').first();
const box = await para.boundingBox();
await page.mouse.click(box.x + box.width - 4, box.y + box.height - 6);
check((await page.locator('.sheet .card').count()) === 1, 'a click at the edge of a paragraph still selects a sentence');

await page.locator('.manuscript [data-id]', { hasText: 'Anchor tanks' }).click();
await page.locator('.sheet .card').getByRole('button', { name: 'Edit' }).click();
await page.locator('#sentence-edit').fill('Sigma and Orisa are slow, so high ground beats them.');
await page.keyboard.press('Enter');
check((await page.locator('.sheet .card h3').textContent()).includes('Your wording'), 'the card confirms an edited sentence');
await page.screenshot({ path: `${shots}/fr-edited.png` });

const out = await copyOutput(page);
check(out.includes('Sigma and Orisa are slow, so high ground beats them.'), 'the edit is in the copied text');
check(out.includes('(such as Sigma on poke maps)'), 'paired dashes became parentheses');

await page.getByRole('button', { name: 'Got it, hide this tip' }).click();
check((await page.getByRole('note').count()) === 0, 'the tip can be dismissed');

await page.getByRole('button', { name: 'Edit text' }).click();
const back = await page.locator('#draft').inputValue();
check(back.includes('Sigma and Orisa are slow') && back.includes('### Why Other Tanks Fall Short'), 'Edit text returns the current text to the box');

await page.getByRole('button', { name: /Clean it up/ }).click();
await page.waitForSelector('.manuscript');
check((await page.getByRole('note').count()) === 0, 'the tip stays dismissed');

await page.getByRole('button', { name: /^Rewrite \d+ sentences?/ }).click();
const dialog = page.locator('dialog[open]');
await dialog.waitFor();
check(await dialog.getByRole('radio', { name: /With my API key/ }).isChecked(), 'new users start on the API-key path');
check((await dialog.getByLabel('Provider', { exact: true }).inputValue()) === 'gemini', 'with Gemini as the provider');
check((await dialog.locator('#model-input').inputValue()) === 'gemini-3.8-flash', 'and its free Flash model');
check(await dialog.getByText('Create API key').isVisible(), 'key setup steps are shown');
check(await dialog.getByText(/human reviewers may read it/).isVisible(), 'free-tier data use is disclosed');
await page.screenshot({ path: `${shots}/fr-settings.png` });
await dialog.getByRole('button', { name: 'Cancel' }).click();

check(errors.length === 0, `no page errors ${JSON.stringify(errors)}`);
await browser.close();
console.log(failures.length ? `\n${failures.length} failed` : '\nall passed');
process.exit(failures.length ? 1 : 0);
