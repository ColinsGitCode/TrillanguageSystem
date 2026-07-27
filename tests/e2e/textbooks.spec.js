'use strict';

const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { resetServerState } = require('./fixtures/resetServerState');
const { createTextbookManifestFixture } = require('./fixtures/textbookFixture');

const repoRoot = path.resolve(__dirname, '../..');
let fixture;
let publishedTrackId;

async function assertContainedDesktop(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
}

async function selectText(page, selector, start, end) {
  const target = page.locator(selector);
  await target.evaluate((element, positions) => {
    const textNode = element.firstChild;
    if (!textNode) throw new Error('selection target has no text node');
    const range = document.createRange();
    range.setStart(textNode, positions.start);
    range.setEnd(textNode, positions.end);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, { start, end });
  await target.dispatchEvent('mouseup');
}

test.describe.serial('Textbook Courses SaaS workflow desktop acceptance', () => {
  test.beforeAll(async ({ request }) => {
    await resetServerState(request);
    fixture = await createTextbookManifestFixture(repoRoot);
  });

  test('renders the Skill-owned empty state without OCR controls', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/textbooks');
    await expect(page.getByTestId('textbook-courses-page')).toBeVisible();
    await expect(page.getByText('还没有教材草稿')).toBeVisible();
    await expect(page.getByText(/import-textbook-track/u)).toBeVisible();
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /OCR|自动配对/iu })).toHaveCount(0);
    await assertContainedDesktop(page);
    await expect(page).toHaveScreenshot('textbook-courses-empty-desktop.png', { animations: 'disabled' });
  });

  test('imports, revises, confirms and releases through a resumable operation', async ({ page }) => {
    const browserErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    page.on('pageerror', (error) => browserErrors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.route('**/api/textbooks/tracks/*/operations', async (route) => {
      const payload = route.request().postDataJSON();
      payload.payload.includeTts = false;
      await route.continue({ postData: JSON.stringify(payload) });
    });
    await page.goto('/textbooks');
    await page.getByText('高级 Manifest intake').click();
    await page.getByLabel('Manifest relative path').fill(fixture.manifestRelative);
    await page.getByLabel('Expected SHA-256').fill(fixture.manifestHash);
    await page.getByRole('button', { name: 'Dry-run' }).click();
    await expect(page.getByText(/dry-run ok .* 2 expressions .* 4 units/u)).toBeVisible();
    await page.getByRole('button', { name: 'Import draft' }).click();
    await expect(page).toHaveURL(/\/textbooks\?track=\d+&stage=review&task=\d+/u);
    publishedTrackId = Number(new URL(page.url()).searchParams.get('track'));
    await expect(page.getByRole('heading', { name: 'Compact Morning Practice' }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /需注意\s*1/u })).toHaveAttribute('aria-pressed', 'true');

    const taskBeforeSave = new URL(page.url()).searchParams.get('task');
    await page.getByLabel('中文提示').fill('我已准备好。');
    await page.getByRole('button', { name: '保存新修订' }).click();
    await expect(page.getByText('已保存')).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get('task')).not.toBe(taskBeforeSave);
    await page.reload();
    await expect(page.getByLabel('中文提示')).toHaveValue('我已准备好。');

    await page.getByRole('button', { name: '确认此表达' }).click();
    await expect(page.getByText('1/2 已确认')).toBeVisible();
    await page.getByRole('button', { name: /待确认\s*1/u }).click();
    await page.getByRole('button', { name: '确认此表达' }).click();
    await expect(page).toHaveURL(/stage=release/u);
    await expect(page.getByRole('heading', { name: '发布前复核' })).toBeVisible();
    await expect(page.getByText('2 / 2')).toBeVisible();
    await expect(page.locator('.workflow-review-summary dl > div').filter({ hasText: 'Study Items' })).toContainText('4');
    let operationReads = 0;
    await page.route(/\/api\/textbooks\/operations\/\d+$/u, async (route) => {
      const response = await route.fetch();
      const payload = await response.json();
      operationReads += 1;
      if (operationReads <= 2) {
        payload.operation.status = 'queued';
        payload.operation.public_summary = '后台任务已创建';
      }
      await route.fulfill({ response, json: payload });
    });
    await page.getByRole('button', { name: '发布 2 条表达' }).click();
    await expect(page).toHaveURL(/stage=processing.*operation=\d+|operation=\d+.*stage=processing/u);
    const processingUrl = page.url();
    await page.reload();
    await expect(page).toHaveURL(processingUrl);
    await expect(page.getByText(/后台处理|教材已发布/u).first()).toBeVisible();
    await expect(page).toHaveURL(/stage=complete/u, { timeout: 15_000 });
    await expect(page.getByRole('heading', { name: '教材 Track 已可学习' })).toBeVisible();
    await expect(page.getByRole('link', { name: '加入学习计划' })).toHaveAttribute('href', `/learn/plan?textbookTrack=${publishedTrackId}`);

    await page.getByPlaceholder('Search English / Japanese / Chinese').fill('ready');
    await expect(page.locator('.textbook-search-results').getByText('I am ready now.')).toBeVisible();
    await assertContainedDesktop(page);
    await expect(page).toHaveScreenshot('textbook-courses-published-desktop.png', { animations: 'disabled' });
    expect(browserErrors).toEqual([]);
  });

  test('restores a deep-linked Track and task across history navigation', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/textbooks?track=${publishedTrackId}&stage=complete`);
    await expect(page.getByRole('heading', { name: '教材 Track 已可学习' })).toBeVisible();
    const expressionButtons = page.locator('.textbook-published-list li button');
    await expressionButtons.nth(1).click();
    const secondUrl = page.url();
    await expressionButtons.nth(0).click();
    await page.goBack();
    await expect(page).toHaveURL(secondUrl);
    await expect(expressionButtons.nth(1)).toHaveClass(/active/u);
  });

  test('persists highlights and creates a normalized derivation job', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/textbooks?track=${publishedTrackId}&stage=complete`);
    await expect(page.locator('[data-textbook-language="en"]').first()).toContainText('Start here.');
    await selectText(page, '[data-textbook-language="en"]', 0, 5);
    const markButton = page.getByRole('button', { name: '标红选区' });
    await expect(markButton).toBeEnabled();
    const highlightResponse = page.waitForResponse((response) => (
      response.request().method() === 'POST' && /\/api\/annotations$/u.test(response.url())
    ));
    await markButton.click();
    const saved = await highlightResponse;
    expect(saved.ok()).toBeTruthy();
    expect((await saved.json()).annotation.targetKind).toBe('textbook_track');
    await expect(page.locator('mark.study-highlight-red')).toHaveText('Start');
    await page.reload();
    await expect(page.locator('mark.study-highlight-red')).toHaveText('Start');
    await expect(page.getByText('含标红')).toBeVisible();

    await selectText(page, 'mark.study-highlight-red', 0, 5);
    await page.getByRole('button', { name: '生成三语卡' }).click();
    await expect(page.getByText(/已创建生成任务 #\d+/u)).toBeVisible();
    await assertContainedDesktop(page);
  });

  test('renders the textbook review answer from canonical annotations', async ({ page, request }) => {
    const scope = {
      version: 2,
      languages: ['en', 'ja'],
      cardTypes: ['textbook_track'],
      dateRange: null,
      tags: [],
      textbookTrackIds: [publishedTrackId],
    };
    const savedPlan = await request.put('/api/learning/plan', {
      data: {
        expectedRevision: 0,
        scope,
        dailyActionGoal: 20,
        dailyNewLimit: 4,
        timeZone: 'Asia/Tokyo',
      },
    });
    expect(savedPlan.ok()).toBeTruthy();
    const queueResponse = await request.post('/api/learning/queues/today');
    expect(queueResponse.ok()).toBeTruthy();
    const queue = (await queueResponse.json()).queue;
    const sessionResponse = await request.post('/api/learning/sessions', {
      data: { queueId: queue.id },
    });
    expect(sessionResponse.ok()).toBeTruthy();
    const session = (await sessionResponse.json()).session;
    const itemResponse = await request.get(
      `/api/learning/items/${session.currentEntry.studyItemId}`
    );
    const item = (await itemResponse.json()).item;
    expect(item.unitKind).toBe('textbook_en');
    expect(item.highlightReference).toBeUndefined();
    expect(item.annotationReference).toMatchObject({
      targetKind: 'textbook_track',
      targetId: publishedTrackId,
      count: 1,
      source: 'card_annotations',
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/learn/session');
    await page.getByRole('button', { name: /揭示答案/ }).click();
    const answer = page.getByTestId('learning-answer');
    await expect(answer).toContainText('含个人标红');
    await expect(answer.locator('mark.study-highlight-red')).toHaveText('Start');
    await expect(answer.getByRole('button', { name: /查看完整卡片/ })).toHaveCount(0);
    await request.post(`/api/learning/sessions/${session.id}/end`);
  });

  test('does not fall back to legacy Track HTML when the annotation feature is disabled', async ({ page }) => {
    const legacyRequests = [];
    page.on('request', (request) => {
      if (/\/api\/textbooks\/tracks\/\d+\/highlights$/u.test(request.url())) {
        legacyRequests.push(request.url());
      }
    });
    await page.route('**/api/annotations?*', async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Not found',
          code: 'ANNOTATION_FEATURE_DISABLED',
        }),
      });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/textbooks?track=${publishedTrackId}&stage=complete`);
    await page.locator('.textbook-published-list li button').nth(1).click();
    await selectText(page, '[data-textbook-language="en"]', 0, 4);
    await expect(page.getByRole('button', { name: '标红选区' })).toBeDisabled();
    expect(legacyRequests).toEqual([]);
    await page.reload();
    expect(legacyRequests).toEqual([]);
  });

  test('keeps official Track and generated sentence playback mutually exclusive', async ({ page }) => {
    await page.addInitScript(() => {
      window.__mediaEvents = [];
      HTMLMediaElement.prototype.play = function play() {
        window.__mediaEvents.push(`official:play:${this.currentSrc || this.src}`);
        this.dispatchEvent(new Event('play'));
        return Promise.resolve();
      };
      HTMLMediaElement.prototype.pause = function pause() {
        window.__mediaEvents.push(`official:pause:${this.currentSrc || this.src}`);
      };
      window.Audio = class FakeAudio {
        constructor(src) {
          this.src = src;
          window.__generatedAudio = this;
        }
        play() {
          window.__mediaEvents.push(`generated:play:${this.src}`);
          return Promise.resolve();
        }
        pause() {
          window.__mediaEvents.push(`generated:pause:${this.src}`);
        }
      };
    });
    await page.route(/\/api\/textbooks\/tracks\/\d+$/u, async (route) => {
      const response = await route.fetch();
      if (!response.ok()) return route.fulfill({ response });
      const payload = await response.json();
      payload.track.tts_audio = [{
        id: 9001,
        generation_id: payload.track.generation_id,
        language: 'en',
        text: 'Start here.',
        filename_suffix: '_en_expr_01',
        tts_provider: 'kokoro',
        tts_model: 'fixture',
        tts_voice: 'fixture',
        status: 'generated',
        error_message: null,
        playback_url: '/api/textbooks/audio/9001/content',
      }];
      await route.fulfill({ response, json: payload });
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`/textbooks?track=${publishedTrackId}&stage=complete`);
    await page.getByRole('button', { name: '播放 EN' }).click();
    await page.locator('.textbook-audio audio').evaluate((audio) => audio.play());
    const events = await page.evaluate(() => window.__mediaEvents);
    expect(events.some((event) => event.startsWith('official:pause:'))).toBeTruthy();
    expect(events.some((event) => event.startsWith('generated:play:'))).toBeTruthy();
    expect(events.some((event) => event.startsWith('generated:pause:'))).toBeTruthy();
    expect(events.some((event) => event.startsWith('official:play:'))).toBeTruthy();
  });
});
