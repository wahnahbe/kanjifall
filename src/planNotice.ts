import type { EnginePlan } from './engine/types';

/**
 * What to tell the player about this run's new-word situation (spec §3.2,
 * §7). Pulled out of App.tsx into its own module so it can be unit-tested
 * directly, with no React/DOM import chain to drag along.
 *
 * `seenIsEmpty` distinguishes the two ways a spent budget can look once
 * `plan.newCardIds` still has entries:
 *  - the pool has history (seen non-empty) → ordinary review, budget will
 *    refill tomorrow.
 *  - the pool has NO history at all (seen empty) → the starved-pool case
 *    (§3.2): brand-new cards are about to fall with no ceremony, which is a
 *    materially different situation and must say so.
 */
export function noticeFor(plan: EnginePlan | null, seenIsEmpty: boolean): string | null {
  if (plan === null) return 'Word introductions need the server — playing without them.';
  if (plan.runBudget > 0) return null;
  if (plan.newCardIds.length === 0) return null;
  if (seenIsEmpty) {
    return "Today's new words are done, and you haven't met anything in this pool yet — playing without introductions.";
  }
  return "Today's new words are done — this run is review.";
}
