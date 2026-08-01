import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  webServer: {
    // Vite dev server with the @forge/bridge mock aliased in.
    command: 'npm run dev -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    env: { E2E_MOCK_BRIDGE: '1' },
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
