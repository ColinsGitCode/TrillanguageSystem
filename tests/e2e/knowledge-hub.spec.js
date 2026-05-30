const { test, expect } = require('@playwright/test');
const { resetServerState } = require('./fixtures/resetServerState');

// Data-driven coverage for the three-pane Knowledge Hub explorer. The knowledge
// jobs are stubbed under E2E_TEST_MODE, so we seed a deterministic mini corpus
// (4 terms; 3 mapped to clusters across both axes, 1 left uncategorized) via the
// test-only /api/_test/seed-knowledge endpoint, then exercise the browse UI.
async function seedKnowledge(request) {
  const res = await request.post('/api/_test/seed-knowledge');
  if (!res.ok()) {
    throw new Error(`/api/_test/seed-knowledge failed: HTTP ${res.status()}`);
  }
  return res.json();
}

test.describe('Knowledge Hub explorer', () => {
  test.beforeAll(async ({ request }) => {
    await resetServerState(request);
    await seedKnowledge(request);
  });

  test('01 三栏结构 + 统计条 + 默认功能轴分类与词条', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

    await page.goto('/knowledge-hub.html');

    // Three-pane scaffold + stats bar present.
    await expect(page.getByTestId('knowledge-hub-page')).toBeVisible();
    await expect(page.getByTestId('knowledge-base-panel')).toBeVisible();
    await expect(page.getByTestId('kh-axis-toggle')).toBeVisible();
    await expect(page.getByTestId('knowledge-base-term-list')).toBeVisible();
    await expect(page.getByTestId('knowledge-relation-inspector')).toBeVisible();
    await expect(page.getByTestId('kh-actions')).toBeVisible();
    await expect(page.getByTestId('knowledge-hub-counts')).toContainText('terms 4');

    // Default axis = function → grammar categories + the uncategorized bucket.
    const cats = page.getByTestId('knowledge-base-categories');
    await expect(cats.getByText('因果关系')).toBeVisible();
    await expect(cats.getByText('意愿·目的·计划')).toBeVisible();
    await expect(cats.getByText('未分类')).toBeVisible();
    // function axis pins card-type grammar_ja → the 3 grammar terms.
    await expect(page.locator('#knowledgeBasePageInfo')).toContainText('1 - 3 / 3');

    expect(consoleErrors, 'console errors').toEqual([]);
  });

  test('02 轴切换到主题领域更新分类树与词条', async ({ page }) => {
    await page.goto('/knowledge-hub.html');
    await page.getByTestId('kh-axis-toggle').getByRole('button', { name: '主题领域' }).click();

    const cats = page.getByTestId('knowledge-base-categories');
    await expect(cats.getByText('工程技术')).toBeVisible();
    await expect(cats.getByText('因果关系')).toHaveCount(0);
    // topic axis pins trilingual → the single trilingual term.
    await expect(page.locator('#knowledgeBasePageInfo')).toContainText('1 - 1 / 1');
    await expect(page.getByTestId('knowledge-base-term-list')).toContainText('api');
  });

  test('03 分类筛选与未分类桶', async ({ page }) => {
    await page.goto('/knowledge-hub.html');
    const cats = page.getByTestId('knowledge-base-categories');

    await cats.getByText('因果关系').click();
    await expect(page.locator('#knowledgeBasePageInfo')).toContainText('1 - 1 / 1');
    await expect(page.getByTestId('knowledge-base-term-list')).toContainText('〜から');

    await cats.getByText('未分类').click();
    await expect(page.locator('#knowledgeBasePageInfo')).toContainText('1 - 1 / 1');
    await expect(page.getByTestId('knowledge-base-term-list')).toContainText('未分类示例');
  });

  test('04 洞察面板切换与 Relation Inspector', async ({ page }) => {
    await page.goto('/knowledge-hub.html');

    await page.getByTestId('kh-insights').getByRole('button', { name: '聚类' }).click();
    const insightList = page.getByTestId('knowledge-hub-synonyms'); // shared insight list container
    await expect(insightList).toBeVisible();
    await expect(insightList).toContainText('工程技术');
    // browse pane is swapped out
    await expect(page.getByTestId('knowledge-base-term-list')).toBeHidden();

    await insightList.getByTestId('knowledge-hub-item-cluster').first().click();
    await expect(page.getByTestId('knowledge-relation-inspector')).toContainText('CLUSTER');
  });

  test('05 词条点击弹出嵌入式卡片弹窗并可关闭', async ({ page }) => {
    await page.goto('/knowledge-hub.html');

    const modal = page.getByTestId('kh-card-modal');
    await expect(modal).toBeHidden();

    await page.getByTestId('knowledge-base-term').first().click();
    await expect(modal).toBeVisible();
    // The Hub embeds the main app's native card modal via /?card=<id>&embed=1.
    await expect(page.locator('#khCardFrame')).toHaveAttribute('src', /\/\?card=\d+&embed=1/);

    await page.locator('#khCardClose').click();
    await expect(modal).toBeHidden();
  });
});
