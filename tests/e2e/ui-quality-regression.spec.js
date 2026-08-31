const { test, expect } = require('@playwright/test');
const { resetServerState } = require('./fixtures/resetServerState');

async function assertNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate((currentLabel) => {
    const doc = document.documentElement;
    const offenders = [...document.body.querySelectorAll('*')]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          testId: element.getAttribute('data-testid') || '',
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      })
      .filter((entry) => entry.width > 0 && (entry.left < -2 || entry.right > window.innerWidth + 2))
      .slice(0, 8);
    return { label: currentLabel, clientWidth: doc.clientWidth, scrollWidth: doc.scrollWidth, offenders };
  }, label);
  expect(overflow.scrollWidth, `${label}: ${JSON.stringify(overflow.offenders)}`)
    .toBeLessThanOrEqual(overflow.clientWidth + 2);
}

async function enqueueAndWait(request, phrase, cardType = 'trilingual') {
  const created = await request.post('/api/generation-jobs', {
    data: { phrase, card_type: cardType, source_mode: 'input' },
  });
  expect(created.ok()).toBeTruthy();
  const id = (await created.json()).job.id;
  await expect.poll(async () => {
    const response = await request.get(`/api/generation-jobs/${id}`);
    return (await response.json()).job.status;
  }, { timeout: 30_000, intervals: [100, 200, 500] }).toBe('success');
}

test.describe.serial('React UI quality regression', () => {
  test.beforeAll(async ({ request }) => {
    await resetServerState(request);
    await enqueueAndWait(request, 'P5 responsive modal fixture');
  });

  test('Cards Factory has no horizontal overflow at supported desktop viewports', async ({ page }) => {
    for (const viewport of [
      { width: 1440, height: 1000, name: 'desktop' },
      { width: 1280, height: 720, name: 'compact-desktop' },
    ]) {
      await page.setViewportSize(viewport);
      await page.goto('/');
      for (const id of ['factory-composer-trigger', 'react-queue-status', 'react-folder-list', 'react-file-list']) {
        await expect(page.getByTestId(id), `${viewport.name}: ${id}`).toBeVisible();
      }
      await assertNoHorizontalOverflow(page, viewport.name);
      // The composer drawer must not push the page sideways either.
      await page.getByTestId('factory-composer-trigger').click();
      for (const id of ['react-phrase-input']) {
        await expect(page.getByTestId(id), `${viewport.name}: ${id}`).toBeVisible();
      }
      await assertNoHorizontalOverflow(page, `${viewport.name} (composer open)`);
      await page.keyboard.press('Escape');
    }
  });

  test('root loads only same-origin hashed assets and no legacy bundles', async ({ page }) => {
    const diagnostics = [];
    page.on('console', (message) => {
      if (['error', 'warning'].includes(message.type())) diagnostics.push(`${message.type()}: ${message.text()}`);
    });
    page.on('requestfailed', (request) => diagnostics.push(`${request.method()} ${request.url()}`));
    await page.goto('/');
    await expect(page.getByTestId('factory-composer-trigger')).toBeVisible();

    const assets = await page.evaluate(() => ({
      origin: location.origin,
      resources: performance.getEntriesByType('resource').map((entry) => entry.name),
      styles: [...document.querySelectorAll('link[rel="stylesheet"]')].map((node) => node.href),
    }));
    expect(assets.resources.every((url) => new URL(url).origin === assets.origin)).toBeTruthy();
    expect(assets.resources.some((url) => /\/assets\/.*\.js$/.test(url))).toBeTruthy();
    expect(assets.styles.some((url) => /\/assets\/.*\.css$/.test(url))).toBeTruthy();
    expect(assets.resources.some((url) => /(?:styles\.css|modern-card\.css|\/js\/modules\/|\/vendor\/)/.test(url))).toBeFalsy();
    expect(diagnostics).toEqual([]);
  });

  test('queue and full-height card modal stay inside the compact desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await page.getByTestId('react-queue-status').click();
    const queue = page.getByRole('dialog', { name: '队列管理' });
    await expect(queue).toBeVisible();
    let box = await queue.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1280);
    expect(box.y + box.height).toBeLessThanOrEqual(900);
    await page.keyboard.press('Escape');

    const opener = page.getByTestId('react-file-list').locator('button').filter({ hasText: 'P5 responsive modal fixture' });
    await opener.click();
    for (const viewport of [{ width: 1280, height: 900 }]) {
      await page.setViewportSize(viewport);
      box = await page.locator('.react-card-modal').boundingBox();
      expect(box.height).toBeGreaterThan(viewport.height - 30);
      expect(box.width).toBeLessThanOrEqual(viewport.width);
      await assertNoHorizontalOverflow(page, `modal ${viewport.width}`);
    }
  });
});
