import { MOTION } from '../design/motion';

/** Second-pass spec §4.3 Kill. Pure frames and geometry; PixiStage applies them. */

export const SLASH_SEED = 9; // distinct from floor 11, underline 4, title rule 7, frames 3
export const SLASH_LENGTH_RATIO = 2.6; // × wordPx
export const SLASH_ANGLE_RAD = (-16 * Math.PI) / 180;
export const FLARE_SCALE_MIN = 0.1;
export const FLARE_SCALE_MAX = 1.7;
const GOLDEN_CONJUGATE = 0.6180339887;

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

const SLASH_HOLD_MS = MOTION.snapMs;
const SLASH_FADE_MS = MOTION.snapMs * 2;
export const SLASH_LIFE_MS = MOTION.slashMs + SLASH_HOLD_MS + SLASH_FADE_MS;

/** scaleX 0→1 over --duration-slash (decelerating), hold one snap, fade over two. */
export function slashFrame(ageMs: number): { scaleX: number; alpha: number; done: boolean } {
  if (ageMs >= SLASH_LIFE_MS) return { scaleX: 1, alpha: 0, done: true };
  if (ageMs < MOTION.slashMs) return { scaleX: easeOut(ageMs / MOTION.slashMs), alpha: 1, done: false };
  const sinceDrawn = ageMs - MOTION.slashMs;
  if (sinceDrawn < SLASH_HOLD_MS) return { scaleX: 1, alpha: 1, done: false };
  return { scaleX: 1, alpha: 1 - (sinceDrawn - SLASH_HOLD_MS) / SLASH_FADE_MS, done: false };
}

/** Scale 0.1→1.7 (decelerating), alpha 1→0, over --duration-flare. */
export function flareFrame(ageMs: number): { scale: number; alpha: number; done: boolean } {
  if (ageMs >= MOTION.flareMs) return { scale: FLARE_SCALE_MAX, alpha: 0, done: true };
  const t = Math.max(0, ageMs) / MOTION.flareMs;
  return { scale: FLARE_SCALE_MIN + (FLARE_SCALE_MAX - FLARE_SCALE_MIN) * easeOut(t), alpha: 1 - t, done: false };
}

/** Four points around the origin at radii 0.7–1.3 × size, derived from a
 *  seed in [0, 1) so each droplet is irregular but stable frame to frame. */
export function dropletPolygon(seed: number, size: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    // A tiny hash: fractional part of a large multiple of the seed, offset per
    // point by the golden-ratio conjugate. The offset must be fractional — an
    // integer one leaves the fractional part, and so all four radii, identical.
    const h = ((seed * 9301 + i * GOLDEN_CONJUGATE) % 1 + 1) % 1;
    const r = size * (0.7 + 0.6 * h);
    const angle = (i / 4) * Math.PI * 2 + h * 0.6;
    out.push(Math.cos(angle) * r, Math.sin(angle) * r);
  }
  return out;
}
