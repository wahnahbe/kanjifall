import type { Card } from '../engine/types';
import { levelFileSchema, toCards } from './schema';

export type LevelId = 'n5' | 'n4' | 'n3' | 'n2';
export type PoolId = LevelId | 'mixed';

export const POOL_LABELS: Record<PoolId, string> = {
  n5: 'JLPT N5', n4: 'JLPT N4', n3: 'JLPT N3', n2: 'JLPT N2',
  mixed: 'Mixed (N5–N2)',
};

const MIXED_ORDER: LevelId[] = ['n5', 'n4', 'n3', 'n2'];

export class DataLoadError extends Error {
  readonly level: string;

  constructor(level: string, cause: unknown) {
    super(`failed to load word data for ${level}`, { cause });
    this.name = 'DataLoadError';
    this.level = level;
  }
}

const cache = new Map<LevelId, Card[]>();

/** Tests only: reset module-level cache between cases. */
export function clearDataCache(): void {
  cache.clear();
}

async function fetchLevelOnce(level: LevelId): Promise<Card[]> {
  const response = await fetch(`/data/jlpt-${level}.json`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const parsed = levelFileSchema.parse(await response.json());
  return toCards(parsed);
}

async function loadLevel(level: LevelId): Promise<Card[]> {
  const cached = cache.get(level);
  if (cached) return cached;
  let cards: Card[];
  try {
    cards = await fetchLevelOnce(level);
  } catch {
    try {
      cards = await fetchLevelOnce(level); // one retry (spec §7)
    } catch (error: unknown) {
      throw new DataLoadError(level, error);
    }
  }
  cache.set(level, cards);
  return cards;
}

/** Mixed = uniform concatenation in M2; profile-weighted mixing arrives in M3. */
export async function loadPool(pool: PoolId): Promise<Card[]> {
  if (pool !== 'mixed') return loadLevel(pool);
  const levels = await Promise.all(MIXED_ORDER.map(loadLevel));
  return levels.flat();
}
