import { MOTION } from '../design/motion';
import { PALETTE } from '../design/palette';
import type { VisualParams } from '../design/visualParams';
import type { Card, LightState } from '../engine/types';

/** The lapse spec §6: the light a word carries in flight, the flicker that puts
 *  it out or on, and the reveal the floor shows for a lesson, a lapse and a
 *  second drop. Pure numbers and strings; PixiStage and WordSprite apply them,
 *  and nothing here touches a canvas or the DOM. */

/** White core alpha at full effects (lapse spec §6.1); scaled by haloAlpha, so
 *  it halves at reduced and collapses to plain at off. */
export const LIT_CORE_ALPHA = 0.9;
/** Core blur in px, tighter than WordSprite's HALO_BLUR (lapse spec §6.1). */
export const LIT_CORE_BLUR = 8;
/** A light flickers for three snap steps (lapse spec §6.2, §6.3). */
export const LIGHT_FLICKER_LIFE_MS = MOTION.snapMs * 3;
/** The lesson reveal size, today's spawnFx reveal, unchanged (lapse spec §6.2). */
export const LESSON_FONT_PX = 30;
/** Lapse reading size, as a multiple of wordPx (lapse spec §6.2). */
export const LAPSE_READING_RATIO = 0.75;
/** Lapse kanji size, as a multiple of wordPx (lapse spec §6.2). */
export const LAPSE_KANJI_RATIO = 0.65;
/** Micro-label size, as a multiple of wordPx (lapse spec §6.2). */
export const LAPSE_TAG_RATIO = 0.22;
/** The tag shown under a lapse's reveal (lapse spec §6.2). */
export const LAPSE_TAG = 'you had this';
/** The label a relit kill flashes (lapse spec §6.3). */
export const RELIT_LABEL = 'relit';

export interface LightStyle {
  fill: number;
  halo: boolean;
  coreAlpha: number;
  chromaticSplit: boolean;
  spawnFlicker: boolean;
}

/** How a word in each light state renders at each effects level (lapse spec
 *  §6.1). Plain is today's look at every level. Lit is plain plus the white
 *  core, scaled by haloAlpha. Dark is dim ink with no halo, split or spawn
 *  flicker, at every level. */
export function lightStyle(light: LightState, params: VisualParams): LightStyle {
  if (light === 'dark') return { fill: PALETTE.inkDim, halo: false, coreAlpha: 0, chromaticSplit: false, spawnFlicker: false };
  const plain: LightStyle = { fill: PALETTE.ink, halo: params.haloAlpha > 0, coreAlpha: 0, chromaticSplit: true, spawnFlicker: true };
  return light === 'lit' ? { ...plain, coreAlpha: LIT_CORE_ALPHA * params.haloAlpha } : plain;
}

/** The stepped on/off sequence of a light going out (ending 'dark', lapse spec
 *  §6.2) or coming on (ending 'lit', §6.3). With flicker on, each snap step
 *  alternates from off for LIGHT_FLICKER_LIFE_MS, then rests in the ending
 *  state. With flicker off, it is a single step straight to the ending. */
export function lightFlickerFrame(ageMs: number, flicker: 0 | 1, ending: 'lit' | 'dark'): { lit: boolean; done: boolean } {
  if (flicker === 0) return { lit: ending === 'lit', done: ageMs >= MOTION.snapMs };
  const done = ageMs >= LIGHT_FLICKER_LIFE_MS;
  const step = Math.floor(ageMs / MOTION.snapMs);
  return { lit: done ? ending === 'lit' : step % 2 === 1, done };
}

export interface RevealLayout {
  kind: 'lesson' | 'lapse';
  fill: number;
  /** The underlined line. */
  main: { text: string; fontSize: number };
  /** Lapse only: the kanji above the line; null for kana-only cards. */
  above: { text: string; fontSize: number } | null;
  /** LAPSE_TAG for a lapse, else null. */
  tag: string | null;
}

/** What the floor shows for a word that was missed (lapse spec §6.2, §6.4). A
 *  plain word is a lesson: today's line in ink. A lit word is a lapse: the
 *  reading alone in dead ink, the kanji above it, and the tag. A dark word is a
 *  second drop: the lesson line in dead ink. Sizes are ratios of wordPx. */
export function revealLayout(card: Card, light: LightState, wordPx: number): RevealLayout {
  if (light === 'lit') {
    return {
      kind: 'lapse',
      fill: PALETTE.inkFaint,
      main: { text: card.kana[0], fontSize: Math.round(LAPSE_READING_RATIO * wordPx) },
      above: card.kanji === null ? null : { text: card.kanji, fontSize: Math.round(LAPSE_KANJI_RATIO * wordPx) },
      tag: LAPSE_TAG,
    };
  }
  return {
    kind: 'lesson',
    fill: light === 'dark' ? PALETTE.inkFaint : PALETTE.ink,
    main: { text: `${card.kanji ?? ''} ${card.kana[0]} — ${card.gloss}`.trim(), fontSize: LESSON_FONT_PX },
    above: null,
    tag: null,
  };
}
