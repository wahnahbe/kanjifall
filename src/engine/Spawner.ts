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

    // Introduced cards join the seen pool immediately - before this wave's
    // own remainder is drawn, not just for later waves. Otherwise, on a
    // fresh run's wave 1, the seen pool is still empty at the moment the
    // remainder is chosen and drawSeen falls back to still-un-introduced
    // cards to fill it, letting them fall with no acquisition ceremony and
    // (once an attempt is recorded) no way back (spec §3.1/§3.2).
    this.seenPool = [...this.seenPool, ...newCards];

    const cards = [...newCards, ...this.drawSeen(size - newCards.length)];

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
   * Fills the rest of a wave from cards the player has met, including ones
   * just introduced this same wave (planWave folds this wave's newCards
   * into seenPool before calling this, so "met" already covers them).
   * Repeats cards when that pool is smaller than the remainder needed.
   *
   * Falls back to still-un-introduced cards only in the genuine starved
   * case: seenPool is empty and this wave introduced nothing either. The
   * fallback does not remove those cards from newPool or mark them
   * introduced, so this engine's own state still treats them as eligible
   * for a proper acquisition moment on a later run with real budget for
   * them. That is a claim about this engine's bookkeeping only, though:
   * once one of them falls and an attempt is recorded, whether a *future*
   * plan still calls it "new" is entirely up to whatever computed that
   * plan (spec §3.2, §7).
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
