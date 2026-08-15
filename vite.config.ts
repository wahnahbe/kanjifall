import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Honors a harness-assigned PORT (e.g. Claude's preview autoPort) while
    // keeping vite's 5173 default; dev:e2e's explicit --port 5183 CLI flag
    // still overrides both.
    port: Number(process.env.PORT) || 5173,
    proxy: { '/api': 'http://localhost:8790' },
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
  },
  test: {
    environment: 'node', // ui tests opt into jsdom via per-file pragma
    include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts'],
    setupFiles: ['src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/engine/**', 'src/data/**', 'server/**'],
      exclude: ['server/index.ts', 'server/testDb.ts'],
      thresholds: { lines: 80, functions: 80, branches: 80 },
    },
  },
});
