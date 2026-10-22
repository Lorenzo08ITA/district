import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  testIgnore: 'offline.spec.ts',
  fullyParallel: false,
  workers: 1,
  use: { baseURL: 'http://localhost:3000', headless: true },
  webServer: {
    env: { DATABASE_URL: process.env.DATABASE_URL || '.data/e2e' },
    command: 'npm run dev',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
