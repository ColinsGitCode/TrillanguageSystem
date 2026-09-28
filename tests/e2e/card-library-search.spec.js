const { test, expect } = require('@playwright/test');
const { resetServerState } = require('./fixtures/resetServerState');
const { enqueueAndWait } = require('./fixtures/cardSelection');

test.beforeEach(async ({ request, page }) => {
  await resetServerState(request);
  await enqueueAndWait(request, 'today search fixture', 'trilingual');
  page.on('pageerror', (error) => { throw error; });
});

test('one search moves from current date to all dates and opens the correct historical card', async ({ page, request }) => {
  await enqueueAndWait(request, '運用体制 archive fixture', 'trilingual', { targetFolder: '20260209' });
  await page.goto('/');
  await page.getByRole('searchbox', { name: '搜索当前日期卡片' }).fill('運用体制');
  await expect(page.getByText('没有匹配卡片', { exact: true })).toBeVisible();
  await expect(page.locator('#library-search-scope')).not.toContainText('全部日期');
  await page.getByRole('button', { name: '在全部卡片中搜索' }).click();
  await expect(page.getByRole('searchbox', { name: '搜索全部卡片' })).toHaveValue('運用体制');
  await expect(page.getByRole('searchbox')).toHaveCount(1);
  await expect(page.getByTestId('react-file-list')).toHaveCount(1);
  await expect(page.getByText('没有匹配卡片', { exact: true })).toHaveCount(0);
  await expect(page.locator('.date-rail .history-items')).toHaveCount(0);
  await expect(page.locator('.card-library').getByLabel('共 1 条')).toBeVisible();
  const result = page.getByTestId('react-file-list').locator('.file-card');
  await expect(result).toHaveCount(1);
  await expect(result).toContainText('運用体制 archive fixture');
  await page.screenshot({ path: 'output/playwright/library-search-all.png' });
  await result.click();
  await expect(page.locator('#react-card-title')).toContainText('運用体制 archive fixture');
  await page.getByTestId('react-card-modal-close').click();
  await expect(page.getByRole('searchbox', { name: '搜索全部卡片' })).toHaveValue('運用体制');
  if (!await page.getByRole('button', { name: '日期 2026.02.09' }).isVisible()) {
    await page.getByRole('button', { name: '展开 2026.02' }).click();
  }
  await page.getByRole('button', { name: '日期 2026.02.09' }).click();
  await expect(page.getByRole('searchbox', { name: '搜索当前日期卡片' })).toHaveValue('運用体制');
  await expect(page.locator('#library-search-scope')).toContainText('2026.02.09');
  await expect(page.getByTestId('react-file-list').locator('.file-card')).toHaveCount(1);
});

test('all-card pagination resets when the single search changes or clears', async ({ page }) => {
  const requests = [];
  await page.route('**/api/history?*', (route) => {
    const url = new URL(route.request().url());
    const search = url.searchParams.get('search') || '';
    const current = Number(url.searchParams.get('page'));
    requests.push({ search, page: current });
    return route.fulfill({ json: {
      records: [{ id: current, phrase: search || `page ${current} fixture`, card_type: 'trilingual', folder_name: '20260209', base_filename: 'fixture' }],
      pagination: { page: current, total: search ? 1 : 21, totalPages: search ? 1 : 2, hasPrev: current > 1, hasNext: !search && current < 2 },
    } });
  });
  await page.goto('/');
  await page.getByRole('tab', { name: '全部卡片' }).click();
  await expect(page.getByTestId('react-file-list')).toContainText('page 1 fixture');
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByTestId('react-file-list')).toContainText('page 2 fixture');
  await page.getByRole('searchbox', { name: '搜索全部卡片' }).fill('specific');
  await expect(page.locator('.history-pager')).toContainText('1 / 1');
  await expect(page.getByRole('button', { name: '上一页', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '清除卡片搜索' }).click();
  await expect(page.getByTestId('react-file-list')).toContainText('page 1 fixture');
  expect(requests.some((r) => r.search === 'specific' && r.page !== 1)).toBe(false);
});

test('all-card loading and errors are not reported as empty search results', async ({ page }) => {
  let fail = true;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  await page.route('**/api/history?*', async (route) => {
    await gate;
    return fail
      ? route.fulfill({ status: 503, json: { error: 'fixture unavailable' } })
      : route.fulfill({ json: { records: [], pagination: { page: 1, total: 0, totalPages: 1, hasPrev: false, hasNext: false } } });
  });
  await page.goto('/');
  await page.getByRole('tab', { name: '全部卡片' }).click();
  await expect(page.getByText('正在读取全部卡片', { exact: true })).toBeVisible();
  await expect(page.getByText('全部卡片中没有匹配结果')).toHaveCount(0);
  release();
  await expect(page.getByText('全部卡片无法读取')).toBeVisible();
  await expect(page.getByText('全部卡片中没有匹配结果')).toHaveCount(0);
  fail = false;
  await page.getByTestId('factory-history-results').getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByText('全部卡片中没有匹配结果')).toBeVisible();
});
