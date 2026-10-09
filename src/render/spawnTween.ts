import { MOTION } from '../design/motion';

export interface SpawnParams {
  /** Blur radius at age 0, px; 0 means alpha-only (visualParams.spawnBlurPx). */
  blurPx: number;
  /** 1 = the light flickers on; 0 = it fades on (visualParams.flicker). */
  flicker: 0 | 1;
}

export interface SpawnFrame {
  alpha: number;
  blurPx: number;
  /** Multiplier on the sprite's alpha for the neon flicker; 1 when settled. */
  lightScale: number;
  done: boolean;
}

/** `--ease-ink`'s shape, good enough as a scalar: fast start, soft landing. */
function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** Second-pass spec §4.3 Spawn: the form bleeds in (alpha and blur over
 *  --duration-bleed) while the light flickers on (1, 0.3, 1 inside the first
 *  two snap steps). Pure; the sprite applies the numbers. */
export function spawnFrame(ageMs: number, params: SpawnParams): SpawnFrame {
  if (ageMs >= MOTION.bleedMs) return { alpha: 1, blurPx: 0, lightScale: 1, done: true };
  const t = Math.max(0, ageMs) / MOTION.bleedMs;
  const eased = easeOut(t);
  let lightScale = 1;
  if (params.flicker === 1 && ageMs > MOTION.snapMs && ageMs <= MOTION.snapMs * 2) lightScale = 0.3;
  return { alpha: eased, blurPx: params.blurPx * (1 - eased), lightScale, done: false };
}

/** Second-pass spec §4.3 Lock: the reticle snaps on at 0.9, dips to 0.2 for
 *  one snap step, then settles at full. A single event (§7.7). */
export function lockFlickerAlpha(ageMs: number, flicker: 0 | 1): number {
  if (flicker === 0) return 1;
  if (ageMs <= MOTION.snapMs) return 0.9;
  if (ageMs < MOTION.snapMs * 2) return 0.2;
  return 1;
}
