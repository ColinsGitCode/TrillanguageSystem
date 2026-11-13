const { defineConfig, devices } = require('@playwright/test');
const base = require('./playwright.config');
module.exports = defineConfig({
  ...base,
  testMatch: /modern-web-guidance\.spec\.js/,
  projects: [
    {name:'chromium', use:devices['Desktop Chrome']},
    {name:'firefox', use:devices['Desktop Firefox']},
    {name:'webkit', use:devices['Desktop Safari']},
  ],
});
