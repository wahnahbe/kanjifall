import { asc, sql } from 'drizzle-orm';
import type { RunPlan, TierProgress } from '../src/shared/api';
import { cardStrength, evaluateDirection, groupByCard, type CardAttemptGroup } from './cardScoring';
import { startOfLocalDay } from './dates';
import { attempts } from './db/schema';
import type { DbHandle } from './db/connect';
import { PLAN } from './planConfig';

type Level = 5 | 4 | 3 | 2;

const POOL_LEVELS: Record<string, Level[]> = {
  n5: [5],
  n4: [4],
  n3: [3],
  n2: [2],
  mixed: [5, 4, 3, 2],
};

const LIST_POOL_RE = /^list:\d+$/;

/** Pools the planner knows. The route rejects anything else; computeRunPlan
 *  itself stays total, returning an empty plan for an unknown pool — and for
 *  a well-formed list pool whose id doesn't exist. */
export function isKnownPool(pool: string): boolean {
  return Object.hasOwn(POOL_LEVELS, pool) || LIST_POOL_RE.test(pool);
}

interface PoolCardRow {
  id: string;
  jlpt: number;
  /** Non-null for every source='jlpt' row: seedCards backfills the column
   *  from the committed data on every boot, before any route exists. */
  tier: number;
  /** Null for kana-only words. Drives mode-unreachability below. */
  kanji: string | null;
}

const HOUR_MS = 3_600_000;

type Mode = 'reading' | 'recall';

/** A card this run's mode can never introduce — currently just kana-only
 *  cards under 'reading' (the engine's own mode filter drops them from the
 *  spawn pool, GameEngine.ts). Absent mode or 'recall': nothing is
 *  unreachable (final-review Fix 1). */
function isModeUnreachable(card: PoolCardRow, mode: Mode | undefined): boolean {
  return mode === 'reading' && card.kanji === null;
}

/** Card-level knowledge over POOLED attempts (§3.2): one learned-gate pass
 *  over the combined bucket — deliberately the same rule the Stats screen
 *  uses, so the gate and Stats can never disagree about knowing a word.
 *  Classification order is significant (final-review Fix 1): a card made
 *  solid by past play counts as solid regardless of this run's mode — it IS
 *  known — and only a NOT-solid mode-unreachable card leaves the
 *  denominator ahead of amnesty. */
function classifyCard(
  group: CardAttemptGroup | undefined,
  unreachable: boolean,
): 'solid' | 'unreachable' | 'amnestied' | 'neither' {
  if (group === undefined) return unreachable ? 'unreachable' : 'neither';
  if (evaluateDirection(group.all).learned) return 'solid';
  if (unreachable) return 'unreachable';
  if (group.all.length >= PLAN.amnestyMinEncounters) return 'amnestied';
  return 'neither';
}

/** §3.4: weight = floor + weakness·w₁ + staleness·w₂, range [0.1, 1.1]. A
 *  card introduced but never attempted has no group and gets the maximum —
 *  it just arrived and has not been tested once. */
function cardWeight(group: CardAttemptGroup | undefined, nowMs: number): number {
  if (group === undefined) {
    return PLAN.reviewWeightFloor + PLAN.reviewWeaknessWeight + PLAN.reviewStalenessWeight;
  }
  const weakness = 1 - cardStrength(group.all) / 100;
  const lastAttemptAt = group.all[group.all.length - 1].createdAt;
  const hoursSince = Math.max(0, (nowMs - lastAttemptAt) / HOUR_MS);
  const staleness = Math.min(1, hoursSince / PLAN.reviewStalenessCeilingHours);
  return (
    PLAN.reviewWeightFloor +
    PLAN.reviewWeaknessWeight * weakness +
    PLAN.reviewStalenessWeight * staleness
  );
}

/** The active tier is DERIVED on every request (§3.3): the lowest tier that
 *  fails the mastery gate. Amnestied AND mode-unreachable cards leave the
 *  denominator and never enter the numerator (unless solid — see
 *  classifyCard); a fully amnestied/unreachable tier (denominator 0) passes. */
function resolveActiveTier(
  levelCards: readonly PoolCardRow[],
  grouped: ReadonlyMap<string, CardAttemptGroup>,
  level: Level,
  mode: Mode | undefined,
): { progress: TierProgress; activeCardIds: string[] } {
  const byTier = new Map<number, PoolCardRow[]>();
  for (const card of levelCards) {
    const list = byTier.get(card.tier);
    if (list) list.push(card);
    else byTier.set(card.tier, [card]);
  }
  const tierNumbers = [...byTier.keys()].sort((a, b) => a - b);
  const totalTiers = tierNumbers.length > 0 ? tierNumbers[tierNumbers.length - 1] : 0;

  for (const t of tierNumbers) {
    const cards = byTier.get(t)!;
    let solid = 0;
    let amnestied = 0;
    let unreachable = 0;
    for (const card of cards) {
      const kind = classifyCard(grouped.get(card.id), isModeUnreachable(card, mode));
      if (kind === 'solid') solid += 1;
      else if (kind === 'unreachable') unreachable += 1;
      else if (kind === 'amnestied') amnestied += 1;
    }
    // Gate uses the tier's ACTUAL size (the last tier runs short), never the
    // tierSize constant (§7).
    const denominator = cards.length - unreachable - amnestied;
    const passes = denominator === 0 || solid / denominator >= PLAN.tierMasteryThreshold;
    if (!passes) {
      return {
        progress: { level, index: t, totalTiers, size: cards.length, solid, amnestied, unreachable },
        activeCardIds: cards.map((c) => c.id),
      };
    }
  }
  // Every tier passes: the level is complete and produces no new cards.
  // size/solid/amnestied/unreachable describe the active tier, and there
  // isn't one (§4.3).
  return {
    progress: { level, index: null, totalTiers, size: 0, solid: 0, amnestied: 0, unreachable: 0 },
    activeCardIds: [],
  };
}

/** Attempts grouped per card plus the introduced set — the planning state
 *  every pool kind derives from. */
function loadPlanningState(handle: DbHandle, nowMs: number): {
  grouped: Map<string, CardAttemptGroup>;
  introduced: Set<string>;
} {
  const attemptRows = handle.db
    .select()
    .from(attempts)
    .orderBy(asc(attempts.createdAt))
    .all()
    .filter((a) => a.createdAt <= nowMs);
  const grouped = groupByCard(attemptRows);
  const introduced = new Set<string>();
  for (const row of handle.sqlite.prepare('SELECT card_id AS id FROM introductions').all() as {
    id: string;
  }[]) {
    introduced.add(row.id);
  }
  return { grouped, introduced };
}

/** M4-A's daily budget, unchanged: shared across every pool kind, because
 *  introductions are global. */
function computeBudget(handle: DbHandle, nowMs: number): number {
  const goal =
    handle.db.get<{ goal: number }>(sql`SELECT daily_word_goal AS goal FROM profile WHERE id = 1`)
      ?.goal ?? 0;
  const introducedToday =
    handle.db.get<{ n: number }>(
      sql`SELECT COUNT(*) AS n FROM introductions WHERE introduced_at >= ${startOfLocalDay(nowMs)}`,
    )?.n ?? 0;
  return Math.max(0, Math.min(goal - introducedToday, PLAN.perRunNewCap));
}

/**
 * What this run may introduce and review. "New" means in an active tier AND
 * never introduced AND reachable in this mode. Every INTRODUCED card returns
 * in seenCards with a review weight (mode-unreachable or not — seenCards
 * stays mode-agnostic, since a card once introduced is met regardless of
 * which mode met it); cards in neither list are locked and must not spawn
 * (§5.3). Attempts alone never confer seen status: the ceremony-less
 * fallbacks (a no-plan run, the starved-pool draws) record attempts for
 * cards that were never taught, and those cards must re-enter newCardIds
 * once their tier is active so they still get their acquisition moment
 * (word-intro §3.2; seen-requires-introduction fix, 2026-08-09). Off-plan
 * attempts still feed the gate and the weights — knowledge evidence, not
 * membership. `mode` is optional: absent means the pooled view used by e2e's
 * direct plan reads and any caller that hasn't opted in (final-review Fix 1).
 * The daily budget is unchanged from M4-A.
 */
export function computeRunPlan(
  handle: DbHandle,
  pool: string,
  nowMs: number,
  mode?: Mode,
): RunPlan {
  if (LIST_POOL_RE.test(pool)) {
    return computeListRunPlan(handle, Number(pool.slice('list:'.length)), nowMs, mode);
  }

  const levels = POOL_LEVELS[pool];
  if (!levels) return { newCardIds: [], seenCards: [], runBudget: 0, tiers: [] };

  const placeholders = levels.map(() => '?').join(',');
  const poolCards = handle.sqlite
    .prepare(
      `SELECT id, jlpt, tier, kanji FROM cards WHERE source = 'jlpt' AND jlpt IN (${placeholders}) ORDER BY id`,
    )
    .all(...levels) as PoolCardRow[];

  const { grouped, introduced } = loadPlanningState(handle, nowMs);

  const tiers: TierProgress[] = [];
  const activeTierIds = new Set<string>();
  for (const level of levels) {
    const levelCards = poolCards.filter((c) => c.jlpt === level);
    const { progress, activeCardIds } = resolveActiveTier(levelCards, grouped, level, mode);
    tiers.push(progress);
    for (const id of activeCardIds) activeTierIds.add(id);
  }

  const newCardIds: string[] = [];
  const seenCards: { id: string; weight: number }[] = [];
  for (const card of poolCards) {
    const { id } = card;
    const group = grouped.get(id);
    if (introduced.has(id)) {
      seenCards.push({ id, weight: cardWeight(group, nowMs) });
    } else if (activeTierIds.has(id) && !isModeUnreachable(card, mode)) {
      newCardIds.push(id);
    }
    // Neither introduced, in an active tier and reachable, is locked (§5.3)
    // — in no list at all, attempt history or not. Mode-unreachable cards
    // can never be introduced in this mode, so they never enter newCardIds
    // even while their tier is active.
  }

  return { newCardIds, seenCards, runBudget: computeBudget(handle, nowMs), tiers };
}

/**
 * A list pool is a curation, not a curriculum: full M4-A treatment —
 * ceremonies via newCardIds, the shared daily budget, weighted review — but
 * NO tier gate and tiers: [] (custom-list-import spec §5.2). The empty tiers
 * array is load-bearing downstream: noticeFor's structural branch, the setup
 * tier display, and tierAdvanceLine all treat it as "nothing to gate".
 */
function computeListRunPlan(
  handle: DbHandle,
  listId: number,
  nowMs: number,
  mode?: Mode,
): RunPlan {
  const listExists = handle.sqlite
    .prepare(`SELECT id FROM lists WHERE id = ?`)
    .get(listId) as { id: number } | undefined;
  if (listExists === undefined) return { newCardIds: [], seenCards: [], runBudget: 0, tiers: [] };

  const members = handle.sqlite
    .prepare(
      `SELECT c.id, c.kanji FROM list_cards lc
       JOIN cards c ON c.id = lc.card_id
       WHERE lc.list_id = ? ORDER BY lc.position`,
    )
    .all(listId) as { id: string; kanji: string | null }[];

  const { grouped, introduced } = loadPlanningState(handle, nowMs);
  const newCardIds: string[] = [];
  const seenCards: { id: string; weight: number }[] = [];
  for (const member of members) {
    const group = grouped.get(member.id);
    if (introduced.has(member.id)) {
      seenCards.push({ id: member.id, weight: cardWeight(group, nowMs) });
    } else if (!(mode === 'reading' && member.kanji === null)) {
      // The mode-unreachable rule (final-review Fix 1) without a gate to
      // feed: a kana-only member simply can't be introduced in reading mode.
      newCardIds.push(member.id);
    }
  }
  return { newCardIds, seenCards, runBudget: computeBudget(handle, nowMs), tiers: [] };
}
