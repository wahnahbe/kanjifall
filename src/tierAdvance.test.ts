import { describe, expect, it } from 'vitest';
import type { TierProgress } from './shared/api';
import { tierAdvanceLine } from './tierAdvance';

const tier = (over: Partial<TierProgress> = {}): TierProgress => ({
  level: 5, index: 1, totalTiers: 64, size: 10, solid: 0, amnestied: 0, unreachable: 0, ...over,
});

describe('tierAdvanceLine (tiered spec §5.4)', () => {
  it('reports an advance within the same level', () => {
    const before = [tier({ level: 5, index: 1 })];
    const after = [tier({ level: 5, index: 2 })];
    expect(tierAdvanceLine(before, after)).toBe('N5 tier 1 cleared — tier 2 is next.');
  });

  it('reports completion when the level has no active tier left', () => {
    const before = [tier({ level: 5, index: 64 })];
    const after = [tier({ level: 5, index: null, size: 0 })];
    expect(tierAdvanceLine(before, after)).toBe('N5 complete — every tier cleared.');
  });

  it('returns null when nothing advanced', () => {
    const before = [tier({ level: 5, index: 3 })];
    const after = [tier({ level: 5, index: 3 })];
    expect(tierAdvanceLine(before, after)).toBeNull();
  });

  it('returns null when the level was already complete before the run', () => {
    const before = [tier({ level: 5, index: null, size: 0 })];
    const after = [tier({ level: 5, index: null, size: 0 })];
    expect(tierAdvanceLine(before, after)).toBeNull();
  });

  it('returns null for a regression (active tier index moved backward)', () => {
    // solid is a live rolling check (plan doc's accepted edges): a later
    // miss can re-open an earlier tier. That is not an advance.
    const before = [tier({ level: 5, index: 5 })];
    const after = [tier({ level: 5, index: 3 })];
    expect(tierAdvanceLine(before, after)).toBeNull();
  });

  it('returns null when either side is null', () => {
    const some = [tier({ level: 5, index: 1 })];
    expect(tierAdvanceLine(null, some)).toBeNull();
    expect(tierAdvanceLine(some, null)).toBeNull();
    expect(tierAdvanceLine(null, null)).toBeNull();
  });

  it('mixed pool: picks the earliest-learned (highest level) advancing level, ignoring later ones', () => {
    const before = [
      tier({ level: 5, index: null, size: 0 }), // N5 already complete before the run
      tier({ level: 4, index: 2 }), // N4 advances
      tier({ level: 3, index: 1 }), // N3 advances too — must be ignored in favor of N4
      tier({ level: 2, index: 1 }), // N2 unchanged
    ];
    const after = [
      tier({ level: 5, index: null, size: 0 }),
      tier({ level: 4, index: 3 }),
      tier({ level: 3, index: 2 }),
      tier({ level: 2, index: 1 }),
    ];
    expect(tierAdvanceLine(before, after)).toBe('N4 tier 2 cleared — tier 3 is next.');
  });

  it('is order-independent: shuffled arrival order still resolves the earliest-learned level', () => {
    // Deliberately N2→N5 (reverse of the server's usual pool order), same
    // defensive posture as noticeFor's own order-independence test.
    const before = [
      tier({ level: 2, index: 1 }),
      tier({ level: 3, index: 1 }),
      tier({ level: 4, index: 2 }),
      tier({ level: 5, index: null, size: 0 }),
    ];
    const after = [
      tier({ level: 2, index: 1 }),
      tier({ level: 3, index: 1 }),
      tier({ level: 4, index: 3 }),
      tier({ level: 5, index: null, size: 0 }),
    ];
    expect(tierAdvanceLine(before, after)).toBe('N4 tier 2 cleared — tier 3 is next.');
  });
});
