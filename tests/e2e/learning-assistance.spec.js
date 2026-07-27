'use strict';

const { test, expect } = require('@playwright/test');
const { resetServerState } = require('./fixtures/resetServerState');

const FIXTURES = [
  ['LA-P2 trilingual fixture', 'trilingual'],
  ['〜ていただけませんか', 'grammar_ja'],
  ['配镜验光时描述远处模糊', 'scenario_phrase'],
];
const TOTAL_STUDY_ITEM_COUNT = 23;
const JAPANESE_ONLY_STUDY_ITEM_COUNT = 1;
const DAILY_NEW_LIMIT = 3;
const EXPECTED_LEARNING_DAYS = 8;

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

test.describe.serial('Learning Assistance 2.0 desktop flow', () => {
  test.beforeAll(async ({ request }) => {
    await resetServerState(request);
    for (const [phrase, cardType] of FIXTURES) await enqueueAndWait(request, phrase, cardType);
    const seeded = await request.post('/api/_test/learning-seed');
    expect(seeded.ok()).toBeTruthy();
    expect((await seeded.json()).studyItemCount).toBe(TOTAL_STUDY_ITEM_COUNT);
  });

  test('creates a real plan from the confirmed scope preview', async ({ page }) => {
    await page.goto('/learn');
    await expect(page.getByTestId('learning-no-plan')).toContainText('开始你的第一天');
    await page.getByRole('button', { name: '建立学习计划' }).click();
    await expect(page).toHaveURL(/\/learn\/plan$/);
    await expect(page.getByTestId('learning-plan-page')).toBeVisible();
    await expect(page.getByText(`${TOTAL_STUDY_ITEM_COUNT} 个`, { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Japanese' }).click();
    await expect(page.getByText(`${JAPANESE_ONLY_STUDY_ITEM_COUNT} 个`, { exact: true })).toBeVisible();
    await expect(page.getByText('场景表达固定为 EN+JA')).toBeVisible();
    await page.getByRole('button', { name: 'Japanese' }).click();
    await expect(page.getByText(`${TOTAL_STUDY_ITEM_COUNT} 个`, { exact: true })).toBeVisible();

    const newLimit = page.getByLabel('每日新单元上限 0 = 只清到期项');
    await newLimit.fill(String(DAILY_NEW_LIMIT));
    await page.getByRole('button', { name: '检查并保存计划' }).click();
    const review = page.getByRole('alertdialog', { name: '确认学习计划' });
    await expect(review).toContainText(`${TOTAL_STUDY_ITEM_COUNT} 个`);
    await expect(review).toContainText(`约 ${EXPECTED_LEARNING_DAYS} 学习日`);
    await review.locator('dl > div').filter({ hasText: '学习范围' }).getByRole('button', { name: '修改' }).click();
    await expect(review).toBeHidden();
    await expect(page.getByRole('button', { name: /三语卡片/ })).toBeFocused();
    await page.getByRole('button', { name: '检查并保存计划' }).click();
    await page.getByRole('button', { name: `保存 ${TOTAL_STUDY_ITEM_COUNT} 个单元并生成今日队列` }).click();
    await expect(page).toHaveURL(/\/learn$/);
    await expect(page.getByTestId('today-learning-page')).toBeVisible();
    await expect(page.locator('.learning-queue-row')).toHaveCount(DAILY_NEW_LIMIT);
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
    const annotationRead = page.waitForResponse((response) => (
      response.request().method() === 'GET'
      && new URL(response.url()).pathname === '/api/annotations'
    ));
    await page.getByRole('button', { name: /查看完整卡片/ }).click();
    expect((await annotationRead).ok()).toBeTruthy();
    const readOnlyCard = page.getByTestId('react-card-modal');
    await expect(readOnlyCard.getByText('READ ONLY')).toBeVisible();
    await expect(readOnlyCard.getByRole('button', { name: '删除卡片' })).toHaveCount(0);
    await expect(readOnlyCard.getByRole('button', { name: '标红选区' })).toHaveCount(0);
    await readOnlyCard.getByTestId('react-card-modal-close').click();
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
    await expect(page.locator('.learning-schedule-explanation')).toContainText('上一项已保存');
    await expect(page.locator('.learning-session-status')).toContainText('已保存');
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

  test('blocks saving when the reviewed plan revision changes', async ({ page, request }) => {
    await page.goto('/learn/plan');
    await page.getByRole('button', { name: '检查并保存计划' }).click();
    const review = page.getByRole('alertdialog', { name: '确认学习计划' });
    await expect(review).toBeVisible();

    const current = await (await request.get('/api/learning/plan')).json();
    const changed = await request.put('/api/learning/plan', {
      data: {
        expectedRevision: current.plan.revision,
        scope: current.plan.scope,
        dailyActionGoal: current.plan.dailyActionGoal,
        dailyNewLimit: current.plan.dailyNewLimit,
        timeZone: current.profile.timeZone,
      },
    });
    expect(changed.ok()).toBeTruthy();

    await expect(review).toContainText('计划 revision 已变化', { timeout: 5_000 });
    await expect(review.getByRole('button', { name: /保存 \d+ 个单元并生成今日队列/ })).toBeDisabled();
    await request.post('/api/learning/queues/today');
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

  test('renders LA-P3 history from the committed review fact', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('/learn/history');
    await expect(page.getByRole('link', { name: '学习记录' })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByTestId('learning-history-page')).toBeVisible();
    await expect(page.getByText('前 14 个实际学习日用于建立个人基线')).toBeVisible();
    await expect(page.getByText('〜ていただけませんか', { exact: true })).toBeVisible();
    await expect(page.locator('.learning-history-stat-strip')).toContainText('1');
    await expect(page.locator('.learning-load-chart')).toBeVisible();
    await expect(page.locator('.learning-rating-bars .rating-3 strong')).toHaveText('1');

    await page.getByRole('button', { name: '7 天' }).click();
    await expect(page.getByRole('button', { name: '7 天' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByLabel('学习单元类型').selectOption('grammar_ja');
    await expect(page.getByText('〜ていただけませんか', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });
});
