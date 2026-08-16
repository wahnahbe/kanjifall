import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom ships no 2D canvas backend, so any getContext('2d') call throws a
// "Not implemented" trace. Pixi probes for canvas blend-mode support at
// module-evaluation time (canvasUtils.mjs -> canUseNewCanvasBlendModes), which
// the visual-identity work put on the import path of every jsdom test that
// mounts <App/>. The probe's result is irrelevant here — nothing under test
// renders through Pixi's canvas backend — but the traces buried real output.
// Stub it to a no-op context so the probe answers and stays quiet.
//
// Guarded by `typeof HTMLCanvasElement`: this file is also loaded for the
// default `node` environment, where the class does not exist.
if (typeof HTMLCanvasElement !== 'undefined') {
  HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
}

// vite.config.ts runs with `globals: false`, so @testing-library/react's own
// `typeof afterEach === 'function'` auto-cleanup check never sees a global
// afterEach and silently no-ops. Register it explicitly so DOM from one test
// doesn't leak into the next when a file calls render() more than once.
afterEach(() => {
  cleanup();
});
