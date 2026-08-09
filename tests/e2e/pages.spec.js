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
    await expect(page.locator('.react-alert')).toContainText('生成服务不可用，请检查 DeepSeek API。');
    await expect(page.getByRole('button', { name: '重新检查生成服务' })).toBeVisible();
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

  test('keeps public route errors safe and actionable', async ({ page }) => {
    await page.goto('/missing-public-page');
    const boundary = page.getByTestId('public-error-boundary');
    await expect(boundary).toContainText('没有找到这个页面');
    await expect(boundary).toContainText('现有卡片、教材和学习记录没有被修改');
    await expect(boundary.getByRole('link', { name: '返回 Cards Factory' })).toBeVisible();
    await expect(page.getByText(/No route matches|Unknown application error|SQLITE|at \w+/u)).toHaveCount(0);
  });

  test('surfaces an unfinished session before offering to create a new daily queue', async ({ page }) => {
    await page.route('**/api/learning/plan', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        plan: { id: 1, status: 'active' },
        profile: { timeZone: 'Asia/Tokyo' },
        admissionSummary: {},
        scopePreview: { studyItemCount: 5 },
      }),
    }));
    await page.route('**/api/learning/queues/today', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, queue: null, emptyReason: 'not-ensured' }),
    }));
    await page.route('**/api/learning/sessions/active', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        session: {
          id: 9,
          queueId: 8,
          status: 'active',
          currentEntry: null,
          revealedEntryId: null,
          revealedAtUtc: null,
          nextAvailableAtUtc: null,
          startedAtUtc: '2026-07-28T23:17:19.525Z',
          endedAtUtc: null,
          queueProgress: {
            total: 5,
            byStatus: { active: 1, pending: 4 },
            actionCount: 0,
            actionGoal: 20,
            goalReached: false,
          },
          reviewSummary: { total: 0, byRating: { 1: 0, 2: 0, 3: 0, 4: 0 } },
        },
      }),
    }));
    await page.route('**/api/activity?limit=30', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        items: [{
          id: '9',
          kind: 'learning-session',
          status: 'running',
          title: '未结束的学习会话',
          summary: '本次已完成 0/5，可继续上次进度',
          href: '/learn/session',
          updatedAt: '2026-07-28T23:17:19.525Z',
          source: 'learning',
          actionLabel: '继续学习',
        }],
        summary: { active: 1, needsAttention: 0, total: 1 },
        sources: [
          { id: 'generation', status: 'available' },
          { id: 'textbooks', status: 'available' },
          { id: 'learning', status: 'available' },
          { id: 'knowledge', status: 'available' },
        ],
        generatedAtUtc: '2026-07-29T00:00:00.000Z',
      }),
    }));

    await page.goto('/learn');
    await expect(page.getByTestId('learning-stale-session')).toContainText('上次学习还没有结束');
    await expect(page.getByTestId('recovery-banner')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '继续上次学习' })).toBeVisible();
    await expect(page.getByRole('button', { name: '结束上次会话并生成今日队列' })).toBeVisible();
    await expect(page.getByRole('button', { name: '生成今日队列', exact: true })).toHaveCount(0);
  });

  test('knowledge result selection stays read-only before a scheduled Study Item is added to today', async ({ page }) => {
    let manualIntentRequests = 0;
    let lookupRequests = 0;
    await page.route('**/api/kg/search**', async (route) => {
      const query = new URL(route.request().url()).searchParams.get('q');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          results: query === '__three_lans_probe__' ? [] : [{
            id: 1,
            pointKey: 'a'.repeat(64),
            kind: 'lexeme',
            language: 'ja',
            canonicalForm: '食べる',
            canonicalReading: 'たべる',
            senseDiscriminator: '',
            identityVersion: 'kg-identity-v1',
            lifecycle: 'active',
            lookupCount7d: 1,
          }],
        }),
      });
    });
    await page.route('**/api/kg/lookups', (route) => {
      lookupRequests += 1;
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    });
    await page.route('**/api/kg/points/1', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        point: {
          id: 1,
          pointKey: 'a'.repeat(64),
          kind: 'lexeme',
          language: 'ja',
          canonicalForm: '食べる',
          canonicalReading: 'たべる',
          senseDiscriminator: '',
          identityVersion: 'kg-identity-v1',
          lifecycle: 'active',
          stats: { studyItemCount: 1, reviewEventCount: 2, explicitLookupCount30d: 1 },
          forms: [{ id: 1, text: '食べる', linkKind: 'canonical', reading: 'たべる' }],
          evidence: [{ id: 1, sourceKind: 'study_item', sourceRefId: 101, sourceText: '毎朝パンを食べる。', reason: '学习卡片中的出现证据。' }],
        },
      }),
    }));
    await page.route('**/api/learning/plan', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, plan: { id: 1, status: 'active' }, profile: { timeZone: 'Asia/Shanghai' }, admissionSummary: {}, scopePreview: {} }),
    }));
    await page.route('**/api/learning/queues/today', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, queue: null, emptyReason: 'not-ensured' }),
    }));
    await page.route('**/api/learning/manual-queue-intents/today', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, intents: [], capacity: { policyVersion: 'manual-intent-v1', limit: 20, used: 0, remaining: 20 } }),
    }));
    await page.route('**/api/learning/items/101', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        item: {
          id: 101,
          unitKind: 'trilingual_ja',
          unitKey: 'ja',
          locator: {},
          source: { generationId: 8, cardType: 'trilingual', title: '食べる', folder: '20260716', baseFilename: 'taberu', generationDate: '2026-07-16', contentHash: 'b'.repeat(64) },
          prompt: { language: 'zh', text: '吃', targetLanguages: ['ja'] },
          answer: { targetText: '食べる', markdown: '# 食べる' },
          scheduleState: { fsrsState: 'review', dueAtUtc: '2026-07-20T00:00:00.000Z', lastReviewedAtUtc: '2026-07-15T00:00:00.000Z', reps: 1, lapses: 0, version: 1 },
          expectedScheduleVersion: 1,
          audioFiles: [],
          annotationReference: null,
        },
      }),
    }));
    await page.route('**/api/learning/manual-queue-intents', async (route) => {
      manualIntentRequests += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          idempotent: false,
          reused: false,
          alreadyQueued: false,
          intent: { id: 1, status: 'active', studyItemId: 101, queueId: 1, queueEntryId: 1 },
          entry: { id: 1, studyItemId: 101, reason: 'manual-lookup', bucket: 5 },
          capacity: { policyVersion: 'manual-intent-v1', limit: 20, used: 1, remaining: 19 },
        }),
      });
    });

    await page.goto('/knowledge');
    await page.getByPlaceholder('输入词语、短语或语法…').fill('食べる');
    await page.getByRole('button', { name: /日本語 · 词语\s+食べる/ }).click();
    await expect(page.getByRole('heading', { name: '食べる' })).toBeVisible();
    await expect(page.getByText('毎朝パンを食べる。')).toBeVisible();
    expect(lookupRequests).toBe(0);
    await page.getByRole('button', { name: '加入', exact: true }).click();
    await expect(page.getByRole('alertdialog', { name: '加入本次学习' })).toContainText('加入本次学习？');
    expect(manualIntentRequests).toBe(0);
    await page.getByRole('button', { name: '确认加入' }).click();
    await expect(page.getByText('已加入本次学习，不会改动原计划范围。')).toBeVisible();
    expect(manualIntentRequests).toBe(1);
  });
});
