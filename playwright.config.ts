import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  use: { baseURL: 'http://localhost:5183' },
  webServer: {
    // dev:e2e hardcodes the client port (5183) and points the API at a
    // dedicated e2e DB — unlike `npm run dev -- --port ...`, whose args the
    // concurrently-wrapped `dev` script silently swallows.
    command: 'npm run dev:e2e',
    url: 'http://localhost:5183',
    reuseExistingServer: false,
    timeout: 120_000, // two processes (vite + tsx server) booting, plus DB migrate/seed
  },
});
