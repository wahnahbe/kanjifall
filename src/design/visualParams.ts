import type { Settings } from '../data/settings';
import { MOTION } from './motion';

export type WaveBeat = 'centre' | 'fade' | 'slot';

/** Rendering numbers derived from the effects level (first spec §7,
 *  second-pass spec §6). Decoration only — anything that conveys game state
 *  (the floor, the deadline, the reticle, lives, score, the buffer, the miss
 *  reveal, the wave number) renders regardless of these values, at flat
 *  intensity when they are 0. */
export interface VisualParams {
  /** Red/cyan offset on falling words, in px. 0 disables the split. */
  chromaticSplitPx: number;
  /** Word halo strength, 0..1. */
  haloAlpha: number;
  /** Floor / reticle / accent glow strength, 0..1. */
  glowAlpha: number;
  /** Backdrop grain + fibre strength, 0..1. */
  grainAlpha: number;
  /** Atmosphere washes, shaft, vignette, ghost glyphs, 0..1 (§3.1). */
  atmosphereAlpha: number;
  /** Spawn bleed-in blur radius, px. 0 = alpha-only (§4.3). */
  spawnBlurPx: number;
  /** 1 = flickers happen (lock, spawn halo, settle, deadline, sign); 0 = none (§7.7). */
  flicker: 0 | 1;
  /** Kill slash, 0..1 (§4.3). */
  slashAlpha: number;
  /** Kill flare, 0..1 (§4.3). */
  flareAlpha: number;
  /** Approach halo tint toward vermillion, 0..1 (§4.3). */
  approachTintAlpha: number;
  /** Red swell under the floor during approach, 0..1 (§4.3). */
  swellAlpha: number;
  /** Miss impact glow, 0..1 (§4.3). */
  impactAlpha: number;
  /** Miss screen-shake jitter, px (§4.3). */
  shakePx: number;
  /** Screen transition blur radius, px (§4.4). */
  transitionBlurPx: number;
  /** Screen transition duration, ms — never 0: a transition is never a cut (§4.4). */
  transitionMs: number;
  /** How the wave header arrives (§4.5). */
  waveBeat: WaveBeat;
}

const FULL: VisualParams = Object.freeze({
  chromaticSplitPx: 1.4, haloAlpha: 1, glowAlpha: 1, grainAlpha: 1, atmosphereAlpha: 1,
  spawnBlurPx: 8, flicker: 1, slashAlpha: 1, flareAlpha: 1, approachTintAlpha: 1, swellAlpha: 1,
  impactAlpha: 1, shakePx: 2, transitionBlurPx: 12, transitionMs: MOTION.transitionMs, waveBeat: 'centre',
});
const REDUCED: VisualParams = Object.freeze({
  chromaticSplitPx: 0, haloAlpha: 0.5, glowAlpha: 0.5, grainAlpha: 0.5, atmosphereAlpha: 0.5,
  spawnBlurPx: 0, flicker: 0, slashAlpha: 1, flareAlpha: 0.5, approachTintAlpha: 1, swellAlpha: 0,
  impactAlpha: 0.5, shakePx: 0, transitionBlurPx: 0, transitionMs: MOTION.transitionMs, waveBeat: 'fade',
});
const OFF: VisualParams = Object.freeze({
  chromaticSplitPx: 0, haloAlpha: 0, glowAlpha: 0, grainAlpha: 0, atmosphereAlpha: 0,
  spawnBlurPx: 0, flicker: 0, slashAlpha: 0, flareAlpha: 0, approachTintAlpha: 0, swellAlpha: 0,
  impactAlpha: 0, shakePx: 0, transitionBlurPx: 0, transitionMs: MOTION.fastMs, waveBeat: 'slot',
});

export function visualParams(effects: Settings['effects']): VisualParams {
  if (effects === 'off') return OFF;
  if (effects === 'reduced') return REDUCED;
  return FULL;
}
