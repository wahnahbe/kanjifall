import type { EnginePlan, GameMode, SeenCardRef } from '../engine/types';
import { runPlanSchema, type TierProgress } from '../shared/api';

/**
 * Mirrors `PLAN.perWaveNewCap` in server/planConfig.ts, which is the source of
 * truth. The client cannot import from server/, and the plan endpoint returns
 * budget rather than pacing, so this one number is duplicated deliberately.
 */
const PER_WAVE_NEW_CAP = 2;

/**
 * Everything the plan endpoint gives the client: the engine's plan shape
 * (`newCardIds`/`seenCards`/`runBudget`/`perWaveNewCap`) plus `tiers`, which
 * the engine has no use for but the UI needs for the setup screen's tier
 * progress and the run notice (tiered-vocab spec §5.4). Kept separate from
 * `EnginePlan` so the engine's contract stays exactly what Spawner needs and
 * nothing more.
 */
export interface FetchedPlan {
  newCardIds: readonly string[];
  seenCards: readonly SeenCardRef[];
  tiers: readonly TierProgress[];
  runBudget: number;
  perWaveNewCap: number;
}

/**
 * The run plan, or null when it can't be had. Never throws and never blocks
 * play: a null plan means "nothing is new", i.e. no ceremonies and ordinary
 * gameplay (spec §7).
 *
 * `mode` is REQUIRED (not optional): both call sites (App's fresh-run fetch,
 * SetupScreen's display-only preview) always know the run's mode, and a
 * mode-less request would silently fall back to the pooled view — which is
 * exactly the stall Fix 1 closes (reading mode's kana-only cards must leave
 * the gate's denominator). The server treats the param itself as optional
 * for other callers (e.g. e2e's direct GETs, which want the pooled view on
 * purpose) — see server/routes/plan.ts.
 */
export async function fetchRunPlan(pool: string, mode: GameMode): Promise<FetchedPlan | null> {
  try {
    const response = await fetch(`/api/plan?pool=${pool}&mode=${mode}`);
    if (!response.ok) return null;
    const plan = runPlanSchema.parse(await response.json());
    return {
      newCardIds: plan.newCardIds,
      seenCards: plan.seenCards,
      tiers: plan.tiers,
      runBudget: plan.runBudget,
      perWaveNewCap: PER_WAVE_NEW_CAP,
    };
  } catch {
    return null;
  }
}

/** Narrows a `FetchedPlan` down to exactly what the engine is allowed to see. */
export function toEnginePlan(fetched: FetchedPlan): EnginePlan {
  return {
    newCardIds: fetched.newCardIds,
    seenCards: fetched.seenCards,
    runBudget: fetched.runBudget,
    perWaveNewCap: fetched.perWaveNewCap,
  };
}
