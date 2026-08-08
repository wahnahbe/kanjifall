import { afterEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '../testDb';

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe('cards.tier seeding', () => {
  it('connect() backfills a valid tier on every jlpt card row — no migration script needed', () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const bad = t.handle.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM cards WHERE source = 'jlpt' AND (tier IS NULL OR tier < 1)`)
      .get() as { n: number };
    expect(bad.n).toBe(0);

    // Contiguity per level: distinct tiers are exactly 1..max.
    for (const level of [5, 4, 3, 2]) {
      const rows = t.handle.sqlite
        .prepare(`SELECT DISTINCT tier FROM cards WHERE source = 'jlpt' AND jlpt = ? ORDER BY tier`)
        .all(level) as { tier: number }[];
      expect(rows[0].tier, `N${level}`).toBe(1);
      expect(rows[rows.length - 1].tier, `N${level}`).toBe(rows.length);
    }
  });
});
