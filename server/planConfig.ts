/** Run-planning knobs. Kept out of statsConfig.ts: planning is not statistics. */
export const PLAN = {
  /** Most new words one run may introduce (spec §3.2). */
  perRunNewCap: 6,
  /** Most ceremonies before any single wave — pacing, so wave 1 isn't a wall of intros. */
  perWaveNewCap: 2,
  /** Cards per intake tier (tiered-vocab spec §3.1). Consumed by the build
   *  pipeline; the server gates on each tier's ACTUAL card count, never this. */
  tierSize: 10,
  /** A tier passes when solid/(size − amnestied) reaches this (§3.2). */
  tierMasteryThreshold: 0.8,
  /** Pooled encounters after which a still-unsolid card is amnestied out of
   *  the gate's denominator. Duplicates STATS.leechWindow's value ON PURPOSE:
   *  amnesty is a planning decision, and retuning the stats leech window must
   *  not silently move the tier gate (§5.2). */
  amnestyMinEncounters: 8,
  /** Review-draw weight = floor + weakness·w + staleness·w (§3.4). The floor
   *  keeps a perfect card rare but never unreachable. */
  reviewWeightFloor: 0.1,
  reviewWeaknessWeight: 0.6,
  reviewStalenessWeight: 0.4,
  reviewStalenessCeilingHours: 72,
} as const;
