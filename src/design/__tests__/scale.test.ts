import { describe, expect, it } from 'vitest';
import { HEIGHT as BRUSH_HEIGHT } from '../../render/brushStroke';
import { HUD_SCALE, playScale, WORD_PX_MAX, WORD_PX_MIN } from '../scale';

describe('playScale (second-pass spec §3.3)', () => {
  it('gives 52px words on the 800px-tall reference window', () => {
    expect(playScale(800).wordPx).toBe(52);
  });

  it('clamps at both ends', () => {
    expect(playScale(100).wordPx).toBe(WORD_PX_MIN);
    expect(playScale(5000).wordPx).toBe(WORD_PX_MAX);
    expect(playScale(0).wordPx).toBe(WORD_PX_MIN); // jsdom reports 0 heights
  });

  it('never drops below the chromatic-split floor of 40px', () => {
    expect(WORD_PX_MIN).toBeGreaterThanOrEqual(40);
  });

  it('scales the floor with the word, from the stroke generator\'s native height', () => {
    expect(playScale(800).floorPx).toBe(Math.round(BRUSH_HEIGHT * 52 / 40)); // 34
  });

  it('lifts the HUD a little less than the play layer', () => {
    expect(playScale(800).hudScale).toBe(HUD_SCALE);
    expect(HUD_SCALE).toBeLessThan(52 / 40);
  });
});
