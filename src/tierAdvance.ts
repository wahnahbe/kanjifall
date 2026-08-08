import type { TierProgress } from './shared/api';

/**
 * Plain results-screen line when a run advanced the active tier (tiered
 * spec §5.4 — the celebration itself belongs to sub-project C). Compares
 * the run-start tier snapshot against a fresh fetch taken once the run
 * ends, matching entries by level. Returns null when nothing advanced or
 * either side is unknown (plan-unavailable at either end of the run).
 *
 * "Advanced" means the level's active tier moved forward: it was active
 * (`before.index !== null`) and is now either cleared entirely
 * (`after.index === null`) or sitting at a strictly later tier
 * (`after.index > before.index`). A level already complete before the run
 * never reports, and a regression (active tier index moved backward — solid
 * is a live rolling check, so a later miss can re-open an earlier tier)
 * never reports either.
 *
 * When more than one level advanced in the same run (mixed pool), the
 * earliest-learned one wins — sorted by level descending, N5 first, the
 * same defensive posture noticeFor takes: the server's array order is an
 * implementation detail, not something callers should depend on.
 */
export function tierAdvanceLine(
  before: readonly TierProgress[] | null,
  after: readonly TierProgress[] | null,
): string | null {
  if (before === null || after === null) return null;

  const byLevel = [...before].sort((a, b) => b.level - a.level);
  for (const prior of byLevel) {
    if (prior.index === null) continue; // already complete before the run
    const current = after.find((t) => t.level === prior.level);
    if (current === undefined) continue; // defensive: no matching entry

    if (current.index === null) return `N${prior.level} complete — every tier cleared.`;
    if (current.index > prior.index) {
      return `N${prior.level} tier ${prior.index} cleared — tier ${current.index} is next.`;
    }
  }
  return null;
}
