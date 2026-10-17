// Shared steps for the browser tests.

export function checker() {
  const failures = [];
  const check = (ok, label) => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}`);
    if (!ok) failures.push(label);
  };
  return { check, failures };
}

export async function cleanSample(page) {
  await page.getByRole('button', { name: /try a sample/i }).click();
  await page.getByRole('button', { name: /Clean it up/ }).click();
  await page.waitForSelector('.manuscript');
}

export async function cleanText(page, text) {
  await page.locator('#draft').fill(text);
  await page.getByRole('button', { name: /Clean it up/ }).click();
  await page.waitForSelector('.manuscript');
}

/** Opens the rewrite settings through the primary button and points the API path at a local server. */
export async function rewriteWithLocalServer(page, url, model) {
  await page.getByRole('button', { name: /^Rewrite \d+ sentences?/ }).click();
  await page.waitForSelector('dialog[open]');
  await page.waitForTimeout(300);
  await page.getByText('With my API key').click();
  await page.getByLabel('Provider', { exact: true }).selectOption('local');
  await page.getByLabel('Server URL').fill(url);
  await page.getByPlaceholder('Model id').fill(model);
  await page.getByRole('button', { name: 'Save and rewrite' }).click();
}

export async function waitDone(page, timeout = 60000) {
  await page.waitForFunction(() => /Read it through|Nothing needed/.test(document.querySelector('.sheet .headline')?.textContent ?? ''), null, { timeout });
}

export async function copyOutput(page) {
  await page.locator('.sheet').getByRole('button', { name: /^Copy/ }).first().click();
  return page.evaluate(() => navigator.clipboard.readText());
}

export async function trackCsp(page) {
  await page.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`));
  });
}
