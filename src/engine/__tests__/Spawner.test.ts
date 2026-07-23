import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, LANES } from '../constants';
import { mulberry32 } from '../rng';
import { Spawner } from '../Spawner';
import type { Card } from '../types';

const pool: Card[] = Array.from({ length: 20 }, (_, i) => ({
  id: `c${i}`, kanji: `字${i}`, kana: [`かな${i}`], gloss: 'g', pos: 'noun',
  jlpt: 5, source: 'jlpt',
}));

const make = (seed = 42) => new Spawner(pool, mulberry32(seed), DEFAULT_CONFIG);

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
