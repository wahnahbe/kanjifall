import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, LANES } from '../constants';
import { mulberry32 } from '../rng';
import { Spawner } from '../Spawner';
import type { Card, EnginePlan, SeenCardRef } from '../types';

const pool: Card[] = Array.from({ length: 20 }, (_, i) => ({
  id: `c${i}`, kanji: `字${i}`, kana: [`かな${i}`], gloss: 'g', pos: 'noun',
  jlpt: 5, source: 'jlpt',
}));

const planOf = (
  newIds: string[],
  runBudget: number,
  perWaveNewCap = 2,
  // Default preserves M4-A semantics for existing tests: everything not new
  // is seen at uniform weight. New tests pass explicit subsets to create
  // locked cards.
  seen: SeenCardRef[] = pool
    .filter((c) => !newIds.includes(c.id))
    .map((c) => ({ id: c.id, weight: 1 })),
): EnginePlan => ({
  newCardIds: newIds,
  seenCards: seen,
  runBudget,
  perWaveNewCap,
});

const make = (seed = 42) => new Spawner(pool, mulberry32(seed), DEFAULT_CONFIG, planOf([], 0));

const makeWithPlan = (plan: EnginePlan, seed = 42) =>
  new Spawner(pool, mulberry32(seed), DEFAULT_CONFIG, plan);

describe('mulberry32', () => {
  it('is deterministic per seed and in [0,1)', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(mulberry32(8)()).not.toBe(mulberry32(7)());
  });
});

describe('Spawner.planWave', () => {
  it('grows wave size and caps it', () => {
    const s = make();
    expect(s.planWave(1).cards).toHaveLength(DEFAULT_CONFIG.baseWaveSize);
    expect(s.planWave(2).cards).toHaveLength(DEFAULT_CONFIG.baseWaveSize + 1);
    expect(s.planWave(50).cards).toHaveLength(DEFAULT_CONFIG.maxWaveSize);
  });

  it('never repeats a card within a wave', () => {
    const cards = make().planWave(5).cards;
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length);
  });

  it('ramps speed and spawn rate monotonically with caps', () => {
    const s = make();
    const w1 = s.planWave(1);
    const w5 = s.planWave(5);
    expect(w5.fallSpeed).toBeGreaterThan(w1.fallSpeed);
    expect(w5.spawnIntervalMs).toBeLessThan(w1.spawnIntervalMs);
    expect(s.planWave(200).fallSpeed).toBe(DEFAULT_CONFIG.maxFallSpeed);
    expect(s.planWave(200).spawnIntervalMs).toBe(DEFAULT_CONFIG.minSpawnIntervalMs);
  });

  it('is unaffected by mutation of the caller\'s pool array', () => {
    const callerPool = [...pool];
    const s = new Spawner(callerPool, mulberry32(42), DEFAULT_CONFIG, planOf([], 0));
    callerPool.length = 0;
    expect(s.planWave(1).cards).toHaveLength(DEFAULT_CONFIG.baseWaveSize);
  });

  it('same seed → same wave composition', () => {
    expect(make(9).planWave(1).cards.map((c) => c.id))
      .toEqual(make(9).planWave(1).cards.map((c) => c.id));
  });
});

describe('Spawner.pickLane', () => {
  it('avoids occupied lanes when any lane is free', () => {
    const s = make();
    for (let i = 0; i < 30; i++) {
      expect(s.pickLane([0, 1, 2, 3])).toBe(4);
    }
  });

  it('returns a valid lane even when all are occupied', () => {
    const lane = make().pickLane([0, 1, 2, 3, 4]);
    expect(lane).toBeGreaterThanOrEqual(0);
    expect(lane).toBeLessThan(LANES.length);
  });
});

describe('Spawner run-plan composition', () => {
  const allNew = pool.map((c) => c.id);

  it('introduces at most the per-wave cap, ordered first in the wave', () => {
    const s = makeWithPlan(planOf(allNew, 6, 2));
    const wave = s.planWave(1);
    expect(wave.newCards).toHaveLength(2);
    // New cards lead the wave so they spawn before anything else.
    expect(wave.cards.slice(0, 2).map((c) => c.id)).toEqual(wave.newCards.map((c) => c.id));
  });

  it('wave 1 of a fresh run fills its remainder only from cards introduced this same wave, never from cards still un-introduced', () => {
    // Budget (6) and cap (2) both exceed what a single wave needs, so this
    // is not the budget-exhausted case: there is plenty of budget left, yet
    // the wave's remainder must still be repeats of the 2 cards just
    // introduced, not other never-met cards (spec §3.1/§3.2).
    const s = makeWithPlan(planOf(allNew, 6, 2));
    const wave = s.planWave(1);
    expect(wave.newCards).toHaveLength(2);
    const introducedIds = new Set(wave.newCards.map((c) => c.id));
    for (const card of wave.cards) {
      expect(introducedIds.has(card.id)).toBe(true);
    }
  });

  it('spends the run budget across waves and then stops introducing', () => {
    const s = makeWithPlan(planOf(allNew, 3, 2));
    expect(s.planWave(1).newCards).toHaveLength(2); // 2 of 3
    expect(s.planWave(2).newCards).toHaveLength(1); // budget exhausted
    expect(s.planWave(3).newCards).toHaveLength(0);
  });

  it('recycles introduced cards into later waves — the promise of return', () => {
    const s = makeWithPlan(planOf(allNew, 2, 2));
    const first = s.planWave(1);
    const introduced = first.newCards.map((c) => c.id);
    expect(introduced).toHaveLength(2);
    const second = s.planWave(2);
    expect(second.newCards).toHaveLength(0);
    // Wave 2 can only draw from what has been met, so it must reuse them.
    for (const id of second.cards.map((c) => c.id)) expect(introduced).toContain(id);
  });

  it('repeats seen cards within a wave when the seen pool is too small', () => {
    const s = makeWithPlan(planOf(allNew, 1, 1));
    s.planWave(1); // introduces exactly 1 card; seen pool is now that 1 card
    const wave = s.planWave(2);
    expect(wave.cards.length).toBeGreaterThan(1);
    expect(new Set(wave.cards.map((c) => c.id)).size).toBe(1); // the same card, repeated
  });

  it('starved pool: zero budget and nothing seen still yields a playable wave, introducing nothing', () => {
    const s = makeWithPlan(planOf(allNew, 0, 2));
    const wave = s.planWave(1);
    expect(wave.newCards).toHaveLength(0);
    expect(wave.cards.length).toBeGreaterThan(0);
  });

  it('starved-pool fallback cards are not spent: a later run with real budget for them can still give them a proper introduction', () => {
    // Within one Spawner, budgetRemaining is fixed at construction and only
    // ever decreases, so a starved (runBudget: 0) instance can never regain
    // budget in a later wave of the *same* run - "a later day" (the
    // drawSeen doc comment's phrasing) means a later run: a fresh plan,
    // computed the next time this player plays, still listing these cards
    // as new. This test stands in for that: the fallback path must not have
    // done anything - consumed them from newPool, marked them seen, or
    // anything else - that would make them ineligible for a real
    // introduction once a plan with budget actually names them.
    const starved = makeWithPlan(planOf(allNew, 0, 2));
    const fallbackIds = starved.planWave(1).cards.map((c) => c.id);
    expect(fallbackIds.length).toBeGreaterThan(0);

    const later = makeWithPlan(planOf(fallbackIds, fallbackIds.length, fallbackIds.length));
    const introducedIds = new Set(later.planWave(1).newCards.map((c) => c.id));
    for (const id of fallbackIds) expect(introducedIds.has(id)).toBe(true);
  });

  it('with no plan-eligible new cards, behaves like a pure review run', () => {
    const s = makeWithPlan(planOf([], 6, 2));
    const wave = s.planWave(1);
    expect(wave.newCards).toHaveLength(0);
    expect(wave.cards.length).toBeGreaterThan(0);
  });

  it('same seed and plan produce identical waves', () => {
    const a = makeWithPlan(planOf(allNew, 4, 2), 7);
    const b = makeWithPlan(planOf(allNew, 4, 2), 7);
    expect(a.planWave(1).cards.map((c) => c.id)).toEqual(b.planWave(1).cards.map((c) => c.id));
    expect(a.planWave(2).cards.map((c) => c.id)).toEqual(b.planWave(2).cards.map((c) => c.id));
  });
});

describe('Spawner tier-gate composition (M4-D)', () => {
  it('cards in neither newCardIds nor seenCards are locked and never spawn', () => {
    const s = makeWithPlan(
      planOf(['c0', 'c1'], 6, 2, [{ id: 'c2', weight: 1 }, { id: 'c3', weight: 1 }]),
    );
    const allowed = new Set(['c0', 'c1', 'c2', 'c3']);
    for (let w = 1; w <= 20; w++) {
      for (const card of s.planWave(w).cards) {
        expect(allowed.has(card.id), card.id).toBe(true);
      }
    }
  });

  it('the starved fallback draws only from the active tier, never from locked cards', () => {
    // Zero budget, nothing seen, and 18 locked cards: the fallback may only
    // surface the plan's new (active-tier) cards (spec §7).
    const s = makeWithPlan(planOf(['c0', 'c1'], 0, 2, []));
    const wave = s.planWave(1);
    expect(wave.newCards).toHaveLength(0);
    expect(wave.cards.length).toBeGreaterThan(0);
    for (const card of wave.cards) expect(['c0', 'c1']).toContain(card.id);
  });

  it('the weighted draw favors a heavy card over any light card across many seeded waves', () => {
    const seen = pool.map((c, i) => ({ id: c.id, weight: i === 0 ? 1.1 : 0.1 }));
    const s = makeWithPlan(planOf([], 0, 2, seen), 7);
    let heavyWaves = 0;
    const lightWaves = new Map<string, number>();
    const ROUNDS = 200;
    for (let i = 0; i < ROUNDS; i++) {
      const ids = new Set(s.planWave(1).cards.map((c) => c.id)); // wave 1: 5 draws from 20
      if (ids.has('c0')) heavyWaves += 1;
      for (const id of ids) {
        if (id !== 'c0') lightWaves.set(id, (lightWaves.get(id) ?? 0) + 1);
      }
    }
    // 11x weight → inclusion should dominate every uniform-light competitor.
    for (const [id, count] of lightWaves) {
      expect(heavyWaves, `c0 vs ${id}`).toBeGreaterThan(2 * count);
    }
    expect(heavyWaves).toBeGreaterThan(ROUNDS / 2);
  });

  it('weighted determinism: same seed and same weighted plan produce identical waves', () => {
    const seen = pool.map((c, i) => ({ id: c.id, weight: 0.1 + (i % 5) * 0.25 }));
    const a = makeWithPlan(planOf(['c0'], 1, 1, seen), 11);
    const b = makeWithPlan(planOf(['c0'], 1, 1, seen), 11);
    for (let w = 1; w <= 3; w++) {
      expect(a.planWave(w).cards.map((c) => c.id)).toEqual(b.planWave(w).cards.map((c) => c.id));
    }
  });
});
