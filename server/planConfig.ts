/** Run-planning knobs. Kept out of statsConfig.ts: planning is not statistics. */
export const PLAN = {
  /** Most new words one run may introduce (spec §3.2). */
  perRunNewCap: 6,
  /** Most ceremonies before any single wave — pacing, so wave 1 isn't a wall of intros. */
  perWaveNewCap: 2,
} as const;
