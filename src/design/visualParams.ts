import type { Settings } from '../data/settings';

/** Rendering numbers derived from the effects level (visual-identity spec §7).
 *  Decoration only — anything that conveys game state (the floor, the
 *  deadline, the reticle, lives, score, the buffer) renders regardless of
 *  these values, at flat intensity when they are 0. */
export interface VisualParams {
  /** Red/cyan offset on falling words, in px. 0 disables the split. */
  chromaticSplitPx: number;
  /** Word halo strength, 0..1. */
  haloAlpha: number;
  /** Floor / reticle / accent glow strength, 0..1. */
  glowAlpha: number;
  /** Backdrop grain + fibre strength, 0..1. */
  grainAlpha: number;
}

const FULL: VisualParams = { chromaticSplitPx: 1.4, haloAlpha: 1, glowAlpha: 1, grainAlpha: 1 };
const REDUCED: VisualParams = { chromaticSplitPx: 0, haloAlpha: 0.5, glowAlpha: 0.5, grainAlpha: 0.5 };
const OFF: VisualParams = { chromaticSplitPx: 0, haloAlpha: 0, glowAlpha: 0, grainAlpha: 0 };

export function visualParams(effects: Settings['effects']): VisualParams {
  if (effects === 'off') return OFF;
  if (effects === 'reduced') return REDUCED;
  return FULL;
}
