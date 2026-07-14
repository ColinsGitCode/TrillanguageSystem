const { test, expect } = require('@playwright/test');
const { resetServerState } = require('./fixtures/resetServerState');

const CARD_FIXTURES = [
  { phrase: 'visual baseline handoff', cardType: 'trilingual', title: 'visual baseline handoff' },
  { phrase: '〜なくなった', cardType: 'grammar_ja', title: '〜なくなった' },
  { phrase: '保育园早上送孩子并说明昨晚有点咳嗽', cardType: 'scenario_phrase', title: '保育园交接' }
];

async function installDeterministicPage(page) {
  await page.route(/https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/, (route) => route.abort('blockedbyclient'));
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' });
}

async function settleVisualPage(page) {
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        caret-color: transparent !important;
      }
    `
  });
  await page.waitForTimeout(100);
}

async function enqueueAndWait(request, fixture) {
  const created = await request.post('/api/generation-jobs', {
    data: {
      phrase: fixture.phrase,
      card_type: fixture.cardType,
      source_mode: 'input'
    }
  });
  expect(created.ok()).toBeTruthy();
  const body = await created.json();
  const id = Number(body?.job?.id || 0);
  expect(id).toBeGreaterThan(0);

  await expect.poll(async () => {
    const response = await request.get(`/api/generation-jobs/${id}`);
    const detail = await response.json();
    return detail?.job?.status || '';
  }, { timeout: 30_000, intervals: [100, 200, 500] }).toBe('success');
}

function visualMasks(page) {
  return [
    page.locator('#heroTaskQueueElapsed'),
    page.locator('.queue-event-time'),
    page.locator('time')
  ];
}

async function expectPageScreenshot(page, name) {
  await settleVisualPage(page);
  await expect(page).toHaveScreenshot(name, {
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
    mask: visualMasks(page)
  });
}

test.describe.serial('UI visual regression', () => {
  test.beforeAll(async ({ request }) => {
    await resetServerState(request);
    for (const fixture of CARD_FIXTURES) {
      await enqueueAndWait(request, fixture);
    }
  });

  test.beforeEach(async ({ page }) => {
    await installDeterministicPage(page);
  });

  test('Cards Factory desktop', async ({ page }) => {
    test.setTimeout(120_000);
    const viewports = [
      { width: 1440, height: 1000, name: 'desktop' },
    ];
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('react-file-list').locator('button')).toHaveCount(3);
      await expectPageScreenshot(page, `react-factory-${viewport.name}.png`);
    }
  });

  test('Cards Factory dark theme on desktop', async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => localStorage.setItem('three-lans-theme-v1', 'dark'));
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    const viewports = [
      { width: 1440, height: 1000, name: 'desktop' },
    ];
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await expect(page.getByTestId('react-file-list').locator('button')).toHaveCount(3);
      await expectPageScreenshot(page, `react-factory-${viewport.name}-dark.png`);
    }
  });

  test('card modal covers all card types on desktop', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('react-file-list').locator('button')).toHaveCount(3);
    for (const fixture of CARD_FIXTURES) {
      const card = page.getByTestId('react-file-list').locator('button').filter({ hasText: fixture.title }).first();
      await card.click();
      await expect(page.getByTestId('react-card-modal')).toBeVisible();
      await expectPageScreenshot(page, `react-card-${fixture.cardType}-desktop.png`);
      await page.getByTestId('react-card-modal-close').click();
    }
  });

  test('card modal dark theme covers all card types on desktop', async ({ page }) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => localStorage.setItem('three-lans-theme-v1', 'dark'));
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByTestId('react-file-list').locator('button')).toHaveCount(3);
    for (const fixture of CARD_FIXTURES) {
      const card = page.getByTestId('react-file-list').locator('button').filter({ hasText: fixture.title }).first();
      await card.click();
      await expect(page.getByTestId('react-card-modal')).toBeVisible();
      await expectPageScreenshot(page, `react-card-${fixture.cardType}-desktop-dark.png`);
      await page.getByTestId('react-card-modal-close').click();
    }
  });
});
