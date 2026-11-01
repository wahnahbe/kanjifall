import type { Card, EnginePlan, GameEvent } from './engine/types';

/** A word still owed, and how many times it has fallen since it became owed
 *  (a comeback dropped again counts; a kill settles it and resets by
 *  removal). The results table marks `drops > 1`, so a word that fell twice
 *  is not mistaken for two words. */
export interface RevengePoolEntry {
  card: Card;
  drops: number;
}

/**
 * The revenge pool: every word dropped during this sitting that has not been
 * cleared since, newest drop first. It lives in App for the whole page life
 * (across runs, replays and trips to the title) and feeds the results
 * screen's Revenge round, so a word dropped in one run and not yet taken
 * back is still owed on the next results screen. A kill in ANY run — a
 * normal run, a revenge round, a lapse comeback relight — settles the debt;
 * the pool only ever offers what is still owed.
 */
export function updateRevengePool(
  pool: readonly RevengePoolEntry[],
  event: GameEvent,
): readonly RevengePoolEntry[] {
  if (event.type === 'wordMissed') {
    const { card } = event.word;
    const owed = pool.find((e) => e.card.id === card.id);
    return [
      { card, drops: (owed?.drops ?? 0) + 1 },
      ...pool.filter((e) => e.card.id !== card.id),
    ];
  }
  if (event.type === 'wordKilled') {
    const { id } = event.word.card;
    return pool.some((e) => e.card.id === id) ? pool.filter((e) => e.card.id !== id) : pool;
  }
  return pool;
}

/**
 * A revenge round's plan is the LAST run's replay plan, but the pool can
 * hold cards from earlier runs that plan never listed — and a card in
 * neither list is locked and never spawns (tiered-vocab spec §5.3). Add
 * those as ordinary seen cards (weight 1, owned per the previous run's
 * light map) so every owed word falls. A card the plan parks in newCardIds
 * stays parked: it was never introduced, and its ceremony is preserved for
 * a later planned run (see App.replayPlan's doc comment).
 */
export function unlockForRevenge(
  plan: EnginePlan,
  pool: readonly Card[],
  ownedIds: ReadonlySet<string>,
): EnginePlan {
  const seen = new Set(plan.seenCards.map((s) => s.id));
  const parked = new Set(plan.newCardIds);
  const added = pool
    .filter((c) => !seen.has(c.id) && !parked.has(c.id))
    .map((c) => ({ id: c.id, weight: 1, owned: ownedIds.has(c.id) }));
  if (added.length === 0) return plan;
  return { ...plan, seenCards: [...plan.seenCards, ...added] };
}
