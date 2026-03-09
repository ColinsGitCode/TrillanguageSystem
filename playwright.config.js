const { defineConfig, devices } = require('@playwright/test');

const PORT = process.env.PLAYWRIGHT_PORT || '3310';
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${PORT}`;

module.exports = defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  timeout: 60_000,
  expect: {
    timeout: 10_000
  },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'output/playwright/report' }]],
  outputDir: 'output/playwright/test-results',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    viewport: { width: 1440, height: 1100 }
  },
  webServer: {
    command: 'bash ./scripts/startE2EServer.sh',
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome']
      }
    }
  ]
});
