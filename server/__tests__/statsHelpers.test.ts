import { describe, expect, it } from 'vitest';
import { attempts } from '../db/schema';
import {
  computeCardStats, computeEstimatedLevel, computeLevelRows, toLevel, type LevelStat,
} from '../statsHelpers';

type AttemptRow = typeof attempts.$inferSelect;

let nextId = 1;
function fakeAttempt(overrides: Partial<AttemptRow> = {}): AttemptRow {
  return {
    id: nextId++,
    runId: 'run-x',
    cardId: 'card-x',
    mode: 'reading',
    outcome: 'kill',
    msToFirstKey: 100,
    msToKill: 900,
    backspaceCount: 0,
    hintShown: false,
    wasTargeted: true,
    airborneCount: 1,
    speedLevel: 1,
    createdAt: 1_000_000,
    ...overrides,
  };
}

describe('toLevel', () => {
  it('passes valid JLPT levels through and falls back to 2 for anything else', () => {
    expect(toLevel(5)).toBe(5);
    expect(toLevel(4)).toBe(4);
    expect(toLevel(3)).toBe(3);
    expect(toLevel(2)).toBe(2);
    // Defensive fallback: profile.targetLevel/cards.jlpt are plain `number` columns at the DB layer,
    // not re-validated on read — a corrupt value falls back to the app's own N2 default, not a crash.
    expect(toLevel(7)).toBe(2);
    expect(toLevel(0)).toBe(2);
  });
});

describe('computeCardStats', () => {
  it('computes a finite strength when a kill has a null msToKill (nullable column regardless of outcome)', () => {
    const killWithNullSpeed = fakeAttempt({ outcome: 'kill', msToKill: null });
    const group = { all: [killWithNullSpeed], reading: [killWithNullSpeed], recall: [] };
    const result = computeCardStats(group);
    // recencyAccuracy = 1 (the only attempt is a kill); killCount stays 0 (msToKill null is never
    // added to the speed average) -> speedFactor = 0 -> strength = round(100*(0.7*1+0.3*0)) = 70.
    expect(result.strength).toBe(70);
  });
});

describe('computeLevelRows', () => {
  it('guards coverage and mastery against 0/0 when a level has zero total cards', () => {
    const rows = computeLevelRows([], new Map());
    expect(rows).toHaveLength(4);
    for (const row of rows) {
      expect(row.total).toBe(0);
      expect(row.encountered).toBe(0);
      expect(row.coverage).toBe(0);
      expect(row.mastery).toBe(0);
    }
  });
});

describe('computeEstimatedLevel', () => {
  it('returns null when no level clears both thresholds', () => {
    const levels: LevelStat[] = [
      { level: 5, total: 100, encountered: 50, learned: 50, coverage: 0.5, mastery: 1 }, // coverage 0.5 < 0.6
      { level: 4, total: 100, encountered: 80, learned: 40, coverage: 0.8, mastery: 0.5 }, // mastery 0.5 < 0.7
    ];
    expect(computeEstimatedLevel(levels)).toBeNull();
  });

  it('returns the lowest N-number among levels that pass both thresholds (most advanced clears first)', () => {
    const levels: LevelStat[] = [
      { level: 5, total: 100, encountered: 95, learned: 90, coverage: 0.95, mastery: 90 / 95 }, // passes: 0.95>=.6, .947>=.7
      { level: 4, total: 100, encountered: 65, learned: 50, coverage: 0.65, mastery: 50 / 65 }, // passes: 0.65>=.6, .769>=.7
      { level: 3, total: 100, encountered: 20, learned: 5, coverage: 0.2, mastery: 0.25 }, // fails coverage
      { level: 2, total: 100, encountered: 10, learned: 1, coverage: 0.1, mastery: 0.1 }, // fails both
    ];
    expect(computeEstimatedLevel(levels)).toBe(4); // lowest N-number among {5,4} that pass
  });
});
