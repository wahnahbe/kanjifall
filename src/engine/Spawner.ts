import { LANES } from './constants';
import type { Card, EngineConfig } from './types';

export interface WavePlan {
  cards: Card[];
  fallSpeed: number;
  spawnIntervalMs: number;
}

export class Spawner {
  private readonly pool: Card[];
  private readonly rng: () => number;
  private readonly config: EngineConfig;

  constructor(pool: Card[], rng: () => number, config: EngineConfig) {
    this.pool = pool;
    this.rng = rng;
    this.config = config;
  }

  planWave(wave: number): WavePlan {
    const c = this.config;
    const size = Math.min(
      c.baseWaveSize + c.waveSizeGrowth * (wave - 1),
      c.maxWaveSize,
      this.pool.length,
    );
    return {
      cards: this.shuffled(this.pool).slice(0, size),
      fallSpeed: Math.min(c.baseFallSpeed * (1 + c.fallSpeedGrowth * (wave - 1)), c.maxFallSpeed),
      spawnIntervalMs: Math.max(
        Math.round(c.baseSpawnIntervalMs * c.spawnIntervalDecay ** (wave - 1)),
        c.minSpawnIntervalMs,
      ),
    };
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
