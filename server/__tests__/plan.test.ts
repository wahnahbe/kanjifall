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
  const insertRun = t.handle.sqlite.prepare(
    `INSERT OR IGNORE INTO runs (id, started_at, mode, pool, app_version, list_version)
     VALUES (?, ?, 'reading', 'n5', 'test', 'test')`,
  );
  insertRun.run('run-1', NOW - HOUR);
  const attempt = (cardId: string, at: number) =>
    t.handle.sqlite
      .prepare(
        `INSERT INTO attempts (run_id, card_id, mode, outcome, ms_to_first_key, ms_to_kill,
           backspace_count, hint_shown, was_targeted, airborne_count, speed_level, created_at)
         VALUES ('run-1', ?, 'reading', 'kill', 100, 400, 0, 0, 1, 1, 1, ?)`,
      )
      .run(cardId, at);
  const introduce = (cardId: string, at: number) =>
    t.handle.sqlite
      .prepare(`INSERT OR IGNORE INTO introductions (card_id, run_id, introduced_at) VALUES (?, 'run-1', ?)`)
      .run(cardId, at);
  return { t, ids: n5Ids.map((r) => r.id), attempt, introduce };
}

describe('computeRunPlan', () => {
  it('with no history, every pool card is new and the budget is the per-run cap', () => {
    const { t } = setup();
    const plan = computeRunPlan(t.handle, 'n5', NOW);
    expect(plan.seenCardIds).toHaveLength(0);
    expect(plan.newCardIds.length).toBeGreaterThan(600); // n5 has 633 cards
    expect(plan.runBudget).toBe(PLAN.perRunNewCap); // dailyWordGoal 20 > cap 6
  });

  it('a card with an attempt is seen, not new', () => {
    const { t, ids, attempt } = setup();
    attempt(ids[0], NOW - HOUR);
    const plan = computeRunPlan(t.handle, 'n5', NOW);
    expect(plan.seenCardIds).toContain(ids[0]);
    expect(plan.newCardIds).not.toContain(ids[0]);
  });

  it('a card that was introduced but never attempted is also seen, not new', () => {
    const { t, ids, introduce } = setup();
    introduce(ids[1], NOW - HOUR);
    const plan = computeRunPlan(t.handle, 'n5', NOW);
    expect(plan.seenCardIds).toContain(ids[1]);
    expect(plan.newCardIds).not.toContain(ids[1]);
  });

  it("today's introductions spend the daily goal; yesterday's do not", () => {
    const { t, ids, introduce } = setup();
    // 18 introduced today leaves 2 of the 20-word goal, below the per-run cap of 6.
    for (let i = 0; i < 18; i++) introduce(ids[i], NOW - HOUR);
    expect(computeRunPlan(t.handle, 'n5', NOW).runBudget).toBe(2);

    // One second before local midnight today is still "yesterday" for a run at NOW.
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
    // Mid-day goal reduction: 5 - 12 = -7 before clamping.
    t.handle.sqlite.prepare('UPDATE profile SET daily_word_goal = 5 WHERE id = 1').run();
    expect(computeRunPlan(t.handle, 'n5', NOW).runBudget).toBe(0);
  });

  it('mixed spans every level; an unknown pool is empty with no budget', () => {
    const { t } = setup();
    const mixed = computeRunPlan(t.handle, 'mixed', NOW);
    expect(mixed.newCardIds.length).toBeGreaterThan(4000);
    const unknown = computeRunPlan(t.handle, 'nope', NOW);
    expect(unknown.newCardIds).toHaveLength(0);
    expect(unknown.seenCardIds).toHaveLength(0);
    expect(unknown.runBudget).toBe(0);
  });
});
