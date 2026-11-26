import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests in a real browser:  npm run e2e   (from the repo root)
 * Starts the app if it is not already running, reloads the demo school, then drives every role
 * through the real screens. Any browser error, crashed screen or server error fails the test.
 */
export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }]],
  outputDir: 'e2e-results',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    cwd: '../..',
    url: 'http://localhost:5173/api/health',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
