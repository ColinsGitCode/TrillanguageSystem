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

  test('01 两栏主体 + metric 指标条 + 默认功能轴分类与词条', async ({ page }) => {
    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

    await page.goto('/knowledge-hub.html');

    // Two-pane scaffold + metric stats bar present.
    await expect(page.getByTestId('knowledge-hub-page')).toBeVisible();
    await expect(page.getByTestId('knowledge-base-panel')).toBeVisible();
    await expect(page.getByTestId('knowledge-base-panel')).not.toHaveClass(/has-inspector/);
    await expect(page.getByTestId('kh-axis-toggle')).toBeVisible();
    await expect(page.getByTestId('knowledge-base-term-list')).toBeVisible();
    await expect(page.getByTestId('kh-inspector')).toBeHidden();
    await expect(page.getByTestId('kh-actions')).toBeVisible();
    await expect(page.getByTestId('knowledge-hub-counts').locator('.kh-metric')).toHaveCount(5);
    await expect(page.getByTestId('knowledge-hub-counts').getByTestId('kh-metric-terms')).toContainText('4');

    // Default axis = function → grammar categories + the uncategorized bucket.
    const cats = page.getByTestId('knowledge-base-categories');
    await expect(cats.getByText('因果关系')).toBeVisible();
    await expect(cats.getByText('意愿·目的·计划')).toBeVisible();
    await expect(cats.getByText('未分类')).toBeVisible();
    // function axis pins card-type grammar_ja → the 3 grammar terms.
    await expect(page.locator('#knowledgeBasePageInfo')).toContainText('1 - 3 / 3');
    await expect(page.getByTestId('knowledge-base-term').first()).toHaveClass(/kh-term-card/);
    await expect(page.getByTestId('knowledge-base-term').first().locator('.kh-pill')).toBeVisible();

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
    await expect(page.getByTestId('knowledge-base-panel')).toHaveClass(/has-inspector/);
    await expect(page.getByTestId('kh-inspector')).toBeVisible();
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

    await page.getByTestId('knowledge-base-term').first().locator('.kh-term-main').click();
    await expect(modal).toBeVisible();
    // The Hub embeds the main app's native card modal via /?card=<id>&embed=1.
    await expect(page.locator('#khCardFrame')).toHaveAttribute('src', /\/\?card=\d+&embed=1/);

    await page.locator('#khCardClose').click();
    await expect(modal).toBeHidden();
  });

  test('05b 词条关系按钮打开 Inspector 且不会弹卡片', async ({ page }) => {
    await page.goto('/knowledge-hub.html');

    const panel = page.getByTestId('knowledge-base-panel');
    const modal = page.getByTestId('kh-card-modal');
    await expect(panel).not.toHaveClass(/has-inspector/);
    await expect(modal).toBeHidden();

    await page.getByTestId('knowledge-base-term').first().getByTestId('kh-term-rel').click();
    await expect(panel).toHaveClass(/has-inspector/);
    await expect(page.getByTestId('kh-inspector')).toBeVisible();
    await expect(page.getByTestId('knowledge-relation-inspector')).not.toContainText('点击词条');
    await expect(modal).toBeHidden();

    await page.getByTestId('kh-list-crumb').click();
    await expect(panel).not.toHaveClass(/has-inspector/);
    await expect(page.getByTestId('kh-inspector')).toBeHidden();

    await page.getByTestId('knowledge-base-term').first().getByTestId('kh-term-rel').click();
    await expect(panel).toHaveClass(/has-inspector/);
    await page.keyboard.press('Escape');
    await expect(panel).not.toHaveClass(/has-inspector/);
    await expect(page.getByTestId('kh-inspector')).toBeHidden();
  });

  test('06 难度徽标与按难度筛选', async ({ page }) => {
    await page.goto('/knowledge-hub.html');
    // grammar terms (default function axis) carry a difficulty badge
    await expect(page.getByTestId('knowledge-base-term-list').locator('.kh-term-card .kh-diff').first()).toBeVisible();
    // switch to 全部 axis (card-type all) then filter to 简单 → only the trilingual 'api'
    await page.getByTestId('kh-axis-toggle').getByRole('button', { name: '全部' }).click();
    await page.getByTestId('knowledge-base-difficulty').selectOption('easy');
    await expect(page.locator('#knowledgeBasePageInfo')).toContainText('1 - 1 / 1');
    await expect(page.getByTestId('knowledge-base-term-list')).toContainText('api');
  });

  test('07 学习计划：阶段列表与「学这组」跳转', async ({ page }) => {
    await page.goto('/knowledge-hub.html');
    await page.getByTestId('knowledge-base-term').first().getByTestId('kh-term-rel').click();
    await expect(page.getByTestId('knowledge-base-panel')).toHaveClass(/has-inspector/);
    await page.getByTestId('kh-plan-btn').click();
    await expect(page.getByTestId('knowledge-base-panel')).not.toHaveClass(/has-inspector/);
    await expect(page.getByTestId('kh-plan-pane')).toBeVisible();
    await expect(page.getByTestId('kh-plan-stage').first()).toBeVisible();
    // 「学这组」jumps to that category's filtered browse
    await page.getByTestId('kh-plan-stage').first().getByRole('button', { name: /学这组/ }).click();
    await expect(page.getByTestId('knowledge-base-term-list')).toBeVisible();
    await expect(page.getByTestId('knowledge-base-categories').locator('.kh-cat.active')).toHaveCount(1);
  });

  test('08 复习模式：进入队列、评分推进直至完成', async ({ page }) => {
    await page.goto('/knowledge-hub.html');

    await page.getByTestId('knowledge-base-term').first().getByTestId('kh-term-rel').click();
    await expect(page.getByTestId('knowledge-base-panel')).toHaveClass(/has-inspector/);
    await page.getByTestId('kh-review-btn').click();
    await expect(page.getByTestId('knowledge-base-panel')).not.toHaveClass(/has-inspector/);
    await expect(page.getByTestId('kh-review-pane')).toBeVisible();
    await expect(page.getByTestId('kh-review-card')).toBeVisible();

    // The 4 seeded cards are all "new" → grade through them until the queue clears.
    for (let i = 0; i < 8; i += 1) {
      if (await page.getByTestId('kh-review-done').isVisible().catch(() => false)) break;
      await page.getByTestId('kh-grade-good').click();
      await page.waitForTimeout(200);
    }
    await expect(page.getByTestId('kh-review-done')).toBeVisible({ timeout: 5000 });
  });

  test('09 URL mode=review 直接进入复习模式', async ({ page }) => {
    await page.goto('/knowledge-hub.html?mode=review');
    await expect(page.getByTestId('kh-review-pane')).toBeVisible();
    await expect(page.getByTestId('kh-review-card').or(page.getByTestId('kh-review-done'))).toBeVisible();
  });
});
