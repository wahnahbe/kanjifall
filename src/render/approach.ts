import { mixColor } from '../design/colorMix';
import { MOTION } from '../design/motion';
import { PALETTE } from '../design/palette';

/** Second-pass spec §4.3 Approach/Miss: pure numbers; PixiStage and
 *  WordSprite apply them. Everything here is decoration — the floor and the
 *  deadline are the state, and position is already the signal (§9.4). */

export const APPROACH_START_Y = 0.8;
export const SWELL_SCALE_MIN = 0.2;
export const IMPACT_SCALE_MIN = 0.5;
export const IMPACT_SCALE_MAX = 1.4;
export const DEADLINE_FLICKER_LIFE_MS = MOTION.snapMs * 3;

/** 0 until the last fifth of the fall, 1 at the kill line. */
export function approachProgress(y: number): number {
  return Math.min(1, Math.max(0, (y - APPROACH_START_Y) / (1 - APPROACH_START_Y)));
}

/** Halo colour: system → danger with progress. */
export function approachTint(progress: number): number {
  return mixColor(PALETTE.system, PALETTE.danger, progress);
}

/** Halo crossfade for the approach (spec §4.3): first half, the red-halo copy
 *  fades in over the cyan one (cyan → neutral); second half, the cyan copy
 *  fades out under it (neutral → red). One of the two is always at alpha 1,
 *  so the glyph — identical ink in both copies — never dims. `tintAlpha` is
 *  visualParams.approachTintAlpha; at 0 the base stays at 1 and the hot copy at 0. */
export function approachMix(progress: number, tintAlpha: number): { hot: number; base: number } {
  const p = Math.min(1, Math.max(0, progress)) * Math.min(1, Math.max(0, tintAlpha));
  return { hot: Math.min(1, 2 * p), base: p <= 0.5 ? 1 : 1 - (2 * p - 1) };
}

export function swellScaleX(progress: number): number {
  return SWELL_SCALE_MIN + (1 - SWELL_SCALE_MIN) * Math.min(1, Math.max(0, progress));
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

export function impactFrame(ageMs: number): { scaleX: number; alpha: number; done: boolean } {
  if (ageMs >= MOTION.flareMs) return { scaleX: IMPACT_SCALE_MAX, alpha: 0, done: true };
  const t = Math.max(0, ageMs) / MOTION.flareMs;
  return { scaleX: IMPACT_SCALE_MIN + (IMPACT_SCALE_MAX - IMPACT_SCALE_MIN) * easeOut(t), alpha: 1 - t, done: false };
}

/** 0.45 → 1 → 0.45 → 1 over three snap steps; a single event (§7.7). */
export function deadlineFlickerAlpha(ageMs: number, flicker: 0 | 1): number {
  if (flicker === 0 || ageMs >= DEADLINE_FLICKER_LIFE_MS) return 1;
  const step = Math.floor(ageMs / MOTION.snapMs);
  return step % 2 === 0 ? 0.45 : 1;
}
