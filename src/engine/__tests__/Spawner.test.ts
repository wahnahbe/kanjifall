import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, LANES } from '../constants';
import { mulberry32 } from '../rng';
import { Spawner } from '../Spawner';
import type { Card, EnginePlan } from '../types';

const pool: Card[] = Array.from({ length: 20 }, (_, i) => ({
  id: `c${i}`, kanji: `字${i}`, kana: [`かな${i}`], gloss: 'g', pos: 'noun',
  jlpt: 5, source: 'jlpt',
}));

const planOf = (newIds: string[], runBudget: number, perWaveNewCap = 2): EnginePlan => ({
  newCardIds: newIds,
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
