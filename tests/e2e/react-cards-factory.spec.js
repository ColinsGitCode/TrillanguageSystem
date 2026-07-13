const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { resetServerState } = require('./fixtures/resetServerState');

const FIXTURES = [
  ['react trilingual fixture', 'trilingual'],
  ['〜なくなった', 'grammar_ja'],
  ['保育园早上送孩子并说明昨晚有点咳嗽', 'scenario_phrase'],
];

async function enqueueAndWait(request, phrase, cardType) {
  const created = await request.post('/api/generation-jobs', {
    data: { phrase, card_type: cardType, source_mode: 'input' },
  });
  expect(created.ok()).toBeTruthy();
  const body = await created.json();
  const id = body.job.id;
  await expect.poll(async () => {
    const response = await request.get(`/api/generation-jobs/${id}`);
    return (await response.json()).job.status;
  }, { timeout: 30_000, intervals: [100, 200, 500] }).toBe('success');
}

test.describe.serial('React Cards Factory P3 + P4', () => {
  test.beforeAll(async ({ request }) => {
    await resetServerState(request);
    for (const [phrase, cardType] of FIXTURES) await enqueueAndWait(request, phrase, cardType);
  });

  test('P3 desktop composition keeps 2:1 and 1:3 working ratios', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('react-file-list').locator('button')).toHaveCount(3);
    const composer = await page.locator('.factory-composer').boundingBox();
    const queue = await page.getByTestId('react-queue-status').boundingBox();
    const dates = await page.locator('.date-rail').boundingBox();
    const library = await page.locator('.card-library').boundingBox();
    expect(composer.width / queue.width).toBeGreaterThan(1.85);
    expect(composer.width / queue.width).toBeLessThan(2.15);
    expect(library.width / dates.width).toBeGreaterThan(2.85);
    expect(library.width / dates.width).toBeLessThan(3.15);
    await expect(page.getByRole('button', { name: /场景表达/ }).last()).toHaveCSS('background-color', 'rgb(255, 244, 220)');
  });

  test('P3 queue opens only from its status card and closes outside', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('react-queue-status').click();
    const dialog = page.getByRole('dialog', { name: '队列管理' });
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('react-queue-timeline')).toBeVisible();
    const box = await dialog.boundingBox();
    expect(Math.abs((box.x + box.width / 2) - page.viewportSize().width / 2)).toBeLessThan(12);
    await page.mouse.click(4, 4);
    await expect(dialog).toBeHidden();
  });

  test('P3 UI enqueues the selected card type and keeps the workspace responsive', async ({ page, request }) => {
    await page.goto('/');
    await page.getByTestId('react-card-type-scenario_phrase').click();
    await page.getByTestId('react-phrase-input').fill('React 场景入队验证');
    await page.getByTestId('react-generate-button').click();
    await expect(page.getByRole('status')).toContainText('已加入共享任务队列');
    await expect.poll(async () => {
      const response = await request.get('/api/generation-jobs?limit=30');
      const jobs = (await response.json()).jobs;
      return jobs.find((job) => job.phraseNormalized === 'React 场景入队验证')?.jobType;
    }).toBe('scenario_phrase');
  });

  test('P3 OCR uploads, cleans and fills the shared text input', async ({ page }) => {
    await page.goto('/');
    const sample = path.resolve(__dirname, 'fixtures/ocr-sample.png');
    await page.getByTestId('react-image-input').setInputFiles(sample);
    await expect(page.getByTestId('react-ocr-button')).toBeEnabled();
    await page.getByTestId('react-ocr-button').click();
    await expect(page.getByTestId('react-phrase-input')).toHaveValue('Queue state キューに追加する persistent highlight');
    await expect(page.getByText('OCR 结果', { exact: true })).toBeVisible();
  });

  test('P3 exposes searchable history without a second product page', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('tab', { name: '历史' }).click();
    await page.getByPlaceholder('搜索历史').fill('なくなった');
    await expect(page.locator('.history-items button')).toHaveCount(1);
    await expect(page.locator('.history-items button')).toContainText('〜なくなった');
  });

  test('P3 retries a failed shared-queue job from the centered dialog', async ({ page, request }) => {
    const phrase = `__E2E_FAIL_ONCE__ React retry ${Date.now()}`;
    const created = await request.post('/api/generation-jobs', {
      data: { phrase, card_type: 'trilingual', source_mode: 'input' },
    });
    expect(created.ok()).toBeTruthy();
    const id = (await created.json()).job.id;
    await expect.poll(async () => {
      const response = await request.get(`/api/generation-jobs/${id}`);
      return (await response.json()).job.status;
    }, { timeout: 15_000 }).toBe('failed');

    await page.goto('/');
    await page.getByTestId('react-queue-status').click();
    await page.locator('.queue-job').filter({ hasText: phrase }).click();
    await expect(page.getByTestId('react-queue-timeline')).toContainText('FAILED');
    await page.getByRole('button', { name: '重试失败' }).click();
    await expect.poll(async () => {
      const response = await request.get(`/api/generation-jobs/${id}`);
      return (await response.json()).job.status;
    }, { timeout: 30_000 }).toBe('success');
    await expect(page.getByTestId('react-queue-timeline')).toContainText('SUCCEEDED');
  });

  test('P4 renders full-height Markdown, kanji-only ruby, audio and INTEL', async ({ page }) => {
    await page.goto('/');
    const opener = page.getByTestId('react-file-list').locator('button').filter({ hasText: 'react trilingual fixture' });
    await opener.click();
    const modal = page.getByTestId('react-card-modal');
    await expect(modal).toBeVisible();
    const modalBox = await modal.locator('.react-card-modal').boundingBox();
    expect(modalBox.height).toBeGreaterThan(page.viewportSize().height - 30);
    const rubyBases = await modal.locator('ruby').evaluateAll((nodes) => nodes.map((ruby) => {
      const clone = ruby.cloneNode(true);
      clone.querySelectorAll('rt, rp').forEach((node) => node.remove());
      return clone.textContent.trim();
    }));
    expect(rubyBases.length).toBeGreaterThan(0);
    expect(rubyBases.every((text) => /^[\p{Script=Han}々〆ヵヶ]+$/u.test(text))).toBeTruthy();
    await expect(modal.locator('.audio-btn')).toHaveCount(4);
    await page.getByRole('tab', { name: 'INTEL' }).click();
    await expect(page.getByTestId('react-card-intel')).toContainText('DEEPSEEK');
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('P4 persists a selected-text highlight and restores it on reopen', async ({ page }) => {
    await page.goto('/');
    const opener = page.getByTestId('react-file-list').locator('button').filter({ hasText: 'react trilingual fixture' });
    await opener.click();
    await page.getByTestId('react-card-content').evaluate((container) => {
      const text = Array.from(container.querySelectorAll('li')).find((node) => node.textContent.includes('E2E'))?.firstChild;
      const range = document.createRange();
      range.selectNodeContents(text);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    const highlight = page.getByRole('button', { name: '标红选区' });
    await expect(highlight).toBeEnabled();
    await highlight.click();
    await expect(page.locator('mark.study-highlight-red')).toHaveCount(1);
    await page.getByTestId('react-card-modal-close').click();
    await opener.click();
    await expect(page.locator('mark.study-highlight-red')).toHaveCount(1);
  });

  test('P4 sanitizer blocks script, style and event attributes while preserving ruby', async ({ page }) => {
    await page.route('**/api/folders', (route) => route.fulfill({ json: { folders: ['mock'] } }));
    await page.route('**/api/folders/mock/files', (route) => route.fulfill({ json: {
      files: [{ file: 'hostile.html', title: 'hostile', cardType: 'trilingual' }],
    } }));
    await page.route('**/api/folders/mock/files/hostile.md', (route) => route.fulfill({
      contentType: 'text/markdown',
      body: '# hostile\n<style>body{display:none}</style><script>window.__pwned=1</script><img src=x onerror="window.__imgPwned=1">\n## 日本語\n<ruby>漢字<rt>かんじ</rt></ruby>',
    }));
    await page.route('**/api/records/by-file?*', (route) => route.fulfill({ status: 404, json: { error: 'not found' } }));
    await page.goto('/');
    await page.getByTestId('react-file-list').getByRole('button', { name: /hostile/ }).click();
    const content = page.getByTestId('react-card-content');
    await expect(content.locator('ruby')).toHaveCount(1);
    await expect(content.locator('script, style')).toHaveCount(0);
    await expect(content.locator('img')).not.toHaveAttribute('onerror');
    expect(await page.evaluate(() => Boolean(window.__pwned || window.__imgPwned))).toBeFalsy();
  });

  test('P3/P4 stay inside all supported viewports and modal remains full-height', async ({ page }) => {
    for (const viewport of [{ width: 1440, height: 1100 }, { width: 1024, height: 768 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.goto('/');
      await expect(page.getByTestId('react-cards-factory')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
      const scenario = page.getByTestId('react-file-list').locator('button').filter({ hasText: '保育园交接' });
      await scenario.click();
      const box = await page.locator('.react-card-modal').boundingBox();
      expect(box.height).toBeGreaterThan(viewport.height - 30);
      expect(box.width).toBeLessThanOrEqual(viewport.width);
      await page.keyboard.press('Escape');
    }
  });
});
