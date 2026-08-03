'use strict';

const { test, expect } = require('@playwright/test');

test.describe('Knowledge Points unresolved workbench', () => {
  test('keeps the page safely degraded when KG is disabled', async ({ page }) => {
    await page.goto('/knowledge');
    await expect(page.getByTestId('knowledge-points-page')).toBeVisible();
    await expect(page.getByTestId('knowledge-page-header')).toContainText('知识点查找 · 明确查询');
    await expect(page.getByText('当前工作区未开放知识点查找')).toBeVisible();
    await expect(page.getByText('Cards Factory 与学习复习仍可正常使用')).toBeVisible();
  });

  test('keeps an availability failure distinct from a disabled feature', async ({ page }) => {
    await page.route('**/api/kg/search**', (route) => route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'fixture unavailable', code: 'KG_TEMPORARILY_UNAVAILABLE' }),
    }));
    await page.goto('/knowledge');
    await expect(page.getByTestId('knowledge-availability-error')).toContainText('知识点服务暂时无法读取');
    await expect(page.getByTestId('knowledge-availability-disabled')).toHaveCount(0);
    await expect(page.getByPlaceholder('输入词语、短语或语法…')).toBeDisabled();
  });

  test('reviews an unresolved case without allowing an AI proposal to self-accept', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    let open = true;
    let decisionPayload = null;
    const resolutionCase = {
      id: 91,
      caseKind: 'ambiguous-surface',
      language: 'ja',
      kindHint: 'lexeme',
      normalizedInput: 'はし',
      candidates: [
        {
          kind: 'lexeme',
          language: 'ja',
          canonicalForm: '橋',
          canonicalReading: 'はし',
          source: 'llm-proposal',
          reason: 'Possible bridge sense',
        },
      ],
      status: 'open',
      revision: 3,
      evidenceId: null,
    };
    const point = {
      id: 901,
      pointKey: 'fixture',
      kind: 'lexeme',
      language: 'ja',
      canonicalForm: '橋',
      canonicalReading: 'はし',
      senseDiscriminator: '',
      identityVersion: 'fixture-v1',
      lifecycle: 'active',
    };

    await page.route('**/api/kg/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === '/api/kg/search') {
        await route.fulfill({ json: { success: true, results: [] } });
        return;
      }
      if (url.pathname === '/api/kg/recent-lookups') {
        await route.fulfill({ json: { success: true, lookups: [] } });
        return;
      }
      if (url.pathname === '/api/kg/resolution-cases' && request.method() === 'GET') {
        await route.fulfill({ json: { success: true, resolutionCases: open ? [resolutionCase] : [] } });
        return;
      }
      if (url.pathname === '/api/kg/resolution-cases/91' && request.method() === 'GET') {
        await route.fulfill({ json: { success: true, resolutionCase } });
        return;
      }
      if (url.pathname === '/api/kg/resolution-cases/91/decisions' && request.method() === 'POST') {
        decisionPayload = request.postDataJSON();
        open = false;
        await route.fulfill({
          json: {
            success: true,
            resolutionCase: { ...resolutionCase, status: 'resolved', revision: 4, resolvedPointId: point.id },
            point,
            reused: false,
          },
        });
        return;
      }
      if (url.pathname === '/api/kg/points/901') {
        await route.fulfill({
          json: {
            success: true,
            point: { ...point, stats: null, forms: [], evidence: [] },
          },
        });
        return;
      }
      await route.fallback();
    });

    await page.goto('/knowledge?mode=resolution&case=91');
    const workbench = page.getByTestId('knowledge-resolution-workbench');
    await expect(workbench).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await expect(workbench.getByRole('button', { name: '橋 はし AI 候选 · 尚未确认', exact: true })).toBeVisible();
    await expect(page.getByLabel('规范形')).toHaveValue('橋');
    await expect(page.getByText('同一个写法若要拆成多个词义')).toBeVisible();

    const openReviewButton = page.getByRole('button', { name: '检查并确认归属' });
    await openReviewButton.click();
    const review = page.getByRole('alertdialog', { name: '确认知识点裁决' });
    await expect(review).toContainText('不改变复习安排');
    await expect(review).toContainText('AI 候选');
    const closeReviewButton = review.getByRole('button', { name: '返回待确认项' });
    const confirmResolutionButton = review.getByRole('button', { name: '确认归属为 橋' });
    await expect(closeReviewButton).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(confirmResolutionButton).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(closeReviewButton).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(review).toBeHidden();
    await expect(openReviewButton).toBeFocused();
    await openReviewButton.click();
    await review.getByRole('button', { name: '确认归属为 橋' }).click();

    await expect(page.getByRole('heading', { name: '橋' })).toBeVisible();
    expect(decisionPayload).toMatchObject({
      action: 'resolve',
      revision: 3,
      point: {
        kind: 'lexeme',
        language: 'ja',
        canonicalForm: '橋',
        canonicalReading: 'はし',
      },
    });
    expect(decisionPayload.eventKey).toMatch(/^resolution:/u);
  });

  test('restores a recent lookup and turns pending work into an explicit next action', async ({ page }) => {
    const point = {
      id: 42,
      pointKey: 'recent-fixture',
      kind: 'lexeme',
      language: 'en',
      canonicalForm: 'handoff',
      canonicalReading: '',
      senseDiscriminator: '',
      identityVersion: 'fixture-v1',
      lifecycle: 'active',
    };
    const resolutionCase = {
      id: 91,
      caseKind: 'ambiguous-surface',
      language: 'ja',
      kindHint: 'lexeme',
      normalizedInput: 'はし',
      candidates: [],
      status: 'open',
      revision: 1,
    };

    await page.route('**/api/kg/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/kg/search') {
        await route.fulfill({ json: { success: true, results: [] } });
        return;
      }
      if (url.pathname === '/api/kg/recent-lookups') {
        await route.fulfill({
          json: {
            success: true,
            lookups: [
              {
                id: 8,
                eventKey: 'lookup:recent:0008',
                inputText: 'handoff',
                normalizedInput: 'handoff',
                language: 'en',
                kindHint: 'lexeme',
                occurredAtUtc: '2026-07-30T03:00:00.000Z',
                resolution: 'resolved',
                point,
                resolutionCase: null,
                reused: false,
              },
              {
                id: 7,
                eventKey: 'lookup:recent:0007',
                inputText: 'はし',
                normalizedInput: 'はし',
                language: 'ja',
                kindHint: 'lexeme',
                occurredAtUtc: '2026-07-29T03:00:00.000Z',
                resolution: 'unresolved',
                point: null,
                resolutionCase,
                reused: false,
              },
            ],
          },
        });
        return;
      }
      if (url.pathname === '/api/kg/resolution-cases') {
        await route.fulfill({ json: { success: true, resolutionCases: [resolutionCase] } });
        return;
      }
      if (url.pathname === '/api/kg/points/42') {
        await route.fulfill({ json: { success: true, point: { ...point, stats: null, forms: [], evidence: [] } } });
        return;
      }
      await route.fallback();
    });

    await page.goto('/knowledge');
    await expect(page.getByTestId('knowledge-resolution-workbench')).toBeVisible();
    await expect(page.getByPlaceholder('搜索待确认项')).toBeVisible();
    await expect(page).toHaveURL(/mode=resolution.*case=91/u);
    const resolutionFilters = page.getByTestId('knowledge-resolution-workbench').locator('.workflow-task-filters');
    await expect(resolutionFilters.getByRole('button', { name: /待确认 1/u })).toBeVisible();
    await expect(resolutionFilters.getByRole('button', { name: /需注意/u })).toHaveCount(0);
    const taskRailSeparator = page.getByRole('separator', { name: '调整任务列表宽度' });
    const initialRailWidth = Number(await taskRailSeparator.getAttribute('aria-valuenow'));
    await taskRailSeparator.focus();
    await page.keyboard.press('ArrowLeft');
    await expect(taskRailSeparator).toHaveAttribute('aria-valuenow', String(initialRailWidth - 12));
    await page.reload();
    await expect(page.getByRole('separator', { name: '调整任务列表宽度' })).toHaveAttribute('aria-valuenow', String(initialRailWidth - 12));
    await page.getByRole('button', { name: '返回查找' }).click();
    await expect(page.getByRole('heading', { name: '最近查找' })).toBeVisible();
    await expect(page.getByTestId('knowledge-start-state')).toContainText('处理 1 个待确认项');
    await page.getByTestId('knowledge-recent-8').click();
    await expect(page.getByRole('heading', { name: 'handoff' })).toBeVisible();
    await expect(page.getByPlaceholder('输入词语、短语或语法…')).toHaveValue('handoff');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  });

  test('windows hundreds of pending cases while preserving keyboard navigation', async ({ page }) => {
    const resolutionCases = Array.from({ length: 240 }, (_, index) => ({
      id: index + 1,
      caseKind: 'ambiguous-surface',
      language: 'ja',
      kindHint: 'lexeme',
      normalizedInput: `候选 ${String(index + 1).padStart(3, '0')}`,
      candidates: [],
      status: 'open',
      revision: 1,
      evidenceId: null,
    }));

    await page.route('**/api/kg/**', async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === '/api/kg/search') {
        await route.fulfill({ json: { success: true, results: [] } });
        return;
      }
      if (url.pathname === '/api/kg/recent-lookups') {
        await route.fulfill({ json: { success: true, lookups: [] } });
        return;
      }
      if (url.pathname === '/api/kg/resolution-cases') {
        await route.fulfill({ json: { success: true, resolutionCases } });
        return;
      }
      const caseMatch = url.pathname.match(/^\/api\/kg\/resolution-cases\/(\d+)$/u);
      if (caseMatch) {
        const resolutionCase = resolutionCases.find((item) => item.id === Number(caseMatch[1]));
        await route.fulfill({ json: { success: true, resolutionCase } });
        return;
      }
      await route.fallback();
    });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/knowledge?mode=resolution&case=240');
    const list = page.getByTestId('workflow-task-virtual-list');
    await expect(list).toHaveAttribute('data-total-count', '240');
    await expect(list.getByRole('button', { name: /候选 240/u })).toBeVisible();
    expect(await list.locator('ol > li').count()).toBeLessThan(30);

    const last = list.getByRole('button', { name: /候选 240/u });
    await last.focus();
    await page.keyboard.press('Home');
    const first = list.getByRole('button', { name: /候选 001/u });
    await expect(first).toBeVisible();
    await expect(first).toHaveAttribute('aria-current', 'true');
    await first.focus();
    await page.keyboard.press('End');
    await expect(last).toBeVisible();
    await expect(last).toHaveAttribute('aria-current', 'true');
    expect(await list.locator('ol > li').count()).toBeLessThan(30);
  });
});
