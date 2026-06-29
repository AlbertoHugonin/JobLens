import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    {
      name: 'chromium-mobile',
      use: {
        ...devices['Pixel 5'],
      },
    },
  ],
  testDir: './tests/e2e',
  timeout: 30_000,
  workers: 1,
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
});
