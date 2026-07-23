'use strict';

const { test, expect } = require('@playwright/test');

test.describe('Knowledge Points unresolved workbench', () => {
  test('keeps the page safely degraded when KG is disabled', async ({ page }) => {
    await page.goto('/knowledge');
    await expect(page.getByTestId('knowledge-points-page')).toBeVisible();
    await expect(page.getByText('知识点功能尚未启用')).toBeVisible();
    await expect(page.getByText('Cards Factory 与学习复习不受影响')).toBeVisible();
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

    await page.goto('/knowledge');
    await page.getByRole('button', { name: /待确认 1/ }).click();
    const workbench = page.getByTestId('knowledge-resolution-workbench');
    await expect(workbench).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await expect(workbench.getByText('AI proposal · 未接受')).toBeVisible();
    await expect(page.getByLabel('规范形')).toHaveValue('橋');
    await expect(page.getByText('拆分/合并会改写 KP transition')).toBeVisible();

    await page.getByRole('button', { name: '检查并确认归属' }).click();
    const review = page.getByRole('alertdialog', { name: '确认知识点裁决' });
    await expect(review).toContainText('无 FSRS 写入');
    await expect(review).toContainText('AI proposal');
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
});
