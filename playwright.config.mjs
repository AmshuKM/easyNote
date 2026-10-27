import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '*.spec.mjs',
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: 'http://localhost:5173' },
  webServer: {
    command: 'npm start',
    url: 'http://localhost:5173/',
    reuseExistingServer: true,
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
    { name: 'phone', use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
  ],
});
