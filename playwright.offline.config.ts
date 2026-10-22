import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: 'offline.spec.ts',
  workers: 1,
  use: { baseURL: 'http://localhost:3000', headless: true },
  webServer: {
    env: { DATABASE_URL: process.env.DATABASE_URL || '.data/e2e' },
    command: 'npm run preview',
    url: 'http://localhost:3000/api/health',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
