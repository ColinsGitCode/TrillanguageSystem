const { test, expect } = require('@playwright/test');

test.describe('Markdown-first card renderer', () => {
  test('renders sanitized Markdown through a typed idempotent adapter', async ({ page, request }) => {
    const created = await request.post('/api/generate', {
      data: { phrase: 'adapter smoke handoff', cardType: 'trilingual' }
    });
    const payload = await created.json();
    await page.goto(`/?card=${payload.generationId}`);
    await expect(page.getByTestId('card-modal')).toBeVisible();
    const renderer = page.locator('[data-card-renderer-version="2"]');
    await expect(renderer).toHaveAttribute('data-card-type', 'trilingual');
    await expect(renderer.locator('.audio-btn').first()).toBeVisible();
    await expect(renderer.locator('script')).toHaveCount(0);

    const idempotent = await page.evaluate(async () => {
      const { enhanceCardHtmlByType } = await import('/js/modules/card-renderer.js');
      const once = enhanceCardHtmlByType('<h2>1. English</h2><p>Hello</p>', 'trilingual');
      const twice = enhanceCardHtmlByType(once, 'trilingual');
      const template = document.createElement('template');
      template.innerHTML = twice;
      return {
        same: once === twice,
        wrappers: template.content.querySelectorAll('[data-card-renderer-version="2"]').length
      };
    });
    expect(idempotent).toEqual({ same: true, wrappers: 1 });
  });

  test('keeps ruby readings on their kanji and migrates v1 marks onto fresh HTML', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const { enhanceCardHtmlByType, migrateHighlightHtml } = await import('/js/modules/card-renderer.js');
      const fresh = enhanceCardHtmlByType('<p><ruby>漢字<rt>かんじ</rt></ruby>だけを読む。重要です。</p>', 'grammar_ja');
      const old = '<p><ruby>漢字<rt>かんじ</rt></ruby>だけを読む。<mark class="study-highlight-red">重要</mark>です。</p>';
      const migrated = migrateHighlightHtml(fresh, old);
      const template = document.createElement('template');
      template.innerHTML = migrated;
      return {
        reading: template.content.querySelector('ruby rt')?.textContent,
        rubyText: template.content.querySelector('ruby')?.textContent,
        mark: template.content.querySelector('mark.study-highlight-red')?.textContent,
        version: template.content.querySelector('[data-card-renderer-version]')?.dataset.cardRendererVersion
      };
    });
    expect(result).toEqual({ reading: 'かんじ', rubyText: '漢字かんじ', mark: '重要', version: '2' });
  });

  test('sanitizer strips hostile HTML and fails closed without DOMPurify', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(async () => {
      const { sanitizeHtml } = await import('/js/modules/utils.js');
      const clean = sanitizeHtml('<img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script><p>safe</p>');
      const purifier = window.DOMPurify;
      delete window.DOMPurify;
      const closed = sanitizeHtml('<img src=x onerror=alert(1)><b>unsafe source</b>');
      window.DOMPurify = purifier;
      return { clean, closed };
    });
    expect(result.clean).not.toContain('onerror');
    expect(result.clean).not.toContain('<script');
    expect(result.clean).toContain('<p>safe</p>');
    expect(result.closed).toContain('safe-render-error');
    expect(result.closed).toContain('&lt;img');
    expect(result.closed).not.toContain('<img src=x');
  });

  test('full-height modal traps focus, hides browse SRS controls and restores its opener', async ({ page, request }) => {
    const phrase = `modal focus ${Date.now()}`;
    const created = await request.post('/api/generate', { data: { phrase, cardType: 'trilingual' } });
    expect(created.ok()).toBeTruthy();
    await page.goto('/');
    const folder = page.getByTestId('folder-list').locator('button').first();
    await expect(folder).toBeVisible();
    await folder.click();
    const card = page.getByTestId('file-list').locator('button').filter({ hasText: phrase }).first();
    await expect(card).toBeVisible();
    await card.focus();
    await card.click();
    const modal = page.getByTestId('card-modal');
    await expect(modal).toBeVisible();
    await expect(modal).toHaveAttribute('aria-labelledby', 'cardModalTitle');
    await expect(page.getByTestId('card-modal-close')).toBeFocused();
    await expect(page.getByTestId('card-srs-footer')).toHaveCount(0);
    await expect(page.locator('body')).toHaveClass(/card-modal-open/);
    await page.keyboard.press('Escape');
    await expect(modal).toBeHidden();
    await expect(card).toBeFocused();
    await expect(page.locator('body')).not.toHaveClass(/card-modal-open/);
  });
});
