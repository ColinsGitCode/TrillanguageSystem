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

async function openCard(page, title) {
  const fileButton = page.getByTestId('file-list').locator('button').filter({ hasText: title }).first();
  await expect(fileButton).toBeVisible();
  await fileButton.click();
  await expect(page.getByTestId('card-modal')).toBeVisible();
  await expect(page.getByTestId('card-modal-title')).toContainText(title);
}

async function expectCardModalExpanded(page) {
  const layout = await page.evaluate(() => {
    const card = document.querySelector('.modern-card')?.getBoundingClientRect();
    const header = document.querySelector('.mc-header')?.getBoundingClientRect();
    const tabs = document.querySelector('.mc-header .panel-tabs')?.getBoundingClientRect();
    const ticker = document.querySelector('#cardContent .hud-ticker')?.getBoundingClientRect();
    return {
      viewportHeight: window.innerHeight,
      cardHeight: Math.round(card?.height || 0),
      headerHeight: Math.round(header?.height || 0),
      tabToContentGap: Math.round((ticker?.top || 0) - (tabs?.bottom || 0))
    };
  });
  expect(layout.cardHeight).toBeGreaterThanOrEqual(layout.viewportHeight - 36);
  expect(layout.headerHeight).toBeLessThanOrEqual(190);
  expect(layout.tabToContentGap).toBeLessThanOrEqual(18);
}

async function deleteRecord(request, folder, base) {
  const res = await request.delete(`/api/records/by-file?folder=${encodeURIComponent(folder)}&base=${encodeURIComponent(base)}`);
  expect(res.ok()).toBeTruthy();
}

test.describe.serial('前端综合回归', () => {
  test.beforeAll(async ({ request }) => {
    await resetServerState(request);
  });

  test('01 首页、卡片类型、历史入口与移动端布局稳定', async ({ page }) => {
    const diagnostics = collectDiagnostics(page);

    await page.goto('/');
    await expect(page).toHaveTitle(/Trilingual Records Viewer/);
    await expect(page.getByTestId('hero-queue-state')).toHaveText('IDLE');
    await expect(page.getByTestId('phrase-input')).toBeVisible();
    await expect(page.getByTestId('generate-btn')).toHaveText('Generate');
    await expect(page.locator('#teacherModelHint')).toHaveText('Gemini 3 Flash Preview');
    await expect(page.getByTestId('folder-list')).toBeVisible();
    await expect(page.getByTestId('file-list')).toBeVisible();

    await page.getByTestId('card-type-grammar').click();
    await expect(page.getByTestId('generate-btn')).toHaveText('Generate Grammar Card');
    await expect(page.getByTestId('card-type-grammar')).toHaveClass(/active/);

    await page.getByTestId('card-type-scenario').click();
    await expect(page.getByTestId('generate-btn')).toHaveText('Generate Scenario Card');
    await expect(page.getByTestId('phrase-input')).toHaveAttribute('placeholder', /描述一个具体场景/);
    await expect(page.getByTestId('card-type-scenario')).toHaveClass(/active/);

    await page.getByTestId('card-type-trilingual').click();
    await expect(page.getByTestId('generate-btn')).toHaveText('Generate');
    await expect(page.getByTestId('card-type-trilingual')).toHaveClass(/active/);

    await page.getByRole('button', { name: '历史记录' }).click();
    await expect(page.locator('[data-content="history"]')).toHaveClass(/active/);

    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '文件夹' }).click();
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      inputVisible: Boolean(document.querySelector('[data-testid="phrase-input"]')?.getClientRects().length),
      queueVisible: Boolean(document.querySelector('[data-testid="hero-queue-status"]')?.getClientRects().length)
    }));
    expect(layout).toEqual({ overflow: false, inputVisible: true, queueVisible: true });

    await page.setViewportSize({ width: 1440, height: 1100 });
    await expectNoDiagnostics(diagnostics);
  });

  test('02 队列浮窗可关闭并从顶部状态恢复', async ({ page }) => {
    const diagnostics = collectDiagnostics(page);

    await page.goto('/');
    const queuePanel = page.locator('#generationQueuePanel');
    await expect(queuePanel).toBeHidden();

    await page.getByTestId('hero-queue-status').click();
    await expect(queuePanel).toBeVisible();

    await queuePanel.getByRole('button', { name: '关闭' }).click();
    await expect(queuePanel).toBeHidden();

    await page.getByTestId('hero-queue-status').click();
    await expect(queuePanel).toBeVisible();

    await expectNoDiagnostics(diagnostics);
  });

  test('03 UI 生成卡片后 CONTENT/INTEL 可打开且元数据完整', async ({ page, request }) => {
    const diagnostics = collectDiagnostics(page);
    const phrase = `PW frontend regression ${Date.now()}`;
    let folder = '';

    await page.goto('/');
    await page.getByTestId('phrase-input').fill(phrase);
    await page.getByTestId('generate-btn').click();
    await expect(page.getByTestId('hero-queue-state')).toHaveText(/RUNNING|QUEUED/, { timeout: 10_000 });
    await waitForQueueIdle(page);
    await expect(page.getByTestId('phrase-input')).toHaveValue('');

    folder = await openFirstFolder(page);
    await openCard(page, phrase);
    await expectCardModalExpanded(page);

    await page.getByTestId('tab-content').click();
    await expect(page.getByTestId('card-content-panel')).toBeVisible();
    await expect.poll(() => page.locator('.audio-btn').count()).toBeGreaterThanOrEqual(1);

    await page.getByTestId('tab-intel').click();
    await expect(page.getByText('QUALITY GRADE')).toBeVisible();
    await expect(page.getByTestId('card-modal-container').getByText('PROVIDER')).toBeVisible();
    await expect(page.getByTestId('card-modal-container').getByText('MODEL')).toBeVisible();

    await page.getByTestId('card-modal-close').click();
    await expect(page.getByTestId('card-modal')).toBeHidden();

    await deleteRecord(request, folder, phrase);
    await expectNoDiagnostics(diagnostics);
  });

  test('04 场景表达卡可生成、展示、播放入口可渲染且不显示 Knowledge 标签', async ({ page, request }) => {
    const diagnostics = collectDiagnostics(page);
    const phrase = `PW scenario expression ${Date.now()}`;
    let folder = '';

    await page.goto('/');
    await page.getByTestId('card-type-scenario').click();
    await page.getByTestId('phrase-input').fill(phrase);
    await page.getByTestId('generate-btn').click();

    await expect(page.getByTestId('hero-queue-state')).toHaveText(/RUNNING|QUEUED/, { timeout: 10_000 });
    await page.getByTestId('hero-queue-status').click();
    await expect(page.getByTestId('queue-task-item').filter({ hasText: phrase }).first()).toContainText('场景');
    await waitForQueueIdle(page);

    folder = await openFirstFolder(page);
    const fileButton = page.getByTestId('file-list').locator('button').filter({ hasText: phrase }).first();
    await expect(fileButton).toContainText('场景卡');
    await fileButton.click();

    await expect(page.getByTestId('card-modal')).toBeVisible();
    await expect(page.getByTestId('card-modal-container')).toContainText('SCENARIO EXPRESSIONS');
    await expect(page.getByTestId('card-content-panel')).toContainText('CARD TYPE · 场景表达卡');
    await expect(page.getByTestId('card-content-panel').locator('h3')).toHaveCount(12);
    await expect.poll(() => page.locator('.audio-btn').count()).toBeGreaterThanOrEqual(2);
    await expect(page.getByTestId('tab-knowledge')).toHaveCount(0);

    await page.getByTestId('card-modal-close').click();
    await deleteRecord(request, folder, phrase);
    await expectNoDiagnostics(diagnostics);
  });

  test('05 Dashboard / Knowledge OPS / Knowledge Hub 基础页面无前端错误', async ({ page }) => {
    const diagnostics = collectDiagnostics(page);

    await page.goto('/dashboard.html');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('mission-control-page')).toBeVisible();
    await expect(page.getByTestId('mission-control-title')).toContainText('MISSION CONTROL');
    await expect(page.getByTestId('mission-task-queue')).toBeVisible();
    await expect(page.getByTestId('mission-queue-total')).toBeVisible();
    await expect(page.getByTestId('service-matrix')).toBeVisible();

    await page.goto('/knowledge-ops.html');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('knowledge-ops-page')).toBeVisible();
    await expect(page.getByTestId('knowledge-ops-title')).toContainText('KNOWLEDGE OPS');
    await expect(page.getByTestId('knowledge-start-btn')).toBeEnabled();
    await expect(page.getByTestId('knowledge-jobs-list')).toBeVisible();

    await page.goto('/knowledge-hub.html');
    await page.waitForLoadState('networkidle');
    await expect(page.getByTestId('knowledge-hub-page')).toBeVisible();
    await expect(page.getByTestId('knowledge-hub-title')).toContainText('KNOWLEDGE HUB');
    await expect(page.getByTestId('knowledge-hub-counts')).toBeVisible();
    await expect(page.getByTestId('knowledge-relation-inspector')).toBeVisible();

    await expectNoDiagnostics(diagnostics);
  });
});
