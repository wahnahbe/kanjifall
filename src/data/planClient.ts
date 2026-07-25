import type { EnginePlan } from '../engine/types';
import { runPlanSchema } from '../shared/api';

/**
 * Mirrors `PLAN.perWaveNewCap` in server/planConfig.ts, which is the source of
 * truth. The client cannot import from server/, and the plan endpoint returns
 * budget rather than pacing, so this one number is duplicated deliberately.
 */
const PER_WAVE_NEW_CAP = 2;

/**
 * The run plan, or null when it can't be had. Never throws and never blocks
 * play: a null plan means "nothing is new", i.e. no ceremonies and ordinary
 * gameplay (spec §7).
 */
export async function fetchRunPlan(pool: string): Promise<EnginePlan | null> {
  try {
    const response = await fetch(`/api/plan?pool=${pool}`);
    if (!response.ok) return null;
    const plan = runPlanSchema.parse(await response.json());
    return {
      newCardIds: plan.newCardIds,
      runBudget: plan.runBudget,
      perWaveNewCap: PER_WAVE_NEW_CAP,
    };
  } catch {
    return null;
  }
}
