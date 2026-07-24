import { afterEach, describe, expect, it } from 'vitest';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { makeTestDb } from '../testDb';
import { attempts, cards, runs } from '../db/schema';
import { computeOverview, computeWordStats } from '../stats';
import type { DbHandle } from '../db/connect';

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

// Fixed "now" for every assertion below: 2026-08-01T12:00:00Z (noon UTC). days(n) walks back n
// whole days, staying at 12:00 UTC so every timestamp lands mid-day in its own UTC calendar date
// (no boundary risk for the toISOString().slice(0,10) bucketing stats.ts uses for trend/streak).
const NOW = Date.parse('2026-08-01T12:00:00Z');
const days = (n: number): number => NOW - n * 86_400_000;

function seedRun(handle: DbHandle, runId: string): void {
  handle.db.insert(runs).values({
    id: runId,
    startedAt: days(10),
    mode: 'reading',
    pool: 'n5',
    appVersion: '1.0.0',
    listVersion: 'v1',
  }).run();
}

interface AttemptOverrides {
  hintShown?: boolean;
  msToKill?: number;
}

type Mode = 'reading' | 'recall';

function record(
  handle: DbHandle,
  runId: string,
  cardId: string,
  mode: Mode,
  outcome: 'kill' | 'miss',
  createdAt: number,
  overrides: AttemptOverrides = {},
): void {
  handle.db.insert(attempts).values({
    runId,
    cardId,
    mode,
    outcome,
    // Every kill in this fixture uses a fixed 1000ms so the leech "speed factor" term
    // (clamp01(1 - avgKillMs/15000)) is a single known constant (14/15) throughout — isolating the
    // recency-weighted-accuracy term (which genuinely varies across attempts) as the thing under test.
    msToKill: outcome === 'kill' ? (overrides.msToKill ?? 1000) : null,
    msToFirstKey: outcome === 'kill' ? 200 : null,
    backspaceCount: 0,
    hintShown: overrides.hintShown ?? false,
    wasTargeted: true,
    airborneCount: 1,
    speedLevel: 1,
    createdAt,
  }).run();
}

function kill(
  handle: DbHandle, runId: string, cardId: string, mode: Mode, createdAt: number,
  overrides: AttemptOverrides = {},
): void {
  record(handle, runId, cardId, mode, 'kill', createdAt, overrides);
}

function miss(handle: DbHandle, runId: string, cardId: string, mode: Mode, createdAt: number): void {
  record(handle, runId, cardId, mode, 'miss', createdAt);
}

type CardRow = typeof cards.$inferSelect;

/**
 * Real seeded n5/n2 card ids (connect() seeds all 4,678 committed JLPT cards, including n5=633,
 * n2=1776 — the fixture's math below depends on those level TOTALS, not on which specific cards are
 * chosen, per the task's binding instructions). n5 cards are additionally filtered to have a non-null
 * kanji so the leech assertion's `kanji` field check below is non-vacuous.
 */
function pickFixtureCards(handle: DbHandle): {
  cardA: CardRow; cardB: CardRow; cardC: CardRow; cardD: CardRow;
} {
  const n5 = handle.db.select().from(cards)
    .where(and(eq(cards.source, 'jlpt'), eq(cards.jlpt, 5), isNotNull(cards.kanji)))
    .orderBy(asc(cards.id))
    .limit(3)
    .all();
  const n2 = handle.db.select().from(cards)
    .where(and(eq(cards.source, 'jlpt'), eq(cards.jlpt, 2)))
    .orderBy(asc(cards.id))
    .limit(1)
    .all();
  const [cardA, cardB, cardC] = n5;
  const [cardD] = n2;
  if (!cardA || !cardB || !cardC || !cardD) throw new Error('fixture requires 3 n5 + 1 n2 seeded cards');
  return { cardA, cardB, cardC, cardD };
}

describe('computeOverview — golden fixture', () => {
  it('matches every hand-computed number', () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const { cardA, cardB, cardC, cardD } = pickFixtureCards(t.handle);
    const runId = 'run-1';
    seedRun(t.handle, runId);

    // Card A (n5): reading, 3 unhinted kills -> weighted acc over last 5 (only 3 present) = 3/3 = 1.0
    // >= 0.8 -> learned, crossing at the 3rd attempt. learnedAt = days(8).
    kill(t.handle, runId, cardA.id, 'reading', days(10));
    kill(t.handle, runId, cardA.id, 'reading', days(9));
    kill(t.handle, runId, cardA.id, 'reading', days(8));

    // Card B (n5): reading, 3 HINTED kills -> each weighs hintedKillWeight(0.5); weighted acc =
    // (0.5+0.5+0.5)/3 = 0.5 < 0.8 -> NOT learned.
    kill(t.handle, runId, cardB.id, 'reading', days(4), { hintShown: true });
    kill(t.handle, runId, cardB.id, 'reading', days(3), { hintShown: true });
    kill(t.handle, runId, cardB.id, 'reading', days(2), { hintShown: true });

    // Card C (n5): reading, kill/miss/kill/kill (chronological) -> 4 encounters; last-5 window = all
    // 4 present: weights [kill,miss,kill,kill] = [1,0,1,1] / 4 = 3/4 = 0.75 < 0.8 -> NOT learned.
    // This is also the ONLY fixture card with a real miss in its history — the leech candidate.
    kill(t.handle, runId, cardC.id, 'reading', days(6));
    miss(t.handle, runId, cardC.id, 'reading', days(5));
    kill(t.handle, runId, cardC.id, 'reading', days(4));
    kill(t.handle, runId, cardC.id, 'reading', days(3));

    // Card D (n2): recall, 3 unhinted kills -> learned at the 3rd attempt, learnedAt = days(1).
    kill(t.handle, runId, cardD.id, 'recall', days(3));
    kill(t.handle, runId, cardD.id, 'recall', days(2));
    kill(t.handle, runId, cardD.id, 'recall', days(1));

    const overview = computeOverview(t.handle, NOW);

    // --- learned per direction: only A (reading) and D (recall) cross the gate. ---
    expect(overview.learned).toEqual({ reading: 1, recall: 1 });

    // --- level rows ---
    expect(overview.levels).toHaveLength(4);
    const n5Row = overview.levels.find((l) => l.level === 5)!;
    // encountered = distinct n5 cards with >=1 attempt = {A,B,C} = 3.
    // learned = distinct n5 cards with >=1 LEARNED direction = {A} = 1 (B and C both fail the gate).
    expect(n5Row.encountered).toBe(3);
    expect(n5Row.learned).toBe(1);
    // coverage = encountered/total = 3/633 (real seeded n5 total, queried not hardcoded).
    expect(n5Row.coverage).toBeCloseTo(3 / 633, 10);
    // mastery = learned/encountered = 1/3.
    expect(n5Row.mastery).toBeCloseTo(1 / 3, 10);

    const n2Row = overview.levels.find((l) => l.level === 2)!;
    expect(n2Row.encountered).toBe(1);
    expect(n2Row.learned).toBe(1);
    expect(n2Row.coverage).toBeCloseTo(1 / 1776, 10);
    expect(n2Row.mastery).toBeCloseTo(1, 10);

    // n4/n3: untouched by the fixture -> all-zero, and mastery's 0/0 must be guarded (not NaN).
    for (const level of [4, 3] as const) {
      const row = overview.levels.find((l) => l.level === level)!;
      expect(row.encountered).toBe(0);
      expect(row.learned).toBe(0);
      expect(row.coverage).toBe(0);
      expect(row.mastery).toBe(0);
    }

    // --- estimatedLevel: neither n5 (3/633≈0.47%) nor n2 (1/1776≈0.06%) clears the 60% coverage bar. ---
    expect(overview.estimatedLevel).toBeNull();

    // --- pace ---
    // learnedAt: A=days(8), D=days(1) — both inside [NOW-14d, NOW] -> 2 cards learned in the window.
    // learnRatePerDay = 2 / 14 = 0.142857...
    expect(overview.pace.learnRatePerDay).toBeCloseTo(0.142857, 5);
    // remainingTargetWords = n2.total(1776) - n2.learned(1) = 1775.
    expect(overview.pace.remainingTargetWords).toBe(1775);
    // daysToExam: default profile exam '2026-12-06' (00:00 UTC) - NOW(2026-08-01T12:00Z)
    // = 126.5 days -> ceil = 127.
    expect(overview.pace.daysToExam).toBe(127);
    // requiredRatePerDay = 1775 / 127 = 13.9763779...
    expect(overview.pace.requiredRatePerDay).toBeCloseTo(13.976, 2);
    expect(overview.pace.onPace).toBe(false); // 0.142857 < 13.976

    // --- trend: spot-check three days that exercise distinct branches (30-day window, UTC bucketed) ---
    expect(overview.trend).toHaveLength(30);
    // days(1) = 2026-07-31: only Card D attempted (1 kill) -> words=1, accuracy=1.
    expect(overview.trend.find((r) => r.date === '2026-07-31')).toEqual(
      { date: '2026-07-31', words: 1, accuracy: 1 },
    );
    // days(5) = 2026-07-27: only Card C's miss that day -> words=1, accuracy = 0 kills/1 total = 0
    // (not NaN — this is the "attempts present but zero kills" branch).
    expect(overview.trend.find((r) => r.date === '2026-07-27')).toEqual(
      { date: '2026-07-27', words: 1, accuracy: 0 },
    );
    // days(7) = 2026-07-25: no card in the fixture touches this date -> zero-activity day INSIDE the
    // 30-day window (distinguishes "day present with zeros" from the wholly-empty-DB case below).
    expect(overview.trend.find((r) => r.date === '2026-07-25')).toEqual(
      { date: '2026-07-25', words: 0, accuracy: 0 },
    );

    // --- streakDates: every distinct date with >=1 attempt = days(1)..days(10) MINUS days(7)
    // (2026-07-25, which no card touches) = 9 dates.
    expect(overview.streakDates).toEqual([
      '2026-07-22', '2026-07-23', '2026-07-24', '2026-07-26', '2026-07-27',
      '2026-07-28', '2026-07-29', '2026-07-30', '2026-07-31',
    ]);

    // --- leeches ---
    // All four cards clear leechMinEncounters(3), so all four are leech candidates; ascending by
    // strength puts the weakest (lowest strength) first.
    //
    // Card C strength — its 4 attempts (all within the 8-attempt window), most-recent-first ages 0..3:
    //   age0=kill(days3) age1=kill(days4) age2=miss(days5) age3=kill(days6)
    //   weights  w_i = 0.85^age:  w0=1, w1=0.85, w2=0.7225, w3=0.614125        sum = 3.186625
    //   outcome  o_i = kill:1, miss:0 (hinted weighting does NOT apply here — see stats.ts comment)
    //   weighted sum = 1*1 + 1*0.85 + 0*0.7225 + 1*0.614125 = 2.464125
    //   recencyAccuracy = 2.464125 / 3.186625 = 0.773271094 (repeating)
    //   speedFactor = clamp01(1 - 1000/15000) = clamp01(14/15) = 0.933333... (all fixture kills use 1000ms)
    //   strength = round(100 * (0.7*0.773271094 + 0.3*0.933333...))
    //            = round(100 * (0.541289766 + 0.28)) = round(82.1289766) = 82
    //
    // Cards A, B, D strength — each is 3 kills (A, D unhinted; B hinted) with zero misses ->
    // recencyAccuracy = 1.0 exactly, because the leech formula's recency-weighted accuracy treats
    // every KILL (hinted or not) as a full 1 — the hintedKillWeight(0.5) half-credit is scoped ONLY
    // to the "learned" gate, never to leech strength. (Verified by construction: if hinted kills were
    // down-weighted here too, Card B's recencyAccuracy would be 0.5 -> strength
    // round(100*(0.7*0.5+0.3*0.93333)) = 63, LESS than Card C's 82, which would rank Card B ahead of
    // Card C and contradict leeches[0] below — see the report for the numeric proof.)
    //   strength = round(100 * (0.7*1 + 0.3*(14/15))) = round(100 * (0.7+0.28)) = round(98) = 98
    expect(overview.leeches).toHaveLength(4);
    expect(overview.leeches[0]).toEqual({
      cardId: cardC.id,
      kanji: cardC.kanji,
      kana: cardC.kana[0],
      gloss: cardC.gloss,
      strength: 82,
      encounters: 4,
    });
    const rest = new Set(overview.leeches.slice(1).map((l) => `${l.cardId}:${l.strength}:${l.encounters}`));
    expect(rest).toEqual(new Set([
      `${cardA.id}:98:3`, `${cardB.id}:98:3`, `${cardD.id}:98:3`,
    ]));
  });
});

describe('computeTrendAndStreak — an attempt older than the 30-day window', () => {
  it('is excluded from trend and streakDates (but still counts toward learned/leech stats)', () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const [oldCard] = t.handle.db.select().from(cards)
      .where(and(eq(cards.source, 'jlpt'), eq(cards.jlpt, 5)))
      .limit(1).all();
    const runId = 'run-old';
    seedRun(t.handle, runId);
    const oldMs = days(45); // well outside trendDays(30) — a realistic case for a long-running player
    const oldDateStr = new Date(oldMs).toISOString().slice(0, 10);
    kill(t.handle, runId, oldCard.id, 'reading', oldMs);

    const overview = computeOverview(t.handle, NOW);
    expect(overview.trend.some((r) => r.date === oldDateStr)).toBe(false);
    expect(overview.streakDates).not.toContain(oldDateStr);
    // Still a real, in-range attempt for every OTHER computation (not time-windowed the same way):
    expect(overview.levels.find((l) => l.level === 5)!.encountered).toBe(1);
  });
});

describe('computeOverview / computeWordStats — custom cards and orphaned attempts', () => {
  it('a custom card counts toward learned/word-stats but never toward level coverage; an unknown card id is skipped, not crashed on', () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const runId = 'run-custom';
    seedRun(t.handle, runId);

    // A hand-inserted custom card (source:'custom', jlpt:null) — the import UI itself is M4 scope, but
    // the DB shape already supports it and stats.ts must handle it per spec §5.1 ("custom cards
    // contribute to every other stat but never to level coverage/mastery denominators").
    const customCardId = 'custom-1';
    t.handle.db.insert(cards).values({
      id: customCardId, kanji: null, kana: ['てすと'], gloss: 'test word', pos: 'n',
      jlpt: null, source: 'custom', listVersion: 'custom-v1',
    }).run();
    kill(t.handle, runId, customCardId, 'reading', days(3));
    kill(t.handle, runId, customCardId, 'reading', days(2));
    kill(t.handle, runId, customCardId, 'reading', days(1)); // 3 unhinted kills -> learned in reading

    // 3 kills on a cardId that was never seeded into `cards` — clears leechMinEncounters(3) so it
    // would be a leech/word-stat candidate, but must be silently skipped rather than crash (run_id/
    // card_id FKs are declared but not runtime-enforced — see server/db/connect.ts's progress notes).
    kill(t.handle, runId, 'ghost-card', 'reading', days(3));
    kill(t.handle, runId, 'ghost-card', 'reading', days(2));
    kill(t.handle, runId, 'ghost-card', 'reading', days(1));

    const overview = computeOverview(t.handle, NOW);
    expect(overview.learned.reading).toBe(1); // the custom card, counted at the top level...
    for (const row of overview.levels) {
      expect(row.encountered).toBe(0); // ...but absent from every JLPT level row (source !== 'jlpt')
      expect(row.learned).toBe(0);
    }
    expect(overview.leeches.some((l) => l.cardId === 'ghost-card')).toBe(false);

    const wordStats = computeWordStats(t.handle, NOW);
    expect(wordStats.some((w) => w.cardId === 'ghost-card')).toBe(false);
    const customRow = wordStats.find((w) => w.cardId === customCardId);
    expect(customRow).toMatchObject({ level: null, kanji: null, kana: 'てすと', gloss: 'test word' });
  });
});

describe('computeOverview — orphan attempts excluded from trend and streak', () => {
  it('an attempt for a ghost-card (unknown cardId) is filtered from trend.words and streakDates', () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const { cardA } = pickFixtureCards(t.handle);
    const runId = 'run-orphan-trend';
    seedRun(t.handle, runId);

    // Real card: 3 kills on different dates to reach learned status (need 3 encounters, 80% accuracy)
    kill(t.handle, runId, cardA.id, 'reading', days(5));
    kill(t.handle, runId, cardA.id, 'reading', days(4));
    kill(t.handle, runId, cardA.id, 'reading', days(3));

    // Orphan attempts (cardId 'ghost-card' has no cards row): 3 kills on days(2) and days(1)
    kill(t.handle, runId, 'ghost-card', 'reading', days(2));
    kill(t.handle, runId, 'ghost-card', 'reading', days(2)); // same day, different attempt
    kill(t.handle, runId, 'ghost-card', 'reading', days(1));

    const overview = computeOverview(t.handle, NOW);

    // Verify the real card's dates show words=1 in trend
    expect(overview.trend.find((r) => r.date === '2026-07-27')).toEqual(
      { date: '2026-07-27', words: 1, accuracy: 1 },
    );
    expect(overview.trend.find((r) => r.date === '2026-07-28')).toEqual(
      { date: '2026-07-28', words: 1, accuracy: 1 },
    );
    expect(overview.trend.find((r) => r.date === '2026-07-29')).toEqual(
      { date: '2026-07-29', words: 1, accuracy: 1 },
    );

    // Verify the ghost-card's dates show words=0 in trend (orphans are invisible)
    expect(overview.trend.find((r) => r.date === '2026-07-30')).toEqual(
      { date: '2026-07-30', words: 0, accuracy: 0 },
    );
    expect(overview.trend.find((r) => r.date === '2026-07-31')).toEqual(
      { date: '2026-07-31', words: 0, accuracy: 0 },
    );

    // Verify streakDates contains only the real card's dates, not the ghost-card's dates
    expect(overview.streakDates).toContain('2026-07-27');
    expect(overview.streakDates).toContain('2026-07-28');
    expect(overview.streakDates).toContain('2026-07-29');
    expect(overview.streakDates).not.toContain('2026-07-30');
    expect(overview.streakDates).not.toContain('2026-07-31');

    // Verify learned/leeches are unaffected (just the one real card learned in reading)
    expect(overview.learned.reading).toBe(1);
    expect(overview.leeches.some((l) => l.cardId === 'ghost-card')).toBe(false);
  });
});

describe('computeOverview — empty attempts table', () => {
  it('returns all-zero shapes with no NaN anywhere', () => {
    const t = makeTestDb();
    cleanup = t.cleanup;

    const overview = computeOverview(t.handle, NOW);

    expect(overview.learned).toEqual({ reading: 0, recall: 0 });
    expect(overview.levels).toHaveLength(4);
    for (const row of overview.levels) {
      expect(row.total).toBeGreaterThan(0); // real seeded totals — still populated with zero attempts
      expect(row.encountered).toBe(0);
      expect(row.learned).toBe(0);
      expect(row.coverage).toBe(0);
      expect(row.mastery).toBe(0); // 0/0 must be guarded to 0, not NaN
    }
    expect(overview.estimatedLevel).toBeNull();
    expect(overview.pace.learnRatePerDay).toBe(0);
    expect(overview.pace.onPace).toBe(false);
    expect(overview.pace.remainingTargetWords).toBeGreaterThan(0); // default target N2 total, none learned
    expect(Number.isFinite(overview.pace.requiredRatePerDay)).toBe(true);
    expect(overview.trend).toHaveLength(30);
    for (const row of overview.trend) {
      expect(row.words).toBe(0);
      expect(row.accuracy).toBe(0);
    }
    expect(overview.streakDates).toEqual([]);
    expect(overview.leeches).toEqual([]);

    expect(computeWordStats(t.handle, NOW)).toEqual([]);
  });
});
