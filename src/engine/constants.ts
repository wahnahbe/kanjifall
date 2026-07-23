import type { EngineConfig } from './types';

/** Fixed simulation step (ms). */
export const STEP_MS = 1000 / 60;

/** Horizontal spawn lanes (normalized x centers). */
export const LANES = [0.15, 0.32, 0.5, 0.68, 0.85];

/**
 * THE tuning surface for the Milestone-1 fun-check gate.
 * Change values here; nothing else should hardcode pacing.
 */
export const DEFAULT_CONFIG: EngineConfig = {
  lives: 3,
  baseWaveSize: 5,
  waveSizeGrowth: 1,
  maxWaveSize: 10,
  maxAirborne: 6,
  baseFallSpeed: 0.07, // ~14s top-to-floor in wave 1
  fallSpeedGrowth: 0.12, // +12% per wave
  maxFallSpeed: 0.28,
  baseSpawnIntervalMs: 3200,
  spawnIntervalDecay: 0.94,
  minSpawnIntervalMs: 1200,
  interWaveDelayMs: 1500,
  hintAtY: 0.6,
  pauseOnWaveStart: false, // engine default keeps M1 behavior; the UI opts in
};
