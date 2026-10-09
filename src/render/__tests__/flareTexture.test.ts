import { afterEach, describe, expect, it, vi } from 'vitest';
import { tryFlareTexture } from '../flareTexture';

describe('tryFlareTexture (juice-pass spec §9 posture)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns null instead of throwing when the 2D context is unavailable, and warns once', () => {
    vi.stubGlobal('document', { createElement: () => ({ getContext: () => null }) });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(tryFlareTexture()).toBeNull();
    expect(tryFlareTexture()).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
