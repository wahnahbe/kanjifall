import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node', // ui tests opt into jsdom via per-file pragma
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/engine/**', 'src/data/**'],
      thresholds: { lines: 80, functions: 80, branches: 80 },
    },
  },
} as any);
