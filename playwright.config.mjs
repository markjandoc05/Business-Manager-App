import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/uat',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.BSM_UAT_BASE_URL || 'http://127.0.0.1:3000',
    ...devices['Desktop Chrome'],
    channel: 'chrome',
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
