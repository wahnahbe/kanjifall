import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
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
