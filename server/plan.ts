import { sql } from 'drizzle-orm';
import type { RunPlan } from '../src/shared/api';
import { startOfLocalDay } from './dates';
import type { DbHandle } from './db/connect';
import { PLAN } from './planConfig';

const POOL_LEVELS: Record<string, number[]> = {
  n5: [5],
  n4: [4],
  n3: [3],
  n2: [2],
  mixed: [5, 4, 3, 2],
};

/**
 * What this run may introduce. "New" means never attempted AND never
 * introduced, so quitting before a word falls doesn't burn its introduction,
 * and the daily budget can't be spent twice on one card.
 */
export function computeRunPlan(handle: DbHandle, pool: string, nowMs: number): RunPlan {
  const levels = POOL_LEVELS[pool];
  if (!levels) return { newCardIds: [], seenCardIds: [], runBudget: 0 };

  const placeholders = levels.map(() => '?').join(',');
  const poolIds = handle.sqlite
    .prepare(`SELECT id FROM cards WHERE source = 'jlpt' AND jlpt IN (${placeholders}) ORDER BY id`)
    .all(...levels) as { id: string }[];

  const seen = new Set<string>();
  for (const row of handle.sqlite.prepare('SELECT DISTINCT card_id AS id FROM attempts').all() as {
    id: string;
  }[]) {
    seen.add(row.id);
  }
  for (const row of handle.sqlite.prepare('SELECT card_id AS id FROM introductions').all() as {
    id: string;
  }[]) {
    seen.add(row.id);
  }

  const newCardIds: string[] = [];
  const seenCardIds: string[] = [];
  for (const { id } of poolIds) {
    if (seen.has(id)) seenCardIds.push(id);
    else newCardIds.push(id);
  }

  const goal =
    handle.db.get<{ goal: number }>(sql`SELECT daily_word_goal AS goal FROM profile WHERE id = 1`)
      ?.goal ?? 0;
  const introducedToday =
    handle.db.get<{ n: number }>(
      sql`SELECT COUNT(*) AS n FROM introductions WHERE introduced_at >= ${startOfLocalDay(nowMs)}`,
    )?.n ?? 0;

  const runBudget = Math.max(0, Math.min(goal - introducedToday, PLAN.perRunNewCap));
  return { newCardIds, seenCardIds, runBudget };
}
