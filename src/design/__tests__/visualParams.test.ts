import { describe, expect, it } from 'vitest';
import { visualParams } from '../visualParams';

describe('visualParams (visual-identity spec §7)', () => {
  it('full gets every decoration', () => {
    const p = visualParams('full');
    expect(p.chromaticSplitPx).toBeGreaterThan(0);
    expect(p.haloAlpha).toBe(1);
    expect(p.glowAlpha).toBe(1);
    expect(p.grainAlpha).toBeGreaterThan(0);
  });

  it('reduced drops the chromatic split but keeps glow and grain', () => {
    const p = visualParams('reduced');
    expect(p.chromaticSplitPx).toBe(0);
    expect(p.haloAlpha).toBeLessThan(1);
    expect(p.haloAlpha).toBeGreaterThan(0);
    expect(p.glowAlpha).toBe(0.5);
    expect(p.grainAlpha).toBeGreaterThan(0);
  });

  it('off strips all decoration', () => {
    expect(visualParams('off')).toEqual({
      chromaticSplitPx: 0, haloAlpha: 0, glowAlpha: 0, grainAlpha: 0,
    });
  });

  it('never returns a negative or out-of-range alpha', () => {
    for (const level of ['full', 'reduced', 'off'] as const) {
      const p = visualParams(level);
      for (const alpha of [p.haloAlpha, p.glowAlpha, p.grainAlpha]) {
        expect(alpha).toBeGreaterThanOrEqual(0);
        expect(alpha).toBeLessThanOrEqual(1);
      }
      expect(p.chromaticSplitPx).toBeGreaterThanOrEqual(0);
    }
  });
});
