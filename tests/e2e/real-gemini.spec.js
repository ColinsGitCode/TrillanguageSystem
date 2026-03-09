const { test, expect } = require('@playwright/test');

const runReal = /^(1|true|yes|on)$/i.test(String(process.env.RUN_REAL_GEMINI_E2E || '').trim());
const realBaseUrl = String(process.env.PLAYWRIGHT_REAL_BASE_URL || 'http://127.0.0.1:3010').trim();

async function waitForQueueIdle(page, timeout = 180000) {
  await expect(page.getByTestId('hero-queue-state')).toHaveText(/IDLE/, { timeout });
  await expect(page.getByTestId('hero-queue-task')).toContainText('Task Queue Idle', { timeout });
}

test.describe('Real Gemini acceptance', () => {
  test.skip(!runReal, '设置 RUN_REAL_GEMINI_E2E=1 后才执行真实 Gemini 验收');

  test('文本输入生成真实 Gemini 卡片', async ({ page, request }) => {
    test.slow();
    const phrase = `PW real gemini ${Date.now()}`;
    let folder = '';

    await page.goto(realBaseUrl);
    await page.getByTestId('model-gemini').click();
    await page.getByTestId('card-type-trilingual').click();
    await page.getByTestId('phrase-input').fill(phrase);
    await page.getByTestId('generate-btn').click();

    await waitForQueueIdle(page);

    const firstFolder = page.getByTestId('folder-list').locator('button').first();
    await expect(firstFolder).toBeVisible();
    folder = await firstFolder.getAttribute('title');
    await firstFolder.click();
    const fileButton = page.getByTestId('file-list').locator('button').filter({ hasText: phrase }).first();
    await expect(fileButton).toBeVisible();

    await fileButton.click();
    await page.getByTestId('tab-train').click();
    await expect(page.getByTestId('train-wrap')).toBeVisible();
    await expect(page.getByTestId('train-status')).toContainText(/READY|REPAIRED|FALLBACK/);

    const beforeRes = await request.get(`${realBaseUrl}/api/training/by-file?folder=${encodeURIComponent(folder)}&base=${encodeURIComponent(phrase)}`);
    expect(beforeRes.ok()).toBeTruthy();
    const beforeJson = await beforeRes.json();
    const beforeUpdatedAt = beforeJson?.training?.updatedAt || '';

    await page.getByTestId('train-regenerate-btn').click();

    await expect.poll(async () => {
      const res = await request.get(`${realBaseUrl}/api/training/by-file?folder=${encodeURIComponent(folder)}&base=${encodeURIComponent(phrase)}`);
      if (!res.ok()) return '';
      const json = await res.json();
      return json?.training?.updatedAt || '';
    }, {
      timeout: 300000,
      message: '等待 TRAIN regenerate 完成'
    }).not.toBe(beforeUpdatedAt);

    if (folder) {
      const res = await request.delete(`${realBaseUrl}/api/records/by-file?folder=${encodeURIComponent(folder)}&base=${encodeURIComponent(phrase)}`);
      expect(res.ok()).toBeTruthy();
    }
  });
});
