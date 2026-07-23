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

const cache = new Map<LevelId, Promise<Card[]>>();

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

async function fetchWithRetry(level: LevelId): Promise<Card[]> {
  try {
    return await fetchLevelOnce(level);
  } catch {
    try {
      return await fetchLevelOnce(level); // one retry (spec §7)
    } catch (error: unknown) {
      throw new DataLoadError(level, error);
    }
  }
}

function loadLevel(level: LevelId): Promise<Card[]> {
  const cached = cache.get(level);
  if (cached) return cached;
  const pending = fetchWithRetry(level);
  cache.set(level, pending);
  // A failed load must not poison the cache (spec §7: retry then error screen).
  pending.catch(() => cache.delete(level));
  return pending;
}

/** Mixed = uniform concatenation in M2; profile-weighted mixing arrives in M3. */
export async function loadPool(pool: PoolId): Promise<Card[]> {
  if (pool !== 'mixed') return loadLevel(pool);
  const levels = await Promise.all(MIXED_ORDER.map(loadLevel));
  return levels.flat();
}
