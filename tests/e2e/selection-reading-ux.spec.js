const { test, expect } = require('@playwright/test');
const { resetServerState } = require('./fixtures/resetServerState');
const { enqueueAndWait, selectVisibleText } = require('./fixtures/cardSelection');

const title = 'selection UX fixture';
const toolbar = (page) => page.getByTestId('card-selection-toolbar');
const details = (page) => page.getByRole('region', { name: '释义详情' });
const preview = (page) => page.getByTestId('card-selection-preview');
const correction = (page) => page.getByRole('button', { name: '纠正释义', exact: true });

async function openSelection(page, text = 'deterministic') {
  await page.goto('/');
  await page.getByTestId('react-file-list').locator('button').filter({ hasText: title }).click();
  await selectVisibleText(page, text);
  await expect(toolbar(page)).toBeVisible();
}
async function expand(page) {
  await page.getByRole('button', { name: '打开释义选项' }).click();
  await expect(details(page)).toBeVisible();
}
async function capabilities(page, enabled) {
  await page.route('**/api/local-glossary/capabilities', (route) => route.fulfill({ json: { success: true, contextExplanation: enabled } }));
}
async function mockGloss(page, { long = false, missing = false } = {}) {
  await page.route('**/api/local-glossary/lookup*', (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({ json: { success: true, lookup: {
      status: missing ? 'missing' : 'candidate', query: { text: url.searchParams.get('text'), language: url.searchParams.get('language') },
      gloss: missing ? null : { id: null, zhGloss: long ? '需要结合上下文进一步确认的较长中文解释'.repeat(6) : '使用者', sourceKind: 'dictionary', sourceDetail: 'JMdict · 英中桥接', confidence: 'low', partOfSpeech: 'n', senseKey: 'primary' },
      alternatives: missing ? [] : [{ id: null, zhGloss: '用户', sourceKind: 'dictionary', sourceDetail: '精选本地词典', confidence: 'medium', senseKey: 'alternative' }],
    } } });
  });
}
async function note(page) {
  await page.getByRole('button', { name: '更多学习操作' }).click();
  await page.getByRole('menuitem', { name: '记笔记', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '阅读笔记' })).toBeFocused();
}

// Independent fixtures prevent a failed UX case from skipping the remaining matrix.
test.beforeEach(async ({ request, page }) => {
  await resetServerState(request);
  await enqueueAndWait(request, title, 'trilingual');
  page.on('pageerror', (error) => { throw error; });
});

test('UX01 compact summary, low confidence, candidate choice and disclosure', async ({ page }) => {
  await mockGloss(page);
  await capabilities(page, true);
  let calls = 0;
  await page.route('**/api/local-glossary/explain', (route) => { calls++; return route.abort(); });
  await openSelection(page);
  await expect(toolbar(page)).toContainText('待确认');
  await expect(details(page)).toHaveCount(0);
  await expect(toolbar(page)).not.toContainText('JMdict');
  await toolbar(page).screenshot({ path: 'output/playwright/ux01-compact.png' });
  await expand(page);
  await expect(details(page)).toContainText('经英文桥接');
  await expect(details(page)).toContainText('JMdict');
  await page.getByRole('radio', { name: '用户', exact: true }).check();
  await expect(page.locator('.csa-gloss')).toContainText('用户');
  await expect(page.locator('.csa-gloss')).toContainText('需核对');
  await page.getByRole('button', { name: '收起释义详情' }).click();
  await expect(page.getByRole('button', { name: '打开释义选项' })).toBeFocused();
  await expand(page);
  await expect(page.getByRole('radio', { name: '用户', exact: true })).toBeChecked();
  expect(calls).toBe(0);
});

test('UX02 create and update a reusable glossary correction, cancel and blank validation', async ({ page }) => {
  await openSelection(page);
  await expand(page);
  await correction(page).click();
  const input = page.getByRole('textbox', { name: '中文释义' });
  await input.fill('   ');
  await expect(page.getByRole('button', { name: '保存中文释义' })).toBeDisabled();
  await input.fill('不应保存');
  await details(page).getByRole('button', { name: '取消', exact: true }).click();
  await expect(input).toHaveCount(0);
  await correction(page).click();
  await input.fill('可确定的');
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/local-glossary/entries') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '保存中文释义' }).click();
  expect((await saved).status()).toBe(201);
  await expect(page.locator('.csa-gloss')).toContainText('可确定的');
  await page.reload();
  await page.getByTestId('react-file-list').locator('button').filter({ hasText: title }).click();
  await selectVisibleText(page, 'deterministic');
  await expect(page.locator('.csa-gloss')).toContainText('可确定的');
  await expand(page);
  await correction(page).click();
  await input.fill('确定性的');
  const updated = page.waitForResponse((r) => r.url().includes('/api/local-glossary/entries/') && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: '保存中文释义' }).click();
  expect((await updated).status()).toBe(200);
  await expect(page.locator('.csa-gloss')).toContainText('确定性的');
});

test('UX03 glossary save failure preserves draft and supports retry', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/local-glossary/entries', (route) => {
    if (route.request().method() === 'POST' && ++attempts === 1) return route.fulfill({ status: 503, json: { error: 'fixture unavailable' } });
    return route.continue();
  });
  await openSelection(page); await expand(page); await correction(page).click();
  await page.getByRole('textbox', { name: '中文释义' }).fill('确定的');
  await page.getByRole('button', { name: '保存中文释义' }).click();
  await expect(page.locator('.card-selection-toast')).toContainText('保存失败');
  await expect(page.getByRole('textbox', { name: '中文释义' })).toHaveValue('确定的');
  await page.getByRole('button', { name: '保存中文释义' }).click();
  await expect(page.locator('.csa-gloss')).toContainText('确定的');
  expect(attempts).toBe(2);
});

test('UX04 AI disabled and lookup unavailable states retain other actions', async ({ page }) => {
  await capabilities(page, false);
  await page.route('**/api/local-glossary/lookup*', (route) => route.fulfill({ status: 503, json: { error: 'offline' } }));
  await openSelection(page); await expand(page);
  await expect(page.locator('.csa-gloss')).toContainText('暂不可用');
  await expect(page.getByRole('button', { name: '解释此处用法' })).toBeDisabled();
  await expect(details(page)).toContainText('AI 解释暂未启用');
  await expect(page.getByRole('button', { name: '复制选区' })).toBeEnabled();
  await expect(correction(page)).toBeEnabled();
});

test('UX05 AI loading prevents duplicate calls, error retry succeeds and collapse preserves result', async ({ page }) => {
  await capabilities(page, true);
  let calls = 0;
  let release;
  const barrier = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/local-glossary/explain', async (route) => {
    calls++;
    if (calls === 1) { await barrier; return route.fulfill({ status: 502, json: { error: 'fixture failure' } }); }
    return route.fulfill({ json: { success: true, explanation: '此处强调结果是确定的。', model: 'fixture' } });
  });
  await openSelection(page); await expand(page);
  expect(calls).toBe(0);
  await page.getByRole('button', { name: '解释此处用法' }).click();
  await expect(page.getByRole('button', { name: '正在解释…' })).toBeDisabled();
  await expect.poll(() => calls).toBe(1);
  release();
  await expect(details(page).getByRole('alert')).toContainText('请重试');
  await page.getByRole('button', { name: '解释此处用法' }).click();
  await expect(page.locator('.csa-context-answer')).toContainText('此处强调');
  await expect(details(page).getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: '收起释义详情' }).click(); await expand(page);
  await expect(page.locator('.csa-context-answer')).toContainText('此处强调');
  expect(calls).toBe(2);
});

test('UX06 AI glossary proposal requires explicit acceptance and supports rejection', async ({ page }) => {
  await capabilities(page, true); await mockGloss(page, { missing: true });
  const decisions = [];
  await page.route('**/api/local-glossary/proposals', (route) => route.fulfill({ status: 201, json: { success: true, proposal: { id: 9901, zhGloss: '候选释义', explanation: '候选解释', status: 'pending' } } }));
  await page.route('**/api/local-glossary/proposals/9901/*', (route) => {
    decisions.push(route.request().url().split('/').pop());
    return route.fulfill({ json: { success: true } });
  });
  await openSelection(page); await expand(page);
  await page.getByRole('button', { name: 'AI 释义候选' }).click();
  await expect(page.getByRole('textbox', { name: '中文释义' })).toHaveValue('候选释义');
  expect(decisions).toEqual([]);
  await details(page).getByRole('button', { name: '取消', exact: true }).click();
  await expect.poll(() => decisions).toEqual(['reject']);
  await page.getByRole('button', { name: 'AI 释义候选' }).click();
  await page.getByRole('textbox', { name: '中文释义' }).fill('人工修订释义');
  await page.getByRole('button', { name: '保存中文释义' }).click();
  await expect.poll(() => decisions).toEqual(['reject', 'accept']);
});

test('UX07 notes cancel, blank validation, save, reload, edit and delete', async ({ page }) => {
  await openSelection(page); await note(page);
  await expect(page.getByRole('button', { name: '保存笔记' })).toBeDisabled();
  await page.getByRole('textbox', { name: '阅读笔记' }).fill('临时内容');
  await page.locator('.csa-note-editor').getByRole('button', { name: '取消' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '阅读笔记' })).toHaveCount(0);
  await note(page);
  await expect(page.getByRole('textbox', { name: '阅读笔记' })).toHaveValue('');
  await page.getByRole('textbox', { name: '阅读笔记' }).fill('确定性测试笔记');
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/annotations') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '保存笔记' }).click();
  const { annotation } = await (await saved).json();
  await page.reload();
  await page.getByTestId('react-file-list').locator('button').filter({ hasText: title }).click();
  const mark = page.getByTestId('react-card-content').locator('[data-annotation-id="' + annotation.id + '"]').first();
  await mark.click();
  await expect(page.getByRole('textbox', { name: '阅读笔记' })).toHaveValue('确定性测试笔记');
  await page.getByRole('textbox', { name: '阅读笔记' }).fill('更新后的笔记');
  const updated = page.waitForResponse((r) => r.url().includes('/api/annotations/') && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: '保存笔记' }).click();
  expect((await updated).status()).toBe(200);
  await mark.click();
  await expect(page.getByRole('textbox', { name: '阅读笔记' })).toHaveValue('更新后的笔记');
  await page.getByRole('button', { name: '取消标记' }).click();
  await expect(mark).toHaveCount(0);
});

test('UX08 note failure preserves text and enables retry', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/annotations', (route) => {
    if (route.request().method() === 'POST' && ++attempts === 1) return route.fulfill({ status: 409, json: { error: 'conflict' } });
    return route.continue();
  });
  await openSelection(page); await note(page);
  await page.getByRole('textbox', { name: '阅读笔记' }).fill('应保留的草稿');
  await page.getByRole('button', { name: '保存笔记' }).click();
  await expect(page.locator('.card-selection-toast')).toContainText('保存失败');
  await expect(page.getByRole('textbox', { name: '阅读笔记' })).toHaveValue('应保留的草稿');
  await expect(page.getByRole('button', { name: '保存笔记' })).toBeEnabled();
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/annotations') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '保存笔记' }).click();
  expect((await saved).status()).toBe(201);
  expect(attempts).toBe(2);
});

test('UX12 Japanese ruby scopes preserve clean text in clipboard and every card generation payload', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const payloads = [];
  await page.route('**/api/generation-jobs', (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    payloads.push(route.request().postDataJSON());
    return route.fulfill({ status: 202, json: { job: { id: 99001, status: 'queued' } } });
  });
  await openSelection(page, '安定');
  for (const scope of ['词', '短语', '整句', '原选']) {
    await page.getByRole('button', { name: scope, exact: true }).click();
    await expect(preview(page)).toContainText('安定');
    expect(await preview(page).getAttribute('title')).not.toMatch(/あんてい|▶/);
  }
  await expect(preview(page)).toHaveAttribute('title', '安定');
  for (const [label, cardType] of [['三语卡', 'trilingual'], ['语法卡', 'grammar_ja'], ['场景卡', 'scenario_phrase']]) {
    if (payloads.length) await selectVisibleText(page, '安定');
    await page.getByRole('button', { name: '整句', exact: true }).click();
    await expect(preview(page)).not.toHaveAttribute('title', '安定');
    const text = await preview(page).getAttribute('title');
    expect(text.length).toBeGreaterThan(2);
    await page.getByRole('button', { name: '复制选区' }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);
    await page.getByRole('button', { name: '生成卡片', exact: true }).click();
    await page.getByRole('menuitem', { name: label, exact: true }).click();
    await expect(toolbar(page)).toHaveCount(0);
    expect(payloads.at(-1)).toMatchObject({ phrase: text, card_type: cardType, source_mode: 'selection' });
  }
  expect(payloads).toHaveLength(3);
});

test('UX14 original selection survives replacement of the rendered card DOM', async ({ page }) => {
  await openSelection(page, '安定');
  await page.getByTestId('react-card-content').evaluate((el) => { el.innerHTML = el.innerHTML; });
  await page.getByRole('button', { name: '整句', exact: true }).click();
  await expect(preview(page)).not.toHaveAttribute('title', '安定');
  await expect(preview(page)).toContainText('安定');
  await page.getByRole('button', { name: '原选', exact: true }).click();
  await expect(preview(page)).toHaveAttribute('title', '安定');
});

test('UX13 all playback speeds, stop and replay use the captured selection', async ({ page }) => {
  await page.addInitScript(() => {
    class FakeAudio extends EventTarget {
      constructor(src) { super(); this.src = src; this.paused = true; }
      play() { this.paused = false; return Promise.resolve(); }
      pause() { this.paused = true; }
      removeAttribute() {}
      load() {}
    }
    window.Audio = FakeAudio;
    URL.createObjectURL = () => 'blob:fixture-audio';
    URL.revokeObjectURL = () => {};
  });
  const requests = [];
  await page.route('**/api/tts/selection', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { success: true, enabled: true, languages: ['en', 'ja'], speeds: [0.8, 1, 1.2], maxChars: 300 } });
    requests.push(route.request().postDataJSON());
    return route.fulfill({ body: Buffer.from('fixture-audio'), contentType: 'audio/mpeg' });
  });
  await openSelection(page);
  for (const speed of [0.8, 1, 1.2]) {
    await page.getByLabel('朗读速度').selectOption(String(speed));
    await page.getByRole('button', { name: '朗读选区', exact: true }).click();
    await expect(page.getByRole('button', { name: '停止朗读' })).toBeVisible();
    await expect(page.getByLabel('朗读速度')).toBeDisabled();
    expect(requests.at(-1)).toMatchObject({ text: 'deterministic', language: 'en', speed });
    await page.getByRole('button', { name: '停止朗读' }).click();
    await expect(page.getByRole('button', { name: '重播选区' })).toBeVisible();
  }
  await page.getByRole('button', { name: '重播选区' }).click();
  await expect(page.getByRole('button', { name: '停止朗读' })).toBeVisible();
  expect(requests).toHaveLength(4);
});

test('UX09 Escape restores focus through correction, details and toolbar layers', async ({ page }) => {
  await openSelection(page); await expand(page); await correction(page).click();
  await page.keyboard.press('Escape');
  await expect(correction(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(details(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '打开释义选项' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(toolbar(page)).toHaveCount(0);
  await expect(page.getByTestId('react-card-modal')).toBeVisible();
});

test('UX10 note cancel restores focus and arrow keys keep textarea caret editing', async ({ page }) => {
  await openSelection(page); await note(page);
  const input = page.getByRole('textbox', { name: '阅读笔记' });
  await input.fill('笔记内容');
  await input.press('Home'); await input.press('ArrowRight');
  await expect(input).toBeFocused();
  expect(await input.evaluate((el) => el.selectionStart)).toBe(1);
  await input.press('Escape');
  await expect(page.getByRole('alertdialog', { name: '笔记尚未保存' })).toBeVisible();
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
  await expect(page.getByRole('button', { name: '更多学习操作' })).toBeFocused();
});

for (const theme of ['light', 'dark']) {
  for (const viewport of [{ width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
    test('UX11 layout ' + theme + ' ' + viewport.width + ': long gloss, details and note remain within viewport', async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: theme, reducedMotion: 'reduce' });
      await mockGloss(page, { long: true });
      await openSelection(page); await expand(page);
      await details(page).getByRole('button', { name: '记笔记' }).click();
      await page.getByRole('textbox', { name: '阅读笔记' }).fill('较长笔记测试。'.repeat(50));
      const box = await toolbar(page).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(7); expect(box.y).toBeGreaterThanOrEqual(7);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width - 7);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height - 7);
      expect(await toolbar(page).evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
      const noteBox = await page.locator('.card-note-panel').boundingBox();
      expect(noteBox.x).toBeGreaterThanOrEqual(0); expect(noteBox.y).toBeGreaterThanOrEqual(0);
      expect(noteBox.x + noteBox.width).toBeLessThanOrEqual(viewport.width);
      expect(noteBox.y + noteBox.height).toBeLessThanOrEqual(viewport.height);
      await page.screenshot({ path: 'output/playwright/ux11-' + theme + '-' + viewport.width + '.png' });
      await expect(page.getByRole('button', { name: '保存笔记' })).toBeVisible();
    });
  }
}

test('UX15 note draft survives scrolling, tabs and a new selection without retargeting its saved anchor', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await openSelection(page); await note(page);
  const input = page.getByRole('textbox', { name: '阅读笔记' });
  await input.fill('滚动和切换后仍保留');
  const scroll = await page.locator('.react-card-scroll').boundingBox();
  await page.mouse.move(scroll.x + 60, scroll.y + scroll.height - 40);
  await page.mouse.wheel(0, 350);
  await expect(toolbar(page)).toHaveCount(0);
  await expect(input).toHaveValue('滚动和切换后仍保留');
  await page.getByRole('tab', { name: '生成信息' }).click();
  await expect(input).toHaveValue('滚动和切换后仍保留');
  await page.getByRole('tab', { name: '学习内容' }).click();
  await selectVisibleText(page, 'E2E');
  await note(page);
  await expect(input).toHaveValue('滚动和切换后仍保留');
  await expect(page.locator('.csa-note-editor blockquote')).toHaveText('deterministic');
  await page.screenshot({ path: 'output/playwright/ux15-retained-draft.png' });
  const saved = page.waitForResponse((r) => r.url().endsWith('/api/annotations') && r.request().method() === 'POST');
  await page.getByRole('button', { name: '保存笔记' }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON().selector.textQuote.exact).toBe('deterministic');
  await expect(input).toHaveCount(0);
  await expect(page.getByTestId('react-card-content').locator('[data-annotation-kind="note"]').first()).toContainText('deterministic');
});

test('UX16 dirty note guards close, backdrop, Escape and delete; explicit discard is required', async ({ page }) => {
  let writes = 0;
  page.on('request', (r) => { if (r.url().includes('/api/annotations') && r.method() !== 'GET') writes++; });
  await openSelection(page); await note(page);
  const input = page.getByRole('textbox', { name: '阅读笔记' });
  await input.fill('不能静默丢失');
  const dialog = page.getByRole('alertdialog', { name: '笔记尚未保存' });
  for (const action of ['close', 'backdrop', 'escape', 'delete']) {
    if (action === 'close') await page.getByTestId('react-card-modal-close').click();
    if (action === 'backdrop') await page.getByTestId('react-card-modal').click({ position: { x: 2, y: 2 } });
    if (action === 'escape') await page.getByTestId('react-card-modal-close').press('Escape');
    if (action === 'delete') await page.getByRole('button', { name: '删除卡片', exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: '继续编辑' })).toBeFocused();
    if (action === 'close') await page.screenshot({ path: 'output/playwright/ux16-discard-guard.png' });
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: /放弃修改/ })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(input).toBeFocused();
    await expect(input).toHaveValue('不能静默丢失');
    await expect(page.getByRole('alertdialog', { name: '确认删除卡片' })).toHaveCount(0);
  }
  await page.getByTestId('react-card-modal-close').click();
  await dialog.getByRole('button', { name: '放弃修改并关闭' }).click();
  await expect(page.getByTestId('react-card-modal')).toHaveCount(0);
  expect(writes).toBe(0);
});

test('UX17 note save in flight prevents card close and duplicate submissions', async ({ page }) => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/annotations', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    calls++; await gate; return route.continue();
  });
  await openSelection(page); await note(page);
  await page.getByRole('textbox', { name: '阅读笔记' }).fill('保存中的内容');
  await page.getByRole('button', { name: '保存笔记' }).click();
  await expect.poll(() => calls).toBe(1);
  await page.getByTestId('react-card-modal-close').click();
  await expect(page.getByTestId('react-card-modal')).toBeVisible();
  await expect(page.getByRole('button', { name: '保存笔记' })).toBeDisabled();
  await expect(page.getByRole('textbox', { name: '阅读笔记' })).toHaveValue('保存中的内容');
  release();
  await expect(page.getByRole('textbox', { name: '阅读笔记' })).toHaveCount(0);
  expect(calls).toBe(1);
});

test('UX18 expanded preview exposes the complete sentence and preserves clipboard equality', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openSelection(page);
  await page.getByRole('button', { name: '整句', exact: true }).click();
  await expect(preview(page)).not.toHaveAttribute('title', 'deterministic');
  const sentence = await preview(page).getAttribute('title');
  await page.getByRole('button', { name: '展开选区全文' }).click();
  const text = preview(page).locator('strong');
  await expect(text).toHaveText(sentence);
  expect(await text.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy();
  await page.getByRole('button', { name: '复制选区' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(sentence);
  await page.screenshot({ path: 'output/playwright/ux18-full-preview.png' });
  await page.getByRole('button', { name: '原选', exact: true }).click();
  await expect(preview(page)).toHaveAttribute('title', 'deterministic');
  await expect(page.getByRole('button', { name: '收起全文' })).toHaveCount(0);
});

test('UX19 keyboard context actions use the same toolbar for selected text and Japanese tokens', async ({ page }) => {
  await openSelection(page);
  const content = page.getByTestId('react-card-content');
  await content.press('Shift+F10');
  await expect(toolbar(page)).toHaveCount(1);
  await expect(page.locator('.csa-context-menu')).toHaveCount(0);
  await expect(preview(page)).toHaveAttribute('title', 'deterministic');
  await expect(page.getByRole('button', { name: '标记选区' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(toolbar(page)).toHaveCount(0);
  await expect(content).toBeFocused();
  const token = content.locator('.pronunciation-token[data-pronunciation-status="accepted"]').first();
  const surface = await token.getAttribute('data-pronunciation-surface');
  await token.press('Shift+F10');
  await expect(preview(page)).toHaveAttribute('title', surface);
  await expect(page.getByRole('button', { name: '标记选区' })).toBeFocused();
  await expect(page.getByRole('tooltip', { name: '日语读音' })).toHaveCount(0);
  await expect(page.locator('.csa-context-menu')).toHaveCount(0);
});

test('UX20 browser reload warns about unsaved notes and cancelling preserves the draft', async ({ page }) => {
  await openSelection(page); await note(page);
  const input = page.getByRole('textbox', { name: '阅读笔记' });
  await input.fill('刷新前保护草稿');
  const warning = page.waitForEvent('dialog');
  const reload = page.reload({ timeout: 3000 }).catch(() => null);
  const dialog = await warning;
  expect(dialog.type()).toBe('beforeunload');
  await dialog.dismiss();
  await reload;
  await expect(input).toHaveValue('刷新前保护草稿');
  await input.press('Escape');
  await page.getByRole('button', { name: '放弃修改', exact: true }).click();
});

test('UX21 adding a note to an existing highlight updates it rather than creating a second annotation', async ({ page }) => {
  await openSelection(page);
  await page.getByRole('button', { name: '标记选区' }).click();
  const created = page.waitForResponse((r) => r.url().endsWith('/api/annotations') && r.request().method() === 'POST');
  await page.getByRole('menuitem', { name: '红色重点', exact: true }).click();
  const { annotation } = await (await created).json();
  const mark = page.getByTestId('react-card-content').locator(`[data-annotation-id="${annotation.id}"]`).first();
  await mark.click();
  await note(page);
  await page.getByRole('textbox', { name: '阅读笔记' }).fill('附加到已有标记');
  const updated = page.waitForResponse((r) => r.url().endsWith(`/api/annotations/${annotation.id}`) && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: '保存笔记' }).click();
  const response = await updated;
  expect(response.status()).toBe(200);
  expect((await response.json()).annotation).toMatchObject({ id: annotation.id, noteText: '附加到已有标记', color: 'red' });
  await expect(page.getByRole('textbox', { name: '阅读笔记' })).toHaveCount(0);
  await mark.click();
  await expect(page.getByRole('textbox', { name: '阅读笔记' })).toHaveValue('附加到已有标记');
});
