import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// vite.config.ts runs with `globals: false`, so @testing-library/react's own
// `typeof afterEach === 'function'` auto-cleanup check never sees a global
// afterEach and silently no-ops. Register it explicitly so DOM from one test
// doesn't leak into the next when a file calls render() more than once.
afterEach(() => {
  cleanup();
});
