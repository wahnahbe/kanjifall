/** Every stats threshold/constant lives here — nowhere else in server/stats.ts or its helpers. */
export const STATS = {
  learnedMinEncounters: 3,
  learnedWindow: 5,
  learnedMinAccuracy: 0.8,
  hintedKillWeight: 0.5,
  coverageThreshold: 0.6,
  masteryThreshold: 0.7,
  paceWindowDays: 14,
  trendDays: 30,
  leechWindow: 8,
  leechRecencyDecay: 0.85,
  leechAccuracyWeight: 0.7,
  leechSpeedWeight: 0.3,
  leechSpeedCeilingMs: 15_000,
  leechMinEncounters: 3,
  leechLimit: 15,
} as const;
