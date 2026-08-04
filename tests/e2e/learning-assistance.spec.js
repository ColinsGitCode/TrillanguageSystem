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
    const onboarding = page.getByTestId('learning-onboarding');
    await expect(onboarding).toContainText('完成第一次真实学习');
    await expect(onboarding.locator('li.is-complete')).toContainText('准备学习内容');
    await expect(onboarding.locator('li.is-next')).toContainText('建立学习计划');
    await onboarding.getByRole('button', { name: '暂不显示首次学习清单' }).click();
    await expect(onboarding).toBeHidden();
    await expect.poll(() => page.evaluate(() => localStorage.getItem('three-lans-onboarding-dismissed-v1'))).toBe('true');
    await expect(page.getByTestId('learning-no-plan')).toContainText('开始你的第一天');
    await page.getByRole('button', { name: '建立学习计划' }).click();
    await expect(page).toHaveURL(/\/learn\/plan$/);
    await expect(page.getByTestId('learning-plan-page')).toBeVisible();
    await expect(page.getByTestId('plan-page-header')).toContainText('学习计划 · 版本');
    await expect(page.getByText(`${TOTAL_STUDY_ITEM_COUNT} 个`, { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Japanese' }).click();
    await expect(page.getByText(`${JAPANESE_ONLY_STUDY_ITEM_COUNT} 个`, { exact: true })).toBeVisible();
    await expect(page.getByText('场景表达固定为 EN+JA')).toBeVisible();
    await page.getByRole('button', { name: 'Japanese' }).click();
    await expect(page.getByText(`${TOTAL_STUDY_ITEM_COUNT} 个`, { exact: true })).toBeVisible();

    const newLimit = page.getByLabel('每日新单元上限 0 = 只清到期项');
    await newLimit.fill(String(DAILY_NEW_LIMIT));
    const savePlanButton = page.getByRole('button', { name: '检查并保存计划' });
    await savePlanButton.click();
    const review = page.getByRole('alertdialog', { name: '确认学习计划' });
    await expect(review).toContainText(`${TOTAL_STUDY_ITEM_COUNT} 个`);
    await expect(review).toContainText(`约 ${EXPECTED_LEARNING_DAYS} 学习日`);
    await expect(review.getByRole('button', { name: '返回修改计划' })).toBeFocused();
    await page.getByTestId('dialog-backdrop').click({ position: { x: 2, y: 2 } });
    await expect(review).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(review).toBeHidden();
    await expect(savePlanButton).toBeFocused();
    await savePlanButton.click();
    await review.locator('dl > div').filter({ hasText: '学习范围' }).getByRole('button', { name: '修改' }).click();
    await expect(review).toBeHidden();
    await expect(page.getByRole('button', { name: /三语卡片/ })).toBeFocused();
    await savePlanButton.click();
    await page.getByRole('button', { name: `保存 ${TOTAL_STUDY_ITEM_COUNT} 个单元并生成今日队列` }).click();
    await expect(page).toHaveURL(/\/learn$/);
    await expect(page.getByTestId('today-learning-page')).toBeVisible();
    await expect(page.getByTestId('today-page-header')).toContainText('今日安排');
    await expect(page.locator('.learning-queue-row')).toHaveCount(DAILY_NEW_LIMIT);
  });

  test('keeps prompt, reveal, four ratings and idempotent retry in one owner', async ({ page, request }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.route('**/api/activity?limit=30', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        items: [{
          id: 'open',
          kind: 'knowledge-resolution',
          status: 'needs_attention',
          title: '3 个知识点待确认',
          summary: '最近待确认：はし。未经人工确认的候选不会进入正式知识点',
          href: '/knowledge?mode=resolution&case=31',
          updatedAt: '2026-07-30T12:03:00.000Z',
          source: 'knowledge',
          actionLabel: '开始确认',
        }],
        summary: { active: 0, needsAttention: 1, total: 1 },
        sources: [
          { id: 'generation', status: 'available' },
          { id: 'textbooks', status: 'available' },
          { id: 'learning', status: 'available' },
          { id: 'knowledge', status: 'available' },
        ],
        generatedAtUtc: '2026-07-30T12:05:00.000Z',
      }),
    }));
    await page.goto('/learn');
    await expect(page.getByTestId('recovery-banner')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '后台活动' }).locator('span')).toHaveText('1');
    await page.getByRole('button', { name: '开始学习' }).click();
    await expect(page).toHaveURL(/\/learn\/session$/);
    await expect(page.getByTestId('learning-review-session')).toBeVisible();
    await expect(page.locator('.react-app-shell')).toHaveClass(/is-focus-mode/);
    await expect(page.locator('.react-sidebar')).toBeHidden();
    await expect(page.getByTestId('recovery-banner')).toHaveCount(0);
    await page.getByTestId('learning-focus-toggle').click();
    await expect(page.locator('.react-sidebar')).toBeVisible();
    await expect(page.getByTestId('learning-focus-toggle')).toHaveText(/专注模式/);
    await expect(page.getByTestId('recovery-banner')).toHaveCount(0);
    await page.getByRole('button', { name: '后台活动' }).click();
    await expect(page.getByRole('dialog', { name: '活动中心' })).toContainText('3 个知识点待确认');
    await page.keyboard.press('Escape');
    await page.getByTestId('learning-focus-toggle').click();
    await expect(page.locator('.react-sidebar')).toBeHidden();
    await expect(page.getByTestId('recovery-banner')).toHaveCount(0);
    await expect(page.getByTestId('learning-session-progress')).toHaveText(`本次1 / ${DAILY_NEW_LIMIT}`);
    await expect(page.getByTestId('learning-daily-goal')).toHaveText('今日目标0 / 20');
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
    await readOnlyCard.getByTestId('react-card-content').evaluate((container) => {
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && (!node.textContent?.trim() || node.parentElement?.closest('rt, button'))) {
        node = walker.nextNode();
      }
      if (!node?.textContent) throw new Error('No readable text found');
      const start = node.textContent.search(/\S/u);
      const range = document.createRange();
      range.setStart(node, Math.max(0, start));
      range.setEnd(node, Math.min(node.textContent.length, Math.max(0, start) + 3));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await expect(readOnlyCard.getByRole('button', { name: '朗读选区' })).toBeVisible();
    await expect(readOnlyCard.getByRole('button', { name: /标记选区|更改标记颜色/ })).toHaveCount(0);
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

    await page.keyboard.press('Space');
    await expect(page.getByTestId('learning-answer').locator('.pronunciation-token').first()).toBeVisible();

    const endSessionButton = page.getByRole('button', { name: '结束' });
    await endSessionButton.click();
    const endDialog = page.getByRole('alertdialog', { name: '结束本次会话' });
    const continueButton = endDialog.getByRole('button', { name: '继续学习' });
    const confirmEndButton = endDialog.getByRole('button', { name: '结束并查看摘要' });
    await expect(endDialog).toBeVisible();
    await expect(continueButton).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(confirmEndButton).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(continueButton).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(endDialog).toBeHidden();
    await expect(endSessionButton).toBeFocused();
    await endSessionButton.click();
    await confirmEndButton.click();
    await expect(page.getByTestId('learning-session-summary')).toContainText('已提交 1 个评分');
  });

  test('removes the first-use checklist after a real review fact exists', async ({ page }) => {
    await page.goto('/learn');
    await expect(page.getByTestId('learning-onboarding')).toHaveCount(0);
    const onboarding = await (await page.request.get('/api/onboarding')).json();
    expect(onboarding.completed).toBe(true);
    expect(onboarding.completedCount).toBe(4);
    expect(onboarding.nextStep).toBeNull();
  });

  test('blocks saving when the reviewed plan revision changes', async ({ page, request }) => {
    await page.goto('/learn/plan');
    const dailyGoal = page.getByLabel('每日行动目标 已提交评分数');
    await dailyGoal.fill('21');
    await expect(page.getByText('有未保存修改')).toBeVisible();
    await page.getByRole('link', { name: 'Cards Factory' }).click();
    const leaveGuard = page.getByRole('alertdialog', { name: '放弃未保存修改' });
    await expect(leaveGuard).toContainText('学习范围或每日负担还有未保存修改');
    await leaveGuard.getByRole('button', { name: '继续编辑' }).click();
    await expect(page).toHaveURL(/\/learn\/plan$/u);
    await expect(dailyGoal).toHaveValue('21');
    await page.getByRole('link', { name: 'Cards Factory' }).click();
    await leaveGuard.getByRole('button', { name: '放弃修改并离开' }).click();
    await expect(page).toHaveURL(/\/$/u);
    await page.goto('/learn/plan');
    await expect(page.getByLabel('每日行动目标 已提交评分数')).toHaveValue('20');
    await page.getByLabel('每日行动目标 已提交评分数').fill('21');
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

    await expect(review).toContainText('学习计划已经更新', { timeout: 5_000 });
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
    await expect(page.getByTestId('history-page-header')).toContainText('学习记录 · Asia/Tokyo');
    await expect(page.getByText('前 14 个实际学习日用于建立个人基线')).toBeVisible();
    await expect(page.getByText('〜ていただけませんか', { exact: true })).toBeVisible();
    await expect(page.locator('.learning-history-stat-strip')).toContainText('1');
    await expect(page.getByTestId('learning-history-guidance')).toContainText('再完成 13 个学习日');
    await expect(page.getByTestId('learning-history-guidance')).toContainText('当前没有明显薄弱类型');
    await expect(page.locator('.learning-load-chart')).toBeVisible();
    await expect(page.locator('.learning-rating-bars .rating-3 strong')).toHaveText('1');

    await page.getByRole('button', { name: '7 天' }).click();
    await expect(page.getByRole('button', { name: '7 天' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByLabel('学习单元类型').selectOption('grammar_ja');
    await expect(page.getByText('〜ていただけませんか', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });

  test('keeps learning API failures distinct from loading and empty states', async ({ page }) => {
    await page.route('**/api/learning/plan', (route) => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'fixture unavailable', code: 'LEARNING_FIXTURE_UNAVAILABLE' }),
    }));
    await page.goto('/learn/plan');
    await expect(page.getByTestId('learning-plan-load-error')).toContainText('学习计划暂时无法读取');
    await expect(page.getByTestId('learning-plan-loading')).toHaveCount(0);
    await page.unroute('**/api/learning/plan');

    await page.route('**/api/learning/sessions/active', (route) => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'fixture unavailable', code: 'LEARNING_FIXTURE_UNAVAILABLE' }),
    }));
    await page.goto('/learn/session');
    await expect(page.getByTestId('learning-session-load-error')).toContainText('学习会话暂时无法读取');
    await expect(page.getByTestId('learning-session-empty')).toHaveCount(0);
  });
});
