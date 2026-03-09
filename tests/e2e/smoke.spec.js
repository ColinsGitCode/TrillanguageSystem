const { test, expect } = require('@playwright/test');

let basePhrase = `PW smoke base ${Date.now()}`;
let baseFolder = '';
const derivedCards = [];

async function waitForQueueIdle(page) {
  await expect(page.getByTestId('hero-queue-state')).toHaveText(/IDLE/, { timeout: 30_000 });
  await expect(page.getByTestId('hero-queue-task')).toContainText('Task Queue Idle', { timeout: 30_000 });
}

async function openTodayFolder(page) {
  const firstFolder = page.getByTestId('folder-list').locator('button').first();
  await expect(firstFolder).toBeVisible();
  baseFolder = await firstFolder.getAttribute('title');
  await firstFolder.click();
  return baseFolder;
}

async function openCardByTitle(page, title) {
  const button = page.getByTestId('file-list').locator('button').filter({ hasText: title }).first();
  await expect(button).toBeVisible();
  await button.click();
  await expect(page.getByTestId('card-modal')).toBeVisible();
  await expect(page.getByTestId('card-modal-title')).toContainText(title);
}

async function closeModal(page) {
  await page.getByTestId('card-modal-close').click();
  await expect(page.getByTestId('card-modal')).toBeHidden();
}

async function selectNodeText(page, selector, expectedText) {
  const result = await page.evaluate(({ selector, expectedText }) => {
    const target = [...document.querySelectorAll(selector)].find((el) => (el.textContent || '').trim() === expectedText);
    if (!target) return { ok: false, reason: `target not found: ${expectedText}` };
    target.scrollIntoView({ block: 'center', inline: 'nearest' });
    const range = document.createRange();
    range.selectNodeContents(target);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    return { ok: true, selected: sel.toString() };
  }, { selector, expectedText });
  expect(result.ok, result.reason || 'selection failed').toBeTruthy();
}

async function deleteByFile(request, folder, base) {
  const res = await request.delete(`/api/records/by-file?folder=${encodeURIComponent(folder)}&base=${encodeURIComponent(base)}`);
  expect(res.ok()).toBeTruthy();
}

test.describe.serial('Playwright smoke', () => {
  test('01 首页加载与空闲状态', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('hero-queue-state')).toHaveText('IDLE');
    await expect(page.getByTestId('hero-queue-task')).toContainText('Task Queue Idle');
    await expect(page.getByTestId('phrase-input')).toBeVisible();
    await expect(page.getByTestId('generate-btn')).toBeVisible();
    await expect(page.getByTestId('folder-list')).toBeVisible();
    await expect(page.getByTestId('file-list')).toBeVisible();
  });

  test('02 主输入生成三语卡并进入当天目录', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('phrase-input').fill(basePhrase);
    await page.getByTestId('generate-btn').click();
    await expect(page.getByTestId('hero-queue-state')).toHaveText(/RUNNING/, { timeout: 10_000 });
    await waitForQueueIdle(page);
    await openTodayFolder(page);
    await expect(page.getByTestId('file-list').locator('button').filter({ hasText: basePhrase })).toBeVisible();
  });

  test('03 打开卡片并切换 CONTENT/TRAIN/INTEL', async ({ page }) => {
    await page.goto('/');
    await openTodayFolder(page);
    await openCardByTitle(page, basePhrase);

    await page.getByTestId('tab-content').click();
    await expect(page.getByTestId('card-content-panel')).toBeVisible();

    await page.getByTestId('tab-train').click();
    await expect(page.getByTestId('train-wrap')).toBeVisible();
    await expect(page.getByTestId('train-status')).toContainText('READY');

    await page.getByTestId('tab-intel').click();
    await expect(page.getByText('QUALITY GRADE')).toBeVisible();
  });

  test('04 TRAIN 显示答案与标红刷新恢复', async ({ page }) => {
    await page.goto('/');
    await openTodayFolder(page);
    await openCardByTitle(page, basePhrase);
    await page.getByTestId('tab-train').click();
    await expect(page.getByTestId('train-wrap')).toBeVisible();

    await page.locator('.card-training-reveal-btn').first().click();
    await expect(page.locator('.card-training-answer').first()).toBeVisible();

    await selectNodeText(page, '[data-train-field="text"]', 'persistent highlight');
    await page.getByTestId('selection-highlight-btn').click({ force: true });
    await expect(page.locator('mark.study-highlight-red').filter({ hasText: 'persistent highlight' })).toHaveCount(1);

    await page.reload();
    await openTodayFolder(page);
    await openCardByTitle(page, basePhrase);
    await page.getByTestId('tab-train').click();
    await expect(page.locator('mark.study-highlight-red').filter({ hasText: 'persistent highlight' })).toHaveCount(1);
  });

  test('05 TRAIN 选区生成三语卡与语法卡', async ({ page }) => {
    await page.goto('/');
    await openTodayFolder(page);
    await openCardByTitle(page, basePhrase);
    await page.getByTestId('tab-train').click();

    await selectNodeText(page, '[data-train-field="text"]', 'persistent highlight');
    await page.getByTestId('selection-generate-btn').click({ force: true });
    await page.waitForTimeout(300);

    await selectNodeText(page, '[data-train-field="text"]', 'キューに追加する');
    await page.getByTestId('selection-generate-grammar-btn').click({ force: true });

    await waitForQueueIdle(page);
    await closeModal(page);
    await openTodayFolder(page);

    derivedCards.push('persistent highlight', 'キューに追加する');
    await expect(page.getByTestId('file-list').locator('button').filter({ hasText: 'persistent highlight' })).toBeVisible();
    await expect(page.getByTestId('file-list').locator('button').filter({ hasText: 'キューに追加する' })).toBeVisible();
  });

  test('06 删除卡片并确认列表移除', async ({ page, request }) => {
    await page.goto('/');
    await openTodayFolder(page);
    await openCardByTitle(page, basePhrase);

    await page.getByTestId('card-delete-trigger').click();
    await page.getByTestId('card-delete-confirm').click();
    await expect(page.getByTestId('card-modal')).toBeHidden();

    await expect(page.getByTestId('file-list').locator('button').filter({ hasText: basePhrase })).toHaveCount(0);

    for (const title of derivedCards) {
      await deleteByFile(request, baseFolder, title);
    }
  });
});
