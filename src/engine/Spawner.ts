import { LANES } from './constants';
import type { Card, EngineConfig, EnginePlan } from './types';

export interface WavePlan {
  cards: Card[];
  /** Subset of `cards` being introduced this wave; they lead `cards`. */
  newCards: Card[];
  fallSpeed: number;
  spawnIntervalMs: number;
}

export class Spawner {
  private readonly rng: () => number;
  private readonly config: EngineConfig;
  private newPool: Card[];
  private seenPool: Card[];
  private budgetRemaining: number;
  private readonly perWaveNewCap: number;

  constructor(pool: Card[], rng: () => number, config: EngineConfig, plan: EnginePlan) {
    this.rng = rng;
    this.config = config;
    const newIds = new Set(plan.newCardIds);
    this.newPool = pool.filter((c) => newIds.has(c.id));
    this.seenPool = pool.filter((c) => !newIds.has(c.id));
    this.budgetRemaining = Math.max(0, plan.runBudget);
    this.perWaveNewCap = Math.max(0, plan.perWaveNewCap);
  }

  planWave(wave: number): WavePlan {
    const c = this.config;
    const size = Math.min(c.baseWaveSize + c.waveSizeGrowth * (wave - 1), c.maxWaveSize);

    const introduceCount = Math.min(this.budgetRemaining, this.perWaveNewCap, this.newPool.length, size);
    const newCards = this.shuffled(this.newPool).slice(0, introduceCount);
    const introducedIds = new Set(newCards.map((card) => card.id));
    this.newPool = this.newPool.filter((card) => !introducedIds.has(card.id));
    this.budgetRemaining -= newCards.length;

    const cards = [...newCards, ...this.drawSeen(size - newCards.length)];

    // Introduced cards join the seen pool: later waves must draw from it once
    // the budget is gone, which is what guarantees the re-encounter.
    this.seenPool = [...this.seenPool, ...newCards];

    return {
      cards,
      newCards,
      fallSpeed: Math.min(c.baseFallSpeed * (1 + c.fallSpeedGrowth * (wave - 1)), c.maxFallSpeed),
      spawnIntervalMs: Math.max(
        Math.round(c.baseSpawnIntervalMs * c.spawnIntervalDecay ** (wave - 1)),
        c.minSpawnIntervalMs,
      ),
    };
  }

  /**
   * Fills the rest of a wave from cards already met, repeating them when the
   * seen pool is smaller than the wave. Starved pool (nothing met and no
   * budget): fall back to un-introduced cards so the run stays playable —
   * they keep their acquisition moment for a later day (spec §3.2).
   */
  private drawSeen(count: number): Card[] {
    if (count <= 0) return [];
    const source = this.seenPool.length > 0 ? this.seenPool : this.newPool;
    if (source.length === 0) return [];
    const drawn: Card[] = [];
    while (drawn.length < count) {
      for (const card of this.shuffled(source)) {
        if (drawn.length === count) break;
        drawn.push(card);
      }
    }
    return drawn;
  }

  /** Prefer a free lane; fall back to any lane when all are occupied. */
  pickLane(occupiedLanes: readonly number[]): number {
    const free = LANES.map((_, i) => i).filter((i) => !occupiedLanes.includes(i));
    const candidates = free.length > 0 ? free : LANES.map((_, i) => i);
    return candidates[Math.floor(this.rng() * candidates.length)];
  }

  private shuffled(cards: readonly Card[]): Card[] {
    const copy = [...cards];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
}
