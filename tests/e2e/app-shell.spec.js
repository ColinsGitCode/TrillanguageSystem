const { test, expect } = require('@playwright/test');

test.describe('shared theme and shell primitives', () => {
  test('system preference resolves before the page renders', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'system');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('theme menu supports keyboard selection and persistence', async ({ page }) => {
    await page.goto('/');
    const trigger = page.getByRole('button', { name: '主题', exact: true });
    await trigger.click();
    const system = page.getByRole('menuitemradio', { name: '跟随系统' });
    await expect(system).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitemradio', { name: '浅色' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('three-lans-theme-v1'))).toBe('dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme-preference', 'dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('Escape closes the menu and restores focus', async ({ page }) => {
    await page.goto('/dashboard.html');
    const trigger = page.getByRole('button', { name: '主题', exact: true });
    await trigger.click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu', { name: '主题选择' })).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('embedded cards do not mount shell controls', async ({ page, request }) => {
    const result = await request.post('/api/generate', {
      data: { phrase: 'embed theme baseline', cardType: 'trilingual' }
    });
    expect(result.ok()).toBeTruthy();
    const payload = await result.json();
    await page.goto(`/?card=${payload.generationId}&embed=1`);
    await expect(page.locator('[data-theme-control]')).toHaveCount(0);
    await expect(page.getByTestId('card-modal')).toBeVisible();
  });

  test('dark semantic text tokens meet AA contrast and reduced motion is honored', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('three-lans-theme-v1', 'dark'));
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.goto('/knowledge-hub.html');
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
        transition: getComputedStyle(document.querySelector('.ui-icon-button')).transitionDuration
      };
    });
    expect(result.primary).toBeGreaterThanOrEqual(4.5);
    expect(result.secondary).toBeGreaterThanOrEqual(4.5);
    expect(Number.parseFloat(result.transition)).toBeLessThanOrEqual(0.00001);
  });
});
