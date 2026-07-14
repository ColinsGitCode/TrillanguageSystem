'use strict';

const { test, expect } = require('@playwright/test');
const { resetServerState } = require('./fixtures/resetServerState');

const FIXTURES = [
  ['LA-P2 trilingual fixture', 'trilingual'],
  ['〜ていただけませんか', 'grammar_ja'],
  ['配镜验光时描述远处模糊', 'scenario_phrase'],
];

async function enqueueAndWait(request, phrase, cardType) {
  const created = await request.post('/api/generation-jobs', {
    data: { phrase, card_type: cardType, source_mode: 'input' },
  });
  expect(created.ok()).toBeTruthy();
  const id = (await created.json()).job.id;
  await expect.poll(async () => {
    const response = await request.get(`/api/generation-jobs/${id}`);
    return (await response.json()).job.status;
  }, { timeout: 30_000 }).toBe('success');
}

test.describe.serial('Learning Assistance 2.0 LA-P2 desktop flow', () => {
  test.beforeAll(async ({ request }) => {
    await resetServerState(request);
    for (const [phrase, cardType] of FIXTURES) await enqueueAndWait(request, phrase, cardType);
    const seeded = await request.post('/api/_test/learning-seed');
    expect(seeded.ok()).toBeTruthy();
    expect((await seeded.json()).studyItemCount).toBe(15);
  });

  test('creates a real plan from the confirmed scope preview', async ({ page }) => {
    await page.goto('/learn');
    await expect(page.getByTestId('learning-no-plan')).toContainText('开始你的第一天');
    await page.getByRole('button', { name: '建立学习计划' }).click();
    await expect(page).toHaveURL(/\/learn\/plan$/);
    await expect(page.getByTestId('learning-plan-page')).toBeVisible();
    await expect(page.getByText('15 个', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Japanese' }).click();
    await expect(page.getByText('1 个', { exact: true })).toBeVisible();
    await expect(page.getByText('场景表达固定为 EN+JA')).toBeVisible();
    await page.getByRole('button', { name: 'Japanese' }).click();
    await expect(page.getByText('15 个', { exact: true })).toBeVisible();

    const newLimit = page.getByLabel('每日新单元上限 0 = 只清到期项');
    await newLimit.fill('3');
    await page.getByRole('button', { name: '保存并生成今日队列' }).click();
    await expect(page).toHaveURL(/\/learn$/);
    await expect(page.getByTestId('today-learning-page')).toBeVisible();
    await expect(page.locator('.learning-queue-row')).toHaveCount(3);
  });

  test('keeps prompt, reveal, four ratings and idempotent retry in one owner', async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/learn');
    await page.getByRole('button', { name: '开始学习' }).click();
    await expect(page).toHaveURL(/\/learn\/session$/);
    await expect(page.getByTestId('learning-review-session')).toBeVisible();
    await expect(page.getByRole('button', { name: /重来/ })).toBeDisabled();
    await expect(page.getByTestId('learning-answer')).toHaveCount(0);

    await page.keyboard.press('Space');
    await expect(page.getByTestId('learning-answer')).toBeVisible();
    await expect(page.getByRole('button', { name: /记住/ })).toBeEnabled();
    const footerBox = await page.locator('.learning-session-footer').boundingBox();
    expect(footerBox.y + footerBox.height).toBeLessThanOrEqual(720);

    let failedOnce = false;
    await page.route('**/api/learning/sessions/*/reviews', async (route) => {
      if (!failedOnce) {
        failedOnce = true;
        await route.fulfill({ status: 503, json: { error: 'fixture storage busy', code: 'LEARNING_STORAGE_BUSY' } });
        return;
      }
      await route.continue();
    });
    await page.getByRole('button', { name: /记住/ }).click();
    await expect(page.getByRole('alert')).toContainText('当前评分尚未写入');
    await expect(page.getByRole('button', { name: /重来/ })).toBeDisabled();
    await page.getByRole('button', { name: '重试提交' }).click();
    await expect(page.getByRole('status')).toContainText('上一项已保存');
    await expect.poll(async () => {
      const response = await request.get('/api/learning/queues/today');
      return (await response.json()).queue.progress.actionCount;
    }).toBe(1);
    await page.unroute('**/api/learning/sessions/*/reviews');

    await page.getByRole('button', { name: '结束' }).click();
    await expect(page.getByRole('alertdialog', { name: '结束本次会话' })).toBeVisible();
    await page.getByRole('button', { name: '结束并查看摘要' }).click();
    await expect(page.getByTestId('learning-session-summary')).toContainText('已提交 1 个评分');
  });

  test('renders the learning area as a contained desktop workspace', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/learn');
    await expect(page.getByRole('link', { name: '今日学习' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('link', { name: 'Cards Factory' })).toHaveAttribute('href', '/');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    const strip = await page.locator('.learning-stat-strip').boundingBox();
    expect(strip.height).toBeLessThanOrEqual(100);
  });
});
