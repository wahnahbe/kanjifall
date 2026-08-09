// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSettingsCache, updateSettings } from '../../data/settings';
import { comboPitch, sfx } from '../sfx';

beforeEach(() => {
  localStorage.clear();
  resetSettingsCache();
});
afterEach(() => vi.unstubAllGlobals());

describe('comboPitch', () => {
  it('is A4 at combo 0 and rises a semitone per step', () => {
    expect(comboPitch(0)).toBeCloseTo(440, 6);
    expect(comboPitch(1)).toBeCloseTo(440 * 2 ** (1 / 12), 6);
    expect(comboPitch(12)).toBeCloseTo(880, 6);
  });

  it('caps at one octave and clamps negatives', () => {
    expect(comboPitch(30)).toBeCloseTo(880, 6);
    expect(comboPitch(-3)).toBeCloseTo(440, 6);
  });
});

describe('sfx voices', () => {
  it('are silent no-ops without AudioContext (jsdom) — nothing throws', () => {
    expect(() => {
      sfx.kill(3); sfx.miss(); sfx.wrongSubmit(); sfx.waveClear();
      sfx.gameOver(); sfx.ceremonyChime(); sfx.tierFanfare();
    }).not.toThrow();
  });

  it('sound:false short-circuits before the context is even constructed', () => {
    const ctor = vi.fn(() => {
      throw new Error('must not construct');
    });
    vi.stubGlobal('AudioContext', ctor);
    updateSettings({ sound: false });
    sfx.kill(1);
    expect(ctor).not.toHaveBeenCalled();
  });
});
