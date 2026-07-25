import type { EnginePlan } from '../engine/types';
import { runPlanSchema } from '../shared/api';

/**
 * Mirrors `PLAN.perWaveNewCap` in server/planConfig.ts, which is the source of
 * truth. The client cannot import from server/, and the plan endpoint returns
 * budget rather than pacing, so this one number is duplicated deliberately.
 */
const PER_WAVE_NEW_CAP = 2;

/**
 * Everything the plan endpoint gives the client: the engine's plan shape
 * (`newCardIds`/`runBudget`/`perWaveNewCap`) plus `seenCardIds`, which the
 * engine has no use for (Spawner derives "seen" as "pool minus new") but the
 * UI needs to tell a genuinely-starved pool from ordinary review (spec §3.2,
 * §7 — see `noticeFor` in src/planNotice.ts). Kept separate from
 * `EnginePlan` so the engine's contract stays exactly what Spawner needs and
 * nothing more.
 */
export interface FetchedPlan {
  newCardIds: readonly string[];
  seenCardIds: readonly string[];
  runBudget: number;
  perWaveNewCap: number;
}

/**
 * The run plan, or null when it can't be had. Never throws and never blocks
 * play: a null plan means "nothing is new", i.e. no ceremonies and ordinary
 * gameplay (spec §7).
 */
export async function fetchRunPlan(pool: string): Promise<FetchedPlan | null> {
  try {
    const response = await fetch(`/api/plan?pool=${pool}`);
    if (!response.ok) return null;
    const plan = runPlanSchema.parse(await response.json());
    return {
      newCardIds: plan.newCardIds,
      seenCardIds: plan.seenCardIds,
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
    runBudget: fetched.runBudget,
    perWaveNewCap: fetched.perWaveNewCap,
  };
}
