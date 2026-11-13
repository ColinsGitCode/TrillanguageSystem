const { test, expect } = require('@playwright/test');
const { resetServerState } = require('./fixtures/resetServerState');
const { enqueueAndWait, selectVisibleText } = require('./fixtures/cardSelection');
const title = 'MWG interaction fixture';
async function openCard(page) {
  await page.goto('/');
  await page.getByTestId('react-file-list').locator('button').filter({ hasText: title }).click();
  await expect(page.getByTestId('react-card-content').locator('.pronunciation-token').first()).toBeVisible();
}
async function openNote(page) {
  await selectVisibleText(page, 'deterministic');
  await page.getByRole('button', { name: '更多学习操作' }).click();
  await page.getByRole('menuitem', { name: '记笔记', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '阅读笔记' })).toBeFocused();
}
for (const mode of ['enhanced', 'legacy', 'native']) {
  test.describe(mode, () => {
    test.beforeEach(async ({ page, request }) => {
      await resetServerState(request);
      await enqueueAndWait(request, title, 'trilingual');
      await page.addInitScript(mode => {
        if (mode === 'legacy') sessionStorage.setItem('three-lans:web-platform','legacy');
        if (mode === 'native') sessionStorage.setItem('three-lans:native-overlays','1');
      }, mode);
      page.on('pageerror', error => { throw error; });
    });
    test('selection ownership, roving entry and nested menu Escape', async ({ page }) => {
      await openCard(page);
      await page.evaluate(() => { if (window.Highlight && CSS.highlights) CSS.highlights.set('foreign-owner', new Highlight()); });
      await selectVisibleText(page, 'deterministic');
      const toolbar = page.getByTestId('card-selection-toolbar');
      await expect(toolbar).toBeVisible();
      await expect(page.getByRole('button', {name:'标记选区'})).toBeEnabled();
      const nativeFocus = await toolbar.evaluate(el => el.hasAttribute('focusgroup'));
      if (!nativeFocus) {
        await expect.poll(() => toolbar.evaluate(el => [...el.querySelectorAll('button,select')].filter(n => !n.disabled && n.tabIndex === 0 && n.getClientRects().length).length)).toBe(1);
      }
      await page.getByRole('button', {name:'标记选区'}).focus();
      await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('button', {name:'标记选区'})).not.toBeFocused();
      await page.keyboard.press('Home');
      await expect(toolbar.locator(':focus')).toHaveCount(1);
      await page.getByRole('combobox', {name:'朗读速度'}).focus();
      await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('button', {name:'更多学习操作'})).toBeFocused();
      await page.keyboard.press('Tab');
      expect(await toolbar.evaluate(el => el.contains(document.activeElement))).toBe(false);
      await page.getByRole('combobox', {name:'朗读速度'}).focus();
      await page.keyboard.press('Shift+Tab');
      expect(await toolbar.evaluate(el => el.contains(document.activeElement))).toBe(false);
      expect(await page.evaluate(() => document.activeElement.tabIndex)).toBeGreaterThanOrEqual(0);
      await page.getByRole('button', {name:'生成卡片',exact:true}).click();
      const menu = page.getByRole('menu');
      await expect(menu).toBeVisible();
      if (mode === 'native') expect(await menu.evaluate(el => !!el.closest('dialog[open]'))).toBe(true);
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(page.getByRole('button', {name:'生成卡片',exact:true})).toBeFocused();
      const supports = await page.evaluate(() => !!window.Highlight && !!CSS.highlights);
      if (supports) expect(await page.evaluate(() => CSS.highlights.has('three-lans-active-selection'))).toBe(mode !== 'legacy');
      await page.getByTestId('react-card-modal-close').click();
      if (supports) {
        expect(await page.evaluate(() => CSS.highlights.has('three-lans-active-selection'))).toBe(false);
        expect(await page.evaluate(() => CSS.highlights.has('foreign-owner'))).toBe(true);
      }
      await expect(page.locator('dialog[open]')).toHaveCount(0);
      expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
      await expect(page.locator('[inert]')).toHaveCount(0);
    });
    test('persistent note error, guard, scrolling and instant reduced-motion close', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.route('**/api/annotations', route => route.request().method() === 'POST'
        ? route.fulfill({status:409,json:{error:'fixture conflict'}}) : route.continue());
      await openCard(page);
      await openNote(page);
      const note = page.getByRole('textbox',{name:'阅读笔记'});
      await note.fill('草稿应该一直保留');
      await page.getByRole('button',{name:'保存笔记',exact:true}).click();
      const error = page.locator('.csa-note-error');
      await expect(error).toContainText('草稿已保留');
      await expect(note).toHaveAttribute('aria-describedby', await error.getAttribute('id'));
      await page.waitForTimeout(2600);
      await expect(error).toBeVisible();
      await page.locator('.react-card-scroll').evaluate(el => { el.scrollTop=1000; el.dispatchEvent(new Event('scroll')); });
      await expect(note).toHaveValue('草稿应该一直保留');
      await page.getByTestId('react-card-modal-close').click();
      await expect(page.getByRole('alertdialog')).toContainText('笔记尚未保存');
      await page.getByRole('button',{name:'继续编辑'}).click();
      await expect(note).toHaveValue('草稿应该一直保留');
      expect(await page.locator('.react-card-modal').evaluate(el => getComputedStyle(el).animationName)).toBe('none');
      await page.getByTestId('react-card-modal-close').click();
      await page.getByRole('button',{name:'放弃修改并关闭'}).click();
      await expect(page.getByTestId('react-card-modal')).toHaveCount(0);
      expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
    });
    test('header anchored menu, background scroll and reading visibility', async ({ page }) => {
      await openCard(page);
      const scroll = await page.evaluate(() => ({x:scrollX,y:scrollY}));
      const toggle = page.getByTestId('card-reading-toggle');
      if (await toggle.getAttribute('aria-pressed') === 'true') await toggle.click();
      await expect(page.getByTestId('card-summary-reading')).toHaveCount(0);
      await page.getByTestId('card-more-menu-trigger').click();
      const menu = page.getByRole('menu',{name:'更多操作'});
      await expect(menu).toBeVisible();
      const hit = await menu.evaluate(el => { const r=el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)); });
      expect(hit).toBe(true);
      await page.keyboard.press('Escape');
      await expect(page.getByTestId('card-more-menu-trigger')).toBeFocused();
      await page.mouse.move(4,4);
      await page.mouse.wheel(0,800);
      await page.getByTestId('react-card-modal-close').click();
      expect(await page.evaluate(() => ({x:scrollX,y:scrollY}))).toEqual(scroll);
    });
    test('history navigation cannot silently discard a note draft', async ({ page }) => {
      await page.goto('/learn');
      await page.getByRole('link',{name:'Cards Factory',exact:true}).click();
      await page.getByTestId('react-file-list').locator('button').filter({hasText:title}).click();
      await openNote(page);
      const note = page.getByRole('textbox',{name:'阅读笔记'});
      await note.fill('导航时保留');
      await page.evaluate(() => history.back());
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await page.getByRole('button',{name:'继续编辑'}).click();
      await expect(note).toHaveValue('导航时保留');
      await page.evaluate(() => history.back());
      await expect(page.getByRole('alertdialog')).toBeVisible();
      await page.getByRole('button',{name:'放弃修改',exact:true}).click();
      await expect(page).toHaveURL(/\/learn$/);
    });
    test('active-session onboarding is folded and never writes learning data', async ({ page }) => {
      await page.route('**/api/learning/sessions/active', route => route.fulfill({json:{success:true,session:{
        id:73, queueId:-1, startedAtUtc:'2026-11-12T10:00:00Z', queueProgress:{total:4}, reviewSummary:{total:1}
      }}}));
      let writes=0;
      page.on('request', request => { if (request.url().includes('/api/learning/') && request.method() !== 'GET') writes++; });
      await page.goto('/learn');
      const fold=page.locator('.learning-onboarding-collapsed');
      await expect(fold).toBeVisible();
      await expect(page.getByTestId('learning-onboarding')).toBeHidden();
      await expect(page.getByRole('button',{name:'继续上次学习',exact:true})).toHaveCount(1);
      await fold.locator('summary').click();
      await expect(page.getByTestId('learning-onboarding')).toBeVisible();
      await expect(page.getByTestId('learning-onboarding').locator('footer a')).toHaveCount(0);
      expect(writes).toBe(0);
    });
    test('field-sizing fallback and composing Enter do not submit', async ({ page }) => {
      await page.goto('/');
      await page.getByRole('button',{name:'新建学习卡',exact:true}).click();
      const input = page.getByTestId('react-phrase-input');
      await expect(input).toBeVisible();
      const before = await input.boundingBox();
      await input.fill('一行\n二行\n三行\n四行\n五行');
      const after = await input.boundingBox();
      expect(after.height).toBeGreaterThan(before.height);
      if (mode === 'legacy') await expect(input).toHaveAttribute('data-auto-size','fallback');
      let submissions = 0;
      await page.route('**/api/generation-jobs', route => { if (route.request().method() === 'POST') submissions++; return route.continue(); });
      await input.evaluate(el => el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true})));
      expect(submissions).toBe(0);
      await expect(input).toHaveValue('一行\n二行\n三行\n四行\n五行');
    });
  });
}

test('native modal keeps one owner while its card chunk is loading', async ({ page, request }) => {
  await resetServerState(request);
  await enqueueAndWait(request, title, 'trilingual');
  await page.addInitScript(() => sessionStorage.setItem('three-lans:native-overlays','1'));
  await page.route('**/assets/CardModal-*.js', async route => {
    await new Promise(resolve => setTimeout(resolve, 1800));
    await route.continue();
  });
  await page.goto('/');
  await page.getByTestId('react-file-list').locator('button').filter({hasText:title}).click();
  await expect(page.getByTestId('card-modal-module-loading')).toBeVisible();
  await expect(page.locator('dialog[open]')).toHaveCount(1);
  await expect(page.locator('dialog [role="dialog"]')).toHaveCount(0);
  await page.locator('dialog[open]').evaluate(el => el.dataset.ownerProof = 'unchanged');
  await expect(page.getByTestId('react-card-content')).toBeVisible();
  await expect(page.locator('dialog[open]')).toHaveAttribute('data-owner-proof','unchanged');
  await page.getByTestId('react-card-modal-close').click();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});
