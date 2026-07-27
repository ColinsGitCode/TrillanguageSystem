import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const { chromium } = require(path.join(ROOT, 'node_modules/@playwright/test'));
const POC_ROOT = path.dirname(fileURLToPath(import.meta.url));

async function verifyDropdown(page, entry, { expectFocusReturn }) {
  await page.goto(`${entry}?verify=1`);
  const trigger = page.locator('button.csa-generate');
  await trigger.click();
  const menu = page.getByRole('menu');
  await menu.waitFor({ state: 'visible' });
  assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'hidden' });

  await trigger.focus();
  await page.keyboard.press('Enter');
  await menu.waitFor({ state: 'visible' });
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator(':focus').getAttribute('role'), 'menuitem');
  await page.keyboard.press('Escape');
  if (expectFocusReturn) {
    await page.locator('button.csa-generate:focus').waitFor({ state: 'visible' });
    const focus = await page.evaluate(() => ({
      tag: document.activeElement?.tagName,
      className: document.activeElement?.className,
      text: document.activeElement?.textContent,
    }));
    assert.equal(focus.className?.includes('csa-generate'), true, JSON.stringify(focus));
  }
}

async function verifyContextMenu(page, entry) {
  await page.goto(`${entry}?verify=context`);
  const readingSurface = page.locator('.poc-reading-surface');
  await readingSurface.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: '选区上下文菜单' });
  await menu.waitFor({ state: 'visible' });
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator(':focus').getAttribute('role'), 'menuitem');
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'hidden' });
}

async function styleSnapshot(page, entry) {
  await page.goto(entry);
  const trigger = page.locator('button.csa-generate');
  await trigger.click();
  const menu = page.getByRole('menu');
  await menu.waitFor({ state: 'visible' });
  return page.evaluate(() => {
    const menu = document.querySelector('[role="menu"]');
    const item = menu?.querySelector('button');
    const rect = menu?.getBoundingClientRect();
    return {
      menu: menu ? {
        backgroundColor: getComputedStyle(menu).backgroundColor,
        borderTopWidth: getComputedStyle(menu).borderTopWidth,
        borderRadius: getComputedStyle(menu).borderRadius,
        boxShadow: getComputedStyle(menu).boxShadow,
        display: getComputedStyle(menu).display,
        minWidth: getComputedStyle(menu).minWidth,
        width: Math.round(rect.width),
      } : null,
      item: item ? {
        color: getComputedStyle(item).color,
        padding: getComputedStyle(item).padding,
        fontSize: getComputedStyle(item).fontSize,
      } : null,
    };
  });
}

const server = await createServer({ root: POC_ROOT, logLevel: 'error' });
await server.listen();
const baseUrl = server.resolvedUrls.local[0].replace(/\/$/, '');
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(5_000);
  await verifyDropdown(page, `${baseUrl}/index-radix.html`, { expectFocusReturn: true });
  await verifyDropdown(page, `${baseUrl}/index-aria.html`, { expectFocusReturn: false });
  await verifyContextMenu(page, `${baseUrl}/index-radix.html`);

  const baseline = await styleSnapshot(page, `${baseUrl}/index-baseline.html`);
  const radix = await styleSnapshot(page, `${baseUrl}/index-radix.html`);
  assert.deepEqual(radix, baseline, 'Radix fixed menu must retain the baseline menu style contract');

  console.log(JSON.stringify({
    dropdown: ['radix', 'react-aria'],
    contextMenu: 'radix',
    trustedInteraction: 'click + keyboard + Escape + focus return',
    visualContract: 'computed style and layout equality with hand-written baseline',
  }, null, 2));
} finally {
  await browser.close();
  await server.close();
}
