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
  const kanaOnlyTierIds = (level: number, tier: number): string[] =>
    (t.handle.sqlite
      .prepare(
        `SELECT id FROM cards WHERE source = 'jlpt' AND jlpt = ? AND tier = ? AND kanji IS NULL ORDER BY id`,
      )
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
  const makeList = (id: number, cardIds: string[]) => {
    t.handle.sqlite
      .prepare(`INSERT INTO lists (id, name, created_at, updated_at) VALUES (?, ?, 1, 1)`)
      .run(id, `list-${id}`);
    const insert = t.handle.sqlite
      .prepare(`INSERT INTO list_cards (list_id, card_id, position) VALUES (?, ?, ?)`);
    cardIds.forEach((cardId, i) => insert.run(id, cardId, i));
  };
  const insertCustomCard = (id: string, kanji: string | null) =>
    t.handle.sqlite
      .prepare(
        `INSERT INTO cards (id, kanji, kana, gloss, pos, jlpt, tier, source, list_version)
         VALUES (?, ?, '["よみ"]', 'g', 'unclassified', NULL, NULL, 'custom', 'custom-v1')`,
      )
      .run(id, kanji);
  return {
    t, ids: n5Ids.map((r) => r.id), tierIds, kanaOnlyTierIds, attempt, introduce, makeSolid,
    makeAmnestied, weightOf, makeList, insertCustomCard,
  };
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
    const { t, tierIds, attempt, introduce } = setup();
    const farId = tierIds(5, 3)[0];
    // Met for real — ceremony then attempt — scattered across the ranking (§3.3).
    introduce(farId, NOW - HOUR);
    attempt(farId, NOW - HOUR);
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
    expect(unknown).toEqual({ newCardIds: [], seenCards: [], runBudget: 0, tiers: [] });
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
    // → weight ~0.1 + 0 + 0.4 = ~0.5. Introduced first, as real play always is.
    introduce(ids[1], NOW - 73 * HOUR);
    for (let i = 0; i < 5; i++) attempt(ids[1], NOW - 73 * HOUR + i * 60_000);
    const plan = computeRunPlan(t.handle, 'n5', NOW);
    expect(weightOf(plan, ids[0])).toBeGreaterThan(weightOf(plan, ids[1]));
    expect(weightOf(plan, ids[1])).toBeGreaterThan(PLAN.reviewWeightFloor);
    expect(weightOf(plan, ids[1])).toBeLessThan(0.6);
    // Pins BOTH weighted terms: floor(0.1) + 0.6·weakness(0.01) + 0.4·staleness(1) = 0.506.
    // Dropping either term moves this to 0.500 / 0.106 and fails.
    expect(weightOf(plan, ids[1])).toBeCloseTo(0.506, 3);
  });

  it('the weight floor keeps a strong fresh card strictly positive but rare', () => {
    const { t, ids, attempt, introduce, weightOf } = setup();
    introduce(ids[2], NOW - 2 * HOUR);
    for (let i = 0; i < 3; i++) attempt(ids[2], NOW - HOUR + i * 60_000); // strong and fresh
    const plan = computeRunPlan(t.handle, 'n5', NOW);
    expect(weightOf(plan, ids[2])).toBeGreaterThanOrEqual(PLAN.reviewWeightFloor);
    expect(weightOf(plan, ids[2])).toBeLessThan(0.2);
  });

  it('a weak fresh card is weighted by the weakness term (not only the floor)', () => {
    const { t, ids, introduce, makeAmnestied, weightOf } = setup();
    introduce(ids[3], NOW - 3 * HOUR);
    makeAmnestied(ids[3]); // 8 misses ending ~2h ago: strength 0 → weakness 1
    const plan = computeRunPlan(t.handle, 'n5', NOW);
    // floor + 0.6·1 + 0.4·staleness(~113min/72h ≈ 0.026) ≈ 0.7105 — dominated by
    // the weakness term. Dropping it would collapse this to ~0.11.
    expect(weightOf(plan, ids[3])).toBeGreaterThan(PLAN.reviewWeightFloor + PLAN.reviewWeaknessWeight);
    expect(weightOf(plan, ids[3])).toBeLessThan(0.8);
  });

  it('an introduced card is seen, not new — membership keys on introductions alone (2026-08-09)', () => {
    // M4-A's "an attempt OR an introduction is seen" narrowed: the attempt
    // half was the pre-plan-era absorption shim, retired with the 2026-08-09
    // reset. The attempted-only cases live in the leak-fix describe below.
    const { t, tierIds, introduce } = setup();
    const [b] = tierIds(5, 1);
    introduce(b, NOW - HOUR);
    const plan = computeRunPlan(t.handle, 'n5', NOW);
    expect(plan.newCardIds).not.toContain(b);
    expect(plan.seenCards.map((s) => s.id)).toContain(b);
  });
});

describe('computeRunPlan — seen requires an introduction (leak fix, 2026-08-09)', () => {
  // Attempts without an introduction happen only via the ceremony-less
  // fallbacks (no-plan run, starved pool, Spawner's starved draw). §3.2
  // promises those cards "still get their acquisition moment on a later day",
  // so attempts alone must never confer seen status.

  it('an attempted-but-never-introduced card in the active tier stays new', () => {
    const { t, tierIds, attempt } = setup();
    const cardId = tierIds(5, 1)[0];
    attempt(cardId, NOW - HOUR); // fell during a ceremony-less run
    const plan = computeRunPlan(t.handle, 'n5', NOW);
    expect(plan.newCardIds).toContain(cardId);
    expect(plan.seenCards.map((s) => s.id)).not.toContain(cardId);
  });

  it('an attempted-but-never-introduced card outside the active tier is locked, not seen', () => {
    const { t, tierIds, attempt } = setup();
    const farId = tierIds(5, 3)[0];
    attempt(farId, NOW - HOUR);
    const plan = computeRunPlan(t.handle, 'n5', NOW);
    expect(plan.newCardIds).not.toContain(farId);
    expect(plan.seenCards.map((s) => s.id)).not.toContain(farId);
  });

  it('even a card driven solid without an introduction stays new while its tier is active', () => {
    // Deliberately no solidity carve-out: a carve-out would re-create the
    // never-taught-yet-circulating symptom behind a rarer trigger. The gate
    // still counts the off-plan evidence (solid: 1) — only membership changes.
    const { t, tierIds, makeSolid } = setup();
    const cardId = tierIds(5, 1)[0];
    makeSolid(cardId);
    const plan = computeRunPlan(t.handle, 'n5', NOW);
    expect(plan.newCardIds).toContain(cardId);
    expect(plan.seenCards.map((s) => s.id)).not.toContain(cardId);
    expect(plan.tiers[0]).toMatchObject({ index: 1, solid: 1 });
  });

  it('an attempted-but-never-introduced list member stays new', () => {
    const { t, ids, attempt, makeList } = setup();
    makeList(1, [ids[0]]);
    attempt(ids[0], NOW - HOUR);
    const plan = computeRunPlan(t.handle, 'list:1', NOW);
    expect(plan.newCardIds).toEqual([ids[0]]);
    expect(plan.seenCards).toHaveLength(0);
  });

  it('reading mode: an attempted-but-never-introduced kana-only card is in neither list', () => {
    // Pre-fix it was mode-agnostically seen. Now reading can neither review
    // nor introduce it — locked — while the pooled view can still teach it.
    const { t, kanaOnlyTierIds, attempt } = setup();
    const kanaId = kanaOnlyTierIds(5, 1)[0];
    attempt(kanaId, NOW - HOUR); // fell during a ceremony-less recall run
    const reading = computeRunPlan(t.handle, 'n5', NOW, 'reading');
    expect(reading.newCardIds).not.toContain(kanaId);
    expect(reading.seenCards.map((s) => s.id)).not.toContain(kanaId);
    expect(computeRunPlan(t.handle, 'n5', NOW).newCardIds).toContain(kanaId);
  });

  it('reading mode: an attempted-but-never-introduced kana-only member is in neither list', () => {
    const { t, attempt, makeList, insertCustomCard } = setup();
    insertCustomCard('custom-kanaonly02', null);
    makeList(1, ['custom-kanaonly02']);
    attempt('custom-kanaonly02', NOW - HOUR);
    const reading = computeRunPlan(t.handle, 'list:1', NOW, 'reading');
    expect(reading.newCardIds).toEqual([]);
    expect(reading.seenCards).toEqual([]);
    expect(computeRunPlan(t.handle, 'list:1', NOW, 'recall').newCardIds)
      .toEqual(['custom-kanaonly02']);
  });
});

describe('computeRunPlan — mode-aware plan (reading excludes kana-only cards)', () => {
  it('reading mode excludes kana-only cards from newCardIds; the pooled (no-mode) view still includes them', () => {
    const { t, kanaOnlyTierIds } = setup();
    const kanaOnly = new Set(kanaOnlyTierIds(5, 1));
    expect(kanaOnly.size).toBeGreaterThan(0); // N5 tier 1 ships 2 kana-only cards

    const reading = computeRunPlan(t.handle, 'n5', NOW, 'reading');
    for (const id of reading.newCardIds) expect(kanaOnly.has(id), id).toBe(false);

    const pooled = computeRunPlan(t.handle, 'n5', NOW);
    for (const id of kanaOnly) expect(pooled.newCardIds, id).toContain(id);
  });

  it('a kana-heavy tier gate: reading mode passes on kanji-only mastery while the pooled view still holds', () => {
    // N5 tier 2 (4 kana-only / 6 kanji-bearing) is the fix's own motivating
    // example: max 6/10 pooled = 0.6 < 0.8 is a PERMANENT stall for a
    // reading-only player under the pooled gate, whereas under mode:'reading'
    // the 4 kana-only cards leave the denominator entirely (6/6 = 1.0).
    // NOTE: the brief's test-2 hint names "tier 1 (2 kana-only)" for this
    // case, but tier 1's 8 kanji-bearing cards land exactly on the 8/10 =
    // 0.8 threshold, which the existing (unchanged) `>=` gate already PASSES
    // pooled — verified 8/10 === 0.8 in IEEE754, and the pre-existing "8/10
    // solid passes the gate" test proves the same boundary is inclusive. So
    // tier 1 cannot demonstrate a pooled "holds" outcome from kanji-only
    // mastery; tier 2 is the tier whose numbers actually produce the
    // described contrast, and it matches the fix's own worked example
    // verbatim. Flagged in the final report rather than silently ignored.
    const { t, tierIds, kanaOnlyTierIds, makeSolid } = setup();
    const tier2 = tierIds(5, 2);
    const kanaOnly2 = new Set(kanaOnlyTierIds(5, 2));
    const kanjiBearing2 = tier2.filter((id) => !kanaOnly2.has(id));
    expect(kanaOnly2.size).toBe(4);
    expect(kanjiBearing2).toHaveLength(6);

    // Tier 1 must already be passed (pooled AND reading) so tier 2 becomes
    // active in both modes — otherwise tier 1 itself would be reported.
    for (const id of tierIds(5, 1)) makeSolid(id);
    for (const id of kanjiBearing2) makeSolid(id);

    const reading = computeRunPlan(t.handle, 'n5', NOW, 'reading');
    expect(reading.tiers[0]).toMatchObject({ index: 3, level: 5 }); // tier 2 passed too

    const pooled = computeRunPlan(t.handle, 'n5', NOW);
    expect(pooled.tiers[0]).toMatchObject({ index: 2, level: 5, solid: 6, unreachable: 0 });
  });

  it('a solid kana-only card counts toward the reading-mode solid count, and can help the tier pass', () => {
    const { t, tierIds, kanaOnlyTierIds, makeSolid } = setup();
    const tier1 = tierIds(5, 1);
    const kanaOnly1 = kanaOnlyTierIds(5, 1);
    const kanjiBearing1 = tier1.filter((id) => !kanaOnly1.includes(id));
    expect(kanaOnly1).toHaveLength(2);
    expect(kanjiBearing1).toHaveLength(8);

    makeSolid(kanaOnly1[0]);
    for (const id of kanjiBearing1.slice(0, 6)) makeSolid(id);
    // 7 solid (1 kana + 6 kanji) / denominator 9 (size 10 − 1 remaining
    // unreachable kana card) ≈ 0.778 < 0.8: tier 1 still holds. If the kana
    // card's solidity weren't counted, solid would read 6, not 7.
    const mid = computeRunPlan(t.handle, 'n5', NOW, 'reading');
    expect(mid.tiers[0]).toMatchObject({ index: 1, solid: 7, unreachable: 1 });

    makeSolid(kanjiBearing1[6]);
    // 8 solid (1 kana + 7 kanji) / 9 ≈ 0.889 >= 0.8: now it passes.
    const after = computeRunPlan(t.handle, 'n5', NOW, 'reading');
    expect(after.tiers[0].index).toBe(2);
  });

  it('tiers[0].unreachable reports the not-solid kana-only count under reading, and 0 without mode', () => {
    const { t, kanaOnlyTierIds } = setup();
    const kanaOnly = kanaOnlyTierIds(5, 1);

    const reading = computeRunPlan(t.handle, 'n5', NOW, 'reading');
    expect(reading.tiers[0]).toMatchObject({ index: 1, unreachable: kanaOnly.length });

    const pooled = computeRunPlan(t.handle, 'n5', NOW);
    expect(pooled.tiers[0]).toMatchObject({ index: 1, unreachable: 0 });
  });

  it('recall mode leaves nothing unreachable (kana-only cards are fully reachable in recall)', () => {
    const { t } = setup();
    const recall = computeRunPlan(t.handle, 'n5', NOW, 'recall');
    expect(recall.tiers[0]).toMatchObject({ index: 1, unreachable: 0, size: 10 });
    expect(recall.newCardIds).toHaveLength(10);
  });
});

describe('computeRunPlan — list pools (custom-list-import spec §5.2)', () => {
  it('an unmet member is new, a met member is weighted seen, and tiers is empty', () => {
    const { t, ids, attempt, introduce, makeList } = setup();
    makeList(1, [ids[0], ids[1]]);
    introduce(ids[0], NOW - HOUR);
    attempt(ids[0], NOW - HOUR);
    const plan = computeRunPlan(t.handle, 'list:1', NOW);
    expect(plan.newCardIds).toEqual([ids[1]]);
    expect(plan.seenCards.map((s) => s.id)).toEqual([ids[0]]);
    expect(plan.tiers).toEqual([]);
    expect(plan.runBudget).toBe(PLAN.perRunNewCap);
  });

  it('there is no gate: every unmet member is eligible at once', () => {
    const { t, ids, makeList } = setup();
    makeList(1, ids.slice(0, 15)); // spans far more than one tier's worth
    const plan = computeRunPlan(t.handle, 'list:1', NOW);
    expect(plan.newCardIds).toHaveLength(15);
  });

  it('mode=reading excludes an unmet kana-only member; recall and absent do not', () => {
    // DEVIATION from the brief: it paired 'custom-kanaonly01' with ids[0] as
    // the reachable member. In the real seeded N5 data, ids[0] (jm-1000050,
    // the lowest id under `ORDER BY id`) is ITSELF kana-only — ids[0..4] all
    // are; ids[5] is the first kanji-bearing card (verified against
    // public/data/jlpt-n5.json). Using ids[0] made both list members
    // unreachable under reading, collapsing newCardIds to [] and failing the
    // first assertion — not a planner bug, a fixture-index assumption that
    // doesn't hold. Fixed by building both members as purpose-specific
    // custom cards, so the test no longer depends on JLPT id ordering at all.
    const { t, makeList, insertCustomCard } = setup();
    insertCustomCard('custom-kanji01', '漢字');
    insertCustomCard('custom-kanaonly01', null);
    makeList(1, ['custom-kanji01', 'custom-kanaonly01']);
    expect(computeRunPlan(t.handle, 'list:1', NOW, 'reading').newCardIds).toEqual(['custom-kanji01']);
    expect(computeRunPlan(t.handle, 'list:1', NOW, 'recall').newCardIds)
      .toEqual(expect.arrayContaining(['custom-kanji01', 'custom-kanaonly01']));
    expect(computeRunPlan(t.handle, 'list:1', NOW).newCardIds).toHaveLength(2);
  });

  it('the daily budget is shared with JLPT intake', () => {
    const { t, ids, introduce, makeList } = setup();
    makeList(1, [ids[19]]);
    for (let i = 0; i < 18; i++) introduce(ids[i], NOW - HOUR);
    expect(computeRunPlan(t.handle, 'list:1', NOW).runBudget).toBe(2); // goal 20 - 18
  });

  it('an introduced-never-attempted member carries the maximum weight', () => {
    const { t, ids, introduce, makeList, weightOf } = setup();
    makeList(1, [ids[0]]);
    introduce(ids[0], NOW - HOUR);
    const plan = computeRunPlan(t.handle, 'list:1', NOW);
    expect(weightOf(plan, ids[0])).toBeCloseTo(
      PLAN.reviewWeightFloor + PLAN.reviewWeaknessWeight + PLAN.reviewStalenessWeight,
      10,
    );
  });

  it('a nonexistent list id yields the fully empty plan', () => {
    const { t } = setup();
    expect(computeRunPlan(t.handle, 'list:99', NOW)).toEqual({
      newCardIds: [], seenCards: [], runBudget: 0, tiers: [],
    });
  });
});
