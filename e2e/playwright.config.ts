import { defineConfig, devices } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from '../scripts/lib/e2e-accounts.mjs';

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

/**
 * The suite gets its own embedded database so it never mixes with the developer's data. Placeholder bank details so
 * the transfer checkout opens locally; no real account and no real money involved.
 */
const apiEnv = {
  ...process.env,
  PGLITE_DATA_DIR: process.env.PGLITE_DATA_DIR ?? './.data/pglite-e2e',
  BILLING_BANK_NAME: process.env.BILLING_BANK_NAME ?? 'Banco de Pruebas E2E',
  BILLING_BANK_ACCOUNT: process.env.BILLING_BANK_ACCOUNT ?? '000-000000-0',
  BILLING_BANK_ACCOUNT_TYPE: process.env.BILLING_BANK_ACCOUNT_TYPE ?? 'Corriente',
  BILLING_BANK_HOLDER: process.env.BILLING_BANK_HOLDER ?? 'Cuenta de prueba',
  BILLING_BANK_HOLDER_ID: process.env.BILLING_BANK_HOLDER_ID ?? '000000000',
  E2E_PLATFORM_ADMIN_EMAIL: ADMIN_EMAIL,
  E2E_PLATFORM_ADMIN_PASSWORD: ADMIN_PASSWORD,
};

export default defineConfig({
  testDir: '.',
  outputDir: '../test-results',
  globalSetup: './global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: '../playwright-report', open: 'never' }]],
  use: {
    baseURL,
    locale: 'es-DO',
    timezoneId: 'America/Santo_Domingo',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : [
        // A reused API must have been started with the same env, otherwise the admin and bank details are missing.
        { command: 'pnpm --filter @facilito/api dev', url: 'http://127.0.0.1:3001/health', reuseExistingServer: true, timeout: 120_000, cwd: '..', env: apiEnv },
        { command: 'pnpm --filter @facilito/web start', url: baseURL, reuseExistingServer: true, timeout: 120_000, cwd: '..', env: { ...process.env, CONTACT_DELIVERY: 'sink' } },
      ],
});
