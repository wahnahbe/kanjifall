import { afterEach, describe, expect, it, vi } from 'vitest';

// The dev client proxies /api to the API server. The server honors
// KOTOBA_PORT (server/index.ts), so the proxy target must follow the same
// override or `KOTOBA_PORT=8791 npm run dev` boots an API nobody talks to.
async function loadProxyTarget(): Promise<unknown> {
  vi.resetModules();
  const mod = await import('../../vite.config');
  const proxy = mod.default.server?.proxy as Record<string, unknown> | undefined;
  return proxy?.['/api'];
}

describe('vite dev proxy', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('targets the default API port when KOTOBA_PORT is unset', async () => {
    vi.stubEnv('KOTOBA_PORT', '');
    expect(await loadProxyTarget()).toBe('http://localhost:8790');
  });

  it('follows a KOTOBA_PORT override', async () => {
    vi.stubEnv('KOTOBA_PORT', '8791');
    expect(await loadProxyTarget()).toBe('http://localhost:8791');
  });
});
