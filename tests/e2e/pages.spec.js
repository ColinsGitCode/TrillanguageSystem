const { test, expect } = require('@playwright/test');
const path = require('path');
const { resetServerState } = require('./fixtures/resetServerState');

test.describe('Playwright page smoke', () => {
  test.beforeAll(async ({ request }) => {
    await resetServerState(request);
  });

  test('00 首页在 DeepSeek API 离线时显示告警', async ({ page }) => {
    await page.route('**/api/health', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          services: [
            {
              name: 'DeepSeek API',
              status: 'offline',
              message: 'DeepSeek API key is not configured',
              critical: true
            }
          ],
          system: {
            overallStatus: 'degraded',
            criticalOnline: false,
            criticalServices: [
              { name: 'DeepSeek API', status: 'offline', message: 'DeepSeek API key is not configured' }
            ]
          }
        })
      });
    });

    await page.goto('/');
    await expect(page.getByTestId('infra-alert-banner')).toBeVisible();
    await expect(page.getByTestId('infra-alert-banner')).toContainText('DeepSeek API 离线');
    await expect(page.getByTestId('generate-btn')).toBeDisabled();
  });

  test('05 OCR fixture 上传、清洗与回填输入框', async ({ page }) => {
    await page.goto('/');
    const samplePath = path.resolve(__dirname, 'fixtures/ocr-sample.png');
    await page.getByTestId('image-file-input').setInputFiles(samplePath);
    await page.evaluate(() => {
      const input = document.querySelector('[data-testid="image-file-input"]');
      input?.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await expect(page.getByTestId('ocr-btn')).toBeEnabled();
    await page.getByTestId('ocr-btn').click();

    await expect(page.getByTestId('ocr-preview')).toBeVisible();
    await expect(page.getByTestId('ocr-preview-meta')).toContainText('已清洗');
    await expect(page.getByTestId('ocr-preview-clean')).toContainText('Queue state キューに追加する persistent highlight');

    await page.getByTestId('ocr-preview-tab-raw').click();
    await expect(page.getByTestId('ocr-preview-raw')).toContainText('Queue   state ◆');
    await expect(page.getByTestId('phrase-input')).toHaveValue('Queue state キューに追加する persistent highlight');
  });

  test('06 已退役页面与 API 不再暴露', async ({ request }) => {
    for (const path of ['/dashboard.html', '/knowledge-hub.html', '/knowledge-ops.html']) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(404);
    }

    for (const path of [
      '/api/dashboard/highlight-stats',
      '/api/knowledge/jobs',
      '/api/srs/stats'
    ]) {
      const response = await request.get(path);
      expect(response.status(), path).toBe(404);
    }
  });
});
