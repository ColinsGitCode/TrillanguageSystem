const { test, expect } = require('@playwright/test');
const { resetServerState } = require('./fixtures/resetServerState');

test.describe('Homepage engagement bar', () => {
  test.beforeEach(async ({ request }) => {
    await resetServerState(request);
  });

  test('renders cold-start state and review CTA', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('today-learning-bar')).toBeVisible();
    await expect(page.getByTestId('today-learning-streak')).toContainText('开始你的第一天');
    await expect(page.getByTestId('today-learning-progress')).toContainText('0 / 5');
    await expect(page.getByTestId('today-learning-mastery')).toContainText('0 / 0');
    await expect(page.getByTestId('today-learning-review')).toHaveAttribute('href', /knowledge-hub\.html\?mode=review/);
  });

  test('updates the daily goal from the goal prompt', async ({ page }) => {
    await page.goto('/');
    page.once('dialog', async (dialog) => {
      expect(dialog.type()).toBe('prompt');
      await dialog.accept('12');
    });
    await page.getByTestId('today-learning-goal').click();
    await expect(page.getByTestId('today-learning-goal')).toContainText('目标 12');
    await expect(page.getByTestId('today-learning-progress')).toContainText('0 / 12');
  });
});
