const { test, expect } = require('@playwright/test');
const { resetServerState } = require('./fixtures/resetServerState');

function collectDiagnostics(page) {
  const diagnostics = {
    console: [],
    requests: []
  };

  page.on('console', (message) => {
    if (!['error', 'warning'].includes(message.type())) return;
    diagnostics.console.push(`${message.type()}: ${message.text()}`);
  });

  page.on('requestfailed', (request) => {
    diagnostics.requests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText || 'failed'}`);
  });

  return diagnostics;
}

async function expectNoDiagnostics(diagnostics) {
  expect(diagnostics.console, 'console error/warning').toEqual([]);
  expect(diagnostics.requests, 'failed network requests').toEqual([]);
}

async function assertNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate((currentLabel) => {
    const doc = document.documentElement;
    const offenders = [...document.body.querySelectorAll('*')]
      .map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          id: el.id || '',
          className: typeof el.className === 'string' ? el.className : '',
          testId: el.getAttribute('data-testid') || '',
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width)
        };
      })
      .filter((x) => x.width > 0 && (x.left < -2 || x.right > window.innerWidth + 2))
      .slice(0, 8);
    return {
      label: currentLabel,
      clientWidth: doc.clientWidth,
      scrollWidth: doc.scrollWidth,
      offenders
    };
  }, label);

  expect(
    overflow.scrollWidth,
    `${label} horizontal overflow: ${JSON.stringify(overflow.offenders)}`
  ).toBeLessThanOrEqual(overflow.clientWidth + 2);
}

async function waitForQueueIdle(page, timeout = 30_000) {
  await expect(page.getByTestId('hero-queue-state')).toHaveText(/IDLE/, { timeout });
  await expect(page.getByTestId('hero-queue-task')).toContainText('Task Queue Idle', { timeout });
}

async function openFirstFolder(page) {
  const firstFolder = page.getByTestId('folder-list').locator('button').first();
  await expect(firstFolder).toBeVisible();
  const folder = await firstFolder.getAttribute('title');
  await firstFolder.click();
  return folder;
}

async function openGeneratedCard(page, phrase) {
  const fileButton = page.getByTestId('file-list').locator('button').filter({ hasText: phrase }).first();
  await expect(fileButton).toBeVisible();
  await fileButton.click();
  await expect(page.getByTestId('card-modal')).toBeVisible();
  await expect(page.getByTestId('card-modal-title')).toContainText(phrase);
}

async function deleteRecord(request, folder, base) {
  const res = await request.delete(`/api/records/by-file?folder=${encodeURIComponent(folder)}&base=${encodeURIComponent(base)}`);
  expect(res.ok()).toBeTruthy();
}

test.describe.serial('UI quality regression', () => {
  test.beforeAll(async ({ request }) => {
    await resetServerState(request);
    const seedRes = await request.post('/api/_test/seed-knowledge');
    expect(seedRes.ok()).toBeTruthy();
  });

  test('01 关键页面在桌面、平板、手机视口无横向溢出且核心区块可见', async ({ page }) => {
    test.setTimeout(120_000);
    const pages = [
      {
        url: '/',
        ids: ['hero-queue-status', 'phrase-input', 'folder-list', 'file-list']
      },
      {
        url: '/dashboard.html',
        ids: ['mission-control-page', 'mission-task-queue', 'service-matrix']
      },
      {
        url: '/knowledge-ops.html',
        ids: ['knowledge-ops-page', 'knowledge-start-btn', 'knowledge-jobs-list']
      },
      {
        url: '/knowledge-hub.html',
        ids: ['knowledge-hub-page', 'knowledge-base-panel', 'knowledge-relation-inspector']
      }
    ];
    const viewports = [
      { width: 1440, height: 1000, name: 'desktop' },
      { width: 1024, height: 768, name: 'tablet' },
      { width: 390, height: 844, name: 'mobile' }
    ];

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const target of pages) {
        await page.goto(target.url, { waitUntil: 'domcontentloaded' });
        for (const id of target.ids) {
          await expect(page.getByTestId(id), `${target.url} ${viewport.name} ${id}`).toBeVisible();
        }
        await assertNoHorizontalOverflow(page, `${target.url} ${viewport.name}`);
      }
    }

  });

  test('02 首页关键 CSS/JS 从本地加载且无外部脚本/CDN 依赖', async ({ page }) => {
    const diagnostics = collectDiagnostics(page);
    await page.goto('/');
    await expect(page.getByTestId('phrase-input')).toBeVisible();

    const resources = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name));
    const externalScriptOrCdnResources = resources.filter((url) => /(?:cdn\.jsdelivr|unpkg|cdnjs|esm\.sh)/i.test(url));
    expect(externalScriptOrCdnResources).toEqual([]);

    const requiredAssets = await page.evaluate(() => {
      const hrefs = [...document.querySelectorAll('link[rel="stylesheet"]')].map((node) => node.href);
      const scripts = [...document.querySelectorAll('script[src]')].map((node) => node.src);
      return { hrefs, scripts };
    });
    expect(requiredAssets.hrefs.some((url) => url.endsWith('/styles.css'))).toBeTruthy();
    expect(requiredAssets.hrefs.some((url) => url.endsWith('/modern-card.css'))).toBeTruthy();
    expect(requiredAssets.scripts.some((url) => url.endsWith('/js/modules/app.js'))).toBeTruthy();

    await expectNoDiagnostics(diagnostics);
  });

  test('03 弹出学习卡片在桌面与手机视口拉满高度且头部间距压缩', async ({ page, request }) => {
    const diagnostics = collectDiagnostics(page);
    const phrase = `PW UI modal full height ${Date.now()}`;
    let folder = '';

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/');
    await page.getByTestId('phrase-input').fill(phrase);
    await page.getByTestId('generate-btn').click();
    await waitForQueueIdle(page);
    folder = await openFirstFolder(page);
    await openGeneratedCard(page, phrase);

    for (const viewport of [
      { width: 1440, height: 1000, name: 'desktop' },
      { width: 390, height: 844, name: 'mobile' }
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const layout = await page.evaluate(() => {
        const card = document.querySelector('.modern-card')?.getBoundingClientRect();
        const header = document.querySelector('.mc-header')?.getBoundingClientRect();
        const tabs = document.querySelector('.mc-header .panel-tabs')?.getBoundingClientRect();
        const content = document.querySelector('#cardContent')?.getBoundingClientRect();
        return {
          viewportHeight: window.innerHeight,
          cardHeight: Math.round(card?.height || 0),
          headerHeight: Math.round(header?.height || 0),
          headerToContentGap: Math.round((content?.top || 0) - (tabs?.bottom || 0)),
          modalBottom: Math.round(card?.bottom || 0)
        };
      });

      expect(layout.cardHeight, `${viewport.name} modal height`).toBeGreaterThanOrEqual(layout.viewportHeight - 36);
      expect(layout.headerHeight, `${viewport.name} compact header`).toBeLessThanOrEqual(viewport.name === 'mobile' ? 230 : 190);
      expect(layout.headerToContentGap, `${viewport.name} tab/content gap`).toBeLessThanOrEqual(18);
      expect(layout.modalBottom, `${viewport.name} modal bottom`).toBeGreaterThanOrEqual(layout.viewportHeight - 18);
      await assertNoHorizontalOverflow(page, `card modal ${viewport.name}`);
    }

    await page.getByTestId('tab-content').click();
    await expect(page.getByTestId('card-content-panel')).toBeVisible();
    await page.getByTestId('tab-intel').click();
    await expect(page.getByText('QUALITY GRADE')).toBeVisible();
    await page.getByTestId('card-modal-close').click();
    await expect(page.getByTestId('card-modal')).toBeHidden();

    await deleteRecord(request, folder, phrase);
    const clearDoneRes = await request.post('/api/generation-jobs/clear-done');
    expect(clearDoneRes.ok()).toBeTruthy();
    await expectNoDiagnostics(diagnostics);
  });

  test('04 队列浮窗、审计时间线、详情弹窗在视口内可关闭可恢复', async ({ page, request }) => {
    const diagnostics = collectDiagnostics(page);
    const phrase = `__E2E_FAIL_ONCE__ PW UI queue ${Date.now()}`;
    const enqueueRes = await request.post('/api/generation-jobs', {
      data: {
        phrase,
        card_type: 'trilingual',
        source_mode: 'input'
      }
    });
    expect(enqueueRes.ok()).toBeTruthy();

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/');
    await expect(page.getByTestId('hero-queue-chip-f')).toContainText('失败 1', { timeout: 15_000 });
    await page.getByTestId('hero-queue-status').click();

    const panel = page.locator('#generationQueuePanel');
    await expect(panel).toBeVisible();
    const failedItem = page.getByTestId('queue-task-item').filter({ hasText: phrase }).first();
    await expect(failedItem).toBeVisible();
    await expect(page.getByTestId('queue-audit-timeline')).toContainText('FAILED');

    const panelBox = await panel.boundingBox();
    expect(panelBox.x).toBeGreaterThanOrEqual(0);
    expect(panelBox.y).toBeGreaterThanOrEqual(0);
    expect(panelBox.x + panelBox.width).toBeLessThanOrEqual(1280);
    expect(panelBox.y + panelBox.height).toBeLessThanOrEqual(900);

    await failedItem.getByTestId('queue-task-detail-btn').click();
    await expect(page.getByTestId('queue-job-detail-modal')).toBeVisible();
    await expect(page.getByTestId('queue-job-detail-error')).toContainText('e2e_fixture_forced_retryable_failure');
    await page.getByTestId('queue-job-detail-close').click();
    await expect(page.getByTestId('queue-job-detail-modal')).toBeHidden();
    await expect(panel).toBeHidden();

    await page.getByTestId('hero-queue-status').click();
    await expect(panel).toBeVisible();
    await page.getByTestId('queue-panel-close').click();
    await expect(panel).toBeHidden();
    await page.getByTestId('hero-queue-status').click();
    await expect(panel).toBeVisible();

    const clearRes = await request.post('/api/generation-jobs/clear-done');
    expect(clearRes.ok()).toBeTruthy();
    await expectNoDiagnostics(diagnostics);
  });
});
