const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { resetServerState } = require('./fixtures/resetServerState');

test.describe('React page smoke', () => {
  test.beforeAll(async ({ request }) => {
    await resetServerState(request);
  });

  test('DeepSeek offline state blocks generation and exposes recovery action', async ({ page }) => {
    await page.route('**/api/health', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'unhealthy',
        services: [{ name: 'DeepSeek API', status: 'offline', critical: true }],
        system: { criticalOnline: false },
      }),
    }));
    await page.goto('/');
    await expect(page.getByRole('alert')).toContainText('生成服务当前不可用');
    await expect(page.getByRole('button', { name: '刷新' })).toBeVisible();
    await page.getByTestId('react-phrase-input').fill('blocked while offline');
    await expect(page.getByTestId('react-generate-button')).toBeDisabled();
  });

  test('OCR fixture uploads, normalizes and fills the shared input', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('react-image-input').setInputFiles(path.resolve(__dirname, 'fixtures/ocr-sample.png'));
    await page.getByTestId('react-ocr-button').click();
    await expect(page.getByTestId('react-phrase-input')).toHaveValue('Queue state キューに追加する persistent highlight');
    await expect(page.getByText('OCR 结果', { exact: true })).toBeVisible();
    await expect(page.locator('.ocr-result')).toContainText('Queue   state ◆');
  });

  test('retired pages and APIs remain unavailable', async ({ request }) => {
    for (const pathName of ['/__rr-poc', '/index.html', '/dashboard.html', '/knowledge-hub.html', '/knowledge-ops.html']) {
      expect((await request.get(pathName)).status(), pathName).toBe(404);
    }
    for (const pathName of ['/api/dashboard/highlight-stats', '/api/knowledge/jobs', '/api/srs/stats']) {
      expect((await request.get(pathName)).status(), pathName).toBe(404);
    }
  });
});
