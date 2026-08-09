import { afterEach, describe, expect, it } from 'vitest';
import { connect } from '../db/connect';
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

describe('stale seed cleanup', () => {
  it('connect() purges jlpt rows from superseded list versions but never custom cards', () => {
    // A jlpt row left behind by an older data build can never spawn (the
    // static pool no longer contains it) yet still sits in every tier-gate
    // denominator and stats total — a permanent, silent stall. Seeding must
    // delete it. Custom cards carry their own list versions and must survive.
    const t = makeTestDb();
    cleanup = t.cleanup;
    t.handle.sqlite
      .prepare(
        `INSERT INTO cards (id, kanji, kana, gloss, pos, jlpt, tier, source, list_version)
         VALUES ('jm-9999999', '幽', '["ゆう"]', 'ghost', 'n', 5, 2, 'jlpt', 'jlpt-tanos-jmdict-0.0.0-v0')`,
      )
      .run();
    t.handle.sqlite
      .prepare(
        `INSERT INTO cards (id, kanji, kana, gloss, pos, jlpt, tier, source, list_version)
         VALUES ('custom-1', NULL, '["てすと"]', 'test word', 'n', NULL, NULL, 'custom', 'custom-v0')`,
      )
      .run();

    const reopened = connect(t.dbPath);
    try {
      expect(reopened.sqlite.prepare(`SELECT id FROM cards WHERE id = 'jm-9999999'`).get()).toBeUndefined();
      expect(reopened.sqlite.prepare(`SELECT id FROM cards WHERE id = 'custom-1'`).get()).toEqual({
        id: 'custom-1',
      });
    } finally {
      reopened.sqlite.close();
    }
  });
});
