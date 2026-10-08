import { describe, expect, it } from 'vitest';
import { MOTION } from '../../design/motion';
import { lockFlickerAlpha, spawnFrame } from '../spawnTween';

const FULL = { blurPx: 8, flicker: 1 as const };
const CALM = { blurPx: 0, flicker: 0 as const };

describe('spawnFrame (second-pass spec §4.3 Spawn)', () => {
  it('starts invisible and fully blurred, ends opaque and sharp', () => {
    expect(spawnFrame(0, FULL)).toMatchObject({ alpha: 0, blurPx: 8, done: false });
    expect(spawnFrame(MOTION.bleedMs, FULL)).toMatchObject({ alpha: 1, blurPx: 0, done: true });
  });

  it('is clean past its life (Review Focus 4: a word killed mid-bleed must not leave a half state)', () => {
    expect(spawnFrame(MOTION.bleedMs * 10, FULL)).toEqual({ alpha: 1, blurPx: 0, lightScale: 1, done: true });
  });

  it('decelerates: the blur is more than half gone at the midpoint', () => {
    expect(spawnFrame(MOTION.bleedMs / 2, FULL).blurPx).toBeLessThan(4);
  });

  it('flickers the light in three steps inside the first two snaps, then holds', () => {
    expect(spawnFrame(0, FULL).lightScale).toBe(1);
    expect(spawnFrame(MOTION.snapMs + 1, FULL).lightScale).toBe(0.3);
    expect(spawnFrame(MOTION.snapMs * 2 + 1, FULL).lightScale).toBe(1);
  });

  it('with flicker 0 and blur 0 it is an alpha fade and nothing else', () => {
    for (const age of [0, 50, 130, 259, 260]) {
      const f = spawnFrame(age, CALM);
      expect(f.blurPx).toBe(0);
      expect(f.lightScale).toBe(1);
    }
  });
});

describe('lockFlickerAlpha (second-pass spec §4.3 Lock)', () => {
  it('snaps 0.9, dips to 0.2, settles at 1 over two snaps', () => {
    expect(lockFlickerAlpha(0, 1)).toBe(0.9);
    expect(lockFlickerAlpha(MOTION.snapMs + 1, 1)).toBe(0.2);
    expect(lockFlickerAlpha(MOTION.snapMs * 2, 1)).toBe(1);
  });

  it('is a flat 1 when flicker is off', () => {
    expect(lockFlickerAlpha(0, 0)).toBe(1);
    expect(lockFlickerAlpha(MOTION.snapMs + 1, 0)).toBe(1);
  });
});
