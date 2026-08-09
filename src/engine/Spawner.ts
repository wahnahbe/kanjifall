import { LANES } from './constants';
import type { Card, EngineConfig, EnginePlan } from './types';

export interface WavePlan {
  cards: Card[];
  /** Subset of `cards` being introduced this wave; they lead `cards`. */
  newCards: Card[];
  fallSpeed: number;
  spawnIntervalMs: number;
}

interface WeightedCard {
  card: Card;
  weight: number;
}

/**
 * Mirrors the server's maximum review weight — reviewWeightFloor +
 * reviewWeaknessWeight + reviewStalenessWeight in server/planConfig.ts,
 * which is the source of truth (same deliberate duplication as
 * PER_WAVE_NEW_CAP in src/data/planClient.ts). A card introduced mid-run
 * has no server-computed weight yet; §3.4 gives just-arrived cards the
 * maximum so the introduce → reuse gap stays short.
 */
const JUST_INTRODUCED_WEIGHT = 1.1;

export class Spawner {
  private readonly rng: () => number;
  private readonly config: EngineConfig;
  private newPool: Card[];
  private seenPool: WeightedCard[];
  private budgetRemaining: number;
  private readonly perWaveNewCap: number;

  constructor(pool: Card[], rng: () => number, config: EngineConfig, plan: EnginePlan) {
    this.rng = rng;
    this.config = config;
    const newIds = new Set(plan.newCardIds);
    this.newPool = pool.filter((c) => newIds.has(c.id));
    // Seen comes from the plan's explicit list, never by negation: with the
    // tier gate, "not new" no longer implies "met", and cards in neither
    // list are locked out of every draw below (§5.3).
    const weightById = new Map(plan.seenCards.map((s) => [s.id, s.weight]));
    this.seenPool = pool.flatMap((c) => {
      const weight = weightById.get(c.id);
      return weight === undefined ? [] : [{ card: c, weight }];
    });
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
    // remainder is chosen and drawSeen would fall back to still-un-introduced
    // cards, spending the wave on ceremony-less falls instead of rehearsing
    // the words just taught (spec §3.1/§3.2). They carry the just-introduced
    // maximum weight (§3.4).
    this.seenPool = [
      ...this.seenPool,
      ...newCards.map((card) => ({ card, weight: JUST_INTRODUCED_WEIGHT })),
    ];

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
   * Fills the rest of a wave from the weighted seen pool: sampling without
   * replacement while the pool covers the remainder, refilling (repeats)
   * when it does not — M4-A's behavior, preserved (§5.3).
   *
   * Falls back to still-un-introduced cards only in the genuine starved
   * case: seenPool is empty and this wave introduced nothing either. The
   * fallback draws from newPool ONLY — which the plan restricts to the
   * active tier — at uniform weight (none of them has ever been attempted).
   * Locked cards are in neither pool and can never reach this draw (§7).
   * The fallback does not remove those cards from newPool or mark them
   * introduced, so a later run with real budget can still give them a
   * proper acquisition moment — the planner keys seen status on
   * introductions alone, so the attempts recorded here don't burn them in
   * (seen-requires-introduction fix, 2026-08-09).
   */
  private drawSeen(count: number): Card[] {
    if (count <= 0) return [];
    const source: readonly WeightedCard[] =
      this.seenPool.length > 0
        ? this.seenPool
        : this.newPool.map((card) => ({ card, weight: 1 }));
    if (source.length === 0) return [];
    const drawn: Card[] = [];
    let candidates: readonly WeightedCard[] = source;
    while (drawn.length < count) {
      if (candidates.length === 0) candidates = source; // repeats once exhausted
      const picked = this.pickWeighted(candidates);
      drawn.push(candidates[picked].card);
      candidates = candidates.filter((_, i) => i !== picked);
    }
    return drawn;
  }

  /** Cumulative-weight walk over the injected seeded RNG (§5.3). */
  private pickWeighted(candidates: readonly WeightedCard[]): number {
    let total = 0;
    for (const c of candidates) total += c.weight;
    let roll = this.rng() * total;
    for (let i = 0; i < candidates.length; i++) {
      roll -= candidates[i].weight;
      if (roll < 0) return i;
    }
    return candidates.length - 1; // float-edge fallback
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
