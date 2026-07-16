'use strict';

const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { resetServerState } = require('./fixtures/resetServerState');
const { createTextbookManifestFixture } = require('./fixtures/textbookFixture');

const repoRoot = path.resolve(__dirname, '../..');
let fixture;

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

test.describe.serial('Textbook Courses TC-P4 desktop acceptance', () => {
  test.beforeAll(async ({ request }) => {
    await resetServerState(request);
    fixture = await createTextbookManifestFixture(repoRoot);
  });

  test('renders the Git-external empty state at 1280x720', async ({ page }) => {
    const browserErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    page.on('pageerror', (error) => browserErrors.push(error.message));
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/textbooks');
    await expect(page.getByTestId('textbook-courses-page')).toBeVisible();
    await expect(page.getByText('暂无课程。先导入 Track 草稿。')).toBeVisible();
    await assertContainedDesktop(page);
    await expect(page).toHaveScreenshot('textbook-courses-empty-desktop.png', { animations: 'disabled' });
    expect(browserErrors).toEqual([]);
  });

  test('imports, verifies and publishes a Track at 1440x900', async ({ page }) => {
    const browserErrors = [];
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text());
    });
    page.on('pageerror', (error) => browserErrors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/textbooks');
    await page.getByLabel('Manifest relative path').fill(fixture.manifestRelative);
    await page.getByLabel('Expected manifest hash').fill(fixture.manifestHash);
    await page.getByRole('button', { name: 'Dry-run' }).click();
    await expect(page.getByText(/dry-run ok .* 2 expressions .* 4 study candidates/u)).toBeVisible();
    await page.getByRole('button', { name: 'Import draft' }).click();
    await expect(page.getByText('已导入 Track 1，等待人工校对')).toBeVisible();
    await expect(page.getByText('待校对 · 2 expressions · 1 low-confidence')).toBeVisible();
    await page.getByRole('button', { name: '确认校对' }).click();
    await expect(page.getByText(/已确认 .* 4 study units/u)).toBeVisible();
    await page.getByRole('button', { name: '发布到学习计划' }).click();
    await expect(page.getByText('已发布到学习系统：4 个单元，insert 4 / update 0')).toBeVisible();
    await expect(page.getByRole('button', { name: '生成单句语音' })).toBeEnabled();
    await expect(page.getByText('根据中文提示说出教材英文原句')).toHaveCount(0);
    await page.getByPlaceholder('Search English / Japanese / Chinese cue').fill('ready');
    await expect(page.locator('.textbook-search-results').getByText('I am ready now.')).toBeVisible();
    const layout = await page.evaluate(() => {
      const box = (selector) => document.querySelector(selector).getBoundingClientRect();
      const top = box('.textbook-command-strip');
      const left = box('.textbook-sidebar-panel');
      const center = box('.textbook-main-column');
      const right = box('.textbook-detail-panel');
      return { topHeight: top.height, leftWidth: left.width, centerWidth: center.width, rightWidth: right.width };
    });
    expect(layout.topHeight).toBeLessThanOrEqual(120);
    expect(layout.leftWidth).toBeLessThanOrEqual(150);
    expect(layout.centerWidth).toBeLessThanOrEqual(400);
    expect(layout.rightWidth).toBeGreaterThanOrEqual(620);
    expect(layout.centerWidth / layout.leftWidth).toBeGreaterThanOrEqual(2.2);
    expect(layout.rightWidth / layout.centerWidth).toBeGreaterThanOrEqual(1.6);
    await assertContainedDesktop(page);
    await expect(page).toHaveScreenshot('textbook-courses-published-desktop.png', { animations: 'disabled' });
    expect(browserErrors).toEqual([]);
  });

  test('persists highlights and creates a normalized derivation job', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/textbooks');
    await expect(page.locator('[data-textbook-language="en"]').first()).toContainText('Start here.');
    await selectText(page, '[data-textbook-language="en"]', 0, 5);
    const markButton = page.getByRole('button', { name: '标红选区' });
    await expect(markButton).toBeEnabled();
    const highlightResponse = page.waitForResponse((response) => (
      response.request().method() === 'PUT' && /\/api\/textbooks\/tracks\/\d+\/highlights$/u.test(response.url())
    ));
    await markButton.click();
    expect((await highlightResponse).ok()).toBeTruthy();
    await expect(page.locator('mark.study-highlight-red')).toHaveText('Start');
    await page.reload();
    await expect(page.locator('mark.study-highlight-red')).toHaveText('Start');
    await expect(page.getByText('含标红')).toBeVisible();

    await selectText(page, 'mark.study-highlight-red', 0, 5);
    await page.getByRole('button', { name: '生成三语卡' }).click();
    await expect(page.getByText(/已创建生成任务 #\d+/u)).toBeVisible();
    await assertContainedDesktop(page);
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
    await page.route('**/api/textbooks/tracks/*', async (route) => {
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
    await page.goto('/textbooks');
    await page.getByRole('button', { name: '播放 EN' }).click();
    await page.locator('.textbook-audio audio').evaluate((audio) => audio.play());
    const events = await page.evaluate(() => window.__mediaEvents);
    expect(events.some((event) => event.startsWith('official:pause:'))).toBeTruthy();
    expect(events.some((event) => event.startsWith('generated:play:'))).toBeTruthy();
    expect(events.some((event) => event.startsWith('generated:pause:'))).toBeTruthy();
    expect(events.some((event) => event.startsWith('official:play:'))).toBeTruthy();
  });
});
