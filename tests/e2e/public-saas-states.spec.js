const { test, expect } = require('@playwright/test');
const {
  renderGatewayErrorPage,
} = require('../../services/sandbox/gatewayErrorPage');

test.describe('public SaaS recovery states', () => {
  test('capacity page is branded, recoverable and stable in light and dark themes', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.setContent(renderGatewayErrorPage({
      status: 503,
      code: 'SANDBOX_CAPACITY_FULL',
    }, {
      feedbackUrl: 'https://support.example.com/three-lans',
    }));
    await expect(page.getByRole('heading', { name: '体验空间暂时已满' })).toBeVisible();
    await expect(page.getByText('个人工作区没有被连接或共享')).toBeVisible();
    await expect(page.getByRole('link', { name: '重新尝试' })).toHaveAttribute('href', '/');
    await expect(page.getByRole('link', { name: '提交问题' })).toHaveAttribute(
      'href',
      'https://support.example.com/three-lans'
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
    await expect(page).toHaveScreenshot('public-sandbox-capacity-desktop.png', {
      fullPage: true,
    });

    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page).toHaveScreenshot('public-sandbox-capacity-desktop-dark.png', {
      fullPage: true,
    });
  });
});
