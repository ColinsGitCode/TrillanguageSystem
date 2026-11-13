const { test, expect } = require('@playwright/test');
const { resetServerState } = require('./fixtures/resetServerState');
const { enqueueAndWait, selectVisibleText } = require('./fixtures/cardSelection');

const sourceFolder = '20000101';
const sourceTitle = 'historical selection source';

test.beforeEach(async ({ request, page }) => {
  if (process.env.MWG_NATIVE_OVERLAYS === '1') await page.addInitScript(() => sessionStorage.setItem('three-lans:native-overlays', '1'));
  await resetServerState(request);
  await enqueueAndWait(request, sourceTitle, 'trilingual', { targetFolder: sourceFolder });
  await enqueueAndWait(request, 'older archive', 'trilingual', { targetFolder: '19991231' });
  page.on('pageerror', (error) => { throw error; });
});

test('late initial archive data does not expand all historical months after today activity arrives', async ({ page }) => {
  let releaseFolders;
  const foldersReady = new Promise((resolve) => { releaseFolders = resolve; });
  await page.route('**/api/folders', async (route) => {
    await foldersReady;
    await route.fulfill({ json: { folders: ['20261030', '20260930', '20260830'] } });
  });
  await page.route('**/api/folders/*/files', (route) => route.fulfill({ json: { files: [] } }));
  await page.route('**/api/card-engagement/today', (route) => route.fulfill({ json: {
    success: true, learningDay: '2026-11-13', timeZone: 'Asia/Tokyo', cards: [{
      id: 999, phrase: 'virtual today card', cardType: 'trilingual',
      folder: '20261030', baseFilename: 'virtual-today', generationDate: '2026-10-30', addedAtUtc: '2026-11-13T00:00:00Z',
    }],
  } }));
  await page.goto('/');
  await expect(page.getByTestId('react-file-list')).toContainText('virtual today card');
  releaseFolders();
  await expect(page.getByRole('button', { name: '收起 2026.11', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '收起 2026.10', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '展开 2026.09', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '展开 2026.08', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '日期 2026.09.30', exact: true })).toHaveCount(0);
});

for (const [label, cardType] of [['三语卡', 'trilingual'], ['语法卡', 'grammar_ja'], ['场景卡', 'scenario_phrase']]) {
  test(`selection ${cardType} appears in today's archive without reloading or moving its source`, async ({ page, request }, testInfo) => {
    const sourceFiles = (await (await request.get(`/api/folders/${sourceFolder}/files`)).json()).files;
    const sourceBase = sourceFiles[0].file.replace(/\.html$/, '');
    const source = (await (await request.get(`/api/records/by-file?folder=${sourceFolder}&base=${encodeURIComponent(sourceBase)}`)).json()).record;
    const sourceContext = { surface: 'card-modal', generationId: source.id, folder: sourceFolder, baseFilename: sourceBase };
    const today = new Intl.DateTimeFormat('sv-SE', {
      timeZone: process.env.RECORDS_TIMEZONE || 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date()).replaceAll('-', '.');

    await page.goto('/');
    await page.getByRole('button', { name: '收起 1999.12', exact: true }).click();
    await expect(page.getByRole('button', { name: `日期 ${today}`, exact: true })).toHaveCount(0);
    await page.getByTestId('react-file-list').locator('button').filter({ hasText: sourceTitle }).click();
    await selectVisibleText(page, 'deterministic');
    const createdResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/generation-jobs' && response.request().method() === 'POST');
    await page.getByRole('button', { name: '生成卡片', exact: true }).click();
    await page.getByRole('menuitem', { name: label, exact: true }).click();
    const response = await createdResponse;
    expect(response.ok()).toBeTruthy();
    expect(response.request().postDataJSON()).toMatchObject({
      phrase: 'deterministic', card_type: cardType, source_mode: 'selection', target_folder: '', source_context: sourceContext,
    });
    const jobId = (await response.json()).job.id;
    let completedJob;
    await expect.poll(async () => {
      completedJob = (await (await request.get(`/api/generation-jobs/${jobId}`)).json()).job;
      return completedJob.status;
    }, { timeout: 30_000 }).toBe('success');
    expect(completedJob.resultFolder).toBe(today.replaceAll('.', ''));
    const result = (await (await request.get(`/api/records/by-file?folder=${completedJob.resultFolder}&base=${encodeURIComponent(completedJob.resultBaseFilename)}`)).json()).record;
    expect(result.observability.metadata.sourceContext).toEqual(sourceContext);
    expect(result.phrase).toBe('deterministic');
    const generatedFiles = (await (await request.get(`/api/folders/${completedJob.resultFolder}/files`)).json()).files;
    const generatedFile = generatedFiles.find((file) => file.file === `${completedJob.resultBaseFilename}.html`);
    expect(generatedFile).toBeTruthy();
    expect(generatedFile.cardType).toBe(cardType);
    await page.getByRole('button', { name: '关闭学习卡片' }).click();
    await expect(page.getByRole('button', { name: `收起 ${today.slice(0, 7)}`, exact: true })).toBeVisible();
    const todayButton = page.getByRole('button', { name: `日期 ${today}`, exact: true });
    await expect(todayButton).toBeVisible();
    await expect(page.getByRole('button', { name: '展开 1999.12', exact: true })).toBeVisible();
    // Keep the old card's browsing position until the reader explicitly changes date.
    await expect(page.getByTestId('react-file-list')).toContainText(sourceTitle);
    await todayButton.click();
    await expect(page.getByTestId('react-file-list')).toContainText(generatedFile.title);
    await page.screenshot({ path: testInfo.outputPath('today-selection-archive.png'), fullPage: true });
    await page.reload();
    await expect(page.getByTestId('react-file-list')).toContainText(generatedFile.title);
    const afterFiles = (await (await request.get(`/api/folders/${sourceFolder}/files`)).json()).files;
    expect(afterFiles).toEqual(sourceFiles);
  });
}
