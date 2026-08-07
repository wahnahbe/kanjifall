/** Run-planning knobs. Kept out of statsConfig.ts: planning is not statistics. */
export const PLAN = {
  /** Most new words one run may introduce (spec §3.2). */
  perRunNewCap: 6,
  /** Most ceremonies before any single wave — pacing, so wave 1 isn't a wall of intros. */
  perWaveNewCap: 2,
  /** Cards per intake tier (tiered-vocab spec §3.1). Consumed by the build
   *  pipeline; the server gates on each tier's ACTUAL card count, never this. */
  tierSize: 10,
} as const;
