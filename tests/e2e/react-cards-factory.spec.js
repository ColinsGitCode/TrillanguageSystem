const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { resetServerState } = require('./fixtures/resetServerState');

const FIXTURES = [
  ['react trilingual fixture', 'trilingual'],
  ['〜なくなった', 'grammar_ja'],
  ['保育园早上送孩子并说明昨晚有点咳嗽', 'scenario_phrase'],
];

async function enqueueAndWait(request, phrase, cardType, { targetFolder = '' } = {}) {
  const created = await request.post('/api/generation-jobs', {
    data: { phrase, card_type: cardType, source_mode: 'input', target_folder: targetFolder },
  });
  expect(created.ok()).toBeTruthy();
  const body = await created.json();
  const id = body.job.id;
  await expect.poll(async () => {
    const response = await request.get(`/api/generation-jobs/${id}`);
    return (await response.json()).job.status;
  }, { timeout: 30_000, intervals: [100, 200, 500] }).toBe('success');
  return body.job;
}

async function waitForPronunciationContent(page) {
  await expect(page.getByTestId('react-card-content').locator('.pronunciation-token').first()).toBeVisible();
}

async function selectVisibleText(page, text, { keyboard = false } = {}) {
  const content = page.getByTestId('react-card-content');
  await waitForPronunciationContent(page);
  await content.evaluate((container, options) => {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const nodes = [];
    let node = walker.nextNode();
    while (node) {
      nodes.push(node);
      node = walker.nextNode();
    }
    const joined = nodes.map((item) => item.nodeValue || '').join('');
    const matchStart = joined.indexOf(options.text);
    if (matchStart < 0) throw new Error(`Unable to find selection text: ${options.text}`);
    const matchEnd = matchStart + options.text.length;
    let cursor = 0;
    let startNode = null;
    let startOffset = 0;
    let endNode = null;
    let endOffset = 0;
    for (const candidate of nodes) {
      const length = String(candidate.nodeValue || '').length;
      if (!startNode && matchStart >= cursor && matchStart <= cursor + length) {
        startNode = candidate;
        startOffset = matchStart - cursor;
      }
      if (matchEnd >= cursor && matchEnd <= cursor + length) {
        endNode = candidate;
        endOffset = matchEnd - cursor;
        break;
      }
      cursor += length;
    }
    if (!startNode || !endNode) throw new Error(`Unable to map selection text: ${options.text}`);
    if (options.keyboard) {
      container.focus();
      container.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        shiftKey: true,
        bubbles: true,
      }));
    }
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    if (options.keyboard) {
      document.dispatchEvent(new Event('selectionchange'));
      container.dispatchEvent(new KeyboardEvent('keyup', {
        key: 'ArrowRight',
        shiftKey: true,
        bubbles: true,
      }));
    } else {
      container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    }
  }, { text, keyboard });
}

test.describe.serial('React Cards Factory P3 + P4 + CA-P5', () => {
  test.beforeAll(async ({ request }) => {
    await resetServerState(request);
    for (const [phrase, cardType] of FIXTURES) await enqueueAndWait(request, phrase, cardType);
  });

  test('desktop composition keeps the 4:1 workspace rail and 1:3 library ratios', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('factory-composer-header')).toContainText('创建学习卡');
    await expect(page.getByTestId('react-file-list').locator('button')).toHaveCount(3);
    const workspaceMain = await page.locator('.product-workspace-main').boundingBox();
    const controlRail = await page.locator('.product-workspace-rail').boundingBox();
    const composer = await page.locator('.factory-composer').boundingBox();
    const queue = await page.getByTestId('react-queue-status').boundingBox();
    const dates = await page.locator('.date-rail').boundingBox();
    const library = await page.locator('.card-library').boundingBox();
    expect(workspaceMain.width / controlRail.width).toBeGreaterThan(3.85);
    expect(workspaceMain.width / controlRail.width).toBeLessThan(4.15);
    expect(composer.width / queue.width).toBeGreaterThan(.98);
    expect(composer.width / queue.width).toBeLessThan(1.02);
    expect(composer.x).toBeGreaterThanOrEqual(workspaceMain.x + workspaceMain.width);
    expect(library.width / dates.width).toBeGreaterThan(2.85);
    expect(library.width / dates.width).toBeLessThan(3.15);
    await expect(page.getByRole('button', { name: /场景表达/ }).last()).toHaveCSS('background-color', 'rgb(255, 244, 220)');
  });

  test('background queue polling does not move the factory workspace', async ({ page }) => {
    let jobsCalls = 0;
    let releaseSecondRequest = () => {};
    await page.route('**/api/health', (route) => route.fulfill({
      json: { status: 'healthy', system: { criticalOnline: true }, services: [] },
    }));
    await page.route('**/api/generation-jobs*', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname !== '/api/generation-jobs' || url.searchParams.get('limit') !== '30') {
        await route.continue();
        return;
      }
      jobsCalls += 1;
      if (jobsCalls === 3) {
        await new Promise((resolve) => { releaseSecondRequest = resolve; });
      }
      await route.fulfill({
        json: {
          jobs: [{
            id: 41,
            status: 'running',
            phraseNormalized: 'stable queue fixture',
            jobType: 'trilingual',
          }],
        },
      });
    });
    await page.goto('/');

    const queue = page.getByTestId('react-queue-status');
    const controlRail = page.locator('.product-workspace-rail');
    const workspace = page.locator('.factory-library-grid');
    await expect(queue).toContainText('stable queue fixture');
    await expect(page.getByTestId('react-file-list').locator('button')).toHaveCount(3);
    const beforeQueue = await queue.boundingBox();
    const beforeControlRail = await controlRail.boundingBox();
    const beforeWorkspace = await workspace.boundingBox();

    await expect.poll(() => jobsCalls, { timeout: 6_000 }).toBeGreaterThan(2);
    await expect(queue).toHaveAttribute('aria-busy', 'true');
    const duringQueue = await queue.boundingBox();
    const duringControlRail = await controlRail.boundingBox();
    const duringWorkspace = await workspace.boundingBox();

    expect(duringQueue.height).toBe(beforeQueue.height);
    expect(duringControlRail.width).toBe(beforeControlRail.width);
    expect(duringWorkspace.y).toBe(beforeWorkspace.y);
    await expect(page.getByTestId('factory-queue-refresh-status')).toHaveCount(0);

    releaseSecondRequest();
    await expect(queue).toHaveAttribute('aria-busy', 'false');
  });

  test('keeps recent date groups open and older months compact', async ({ page }) => {
    await page.route('**/api/folders', (route) => route.fulfill({
      json: { folders: ['20260729', '20260630', '20260530', '20260420'] },
    }));
    await page.route('**/api/folders/*/files', (route) => route.fulfill({ json: { files: [] } }));
    await page.goto('/');

    await expect(page.getByRole('button', { name: '收起 2026.07' })).toBeVisible();
    await expect(page.getByRole('button', { name: '收起 2026.06' })).toBeVisible();
    await expect(page.getByRole('button', { name: '展开 2026.05' })).toBeVisible();
    await expect(page.getByRole('button', { name: '日期 2026.05.30' })).toHaveCount(0);

    await page.getByRole('button', { name: '展开 2026.05' }).click();
    await expect(page.getByRole('button', { name: '日期 2026.05.30' })).toBeVisible();
  });

  test('searches, sorts and remembers a compact card-library view', async ({ page }) => {
    await page.route('**/api/folders', (route) => route.fulfill({
      json: { folders: ['20260730'] },
    }));
    await page.route('**/api/folders/20260730/files', (route) => route.fulfill({
      json: {
        files: [
          { file: 'zeta.html', title: 'Zeta handoff', cardType: 'scenario_phrase' },
          { file: 'alpha.html', title: 'Alpha grammar', cardType: 'grammar_ja' },
          { file: 'meeting.html', title: 'Meeting phrase', cardType: 'trilingual' },
          { file: 'beta.html', title: 'Beta phrase', cardType: 'trilingual' },
          { file: 'clinic.html', title: 'Clinic grammar', cardType: 'grammar_ja' },
        ],
      },
    }));
    await page.goto('/');

    const library = page.locator('.card-library');
    const search = page.getByLabel('搜索当前日期卡片');
    await expect(page.getByTestId('factory-library-toolbar')).toBeVisible();
    await expect(page.getByTestId('react-file-list').locator('.file-card')).toHaveCount(5);

    await search.fill('场景表达');
    await expect(page.getByTestId('react-file-list').locator('.file-card')).toHaveCount(1);
    await expect(page.getByTestId('react-file-list')).toContainText('Zeta handoff');
    await search.fill('not-present');
    await expect(page.getByText('没有匹配卡片')).toBeVisible();
    await page.getByRole('button', { name: '清除搜索' }).click();

    await page.getByLabel('卡片排序').selectOption('title');
    await expect(page.getByTestId('react-file-list').locator('.file-card strong').first()).toHaveText('Alpha grammar');
    await page.getByRole('button', { name: '紧凑显示' }).click();
    await expect(library).toHaveClass(/density-compact/u);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();

    await page.reload();
    await expect(page.locator('.card-library')).toHaveClass(/density-compact/u);
    await expect(page.getByLabel('卡片排序')).toHaveValue('title');
  });

  test('keeps card-list failures distinct from a genuinely empty date', async ({ page }) => {
    await page.route('**/api/folders', (route) => route.fulfill({ json: { folders: ['20260729'] } }));
    await page.route('**/api/folders/20260729/files', (route) => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'fixture unavailable' }),
    }));
    await page.goto('/');
    await expect(page.getByTestId('factory-files-error')).toContainText('卡片列表暂时无法读取');
    await expect(page.getByText('这个日期还没有学习卡')).toHaveCount(0);
  });

  test('P3 queue opens only from its status card and closes outside', async ({ page }) => {
    await page.goto('/');
    const queueTrigger = page.getByTestId('react-queue-status');
    await queueTrigger.click();
    const dialog = page.getByRole('dialog', { name: '队列管理' });
    await expect(dialog).toBeVisible();
    await expect(page.getByTestId('react-queue-close')).toBeFocused();
    await expect(page.getByTestId('react-queue-timeline')).toBeVisible();
    const box = await dialog.boundingBox();
    expect(Math.abs((box.x + box.width / 2) - page.viewportSize().width / 2)).toBeLessThan(12);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(queueTrigger).toBeFocused();
    await queueTrigger.click();
    await page.mouse.click(4, 4);
    await expect(dialog).toBeHidden();
    await expect(queueTrigger).toBeFocused();
  });

  test('P3 UI enqueues the selected card type and keeps the workspace responsive', async ({ page, request }) => {
    await page.goto('/');
    await page.getByTestId('react-card-type-scenario_phrase').click();
    await page.getByTestId('react-phrase-input').fill('React 场景入队验证');
    await page.getByTestId('react-generate-button').click();
    await expect(page.getByRole('status').filter({ hasText: '已加入共享任务队列' })).toBeVisible();
    await expect(page.getByTestId('shell-feedback')).toContainText(/生成任务 #\d+ 已加入队列/u);
    await page.getByRole('button', { name: '后台活动' }).click();
    await expect(page.getByRole('dialog', { name: '活动中心' })).toContainText('场景表达生成');
    await page.getByRole('button', { name: '关闭后台活动' }).click();
    await expect.poll(async () => {
      const response = await request.get('/api/generation-jobs?limit=30');
      const jobs = (await response.json()).jobs;
      return jobs.find((job) => job.phraseNormalized === 'React 场景入队验证')?.jobType;
    }).toBe('scenario_phrase');
  });

  test('P3 restores a selected generation job from the Activity deep link', async ({ page, request }) => {
    const phrase = `React activity deep link ${Date.now()}`;
    const created = await request.post('/api/generation-jobs', {
      data: { phrase, card_type: 'trilingual', source_mode: 'input' },
    });
    expect(created.ok()).toBeTruthy();
    const id = (await created.json()).job.id;

    await page.goto(`/?queue=1&job=${id}`);
    const dialog = page.getByRole('dialog', { name: '队列管理' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('option', { name: new RegExp(`#${id}`) })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('react-queue-timeline')).toContainText(`#${id}`);
    await page.getByTestId('react-queue-close').click();
    await expect(page).not.toHaveURL(/queue=1/u);
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

  test('opens an existing duplicate card and resurfaces it today without moving the original', async ({ page, request }) => {
    const phrase = `historical duplicate fixture ${Date.now()}`;
    await enqueueAndWait(request, phrase, 'trilingual', { targetFolder: '20260714' });
    await page.goto('/');
    await page.getByTestId('react-phrase-input').fill(phrase);
    await page.getByTestId('react-generate-button').click();

    const duplicatePanel = page.getByTestId('factory-duplicate-card-panel');
    await expect(duplicatePanel).toContainText('已有相同学习卡');
    await expect(duplicatePanel).toContainText('这不是搜索历史，而是已经成功生成的卡片');
    await expect(duplicatePanel).toContainText('最初生成于 2026-07-14');

    await duplicatePanel.getByRole('button', { name: '打开已有卡' }).click();
    const modal = page.getByTestId('react-card-modal');
    await expect(modal).toBeVisible();
    await expect(page.getByTestId('react-card-content')).toContainText(phrase);
    await expect(modal).toContainText('打开次数');
    await page.getByTestId('react-card-modal-close').click();

    await page.getByTestId('react-generate-button').click();
    await duplicatePanel.getByRole('button', { name: '加入今日' }).click();
    await expect(page.getByText(/已加入今日卡片/u)).toBeVisible();
    await expect(page.getByTestId('react-file-list')).toContainText('今日再次学习');
    await expect(page.getByTestId('react-file-list')).toContainText(phrase);

    const today = await request.get('/api/card-engagement/today');
    expect(today.ok()).toBeTruthy();
    const todayBody = await today.json();
    const resurfaced = todayBody.cards.find((card) => card.phrase === phrase);
    expect(resurfaced).toMatchObject({ folder: '20260714' });
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
    await expect(page.getByTestId('react-queue-timeline')).toContainText('生成失败');
    await page.getByRole('button', { name: '重试失败' }).click();
    await expect(page.getByTestId('shell-feedback')).toContainText(/已重新加入 \d+ 个失败任务/u);
    await expect.poll(async () => {
      const response = await request.get(`/api/generation-jobs/${id}`);
      return (await response.json()).job.status;
    }, { timeout: 30_000 }).toBe('success');
    await expect(page.getByTestId('react-queue-timeline')).toContainText('生成成功');
    await page.getByRole('button', { name: '查看学习卡' }).click();
    await expect(page.getByTestId('react-card-modal')).toBeVisible();
    await expect(page.getByTestId('react-card-content')).toContainText('React retry');
    await page.keyboard.press('Escape');
  });

  test('P4 renders full-height Markdown, pronunciation tokens, audio and generation details', async ({ page }) => {
    await page.goto('/');
    const opener = page.getByTestId('react-file-list').locator('button').filter({ hasText: 'react trilingual fixture' });
    const shadowResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/card-reader/shadow' && response.request().method() === 'GET';
    });
    const canaryResponse = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/card-reader/canary' && response.request().method() === 'GET';
    });
    await opener.click();
    const modal = page.getByTestId('react-card-modal');
    await expect(modal).toBeVisible();
    const shadowPayload = await (await shadowResponse).json();
    expect(shadowPayload.report.parity).toBe(true);
    expect((await (await canaryResponse).json()).canary.rendererVersion).toBe(3);
    await expect(modal.locator('[data-card-renderer-version="3"]')).toHaveCount(1);
    await expect(modal.locator('[data-card-renderer-version="2"]')).toHaveCount(0);
    const modalBox = await modal.locator('.react-card-modal').boundingBox();
    expect(modalBox.height).toBeGreaterThan(page.viewportSize().height - 30);
    await expect(modal.locator('ruby')).toHaveCount(0);
    await expect(modal.locator('.pronunciation-token').first()).toBeVisible();
    expect(await modal.locator('.pronunciation-token').count()).toBeGreaterThan(0);
    await expect(modal.locator('.pronunciation-token[data-pronunciation-status="accepted"]').first()).toBeVisible();
    await expect(modal.locator('.audio-btn')).toHaveCount(4);
    await page.getByRole('tab', { name: '生成信息' }).click();
    await expect(page.getByTestId('react-card-intel')).toContainText('DEEPSEEK');
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('CR-P2 falls back to v2 when an allowlisted Canary request fails', async ({ page }) => {
    await page.route('**/api/card-reader/canary?generationId=*', (route) => route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ code: 'CARD_READER_V3_CANARY_PARITY_FAILED' }),
    }));
    await page.goto('/');
    await page.getByTestId('react-file-list').locator('button').filter({ hasText: 'react trilingual fixture' }).click();
    const modal = page.getByTestId('react-card-modal');
    await expect(modal.locator('[data-card-renderer-version="2"]')).toHaveCount(1);
    await expect(modal.locator('[data-card-renderer-version="3"]')).toHaveCount(0);
  });

  test('creates, colors and restores a manual page tag', async ({ page }) => {
    await page.goto('/');
    const opener = page.getByTestId('react-file-list').locator('button')
      .filter({ hasText: 'react trilingual fixture' });
    await opener.click();
    const modal = page.getByTestId('react-card-modal');
    await modal.getByRole('button', { name: '管理标签' }).click();
    const dialog = page.getByRole('dialog', { name: '标签管理' });
    await dialog.getByRole('button', { name: '新建' }).click();
    await dialog.getByLabel('名称').fill('E2E 重点');
    await dialog.getByLabel('类型').selectOption('priority');
    await dialog.getByRole('button', { name: 'purple' }).click();
    await dialog.getByRole('button', { name: '保存标签' }).click();
    await expect(dialog.getByText('E2E 重点')).toBeVisible();
    await dialog.getByRole('button', { name: '应用到当前页面' }).click();
    await expect(modal.locator('.manual-tag-chip')).toContainText('E2E 重点');

    await page.getByTestId('react-card-modal-close').click();
    await opener.click();
    await expect(page.getByTestId('react-card-modal').locator('.manual-tag-chip'))
      .toContainText('E2E 重点');
  });

  test('reports cold card-modal opening time without sending card content', async ({ page }) => {
    const batches = [];
    await page.route('**/api/ui-performance', async (route) => {
      batches.push(route.request().postDataJSON());
      await route.fulfill({
        status: 202,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, accepted: 1 }),
      });
    });
    await page.goto('/');
    await page.getByTestId('react-file-list').locator('button')
      .filter({ hasText: 'react trilingual fixture' }).click();
    await expect(page.getByTestId('react-card-modal')).toBeVisible();
    await expect.poll(() => batches.flatMap((batch) => batch.metrics || [])
      .find((metric) => metric.name === 'card-modal-open') || null).not.toBeNull();
    const modalMetric = batches.flatMap((batch) => batch.metrics || [])
      .find((metric) => metric.name === 'card-modal-open');
    expect(modalMetric.context).toBe('cold');
    expect(Object.keys(modalMetric).sort()).toEqual(['context', 'name', 'route', 'value']);
    expect(JSON.stringify(batches)).not.toContain('react trilingual fixture');
  });

  test('P4 uses a word-level pronunciation popover and keeps accepted words selectable', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('react-file-list').locator('button').filter({ hasText: '保育园交接' }).click();
    const content = page.getByTestId('react-card-content');
    await expect(content.locator('ruby')).toHaveCount(0);
    const token = content.locator('.pronunciation-token[data-pronunciation-status="accepted"]').first();
    await expect(token).toBeVisible();
    const surface = await token.getAttribute('data-pronunciation-surface');
    expect(surface).toBeTruthy();
    await token.hover();
    await expect(page.getByRole('tooltip', { name: '日语读音' })).toBeVisible();
    await page.reload();
    await page.getByTestId('react-file-list').locator('button').filter({ hasText: '保育园交接' }).click();
    const selectableToken = page.getByTestId('react-card-content').locator('.pronunciation-token[data-pronunciation-status="accepted"]').first();
    await selectableToken.evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      node.closest('[data-testid="react-card-content"]')?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await expect(page.getByTestId('card-selection-preview')).toHaveAttribute('title', surface);
  });

  test('Escape dismisses an open pronunciation overlay before it closes the card', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('react-file-list').locator('button').filter({ hasText: '保育园交接' }).click();
    const modal = page.getByTestId('react-card-modal');
    await expect(modal).toBeVisible();
    const token = page.getByTestId('react-card-content')
      .locator('.pronunciation-token[data-pronunciation-status="accepted"]').first();
    await expect(token).toBeVisible();
    await token.hover();
    const tooltip = page.getByRole('tooltip', { name: '日语读音' });
    await expect(tooltip).toBeVisible();
    // Hovering never moves focus, so the modal's target-based guard cannot see
    // the overlay. Escape must still reach the overlay, not the card.
    await page.keyboard.press('Escape');
    await expect(tooltip).toBeHidden();
    await expect(modal).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
  });

  test('a tab round trip replays one idempotent open event instead of counting a new open', async ({ page }) => {
    const idempotentFlags = [];
    page.on('response', async (response) => {
      if (response.request().method() !== 'POST') return;
      if (!response.url().includes('/api/card-engagement/events')) return;
      try {
        idempotentFlags.push((await response.json()).idempotent);
      } catch {
        // A discarded body is not part of this assertion.
      }
    });
    await page.goto('/');
    await page.getByTestId('react-file-list').locator('button').filter({ hasText: '保育园交接' }).click();
    await expect(page.getByTestId('react-card-modal')).toBeVisible();
    await expect(page.locator('.card-study-meta')).toContainText('打开次数');
    await expect.poll(() => idempotentFlags.length).toBe(1);
    expect(idempotentFlags[0]).toBe(false);
    await page.getByRole('tab', { name: '生成信息' }).click();
    await expect(page.getByTestId('react-card-intel')).toBeVisible();
    await page.getByRole('tab', { name: '学习内容' }).click();
    await expect(page.locator('.card-study-meta')).toContainText('打开次数');
    await expect.poll(() => idempotentFlags.length).toBe(2);
    expect(idempotentFlags[1]).toBe(true);
  });

  test('draws quality dimensions against their own maximum and keeps content length out of the bars', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('react-file-list').locator('button').filter({ hasText: '保育园交接' }).click();
    await page.getByRole('tab', { name: '生成信息' }).click();
    const intel = page.getByTestId('react-card-intel');
    await expect(intel).toBeVisible();
    const bars = intel.locator('.intel-bar');
    await expect(bars).toHaveCount(4);
    await expect(bars.first()).toContainText('完整性');
    await expect(bars.first()).toContainText('40 / 40');
    // The fixture is a perfect 100, so every bar must be full. Raw points read
    // as percentages used to render this same card as 40/30/20/10.
    const fills = await intel.locator('.intel-bar i').evaluateAll(
      (nodes) => nodes.map((node) => node.style.width)
    );
    expect(fills).toEqual(['100%', '100%', '100%', '100%']);
    await expect(intel.locator('.intel-bars')).not.toContainText('contentLength');
  });

  test('the reading toggle layers furigana without changing the card text', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('react-file-list').locator('button').filter({ hasText: '保育园交接' }).click();
    const content = page.getByTestId('react-card-content');
    await expect(content.locator('.pronunciation-token').first()).toBeVisible();
    expect(await content.locator('.pronunciation-token[data-pronunciation-ruby="true"]').count()).toBeGreaterThan(0);

    const toggle = page.getByTestId('card-reading-toggle');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(content).not.toHaveClass(/show-readings/);
    const textBefore = await content.innerText();

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(content).toHaveClass(/show-readings/);
    // The readings are a ::after layer, so the card's own text must be
    // untouched: selection, annotation anchors and read-aloud all read it.
    expect(await content.innerText()).toBe(textBefore);
    const raised = await content.locator('li:has(.pronunciation-token[data-pronunciation-ruby="true"])').first()
      .evaluate((node) => getComputedStyle(node).lineHeight);
    expect(Number.parseFloat(raised)).toBeGreaterThan(40);

    // The preference is per reader, so it survives a reload.
    await page.reload();
    await page.getByTestId('react-file-list').locator('button').filter({ hasText: '保育园交接' }).click();
    await expect(page.getByTestId('card-reading-toggle')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('react-card-content')).toHaveClass(/show-readings/);

    await page.getByTestId('card-reading-toggle').click();
    await expect(page.getByTestId('react-card-content')).not.toHaveClass(/show-readings/);
  });

  test('shows a curated foreign source for loanwords and a dictionary form for inflected verbs', async ({ page }) => {
    await page.route('**/api/pronunciation?*', async (route) => {
      const response = await route.fetch();
      const payload = await response.json();
      payload.tokens = (payload.tokens || []).map((token) => {
        if (token.surface === 'テスト') {
          return {
            ...token,
            evidence: {
              ...(token.evidence || {}),
              foreignOrigin: { language: '英语', term: 'test', source: 'curated' },
            },
          };
        }
        if (token.surface === '使い') {
          return {
            ...token,
            evidence: { ...(token.evidence || {}), basicForm: '使う' },
          };
        }
        return token;
      });
      await route.fulfill({ response, json: payload });
    });

    await page.goto('/');
    await page.getByTestId('react-file-list').locator('button').filter({ hasText: 'react trilingual fixture' }).click();
    const content = page.getByTestId('react-card-content');

    const loanword = content.locator('.pronunciation-token[data-pronunciation-surface="テスト"]').first();
    await loanword.hover();
    const tooltip = page.getByRole('tooltip', { name: '日语读音' });
    await expect(tooltip).toContainText('英语来源');
    await expect(tooltip).toContainText('test');

    const inflectedVerb = content.locator('.pronunciation-token[data-pronunciation-surface="使い"]').first();
    await inflectedVerb.hover();
    await expect(tooltip).toContainText('辞书形');
    await expect(tooltip).toContainText('使う');
  });

  test('shows a retryable JLM adjudication error and clears correction input between popovers', async ({ page }) => {
    await page.route('**/api/pronunciation?*', async (route) => {
      const response = await route.fetch();
      const payload = await response.json();
      let injected = false;
      payload.tokens = (payload.tokens || []).map((token) => {
        if (!injected && token.surface === 'テスト') {
          injected = true;
          return {
            ...token,
            evidence: {
              ...(token.evidence || {}),
              foreignOrigin: {
                language: 'en', term: 'test', source: 'pending', proposalId: 77, confidence: 'medium',
              },
            },
          };
        }
        return token;
      });
      await route.fulfill({ response, json: payload });
    });
    await page.route('**/api/language-metadata/proposals/77/accept', (route) => route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'already decided', code: 'LANGUAGE_METADATA_PROPOSAL_CONFLICT' }),
    }));

    await page.goto('/');
    await page.getByTestId('react-file-list').locator('button').filter({ hasText: 'react trilingual fixture' }).click();
    const token = page.getByTestId('react-card-content')
      .locator('.pronunciation-token[data-pronunciation-surface="テスト"]').first();
    await token.focus();
    await token.press('Enter');
    const dialog = page.getByRole('dialog', { name: '读音详情' });
    await expect(dialog).toBeVisible();
    const originInput = dialog.getByTestId('origin-term-input');
    await originInput.fill('temporary');
    await dialog.getByTestId('origin-accept').click();
    await expect(dialog.getByTestId('origin-error')).toContainText('其它页面处理');

    await originInput.press('Escape');
    await expect(dialog).toBeHidden();
    await token.focus();
    await token.press('Enter');
    await expect(page.getByRole('dialog', { name: '读音详情' }).getByTestId('origin-term-input')).toHaveValue('');
  });

  test('keeps one pronunciation token interactive when an annotation splits it across DOM nodes', async ({ page, request }) => {
    await page.goto('/');
    await page.getByTestId('react-file-list').locator('button').filter({ hasText: '保育园交接' }).click();
    const content = page.getByTestId('react-card-content');
    const acceptedTokens = content.locator('.pronunciation-token[data-pronunciation-status="accepted"]');
    await expect(acceptedTokens.first()).toBeVisible();
    const candidate = await acceptedTokens.evaluateAll((nodes) => nodes.map((node, index) => ({
      index,
      surface: node.getAttribute('data-pronunciation-surface') || '',
      tokenKey: node.getAttribute('data-pronunciation-token-key') || '',
    })).find((item) => Array.from(item.surface).length >= 2));
    expect(candidate).toBeTruthy();
    const token = acceptedTokens.nth(candidate.index);
    await expect(token).toBeVisible();
    await token.evaluate((node) => {
      const text = node.firstChild;
      const firstCharacterLength = Array.from(text.nodeValue || '')[0]?.length || 1;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, firstCharacterLength);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      node.closest('[data-testid="react-card-content"]')?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    const saved = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/annotations'
    ));
    await page.getByRole('button', { name: '标红选区' }).click();
    const savedResponse = await saved;
    expect(savedResponse.status()).toBe(201);
    const savedAnnotation = (await savedResponse.json()).annotation;

    const fragments = content.locator(`.pronunciation-token[data-pronunciation-token-key="${candidate.tokenKey}"]`);
    await expect(fragments).toHaveCount(2);
    await expect(fragments.first()).toHaveAttribute('data-pronunciation-fragment-count', '2');
    await page.evaluate(() => window.getSelection()?.removeAllRanges());
    await fragments.first().dispatchEvent('click');
    await expect(page.getByRole('dialog', { name: '读音详情' })).toHaveCount(0);
    await fragments.last().dispatchEvent('dblclick');
    await expect(page.getByTestId('card-selection-preview')).toHaveAttribute('title', candidate.surface);
    await page.getByRole('button', { name: '查看日语读音详情' }).click();
    await expect(page.getByRole('dialog', { name: '读音详情' })).toContainText(candidate.surface);

    const removed = await request.delete(`/api/annotations/${savedAnnotation.id}`, {
      data: { expectedVersion: savedAnnotation.version },
    });
    expect(removed.ok()).toBeTruthy();
  });

  test('CA-P8 persists and restores a canonical annotation without legacy HTML', async ({ page, request }) => {
    await page.goto('/');
    const opener = page.getByTestId('react-file-list').locator('button').filter({ hasText: 'react trilingual fixture' });
    await opener.click();
    await waitForPronunciationContent(page);
    await page.getByTestId('react-card-content').evaluate((container) => {
      const text = Array.from(container.querySelectorAll('li')).find((node) => node.textContent.includes('E2E'))?.firstChild;
      const range = document.createRange();
      range.selectNodeContents(text);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await expect(page.getByTestId('card-selection-preview')).toHaveAttribute('title', '解释');
    const highlight = page.getByRole('button', { name: '标红选区' });
    await expect(highlight).toBeEnabled();
    const saved = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/annotations'
    ));
    await highlight.click();
    const annotationResponse = await saved;
    expect(annotationResponse.status()).toBe(201);
    const annotationBody = await annotationResponse.json();
    expect(annotationBody.compatibility).toBeUndefined();
    await expect(page.locator('mark.study-highlight-red')).toHaveCount(1);
    const generationId = annotationBody.annotation.targetId;
    const annotations = await request.get(`/api/annotations?targetKind=generation&targetId=${generationId}`);
    expect(annotations.ok()).toBeTruthy();
    expect((await annotations.json()).annotations).toHaveLength(1);
    await page.getByTestId('react-card-modal-close').click();
    await opener.click();
    await expect(page.locator('mark.study-highlight-red')).toHaveCount(1);
  });

  test('CA-I1 supports keyboard selection, multicolor updates, copy, KG lookup and unhighlight', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    let lookupPayload = null;
    await page.route('**/api/kg/lookups', async (route) => {
      lookupPayload = route.request().postDataJSON();
      await route.fulfill({
        json: {
          success: true,
          lookup: {
            id: 81,
            eventKey: lookupPayload.eventKey,
            resolution: 'resolved',
            point: {
              id: 91,
              pointKey: 'kp:en:lexeme:deterministic',
              kind: 'lexeme',
              language: 'en',
              canonicalForm: 'deterministic',
              canonicalReading: '',
              senseDiscriminator: '',
              identityVersion: 'kg-point-v1',
              lifecycle: 'active',
            },
            resolutionCase: null,
            reused: false,
          },
        },
      });
    });

    await page.goto('/');
    await page.getByTestId('react-file-list').locator('button').filter({ hasText: 'react trilingual fixture' }).click();
    await selectVisibleText(page, 'deterministic', { keyboard: true });

    const colorTrigger = page.getByRole('button', { name: '标记选区' });
    await expect(colorTrigger).toBeFocused();
    await colorTrigger.click();
    const created = page.waitForResponse((response) => (
      response.request().method() === 'POST'
      && new URL(response.url()).pathname === '/api/annotations'
    ));
    await page.getByRole('menuitem', { name: '蓝色补充' }).click();
    expect((await created).status()).toBe(201);
    const blueMarker = page.locator('mark.study-highlight-blue').filter({ hasText: 'deterministic' });
    await expect(blueMarker).toHaveCount(1);

    await blueMarker.click();
    await page.getByRole('button', { name: '复制选区' }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('deterministic');

    await page.getByRole('button', { name: '查知识点' }).click();
    const inspector = page.getByTestId('card-knowledge-inspector');
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
    await inspector.getByRole('button', { name: '确认查询' }).click();
    await expect(inspector.getByRole('region', { name: '知识点查询结果' })).toContainText('deterministic');
    expect(lookupPayload).toMatchObject({
      inputText: 'deterministic',
      language: 'en',
      kindHint: 'lexeme',
      timeZone: 'Asia/Tokyo',
      interactionKind: 'explicit_lookup',
      sourceContext: {
        surface: 'card-modal',
        targetKind: 'generation',
        quoteExact: 'deterministic',
      },
    });
    await inspector.getByRole('button', { name: '关闭知识点查询' }).click();

    await blueMarker.dispatchEvent('click');
    const annotationToolbar = page.getByTestId('card-selection-toolbar');
    await expect(annotationToolbar).toBeVisible();
    const annotationToolbarLayout = await annotationToolbar.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return {
        left: bounds.left,
        right: bounds.right,
        viewportWidth: window.innerWidth,
      };
    });
    expect(annotationToolbarLayout.left).toBeGreaterThanOrEqual(7);
    expect(annotationToolbarLayout.right).toBeLessThanOrEqual(annotationToolbarLayout.viewportWidth - 7);
    await page.getByRole('button', { name: '更改标记颜色' }).click();
    const updated = page.waitForResponse((response) => (
      response.request().method() === 'PATCH'
      && /\/api\/annotations\/[^/]+$/u.test(new URL(response.url()).pathname)
    ));
    await page.getByRole('menuitem', { name: '绿色掌握' }).click();
    expect((await updated).status()).toBe(200);
    const greenMarker = page.locator('mark.study-highlight-green').filter({ hasText: 'deterministic' });
    await expect(greenMarker).toHaveCount(1);

    await greenMarker.dispatchEvent('click');
    const removed = page.waitForResponse((response) => (
      response.request().method() === 'DELETE'
      && /\/api\/annotations\/[^/]+$/u.test(new URL(response.url()).pathname)
    ));
    await page.getByRole('button', { name: '取消标记' }).click();
    expect((await removed).status()).toBe(200);
    await expect(greenMarker).toHaveCount(0);
  });

  test('shows a local Chinese gloss for both English and Japanese selections without an automatic LLM call', async ({ page }) => {
    const lookups = [];
    const feedback = [];
    let proposalCalls = 0;
    await page.route('**/api/local-glossary/lookup*', async (route) => {
      const url = new URL(route.request().url());
      const language = url.searchParams.get('language');
      lookups.push({
        language,
        text: url.searchParams.get('text'),
        reading: url.searchParams.get('reading'),
        context: url.searchParams.get('context'),
      });
      await route.fulfill({
        json: {
          success: true,
          lookup: {
            status: 'exact',
            query: { text: url.searchParams.get('text'), language, canonicalForm: url.searchParams.get('text'), normalizedForm: url.searchParams.get('text') },
            gloss: language === 'ja'
              ? { id: null, zhGloss: '日语本地释义', sourceKind: 'current-card', sourceId: 1, confidence: 'high', version: null }
              : { id: 11, zhGloss: '英语错误义项', sourceKind: 'dictionary', sourceId: 11, sourceDetail: 'ECDICT', confidence: 'high', version: null, senseKey: 'noun' },
            alternatives: language === 'en'
              ? [{ id: 12, zhGloss: '英语正确义项', sourceKind: 'dictionary', sourceId: 12, sourceDetail: 'ECDICT', confidence: 'medium', version: null, senseKey: 'adjective' }]
              : [],
          },
        },
      });
    });
    await page.route('**/api/local-glossary/feedback', async (route) => {
      feedback.push(route.request().postDataJSON());
      await route.fulfill({ status: 201, json: { success: true } });
    });
    await page.route('**/api/local-glossary/proposals', async (route) => {
      proposalCalls += 1;
      await route.abort();
    });

    await page.goto('/');
    await page.getByTestId('react-file-list').locator('button').filter({ hasText: 'react trilingual fixture' }).click();
    await selectVisibleText(page, 'deterministic');
    await expect(page.locator('.csa-gloss')).toContainText('英语错误义项');
    await expect(page.locator('.csa-gloss')).toContainText('高可信');
    await page.getByRole('button', { name: '打开释义选项' }).click();
    await page.getByRole('menuitem', { name: '释义不合适' }).click();
    await page.getByRole('button', { name: '打开释义选项' }).click();
    await expect(page.getByRole('menuitem', { name: '自己填写正确释义' })).toBeVisible();
    await page.getByRole('menuitem').filter({ hasText: '英语正确义项' }).click();
    await expect(page.locator('.csa-gloss')).toContainText('英语正确义项');

    await page.getByTestId('react-card-modal-close').click();
    await page.getByTestId('react-file-list').locator('button').filter({ hasText: '保育园交接' }).click();
    const japaneseToken = page.getByTestId('react-card-content').locator('.pronunciation-token[data-pronunciation-status="accepted"]').first();
    await japaneseToken.dispatchEvent('dblclick');
    await expect(page.locator('.csa-gloss')).toContainText('日语本地释义');
    expect(lookups.some((item) => item.language === 'en')).toBeTruthy();
    expect(lookups.some((item) => item.language === 'en' && item.context?.includes('deterministic'))).toBeTruthy();
    expect(lookups.some((item) => item.language === 'ja' && item.reading)).toBeTruthy();
    await expect.poll(() => feedback.filter((item) => item.language === 'en').map((item) => item.outcome)).toEqual([
      'shown',
      'rejected',
      'switched',
    ]);
    expect(feedback.every((item) => !('context' in item) && !('sentence' in item))).toBeTruthy();
    expect(proposalCalls).toBe(0);
  });

  test('uses the Japanese pronunciation projection to classify a kanji-only selection', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('react-file-list').locator('button').filter({ hasText: 'react trilingual fixture' }).click();
    const content = page.getByTestId('react-card-content');
    const tokens = content.locator('.pronunciation-token[data-pronunciation-status="accepted"]');
    await expect(tokens.first()).toBeVisible();
    const kanjiIndex = await tokens.evaluateAll((nodes) => nodes.findIndex((node) => (
      /[\p{Script=Han}々〆ヵヶ]/u.test(node.getAttribute('data-pronunciation-surface') || '')
    )));
    expect(kanjiIndex).toBeGreaterThanOrEqual(0);
    await tokens.nth(kanjiIndex).evaluate((node) => {
      const textNode = Array.from(node.childNodes).find((child) => (
        child.nodeType === Node.TEXT_NODE && /[\p{Script=Han}々〆ヵヶ]/u.test(child.nodeValue || '')
      ));
      if (!textNode) throw new Error('Expected a kanji text fragment inside the pronunciation token');
      const match = /[\p{Script=Han}々〆ヵヶ]/u.exec(textNode.nodeValue || '');
      const range = document.createRange();
      range.setStart(textNode, match.index);
      range.setEnd(textNode, match.index + match[0].length);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      node.closest('[data-testid="react-card-content"]')?.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    await page.getByRole('button', { name: '查知识点' }).click();

    const inspector = page.getByTestId('card-knowledge-inspector');
    await expect(inspector).not.toContainText('汉字选区无法可靠判断');
    await expect(inspector).toContainText('日本語');
    await expect(inspector.getByRole('button', { name: '确认查询' })).toBeEnabled();
  });

  test('P4 previews the selected phrase and enqueues that exact phrase', async ({ page }) => {
    let resolveQueuedRequest;
    const queuedRequest = new Promise((resolve) => { resolveQueuedRequest = resolve; });
    await page.route('**/api/generation-jobs', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      resolveQueuedRequest(route.request().postDataJSON());
      return route.fulfill({ json: { success: true, job: { id: 999, status: 'queued' }, summary: {} } });
    });

    await page.goto('/');
    await page.getByTestId('react-file-list').locator('button').filter({ hasText: 'react trilingual fixture' }).click();
    await waitForPronunciationContent(page);
    await page.getByTestId('react-card-content').evaluate((container) => {
      const text = Array.from(container.querySelectorAll('li')).find((node) => node.textContent.includes('E2E'))?.firstChild;
      const range = document.createRange();
      range.selectNodeContents(text);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    const preview = page.getByTestId('card-selection-preview');
    const selectedPhrase = await preview.getAttribute('title');
    expect(selectedPhrase).toBeTruthy();
    await page.getByRole('button', { name: '生成卡片' }).click();
    await page.getByRole('menuitem', { name: '单词卡' }).click();
    await expect(queuedRequest).resolves.toMatchObject({
      phrase: selectedPhrase,
      card_type: 'trilingual',
      source_mode: 'selection',
    });
  });

  test('right click replaces a stale range with the English word or Japanese pronunciation token under the pointer', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('react-file-list').locator('button').filter({ hasText: 'react trilingual fixture' }).click();
    await waitForPronunciationContent(page);
    const content = page.getByTestId('react-card-content');

    const staleSelectionLength = await content.evaluate((container) => {
      const nodes = [];
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node) {
        nodes.push(node);
        node = walker.nextNode();
      }
      const start = nodes.find((candidate) => candidate.nodeValue?.includes('deterministic'));
      const startBlock = start.parentElement.closest('li, p, h1, h2, h3, h4, blockquote');
      const blocks = Array.from(container.querySelectorAll('li, p, h1, h2, h3, h4, blockquote'));
      const endBlock = blocks.slice(blocks.indexOf(startBlock) + 1).find((candidate) => candidate.textContent?.trim());
      const endWalker = document.createTreeWalker(endBlock, NodeFilter.SHOW_TEXT);
      const end = endWalker.nextNode();
      const range = document.createRange();
      range.setStart(start, start.nodeValue.indexOf('deterministic'));
      range.setEnd(end, Math.min(5, end.nodeValue.length));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const selectedLength = Array.from(selection.toString()).length;
      container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      return selectedLength;
    });
    expect(staleSelectionLength).toBeLessThan(200);
    await expect.poll(() => content.evaluate(() => window.getSelection()?.toString() || '')).toBe('');
    await expect(page.locator('.card-selection-toolbar')).toHaveCount(0);

    const englishPoint = await content.evaluate((container) => {
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();
      while (node && !node.nodeValue?.includes('deterministic')) node = walker.nextNode();
      const start = node.nodeValue.indexOf('deterministic');
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + 'deterministic'.length);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await page.mouse.click(englishPoint.x, englishPoint.y, { button: 'right' });
    await expect(page.getByTestId('card-selection-preview')).toHaveAttribute('title', 'deterministic');
    await expect(page.locator('.csa-context-menu')).toBeVisible();
    await page.keyboard.press('Escape');

    const japaneseTokens = content.locator('.pronunciation-token[data-pronunciation-status="accepted"]');
    const japaneseIndex = await japaneseTokens.evaluateAll((nodes) => nodes.findIndex((node) => (
      /[\p{Script=Han}々〆ヵヶ]/u.test(node.getAttribute('data-pronunciation-surface') || '')
    )));
    expect(japaneseIndex).toBeGreaterThanOrEqual(0);
    const japaneseToken = japaneseTokens.nth(japaneseIndex);
    const surface = await japaneseToken.getAttribute('data-pronunciation-surface');
    await japaneseToken.click({ button: 'right' });
    await expect(page.getByTestId('card-selection-preview')).toHaveAttribute('title', surface);
    await expect(page.locator('.csa-context-menu')).toBeVisible();
  });

  test('CA-P1 keeps selection actions keyboard-accessible and restores focus after closing a menu', async ({ page }) => {
    let resolveQueuedRequest;
    const queuedRequest = new Promise((resolve) => { resolveQueuedRequest = resolve; });
    await page.route('**/api/generation-jobs', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      resolveQueuedRequest(route.request().postDataJSON());
      return route.fulfill({ json: { success: true, job: { id: 1000, status: 'queued' }, summary: {} } });
    });

    await page.goto('/');
    await page.getByTestId('react-file-list').locator('button').filter({ hasText: 'react trilingual fixture' }).click();
    await waitForPronunciationContent(page);
    const content = page.getByTestId('react-card-content');

    await content.evaluate((container) => {
      const text = Array.from(container.querySelectorAll('li')).find((node) => node.textContent.includes('E2E'))?.firstChild;
      const range = document.createRange();
      range.selectNodeContents(text);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    const preview = page.getByTestId('card-selection-preview');
    const selectedPhrase = await preview.getAttribute('title');
    const generateTrigger = page.locator('.card-selection-toolbar .csa-generate');
    await generateTrigger.focus();
    await page.keyboard.press('Enter');
    const dropdown = page.getByRole('menu');
    await expect(dropdown).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator(':focus')).toHaveAttribute('role', 'menuitem');
    await page.keyboard.press('Escape');
    await expect(generateTrigger).toBeFocused();
    await page.keyboard.press('Enter');
    await page.getByRole('menuitem', { name: '单词卡' }).click();
    await expect(queuedRequest).resolves.toMatchObject({
      phrase: selectedPhrase,
      card_type: 'trilingual',
      source_mode: 'selection',
    });
  });

  test('P4 keeps the selection toolbar inside the desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.route('**/api/local-glossary/lookup*', async (route) => {
      const url = new URL(route.request().url());
      await route.fulfill({
        json: {
          success: true,
          lookup: {
            status: 'exact',
            query: {
              text: url.searchParams.get('text'),
              language: url.searchParams.get('language'),
              canonicalForm: url.searchParams.get('text'),
              normalizedForm: url.searchParams.get('text'),
            },
            gloss: {
              id: 21,
              zhGloss: '用于验证较长中文释义不会和标记、朗读、知识点查询以及生成卡片操作发生重叠',
              sourceKind: 'dictionary',
              sourceId: 21,
              sourceDetail: 'ECDICT local dictionary',
              confidence: 'medium',
              version: null,
              senseKey: 'layout-regression',
            },
            alternatives: [{
              id: 22,
              zhGloss: '备用释义',
              sourceKind: 'dictionary',
              sourceId: 22,
              sourceDetail: 'ECDICT',
              confidence: 'low',
              version: null,
              senseKey: 'layout-alternative',
            }],
          },
        },
      });
    });
    await page.goto('/');
    await page.getByTestId('react-file-list').locator('button').filter({ hasText: 'react trilingual fixture' }).click();
    await waitForPronunciationContent(page);
    await selectVisibleText(page, 'react');
    await expect(page.locator('.csa-gloss')).toContainText('用于验证较长中文释义');

    const layout = await page.locator('.card-selection-toolbar').evaluate((toolbar) => {
      const rect = (selector) => toolbar.querySelector(selector).getBoundingClientRect();
      const element = (selector) => toolbar.querySelector(selector);
      const toolbarRect = toolbar.getBoundingClientRect();
      const contextRect = rect('[data-testid="card-selection-context-row"]');
      const actionRect = rect('[data-testid="card-selection-action-row"]');
      const previewRect = rect('[data-testid="card-selection-preview"]');
      const glossRect = rect('.csa-gloss-slot');
      const actionElement = element('[data-testid="card-selection-action-row"]');
      const glossElement = element('.csa-gloss-slot');
      const gloss = element('.csa-gloss');
      const visibleGlossChildren = Array.from(gloss?.children || [])
        .map((child) => child.getBoundingClientRect())
        .filter((child) => child.width > 0 && child.height > 0);
      const glossChildrenOverlap = visibleGlossChildren.some((current, index) => (
        visibleGlossChildren.slice(index + 1).some((next) => (
          current.left < next.right
          && current.right > next.left
          && current.top < next.bottom
          && current.bottom > next.top
        ))
      ));
      return {
        toolbar: { left: toolbarRect.left, right: toolbarRect.right },
        context: { right: contextRect.right, bottom: contextRect.bottom },
        action: { top: actionRect.top, scrollWidth: actionElement.scrollWidth, clientWidth: actionElement.clientWidth },
        previewRight: previewRect.right,
        gloss: { left: glossRect.left, right: glossRect.right, scrollWidth: glossElement.scrollWidth, clientWidth: glossElement.clientWidth },
        glossChildrenOverlap,
      };
    });
    expect(layout.toolbar.left).toBeGreaterThanOrEqual(8);
    expect(layout.toolbar.right).toBeLessThanOrEqual(1272);
    expect(layout.context.bottom).toBeLessThanOrEqual(layout.action.top + 1);
    expect(layout.previewRight).toBeLessThanOrEqual(layout.gloss.left + 1);
    expect(layout.gloss.right).toBeLessThanOrEqual(layout.context.right + 1);
    expect(layout.gloss.scrollWidth).toBeLessThanOrEqual(layout.gloss.clientWidth);
    expect(layout.glossChildrenOverlap).toBe(false);
    expect(layout.action.scrollWidth).toBeLessThanOrEqual(layout.action.clientWidth);
  });

  test('P4 sizes the selection toolbar to its content and keeps it over the selection', async ({ page }) => {
    // A fixed-width bar spanned the column regardless of the selection, so the
    // viewport clamp pinned it to the left edge and it covered unrelated lines.
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.route('**/api/local-glossary/lookup*', async (route) => {
      const url = new URL(route.request().url());
      await route.fulfill({
        json: {
          success: true,
          lookup: {
            status: 'exact',
            query: {
              text: url.searchParams.get('text'),
              language: url.searchParams.get('language'),
              canonicalForm: url.searchParams.get('text'),
              normalizedForm: url.searchParams.get('text'),
            },
            gloss: {
              id: 31,
              zhGloss: '短释义',
              sourceKind: 'dictionary',
              sourceId: 31,
              sourceDetail: 'ECDICT',
              confidence: 'medium',
              version: null,
              senseKey: 'width-regression',
            },
            alternatives: [],
          },
        },
      });
    });
    await page.goto('/');
    await page.getByTestId('react-file-list').locator('button').filter({ hasText: 'react trilingual fixture' }).click();
    await waitForPronunciationContent(page);
    await selectVisibleText(page, 'react');
    await expect(page.locator('.csa-gloss')).toContainText('短释义');

    const geometry = await page.locator('.card-selection-toolbar').evaluate((toolbar) => {
      const bar = toolbar.getBoundingClientRect();
      const selection = window.getSelection().getRangeAt(0).getBoundingClientRect();
      return {
        barWidth: bar.width,
        barCentre: bar.left + (bar.width / 2),
        selectionCentre: selection.left + (selection.width / 2),
        viewportWidth: window.innerWidth,
      };
    });
    // Content-driven: a short gloss must not produce a bar that spans the column.
    expect(geometry.barWidth).toBeLessThan(geometry.viewportWidth * 0.6);
    // The bar tracks the selection, subject to the viewport clamp: a selection
    // near an edge may legitimately shift it inward, but no further than the
    // clamp requires. A fixed-width bar failed this because the clamp dominated.
    const halfWidth = geometry.barWidth / 2;
    const expectedCentre = Math.min(
      Math.max(geometry.selectionCentre, 8 + halfWidth),
      geometry.viewportWidth - 8 - halfWidth
    );
    expect(Math.abs(geometry.barCentre - expectedCentre)).toBeLessThan(2);
  });

  test('ST-P2 reads an English selection with speed control and exclusive playback', async ({ page }) => {
    await page.addInitScript(() => {
      window.__selectionAudio = { created: 0, paused: 0, played: 0 };
      class FakeAudio extends EventTarget {
        constructor(src) {
          super();
          this.src = src;
          this.paused = true;
          window.__selectionAudio.created += 1;
        }
        play() {
          this.paused = false;
          window.__selectionAudio.played += 1;
          return Promise.resolve();
        }
        pause() {
          if (!this.paused) window.__selectionAudio.paused += 1;
          this.paused = true;
        }
        removeAttribute() {}
        load() {}
      }
      window.Audio = FakeAudio;
      URL.createObjectURL = () => `blob:selection-${Date.now()}`;
      URL.revokeObjectURL = () => {};
    });
    const requests = [];
    await page.route('**/api/tts/selection', async (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ json: { success: true, enabled: true, languages: ['en', 'ja'], speeds: [0.8, 1, 1.2], maxChars: 300 } });
      }
      requests.push(route.request().postDataJSON());
      return route.fulfill({
        status: 200,
        body: Buffer.from('fixture-audio'),
        headers: {
          'content-type': 'audio/mpeg',
          'x-tts-cache': requests.length > 1 ? 'HIT' : 'MISS',
          'x-tts-provider': 'fixture',
          'x-tts-model': 'fixture-model',
          'x-tts-voice': 'fixture-voice',
          'x-tts-contended': '0',
        },
      });
    });

    await page.goto('/');
    await page.getByTestId('react-file-list').locator('button').filter({ hasText: 'react trilingual fixture' }).click();
    await selectVisibleText(page, 'E2E');
    await page.getByRole('button', { name: '朗读选区' }).click();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]).toMatchObject({ text: 'E2E', language: 'en', speed: 1 });
    await expect(page.getByRole('button', { name: '停止朗读' })).toBeVisible();
    await page.getByRole('button', { name: '停止朗读' }).click();
    await page.getByLabel('朗读速度').selectOption('0.8');
    await page.getByRole('button', { name: '朗读选区' }).click();
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[1]).toMatchObject({ speed: 0.8 });
    await expect.poll(() => page.evaluate(() => window.__selectionAudio.played)).toBe(2);
    expect(await page.evaluate(() => window.__selectionAudio)).toMatchObject({
      created: 2,
      played: 2,
      paused: 1,
    });
  });

  test('ST-P2 reuses the Japanese projection language and aborts stale selection work', async ({ page }) => {
    let requestCount = 0;
    const requests = [];
    await page.route('**/api/tts/selection', async (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ json: { success: true, enabled: true, languages: ['en', 'ja'], speeds: [0.8, 1, 1.2], maxChars: 300 } });
      }
      requestCount += 1;
      requests.push(route.request().postDataJSON());
      await new Promise((resolve) => setTimeout(resolve, requestCount === 1 ? 500 : 0));
      return route.fulfill({
        status: 200,
        body: Buffer.from('fixture-wav'),
        headers: {
          'content-type': 'audio/wav',
          'x-tts-cache': 'MISS',
          'x-tts-provider': 'voicevox',
          'x-tts-model': 'voicevox',
          'x-tts-voice': 'speaker:2',
        },
      }).catch(() => {});
    });
    await page.addInitScript(() => {
      class FakeAudio extends EventTarget {
        constructor(src) { super(); this.src = src; this.paused = true; }
        play() { this.paused = false; return Promise.resolve(); }
        pause() { this.paused = true; }
        removeAttribute() {}
        load() {}
      }
      window.Audio = FakeAudio;
      URL.createObjectURL = () => `blob:selection-${Date.now()}`;
      URL.revokeObjectURL = () => {};
    });

    await page.goto('/');
    await page.getByTestId('react-file-list').locator('button').filter({ hasText: '保育园交接' }).click();
    await selectVisibleText(page, '昨夜', { keyboard: true });
    await page.getByRole('button', { name: '朗读选区' }).click();
    await expect.poll(() => requestCount).toBe(1);
    expect(requests[0]).toMatchObject({ text: '昨夜', language: 'ja' });
    await expect(page.getByRole('dialog', { name: '选择朗读语言' })).toHaveCount(0);
    await selectVisibleText(page, 'そうです');
    await expect(page.getByTestId('card-selection-preview')).toHaveAttribute('title', 'そうです');
    await page.getByRole('button', { name: '朗读选区' }).click();
    await expect.poll(() => requestCount).toBe(2);
  });

  test('ST-P2 hides selection read-aloud when the server flag is disabled', async ({ page }) => {
    await page.route('**/api/tts/selection', (route) => route.fulfill({
      json: { success: true, enabled: false, languages: ['en', 'ja'], speeds: [0.8, 1, 1.2], maxChars: 300 },
    }));
    await page.goto('/');
    await page.getByTestId('react-file-list').locator('button').filter({ hasText: 'react trilingual fixture' }).click();
    await selectVisibleText(page, 'E2E');
    await expect(page.getByRole('button', { name: '朗读选区' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '复制选区' })).toBeVisible();
  });

  test('ST-P2 reads kana directly, retries a provider failure and restores focus after Escape', async ({ page }) => {
    let postCount = 0;
    await page.route('**/api/tts/selection', async (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ json: { success: true, enabled: true, languages: ['en', 'ja'], speeds: [0.8, 1, 1.2], maxChars: 300 } });
      }
      postCount += 1;
      if (postCount === 1) {
        return route.fulfill({
          status: 502,
          json: { error: 'provider unavailable', code: 'SELECTION_TTS_PROVIDER_FAILED' },
        });
      }
      return route.fulfill({
        status: 200,
        body: Buffer.from('fixture-wav'),
        headers: {
          'content-type': 'audio/wav',
          'x-tts-cache': 'MISS',
          'x-tts-provider': 'voicevox',
          'x-tts-model': 'voicevox',
          'x-tts-voice': 'speaker:2',
        },
      });
    });
    await page.addInitScript(() => {
      class FakeAudio extends EventTarget {
        constructor(src) { super(); this.src = src; this.paused = true; }
        play() { this.paused = false; return Promise.resolve(); }
        pause() { this.paused = true; }
        removeAttribute() {}
        load() {}
      }
      window.Audio = FakeAudio;
      URL.createObjectURL = () => `blob:selection-${Date.now()}`;
      URL.revokeObjectURL = () => {};
    });

    await page.goto('/');
    await page.getByTestId('react-file-list').locator('button').filter({ hasText: '保育园交接' }).click();
    await selectVisibleText(page, 'そうです');
    await page.getByRole('button', { name: '朗读选区' }).click();
    await expect(page.getByRole('dialog', { name: '选择朗读语言' })).toHaveCount(0);
    await expect(page.locator('.csa-tts-status')).toHaveText('发音生成失败，请重试');
    const retry = page.getByRole('button', { name: '重试朗读选区' });
    await expect(retry).toBeFocused();
    await retry.click();
    await expect(page.getByRole('button', { name: '停止朗读' })).toBeVisible();
    expect(postCount).toBe(2);

    await page.getByTestId('react-card-content').evaluate((container) => {
      const unclassified = document.createElement('span');
      unclassified.textContent = '纯汉字';
      unclassified.dataset.testid = 'unclassified-kanji-selection';
      container.append(unclassified);
      const range = document.createRange();
      range.selectNodeContents(unclassified);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      container.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    const readButton = page.getByRole('button', { name: '朗读选区' });
    await readButton.click();
    const confirmation = page.getByRole('dialog', { name: '选择朗读语言' });
    await expect(confirmation).toBeVisible();
    await expect(confirmation.getByRole('button', { name: 'English' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(confirmation).toHaveCount(0);
    await expect(readButton).toBeFocused();
  });

  test('P4 sanitizer blocks script, style and event attributes while preserving readable Japanese text', async ({ page }) => {
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
    await expect(content.locator('ruby')).toHaveCount(0);
    await expect(content).toContainText('漢字');
    await expect(content.locator('script, style')).toHaveCount(0);
    await expect(content.locator('img')).not.toHaveAttribute('onerror');
    expect(await page.evaluate(() => Boolean(window.__pwned || window.__imgPwned))).toBeFalsy();
  });

  test('P3/P4 stay inside supported desktop viewports and modal remains full-height', async ({ page }) => {
    for (const viewport of [{ width: 1440, height: 1100 }, { width: 1280, height: 720 }]) {
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
