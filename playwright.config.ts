import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  timeout: 100_000,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env.CLAUSID_TEST_BROWSER },
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://127.0.0.1:5173/healthz',
    reuseExistingServer: false,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
    timeout: 45_000,
    env: { CLAUSID_DATA_DIR: process.env.CLAUSID_DATA_DIR ?? '.data/e2e' },
  },
})
