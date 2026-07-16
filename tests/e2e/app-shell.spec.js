const { test, expect } = require('@playwright/test');

test.describe('React root shell', () => {
  test('root is the only Cards Factory route and legacy entries stay retired', async ({ page, request }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Cards Factory/);
    await expect(page.getByTestId('react-cards-factory')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Cards Factory' })).toHaveAttribute('href', '/');
    await expect(page.getByRole('link', { name: 'Cards Factory' })).toHaveAttribute('aria-current', 'page');

    const knowledgeResponse = await request.get('/knowledge');
    expect(knowledgeResponse.status()).toBe(200);

    for (const path of ['/__rr-poc', '/index.html', '/dashboard.html', '/knowledge-hub.html', '/knowledge-ops.html']) {
      expect((await request.get(path)).status(), path).toBe(404);
    }
  });

  test('system theme resolves after hydration and explicit choice persists', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByRole('button', { name: '切换主题' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('three-lans-theme-v1'))).toBe('light');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('desktop navigation can collapse to icons and persists the choice', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/textbooks');
    await page.getByRole('button', { name: '收起导航' }).click();
    await expect(page.locator('.react-app-shell')).toHaveClass(/sidebar-compact/u);
    await expect(page.getByRole('link', { name: '教材课程' })).toHaveAttribute('title', '教材课程');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('three-lans-sidebar-compact-v1'))).toBe('true');
    await page.reload();
    await expect(page.locator('.react-app-shell')).toHaveClass(/sidebar-compact/u);
    await page.getByRole('button', { name: '展开导航' }).click();
    await expect(page.locator('.react-app-shell')).not.toHaveClass(/sidebar-compact/u);
  });

  test('dark semantic text tokens meet AA contrast and reduced motion is honored', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('three-lans-theme-v1', 'dark'));
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.goto('/');
    const result = await page.evaluate(() => {
      const root = getComputedStyle(document.documentElement);
      const parse = (value) => {
        const node = document.createElement('span');
        node.style.color = value.trim();
        document.body.appendChild(node);
        const match = getComputedStyle(node).color.match(/[\d.]+/g).map(Number);
        node.remove();
        return match.slice(0, 3);
      };
      const luminance = (rgb) => {
        const values = rgb.map((value) => {
          const channel = value / 255;
          return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
      };
      const ratio = (a, b) => {
        const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x);
        return (lighter + 0.05) / (darker + 0.05);
      };
      const surface = parse(root.getPropertyValue('--color-bg-surface'));
      return {
        primary: ratio(parse(root.getPropertyValue('--color-text-primary')), surface),
        secondary: ratio(parse(root.getPropertyValue('--color-text-secondary')), surface),
        transition: getComputedStyle(document.querySelector('.icon-button')).transitionDuration,
      };
    });
    expect(result.primary).toBeGreaterThanOrEqual(4.5);
    expect(result.secondary).toBeGreaterThanOrEqual(4.5);
    expect(Number.parseFloat(result.transition || '0')).toBeLessThanOrEqual(0.00001);
  });

  test('health endpoint has one React owner', async ({ page }) => {
    let count = 0;
    await page.route('**/api/health', async (route) => {
      count += 1;
      await route.continue();
    });
    await page.goto('/');
    await expect.poll(() => count).toBe(1);
    await page.waitForTimeout(500);
    expect(count).toBe(1);
  });
});
