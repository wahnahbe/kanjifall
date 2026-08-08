import type { Card } from '../engine/types';
import { listCardsResponseSchema } from '../shared/api';
import { levelFileSchema, toCards } from './schema';

export type LevelId = 'n5' | 'n4' | 'n3' | 'n2';
export type PoolId = LevelId | 'mixed';
export type ListPoolId = `list:${number}`;
export type PlayablePool = PoolId | ListPoolId;

export function isListPool(pool: string): pool is ListPoolId {
  return /^list:\d+$/.test(pool);
}

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
const listVersions = new Map<LevelId, string>();

/** Tests only: reset module-level cache between cases. */
export function clearDataCache(): void {
  cache.clear();
  listVersions.clear();
}

async function fetchLevelOnce(level: LevelId): Promise<Card[]> {
  const response = await fetch(`/data/jlpt-${level}.json`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const parsed = levelFileSchema.parse(await response.json());
  listVersions.set(level, parsed.listVersion);
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

export interface LoadedPool {
  cards: Card[];
  listVersion: string;
}

/**
 * List membership is fetched fresh on every load — lists change between
 * imports, so caching them would serve stale pools. The per-level file
 * cache underneath still applies, so the JLPT hydration cost matches what
 * `mixed` already pays (custom-list-import spec §5.3). Arrays arrive in
 * list position order; interleaving across the two is not meaningful — the
 * Spawner shuffles and weights, so pool order never reaches gameplay.
 */
async function loadListPool(pool: ListPoolId): Promise<LoadedPool> {
  try {
    const response = await fetch(`/api/lists/${pool.slice('list:'.length)}/cards`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = listCardsResponseSchema.parse(await response.json());
    const levels = await Promise.all(MIXED_ORDER.map(loadLevel));
    const byId = new Map(levels.flat().map((c) => [c.id, c]));
    const hydrated: Card[] = [];
    for (const id of body.jlptCardIds) {
      const card = byId.get(id);
      if (card === undefined) {
        console.warn(`[loader] list ${body.list.id}: jlpt member ${id} not in the level files — skipped`);
        continue;
      }
      hydrated.push(card);
    }
    return {
      cards: [...body.customCards, ...hydrated],
      listVersion: `list-${body.list.id}@${body.list.updatedAt}`,
    };
  } catch (error: unknown) {
    throw new DataLoadError(pool, error);
  }
}

/** Mixed = uniform concatenation in M2; profile-weighted mixing arrives in M3. */
export async function loadPool(pool: PlayablePool): Promise<LoadedPool> {
  if (isListPool(pool)) return loadListPool(pool);
  if (pool !== 'mixed') {
    const cards = await loadLevel(pool);
    return { cards, listVersion: listVersions.get(pool)! };
  }
  const levels = await Promise.all(MIXED_ORDER.map(loadLevel));
  // All four data files share one pipeline version; n5 stands in for the pool.
  return { cards: levels.flat(), listVersion: listVersions.get('n5')! };
}
