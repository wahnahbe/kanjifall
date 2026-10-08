import { describe, expect, it } from 'vitest';
import { MOTION } from '../../design/motion';
import { dropletPolygon, flareFrame, slashFrame } from '../killFx';

describe('slashFrame (second-pass spec §4.3 Kill)', () => {
  it('draws itself over --duration-slash, holds one snap, fades over two', () => {
    expect(slashFrame(0)).toMatchObject({ scaleX: 0, alpha: 1, done: false });
    expect(slashFrame(MOTION.slashMs)).toMatchObject({ scaleX: 1, alpha: 1, done: false });
    expect(slashFrame(MOTION.slashMs + MOTION.snapMs)).toMatchObject({ scaleX: 1, alpha: 1 });
    const mid = slashFrame(MOTION.slashMs + MOTION.snapMs * 2);
    expect(mid.alpha).toBeCloseTo(0.5, 5);
    expect(slashFrame(MOTION.slashMs + MOTION.snapMs * 3)).toEqual({ scaleX: 1, alpha: 0, done: true });
  });
  it('decelerates while drawing', () => {
    expect(slashFrame(MOTION.slashMs / 2).scaleX).toBeGreaterThan(0.5);
  });
});

describe('flareFrame', () => {
  it('blooms from 0.1 to 1.7 and fades out over --duration-flare', () => {
    expect(flareFrame(0)).toMatchObject({ scale: 0.1, alpha: 1, done: false });
    expect(flareFrame(MOTION.flareMs)).toEqual({ scale: 1.7, alpha: 0, done: true });
    expect(flareFrame(MOTION.flareMs * 3)).toEqual({ scale: 1.7, alpha: 0, done: true });
  });
});

describe('dropletPolygon', () => {
  it('is four points around the origin, irregular, within 0.7–1.3 of the size', () => {
    const pts = dropletPolygon(0.37, 4);
    expect(pts).toHaveLength(8);
    const radii = [0, 2, 4, 6].map((i) => Math.hypot(pts[i], pts[i + 1]));
    for (const r of radii) {
      expect(r).toBeGreaterThanOrEqual(4 * 0.7 - 1e-9);
      expect(r).toBeLessThanOrEqual(4 * 1.3 + 1e-9);
    }
    expect(new Set(radii.map((r) => r.toFixed(6))).size).toBeGreaterThan(1);
  });
  it('is a pure function of its seed', () => {
    expect(dropletPolygon(0.5, 3)).toEqual(dropletPolygon(0.5, 3));
    expect(dropletPolygon(0.5, 3)).not.toEqual(dropletPolygon(0.9, 3));
  });
});
