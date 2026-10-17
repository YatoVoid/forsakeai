// 20,000-word document through the full pipeline. Needs `node scripts/mock-llm.mjs 8787` running.
// Usage: node tests/e2e/long.mjs [baseUrl] [chromiumPath]
import { chromium } from 'playwright-core';
import { cleanText, rewriteWithLocalServer, waitDone } from './helpers.mjs';

const base = process.argv[2] ?? 'http://localhost:4173/plainhand/';
const executablePath = process.argv[3] ?? process.env.CHROMIUM_PATH;
const browser = await chromium.launch({ executablePath });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));

const para = (i) =>
  `Part ${i} plays a crucial role in the plan. Moreover, it leverages data from 2024 to foster growth. ` +
  'The team met on Tuesday and went through the open questions one by one. '.repeat(6);
const text = Array.from({ length: 220 }, (_, i) => para(i + 1)).join('\n\n');
const words = text.split(/\s+/).length;

await page.goto(base);
let t = Date.now();
await cleanText(page, text);
const cleanMs = Date.now() - t;

t = Date.now();
await rewriteWithLocalServer(page, 'http://127.0.0.1:8787/v1', 'mock-editor');
await waitDone(page, 300000);
const runMs = Date.now() - t;
const status = await page.locator('.sheet .headline').textContent();

console.log(`${words} words · clean ${cleanMs} ms · rewrite ${runMs} ms · ${status}`);
console.log(errors.length ? `errors: ${errors.join('\n')}` : 'no page errors');
await browser.close();
process.exit(errors.length || cleanMs > 3000 ? 1 : 0);
