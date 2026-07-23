/// <reference types="vitest/config" />
import { defineConfig, type UserConfigExport } from 'vite';
import react from '@vitejs/plugin-react';

const config: UserConfigExport & { test?: unknown } = {
  plugins: [react()],
  test: {
    environment: 'node',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test-setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/engine/**', 'src/data/**'],
      thresholds: { lines: 80, functions: 80, branches: 80 },
    },
  },
};

export default defineConfig(config);
