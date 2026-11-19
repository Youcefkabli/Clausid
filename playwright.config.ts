import { defineConfig } from '@playwright/test'

const origin = `http://127.0.0.1:${process['env']['CLAUSID_VITE_PORT'] ?? '5173'}`

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  timeout: 100_000,
  // The shared local auth service rate-limits sign-ins by IP.
  workers: 1,
  use: {
    baseURL: origin,
    trace: 'retain-on-failure',
    launchOptions: process.env['CLAUSID_TEST_BROWSER'] ? { executablePath: process.env['CLAUSID_TEST_BROWSER'] } : {},
  },
  webServer: {
    command: 'pnpm dev',
    url: origin + '/healthz',
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    timeout: 120_000,
    env: {
      CLAUSID_DATA_DIR: process['env']['CLAUSID_DATA_DIR'] ?? '.data/e2e',
      PUBLIC_ORIGIN: origin,
    },
  },
})
