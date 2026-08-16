import { describe, expect, it } from 'vitest';
import { reticleBrackets } from '../reticle';

describe('reticleBrackets (visual-identity spec §5.3)', () => {
  it('returns two arms per corner', () => {
    expect(reticleBrackets(40, 25, 10, 18, 2)).toHaveLength(8);
  });

  it('is symmetric about both axes', () => {
    const rects = reticleBrackets(40, 25, 10, 18, 2);
    const sumX = rects.reduce((acc, r) => acc + r.x + r.w / 2, 0);
    const sumY = rects.reduce((acc, r) => acc + r.y + r.h / 2, 0);
    expect(sumX).toBeCloseTo(0);
    expect(sumY).toBeCloseTo(0);
  });

  it('sits outside the word bounds by the padding', () => {
    const rects = reticleBrackets(40, 25, 10, 18, 2);
    const left = Math.min(...rects.map((r) => r.x));
    const top = Math.min(...rects.map((r) => r.y));
    expect(left).toBeCloseTo(-50);
    expect(top).toBeCloseTo(-35);
  });

  it('never returns a zero-area rect', () => {
    for (const r of reticleBrackets(40, 25, 10, 18, 2)) {
      expect(r.w).toBeGreaterThan(0);
      expect(r.h).toBeGreaterThan(0);
    }
  });
});
