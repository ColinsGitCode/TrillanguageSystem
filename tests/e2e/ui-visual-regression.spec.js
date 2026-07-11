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
    page.locator('.mission-queue-updated'),
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
    const seeded = await request.post('/api/_test/seed-knowledge');
    expect(seeded.ok()).toBeTruthy();
    for (const fixture of CARD_FIXTURES) {
      await enqueueAndWait(request, fixture);
    }
  });

  test.beforeEach(async ({ page }) => {
    await installDeterministicPage(page);
  });

  test('four primary pages across desktop, tablet and mobile', async ({ page }) => {
    test.setTimeout(120_000);
    const targets = [
      { path: '/', name: 'workspace', ready: 'phrase-input' },
      { path: '/dashboard.html', name: 'mission-control', ready: 'mission-control-page' },
      { path: '/knowledge-ops.html', name: 'knowledge-ops', ready: 'knowledge-ops-page' },
      { path: '/knowledge-hub.html', name: 'knowledge-hub', ready: 'knowledge-hub-page' }
    ];
    const viewports = [
      { width: 1440, height: 1000, name: 'desktop' },
      { width: 1024, height: 768, name: 'tablet' },
      { width: 390, height: 844, name: 'mobile' }
    ];

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const target of targets) {
        await page.goto(target.path, { waitUntil: 'domcontentloaded' });
        await expect(page.getByTestId(target.ready)).toBeVisible();
        await expectPageScreenshot(page, `${target.name}-${viewport.name}.png`);
      }
    }
  });

  test('all card types and scenario mobile modal', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const folder = page.getByTestId('folder-list').locator('button').first();
    await expect(folder).toBeVisible();
    await folder.click();

    for (const fixture of CARD_FIXTURES) {
      const card = page.getByTestId('file-list').locator('button').filter({ hasText: fixture.title }).first();
      await expect(card).toBeVisible();
      await card.click();
      await expect(page.getByTestId('card-modal')).toBeVisible();
      await expectPageScreenshot(page, `card-${fixture.cardType}-desktop.png`);
      await page.getByTestId('card-modal-close').click();
      await expect(page.getByTestId('card-modal')).toBeHidden();
    }

    const scenario = page.getByTestId('file-list').locator('button').filter({ hasText: '保育园交接' }).first();
    await page.setViewportSize({ width: 390, height: 844 });
    await scenario.click();
    await expect(page.getByTestId('card-modal')).toBeVisible();
    await expectPageScreenshot(page, 'card-scenario_phrase-mobile.png');
  });
});
