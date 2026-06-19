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
});
