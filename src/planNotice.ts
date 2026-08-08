import type { FetchedPlan } from './data/planClient';

/**
 * What to tell the player about this run's new-word situation (tiered-vocab
 * spec §5.4). The gate makes "no new words" far more common than under
 * M4-A, and the REASON matters — so the structural cases (level complete,
 * tier gated) outrank the temporal ones (budget spent today): "today's new
 * words are done" implies tomorrow brings more, and when the gate is also
 * shut that is false.
 *
 * Precedence: plan-unavailable → starved → level-complete → tier-gated →
 * budget-exhausted. Starved requires eligible new cards while the two
 * structural cases require none, so the branches below are disjoint and
 * order-safe.
 */
export function noticeFor(fetched: FetchedPlan | null): string | null {
  if (fetched === null) return 'Word introductions need the server — playing without them.';

  const hasNew = fetched.newCardIds.length > 0;
  const seenIsEmpty = fetched.seenCards.length === 0;

  // Starved pool (§3.2): budget spent, unmet cards exist, but NOTHING in the
  // pool has ever been met — brand-new cards are about to fall with no
  // ceremony, a materially different situation from ordinary review.
  if (fetched.runBudget === 0 && hasNew && seenIsEmpty) {
    return "Today's new words are done, and you haven't met anything in this pool yet — playing without introductions.";
  }

  if (!hasNew) {
    if (fetched.tiers.length === 0) return null; // defensive: no tier info at all
    // The server emits tiers in pool order, but that is an implementation
    // detail — sort by level so "first gated" means the earliest-learned
    // level (N5 before N2) whatever order the array arrived in.
    const byLevel = [...fetched.tiers].sort((a, b) => b.level - a.level);
    const gated = byLevel.find((t) => t.index !== null);
    if (gated === undefined) {
      const label =
        byLevel.length === 1 ? `every N${byLevel[0].level} tier` : 'every tier in this pool';
      return `You've cleared ${label} — this run is review.`;
    }
    const where =
      byLevel.length === 1 ? `Tier ${gated.index}` : `N${gated.level} tier ${gated.index}`;
    return `${where} isn't solid yet — this run is review.`;
  }

  if (fetched.runBudget === 0) return "Today's new words are done — this run is review.";
  return null;
}
