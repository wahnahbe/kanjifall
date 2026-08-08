import { afterEach, describe, expect, it } from 'vitest';
import { startOfLocalDay } from '../dates';
import { computeRunPlan } from '../plan';
import { PLAN } from '../planConfig';
import { makeTestDb } from '../testDb';

const NOW = new Date(2026, 7, 1, 12, 0, 0).getTime(); // local noon, Aug 1 2026
const HOUR = 3_600_000;

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function setup() {
  const t = makeTestDb();
  cleanup = t.cleanup;
  const n5Ids = t.handle.sqlite
    .prepare(`SELECT id FROM cards WHERE jlpt = 5 ORDER BY id LIMIT 20`)
    .all() as { id: string }[];
  const tierIds = (level: number, tier: number): string[] =>
    (t.handle.sqlite
      .prepare(`SELECT id FROM cards WHERE source = 'jlpt' AND jlpt = ? AND tier = ? ORDER BY id`)
      .all(level, tier) as { id: string }[]).map((r) => r.id);
  const insertRun = t.handle.sqlite.prepare(
    `INSERT OR IGNORE INTO runs (id, started_at, mode, pool, app_version, list_version)
     VALUES (?, ?, 'reading', 'n5', 'test', 'test')`,
  );
  insertRun.run('run-1', NOW - 30 * 24 * HOUR);
  const attempt = (cardId: string, at: number, outcome: 'kill' | 'miss' = 'kill') =>
    t.handle.sqlite
      .prepare(
        `INSERT INTO attempts (run_id, card_id, mode, outcome, ms_to_first_key, ms_to_kill,
           backspace_count, hint_shown, was_targeted, airborne_count, speed_level, created_at)
         VALUES ('run-1', ?, 'reading', ?, 100, ?, 0, 0, 1, 1, 1, ?)`,
      )
      .run(cardId, outcome, outcome === 'kill' ? 400 : null, at);
  const introduce = (cardId: string, at: number) =>
    t.handle.sqlite
      .prepare(`INSERT OR IGNORE INTO introductions (card_id, run_id, introduced_at) VALUES (?, 'run-1', ?)`)
      .run(cardId, at);
  // 3 recent kills: clears the learned gate (3 encounters, windowed accuracy 1).
  const makeSolid = (cardId: string) => {
    for (let i = 0; i < 3; i++) attempt(cardId, NOW - 2 * HOUR + i * 60_000);
  };
  // 8 misses: >= amnestyMinEncounters pooled encounters, nowhere near solid.
  const makeAmnestied = (cardId: string) => {
    for (let i = 0; i < 8; i++) attempt(cardId, NOW - 2 * HOUR + i * 60_000, 'miss');
  };
  const weightOf = (plan: ReturnType<typeof computeRunPlan>, cardId: string): number => {
    const entry = plan.seenCards.find((s) => s.id === cardId);
    expect(entry, cardId).toBeDefined();
    return entry!.weight;
  };
  return { t, ids: n5Ids.map((r) => r.id), tierIds, attempt, introduce, makeSolid, makeAmnestied, weightOf };
}

describe('computeRunPlan — M4-A budget (unchanged)', () => {
  it("today's introductions spend the daily goal; yesterday's do not", () => {
    const { t, ids, introduce } = setup();
    for (let i = 0; i < 18; i++) introduce(ids[i], NOW - HOUR);
    expect(computeRunPlan(t.handle, 'n5', NOW).runBudget).toBe(2);

    const { t: t2, ids: ids2, introduce: introduce2 } = setup();
    for (let i = 0; i < 18; i++) introduce2(ids2[i], startOfLocalDay(NOW) - 1000);
    expect(computeRunPlan(t2.handle, 'n5', NOW).runBudget).toBe(PLAN.perRunNewCap);
  });

  it('budget floors at zero once the daily goal is exhausted', () => {
    const { t, ids, introduce } = setup();
    for (let i = 0; i < 20; i++) introduce(ids[i], NOW - HOUR);
    expect(computeRunPlan(t.handle, 'n5', NOW).runBudget).toBe(0);
  });

  it('floors at zero when the goal is lowered below what was already introduced today', () => {
    const { t, ids, introduce } = setup();
    for (let i = 0; i < 12; i++) introduce(ids[i], NOW - HOUR);
    t.handle.sqlite.prepare('UPDATE profile SET daily_word_goal = 5 WHERE id = 1').run();
    expect(computeRunPlan(t.handle, 'n5', NOW).runBudget).toBe(0);
  });
});

describe('computeRunPlan — tier gate', () => {
  it('empty history: tier 1 is active and newCardIds is exactly its unmet cards', () => {
    const { t, tierIds } = setup();
    const plan = computeRunPlan(t.handle, 'n5', NOW);
    expect(plan.seenCards).toHaveLength(0);
    expect(plan.seenCardIds).toHaveLength(0);
    expect([...plan.newCardIds].sort()).toEqual([...tierIds(5, 1)].sort());
    expect(plan.newCardIds).toHaveLength(10);
    expect(plan.tiers).toHaveLength(1);
    expect(plan.tiers[0]).toMatchObject({ level: 5, index: 1, size: 10, solid: 0, amnestied: 0 });
    expect(plan.tiers[0].totalTiers).toBeGreaterThan(50); // 633 cards / 10
    expect(plan.runBudget).toBe(PLAN.perRunNewCap);
  });

  it('8/10 solid passes the gate (active moves to tier 2); 7/10 does not', () => {
    const { t, tierIds, makeSolid } = setup();
    const tier1 = tierIds(5, 1);
    for (const id of tier1.slice(0, 7)) makeSolid(id);
    expect(computeRunPlan(t.handle, 'n5', NOW).tiers[0]).toMatchObject({ index: 1, solid: 7 });

    const { t: t2, tierIds: tierIds2, makeSolid: makeSolid2 } = setup();
    for (const id of tierIds2(5, 1).slice(0, 8)) makeSolid2(id);
    const plan = computeRunPlan(t2.handle, 'n5', NOW);
    expect(plan.tiers[0].index).toBe(2);
    expect([...plan.newCardIds].sort()).toEqual([...tierIds2(5, 2)].sort());
  });

  it('an amnestied card leaves the denominator: 7 solid + 2 amnestied + 1 unmet passes (7/8)', () => {
    const { t, tierIds, makeSolid, makeAmnestied } = setup();
    const tier1 = tierIds(5, 1);
    for (const id of tier1.slice(0, 7)) makeSolid(id);
    for (const id of tier1.slice(7, 9)) makeAmnestied(id);
    expect(computeRunPlan(t.handle, 'n5', NOW).tiers[0].index).toBe(2);
  });

  it('an amnestied card never enters the numerator: 6 solid + 2 amnestied + 2 unmet holds (6/8)', () => {
    const { t, tierIds, makeSolid, makeAmnestied } = setup();
    const tier1 = tierIds(5, 1);
    for (const id of tier1.slice(0, 6)) makeSolid(id);
    for (const id of tier1.slice(6, 8)) makeAmnestied(id);
    const plan = computeRunPlan(t.handle, 'n5', NOW);
    expect(plan.tiers[0]).toMatchObject({ index: 1, solid: 6, amnestied: 2 });
  });

  it('a fully amnestied tier passes (denominator 0 — a permanent stall is rejected by design)', () => {
    const { t, tierIds, makeAmnestied } = setup();
    for (const id of tierIds(5, 1)) makeAmnestied(id);
    expect(computeRunPlan(t.handle, 'n5', NOW).tiers[0].index).toBe(2);
  });

  it('newCardIds never contains a card outside the active tier; a far-tier seen card still appears in seenCards', () => {
    const { t, tierIds, attempt } = setup();
    const farId = tierIds(5, 3)[0];
    attempt(farId, NOW - HOUR); // absorbed history: scattered across the ranking (§3.3)
    const plan = computeRunPlan(t.handle, 'n5', NOW);
    const tier1 = new Set(tierIds(5, 1));
    for (const id of plan.newCardIds) expect(tier1.has(id), id).toBe(true);
    expect(plan.newCardIds).not.toContain(farId);
    expect(plan.seenCards.map((s) => s.id)).toContain(farId);
  });

  it('mixed returns one tiers entry per level and unions the four active tiers', () => {
    const { t } = setup();
    const plan = computeRunPlan(t.handle, 'mixed', NOW);
    expect(plan.tiers.map((x) => x.level)).toEqual([5, 4, 3, 2]);
    for (const entry of plan.tiers) expect(entry.index).toBe(1);
    expect(plan.newCardIds).toHaveLength(40); // 10 per level on a fresh DB
  });

  it('an unknown pool yields the empty plan', () => {
    const { t } = setup();
    const unknown = computeRunPlan(t.handle, 'nope', NOW);
    expect(unknown).toEqual({ newCardIds: [], seenCardIds: [], seenCards: [], runBudget: 0, tiers: [] });
  });
});

describe('computeRunPlan — review weights', () => {
  it('an introduced-but-never-attempted card gets the maximum weight (§3.4)', () => {
    const { t, ids, introduce, weightOf } = setup();
    introduce(ids[0], NOW - HOUR);
    const plan = computeRunPlan(t.handle, 'n5', NOW);
    expect(weightOf(plan, ids[0])).toBeCloseTo(
      PLAN.reviewWeightFloor + PLAN.reviewWeaknessWeight + PLAN.reviewStalenessWeight, // 1.1
      10,
    );
  });

  it('an introduced card outweighs a strong, fully stale card', () => {
    const { t, ids, attempt, introduce, weightOf } = setup();
    introduce(ids[0], NOW - HOUR);
    // 5 fast kills, 73h ago: strength ~99 (weakness ~0), staleness capped at 1
    // → weight ~0.1 + 0 + 0.4 = ~0.5.
    for (let i = 0; i < 5; i++) attempt(ids[1], NOW - 73 * HOUR + i * 60_000);
    const plan = computeRunPlan(t.handle, 'n5', NOW);
    expect(weightOf(plan, ids[0])).toBeGreaterThan(weightOf(plan, ids[1]));
    expect(weightOf(plan, ids[1])).toBeGreaterThan(PLAN.reviewWeightFloor);
    expect(weightOf(plan, ids[1])).toBeLessThan(0.6);
  });

  it('the weight floor keeps a strong fresh card strictly positive but rare', () => {
    const { t, ids, attempt, weightOf } = setup();
    for (let i = 0; i < 3; i++) attempt(ids[2], NOW - HOUR + i * 60_000); // strong and fresh
    const plan = computeRunPlan(t.handle, 'n5', NOW);
    expect(weightOf(plan, ids[2])).toBeGreaterThanOrEqual(PLAN.reviewWeightFloor);
    expect(weightOf(plan, ids[2])).toBeLessThan(0.2);
  });

  it('a card with an attempt or an introduction is seen, not new (M4-A, preserved)', () => {
    const { t, tierIds, attempt, introduce } = setup();
    const [a, b] = tierIds(5, 1);
    attempt(a, NOW - HOUR);
    introduce(b, NOW - HOUR);
    const plan = computeRunPlan(t.handle, 'n5', NOW);
    expect(plan.newCardIds).not.toContain(a);
    expect(plan.newCardIds).not.toContain(b);
    expect(plan.seenCardIds).toEqual(expect.arrayContaining([a, b]));
    expect(plan.seenCards.map((s) => s.id)).toEqual(expect.arrayContaining([a, b]));
  });
});
