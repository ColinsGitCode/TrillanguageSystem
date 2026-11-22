const { test, expect } = require('@playwright/test');
const { resetServerState } = require('./fixtures/resetServerState');
const { enqueueAndWait } = require('./fixtures/cardSelection');

const title = 'Sentence practice E2E fixture';

test.beforeEach(async ({ request }) => {
  await resetServerState(request);
  await enqueueAndWait(request, title, 'trilingual');
});

test('homepage practice does not reveal feedback before the answer, and persists learner decisions', async ({ page, request }) => {
  await page.goto('/');
  await page.getByRole('link', { name: '开始练习' }).click();
  await expect(page).toHaveURL(/\/practice$/);
  await page.getByRole('button', { name: '英语', exact: true }).click();
  await page.getByRole('button', { name: '开始练习' }).click();
  const answer = page.getByRole('textbox', { name: '你的作答' });
  await expect(answer).toBeVisible();
  await expect(answer).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('region', { name: '练习反馈' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '提交作答' })).toBeDisabled();
  await answer.fill('I can say it in my own words.');
  await page.getByRole('button', { name: '提交作答' }).click();
  await expect(page.getByText('句意清楚，可以独立表达。', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '能独立表达' }).click();
  await expect(page.getByRole('button', { name: '能独立表达' })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: '我不同意' }).click();
  await expect(page.getByRole('button', { name: '已标记异议' })).toHaveAttribute('aria-pressed', 'true');
  const history = await (await request.get('/api/sentence-practice/history')).json();
  expect(history.attempts).toHaveLength(1);
  expect(history.attempts[0]).toMatchObject({
    language: 'en', answer: 'I can say it in my own words.', selfAssessment: 'independent', disputed: true,
  });
  expect(history.attempts[0]).not.toHaveProperty('score');
  expect(history.attempts[0]).not.toHaveProperty('reference');
  await page.reload();
  await page.getByRole('button', { name: '练习记录' }).click();
  await expect(page.getByText('有异议', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: '换场景再练' }).click();
  await expect(page.getByRole('heading', { name: /生成出的卡片在测试结束后/ })).toBeVisible();
  await expect(page.getByRole('region', { name: '练习反馈' })).toHaveCount(0);
});

test('mobile card entry keeps the source card and the Japanese exercise fits narrow viewports', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('link', { name: '开始练习' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.getByTestId('react-file-list').getByRole('button', { name: new RegExp(title) }).click();
  const modal = page.getByTestId('react-card-modal');
  await modal.getByRole('link', { name: '练一句' }).click();
  await expect(page).toHaveURL(/\/practice\?card=\d+$/);
  await page.getByRole('button', { name: '开始练习' }).click();
  const field = page.getByRole('textbox', { name: '你的作答' });
  await expect(field).toHaveAttribute('lang', 'ja');
  await field.fill('自分の言葉で表現できます。');
  await page.getByRole('button', { name: '提交作答' }).click();
  await expect(page.getByRole('region', { name: '练习反馈' })).toBeVisible();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
  await page.getByRole('button', { name: '换个场景' }).click();
  await expect(page.getByRole('heading', { name: /测试后需要能够删除/ })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '你的作答' })).toHaveValue('');
});
