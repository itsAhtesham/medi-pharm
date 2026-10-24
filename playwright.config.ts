import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
if (existsSync('.env.test.local')) process.loadEnvFile('.env.test.local');
if (!process.env.TEST_DATABASE_URL) throw new Error('Set TEST_DATABASE_URL; see .env.test.example');
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DATABASE_DIRECT_URL = process.env.TEST_DATABASE_URL;
process.env.E2E_PASSWORD ??= randomBytes(24).toString('base64url');
process.env.JWT_SECRET = 'e2e-only-signing-secret-never-deploy-123456789';
process.env.RATE_LIMIT_SECRET = 'e2e-only-limiter-secret-never-deploy-123456789';
process.env.APP_URL = 'http://127.0.0.1:3100';
process.env.TRUSTED_PROXY = 'none';
export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e-setup.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  use: {
    baseURL: process.env.APP_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command:
      process.env.E2E_PRODUCTION === '1'
        ? 'pnpm start --hostname 127.0.0.1 --port 3100'
        : 'pnpm exec next dev --hostname 127.0.0.1 --port 3100',
    url: 'http://127.0.0.1:3100/login',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
