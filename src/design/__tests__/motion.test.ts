import { describe, expect, it } from 'vitest';
import { EASE, MOTION } from '../motion';

describe('motion tokens (second-pass spec §4.2)', () => {
  it('declares the seven new durations and keeps the three existing ones', () => {
    expect(MOTION).toEqual({
      fastMs: 120, baseMs: 220, slowMs: 600,
      bleedMs: 260, snapMs: 90, slashMs: 120, flareMs: 420, burstMs: 480, transitionMs: 360, beatMs: 1200,
    });
  });

  it('a flicker step never exceeds the 300ms rule (spec §7.7)', () => {
    expect(MOTION.snapMs * 3).toBeLessThanOrEqual(300);
  });

  it('ink decelerates and drain accelerates', () => {
    expect(EASE.ink).toBe('cubic-bezier(0.15, 0.85, 0.35, 1)');
    expect(EASE.drain).toBe('cubic-bezier(0.6, 0, 0.9, 0.6)');
  });
});
