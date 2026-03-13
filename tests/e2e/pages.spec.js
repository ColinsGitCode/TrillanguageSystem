const { test, expect } = require('@playwright/test');
const path = require('path');

test.describe('Playwright page smoke', () => {
  test('01 Mission Control 页面可加载', async ({ page }) => {
    await page.goto('/dashboard.html');
    await expect(page.getByTestId('mission-control-page')).toBeVisible();
    await expect(page.getByTestId('mission-control-title')).toContainText('MISSION CONTROL');
    await expect(page.getByTestId('mission-task-queue')).toBeVisible();
    await expect(page.getByTestId('service-matrix')).toBeVisible();
  });

  test('02 Knowledge OPS 页面可加载', async ({ page }) => {
    await page.goto('/knowledge-ops.html');
    await expect(page.getByTestId('knowledge-ops-page')).toBeVisible();
    await expect(page.getByTestId('knowledge-ops-title')).toContainText('KNOWLEDGE OPS');
    await expect(page.getByTestId('knowledge-start-btn')).toBeVisible();
    await expect(page.getByTestId('knowledge-jobs-list')).toBeVisible();
  });

  test('03 Knowledge OPS 任务可启动并取消', async ({ page }) => {
    await page.goto('/knowledge-ops.html');
    await page.getByTestId('knowledge-start-btn').click();

    const firstJob = page.getByTestId('knowledge-job-item').first();
    await expect(firstJob).toBeVisible();
    await expect(firstJob).toContainText('summary');

    await firstJob.getByTestId('knowledge-job-cancel').click();
    await expect(firstJob.getByTestId('knowledge-job-status')).toHaveText('CANCELLED');
  });

  test('04 Knowledge Hub 页面可加载', async ({ page }) => {
    await page.goto('/knowledge-hub.html');
    await expect(page.getByTestId('knowledge-hub-page')).toBeVisible();
    await expect(page.getByTestId('knowledge-hub-title')).toContainText('KNOWLEDGE HUB');
    await expect(page.getByTestId('knowledge-hub-counts')).toBeVisible();
    await expect(page.getByTestId('knowledge-relation-inspector')).toBeVisible();
  });

  test('05 OCR fixture 上传、清洗与回填输入框', async ({ page }) => {
    await page.goto('/');
    const samplePath = path.resolve(__dirname, 'fixtures/ocr-sample.png');
    await page.setInputFiles('[data-testid="image-file-input"]', samplePath);

    await expect(page.getByTestId('ocr-btn')).toBeEnabled();
    await page.getByTestId('ocr-btn').click();

    await expect(page.getByTestId('ocr-preview')).toBeVisible();
    await expect(page.getByTestId('ocr-preview-meta')).toContainText('已清洗');
    await expect(page.getByTestId('ocr-preview-clean')).toContainText('Queue state キューに追加する persistent highlight');

    await page.getByTestId('ocr-preview-tab-raw').click();
    await expect(page.getByTestId('ocr-preview-raw')).toContainText('Queue   state ◆');
    await expect(page.getByTestId('phrase-input')).toHaveValue('Queue state キューに追加する persistent highlight');
  });

  test('06 Mission Control 可展示共享队列失败与重试结果', async ({ page, request }) => {
    const phrase = `__E2E_FAIL_ONCE__ PW mission retry ${Date.now()}`;
    const enqueueRes = await request.post('/api/generation-jobs', {
      data: {
        phrase,
        llm_provider: 'gemini',
        enable_compare: false,
        card_type: 'trilingual',
        source_mode: 'input'
      }
    });
    expect(enqueueRes.ok()).toBeTruthy();
    const enqueueJson = await enqueueRes.json();
    const jobId = Number(enqueueJson?.job?.id || 0);
    expect(jobId).toBeGreaterThan(0);

    await page.goto('/dashboard.html');
    await expect(page.getByTestId('mission-task-queue')).toBeVisible();
    await expect(page.getByTestId('mission-queue-failed')).toContainText('1', { timeout: 15_000 });
    await expect(page.getByTestId('mission-queue-recent-list')).toContainText(phrase);
    await expect(page.getByTestId('mission-queue-recent-item').first().getByTestId('mission-queue-recent-status')).toHaveText('FAILED');
    await expect(page.getByTestId('mission-queue-audit')).toContainText('FAILED');

    const retryRes = await request.post(`/api/generation-jobs/${jobId}/retry`);
    expect(retryRes.ok()).toBeTruthy();

    await expect(page.getByTestId('mission-queue-success')).toContainText('1', { timeout: 15_000 });
    await expect(page.getByTestId('mission-queue-failed')).toContainText('0', { timeout: 15_000 });
    await expect(page.getByTestId('mission-queue-recent-item').first().getByTestId('mission-queue-recent-status')).toHaveText('SUCCESS');
    await expect(page.getByTestId('mission-queue-audit')).toContainText('SUCCESS');

    const jobsRes = await request.get('/api/generation-jobs?limit=10');
    expect(jobsRes.ok()).toBeTruthy();
    const jobsJson = await jobsRes.json();
    const latestJob = Array.isArray(jobsJson?.jobs)
      ? jobsJson.jobs.find((job) => Number(job.id) === jobId)
      : null;
    const resultFolder = String(latestJob?.resultFolder || '').trim();
    const resultBase = String(latestJob?.resultBaseFilename || '').trim();
    expect(resultFolder).not.toBe('');
    expect(resultBase).not.toBe('');

    const deleteRes = await request.delete(`/api/records/by-file?folder=${encodeURIComponent(resultFolder)}&base=${encodeURIComponent(resultBase)}`);
    expect(deleteRes.ok()).toBeTruthy();

    const clearRes = await request.post('/api/generation-jobs/clear-done');
    expect(clearRes.ok()).toBeTruthy();
  });
});
