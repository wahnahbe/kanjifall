import { describe, expect, it } from 'vitest';
import { MOTION } from '../motion';
import { visualParams } from '../visualParams';

// Second-pass spec §6, one row per field. The table is the oracle: a value
// here that disagrees with the spec is a bug in whichever one changed last.
describe('visualParams (first spec §7, second-pass spec §6)', () => {
  it('full gets every decoration', () => {
    expect(visualParams('full')).toEqual({
      chromaticSplitPx: 1.4, haloAlpha: 1, glowAlpha: 1, grainAlpha: 1, atmosphereAlpha: 1, drift: 1,
      spawnBlurPx: 8, bleed: 1, flicker: 1, slashAlpha: 1, flareAlpha: 1, approachTintAlpha: 1, swellAlpha: 1,
      impactAlpha: 1, shakePx: 2, transitionBlurPx: 12, transitionMs: MOTION.transitionMs, waveBeat: 'centre',
    });
  });

  it('reduced keeps forms and drops every flicker, blur and shake', () => {
    expect(visualParams('reduced')).toEqual({
      chromaticSplitPx: 0, haloAlpha: 0.5, glowAlpha: 0.5, grainAlpha: 0.5, atmosphereAlpha: 0.5, drift: 0,
      spawnBlurPx: 0, bleed: 1, flicker: 0, slashAlpha: 1, flareAlpha: 0.5, approachTintAlpha: 1, swellAlpha: 0,
      impactAlpha: 0.5, shakePx: 0, transitionBlurPx: 0, transitionMs: MOTION.transitionMs, waveBeat: 'fade',
    });
  });

  it('off strips all decoration but never a state carrier', () => {
    expect(visualParams('off')).toEqual({
      chromaticSplitPx: 0, haloAlpha: 0, glowAlpha: 0, grainAlpha: 0, atmosphereAlpha: 0, drift: 0,
      spawnBlurPx: 0, bleed: 0, flicker: 0, slashAlpha: 0, flareAlpha: 0, approachTintAlpha: 0, swellAlpha: 0,
      impactAlpha: 0, shakePx: 0, transitionBlurPx: 0, transitionMs: MOTION.fastMs, waveBeat: 'slot',
    });
  });

  it('never returns a negative or out-of-range alpha', () => {
    for (const level of ['full', 'reduced', 'off'] as const) {
      const p = visualParams(level);
      for (const alpha of [p.haloAlpha, p.glowAlpha, p.grainAlpha, p.atmosphereAlpha, p.slashAlpha, p.flareAlpha, p.approachTintAlpha, p.swellAlpha, p.impactAlpha]) {
        expect(alpha).toBeGreaterThanOrEqual(0);
        expect(alpha).toBeLessThanOrEqual(1);
      }
      expect(p.chromaticSplitPx).toBeGreaterThanOrEqual(0);
      expect(p.shakePx).toBeGreaterThanOrEqual(0);
    }
  });

  it('the shake is a jolt, not a hit (spec §4.3: 2px, down from 4)', () => {
    expect(visualParams('full').shakePx).toBe(2);
  });

  it('a transition is never a cut (spec §4.4)', () => {
    for (const level of ['full', 'reduced', 'off'] as const) expect(visualParams(level).transitionMs).toBeGreaterThan(0);
  });

  it('ambient layers drift only at full: reduced (the reduced-motion default) holds still (spec §6)', () => {
    expect([visualParams('full').drift, visualParams('reduced').drift, visualParams('off').drift]).toEqual([1, 0, 0]);
  });

  it('reduced still bleeds forms in; off makes them appear (spec §6 spawn and title rows)', () => {
    expect(visualParams('full').bleed).toBe(1);
    expect(visualParams('reduced').bleed).toBe(1);
    expect(visualParams('off').bleed).toBe(0);
  });
});
