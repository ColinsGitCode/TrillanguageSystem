'use strict';

const { test, expect } = require('@playwright/test');

test('manages manual dictionary overrides without editing imported providers', async ({ page }) => {
  let entry = null;
  const catalog = {
    manual: [],
    dictionaries: [
      {
        sourceId: 'zhwiktionary-ja-direct', dictionaryVersion: 'zhwiktionary-ja-test',
        language: 'ja', status: 'active', entryCount: 49146, updatedAtUtc: '2026-08-09T00:00:00.000Z',
      },
      {
        sourceId: 'jmdict-simplified', dictionaryVersion: 'jmdict-test',
        language: 'ja', status: 'active', entryCount: 54897, updatedAtUtc: '2026-08-09T00:00:00.000Z',
      },
    ],
  };

  await page.route('**/api/local-glossary/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === '/api/local-glossary/catalog') {
      await route.fulfill({ json: { success: true, catalog } });
      return;
    }
    if (url.pathname === '/api/local-glossary/entries' && request.method() === 'GET') {
      await route.fulfill({ json: { success: true, entries: entry ? [entry] : [] } });
      return;
    }
    if (url.pathname === '/api/local-glossary/entries' && request.method() === 'POST') {
      const payload = request.postDataJSON();
      entry = {
        id: 51, language: payload.language, canonicalForm: payload.canonicalForm,
        normalizedForm: payload.canonicalForm, senseKey: payload.senseKey,
        zhGloss: payload.zhGloss, sourceKind: 'manual', sourceRef: {},
        confidence: payload.confidence, status: 'active', version: 1,
        createdAtUtc: '2026-08-09T00:00:00.000Z', updatedAtUtc: '2026-08-09T00:00:00.000Z',
      };
      catalog.manual = [{ language: entry.language, status: 'active', entryCount: 1 }];
      await route.fulfill({ status: 201, json: { success: true, entry } });
      return;
    }
    if (url.pathname === '/api/local-glossary/entries/51' && request.method() === 'PATCH') {
      const payload = request.postDataJSON();
      entry = { ...entry, ...payload, version: 2 };
      await route.fulfill({ json: { success: true, entry } });
      return;
    }
    if (url.pathname === '/api/local-glossary/entries/51' && request.method() === 'DELETE') {
      entry = { ...entry, status: 'archived', version: 3 };
      await route.fulfill({ json: { success: true, entry } });
      return;
    }
    if (url.pathname === '/api/local-glossary/entries/51/restore') {
      entry = { ...entry, status: 'active', version: 4 };
      await route.fulfill({ json: { success: true, entry } });
      return;
    }
    await route.fallback();
  });

  await page.goto('/dictionary');
  await expect(page.getByRole('heading', { name: '本地词典', exact: true })).toBeVisible();
  await expect(page.getByText('中文维基词典 · 直接日中')).toBeVisible();
  await expect(page.getByText('JMdict · 英中桥接')).toBeVisible();
  await expect(page.getByText('只读开放词典')).toBeVisible();

  await page.getByRole('button', { name: '新建人工词条' }).click();
  const dialog = page.getByRole('dialog', { name: '新建人工词条' });
  await dialog.getByLabel('词语').fill('手帳');
  await dialog.getByLabel('中文释义').fill('记事本；手册');
  await dialog.getByRole('button', { name: '保存词条' }).click();
  await expect(page.getByText('手帳')).toBeVisible();
  await expect(page.getByText('记事本；手册')).toBeVisible();

  await page.getByRole('button', { name: '编辑 手帳' }).click();
  await page.getByRole('dialog', { name: '编辑人工词条' }).getByLabel('中文释义').fill('笔记本；记事本');
  await page.getByRole('dialog', { name: '编辑人工词条' }).getByRole('button', { name: '保存词条' }).click();
  await expect(page.getByText('笔记本；记事本')).toBeVisible();

  await page.getByRole('button', { name: '归档 手帳' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '归档' }).click();
  await expect(page.getByText('词条已归档。')).toBeVisible();
  await page.getByLabel('状态筛选').selectOption('archived');
  await page.getByRole('button', { name: '恢复 手帳' }).click();
  await expect(page.getByText('词条已恢复，并重新成为优先释义。')).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});
