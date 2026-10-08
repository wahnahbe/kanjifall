import { describe, expect, it } from 'vitest';
import { MOTION } from '../../design/motion';
import { PALETTE } from '../../design/palette';
import {
  APPROACH_START_Y, approachMix, approachProgress, approachTint, deadlineFlickerAlpha, impactFrame, swellScaleX,
} from '../approach';

describe('approachProgress (second-pass spec §4.3 Approach)', () => {
  it('is 0 until the last fifth of the fall and 1 at the kill line', () => {
    expect(approachProgress(0)).toBe(0);
    expect(approachProgress(APPROACH_START_Y)).toBe(0);
    expect(approachProgress(0.9)).toBeCloseTo(0.5, 10);
    expect(approachProgress(1)).toBe(1);
    expect(approachProgress(1.2)).toBe(1);
  });
});

describe('approachTint', () => {
  it('runs from the system colour to danger, through a mix and never a third literal', () => {
    expect(approachTint(0)).toBe(PALETTE.system);
    expect(approachTint(1)).toBe(PALETTE.danger);
    const mid = approachTint(0.5);
    expect(mid).not.toBe(PALETTE.system);
    expect(mid).not.toBe(PALETTE.danger);
  });
});

describe('approachMix', () => {
  it('runs cyan → neutral → red without ever dimming the glyph', () => {
    expect(approachMix(0, 1)).toEqual({ hot: 0, base: 1 });
    expect(approachMix(0.25, 1)).toEqual({ hot: 0.5, base: 1 });
    expect(approachMix(0.5, 1)).toEqual({ hot: 1, base: 1 });
    expect(approachMix(0.75, 1)).toEqual({ hot: 1, base: 0.5 });
    expect(approachMix(1, 1)).toEqual({ hot: 1, base: 0 });
    for (const p of [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1]) {
      const { hot, base } = approachMix(p, 1);
      expect(1 - (1 - hot) * (1 - base)).toBeCloseTo(1, 10); // composite glyph opacity
    }
  });
  it('is a no-op at tintAlpha 0', () => {
    expect(approachMix(1, 0)).toEqual({ hot: 0, base: 1 });
  });
});

describe('swellScaleX', () => {
  it('grows from 0.2 to 1 with progress', () => {
    expect(swellScaleX(0)).toBeCloseTo(0.2, 10);
    expect(swellScaleX(1)).toBeCloseTo(1, 10);
  });
});

describe('impactFrame (Miss)', () => {
  it('spreads 0.5→1.4 along the floor and fades over --duration-flare', () => {
    expect(impactFrame(0)).toMatchObject({ scaleX: 0.5, alpha: 1, done: false });
    expect(impactFrame(MOTION.flareMs)).toEqual({ scaleX: 1.4, alpha: 0, done: true });
  });
});

describe('deadlineFlickerAlpha (Miss)', () => {
  it('dips, returns, dips, returns, over three snaps, and only when flicker is on', () => {
    expect(deadlineFlickerAlpha(0, 1)).toBe(0.45);
    expect(deadlineFlickerAlpha(MOTION.snapMs, 1)).toBe(1);
    expect(deadlineFlickerAlpha(MOTION.snapMs * 2, 1)).toBe(0.45);
    expect(deadlineFlickerAlpha(MOTION.snapMs * 3, 1)).toBe(1);
    expect(deadlineFlickerAlpha(0, 0)).toBe(1);
  });
});
