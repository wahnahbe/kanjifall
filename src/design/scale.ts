import { HEIGHT as BRUSH_HEIGHT } from '../render/brushStroke';

/** Second-pass spec §3.3: shipped words were a fixed 40px at any window size,
 *  exactly the floor below which the chromatic split switches off. One pure
 *  function now feeds Pixi (WordSprite, the floor texture) and CSS
 *  (--size-word-play, --hud-scale via GameScreen) from the stage height. */
export interface PlayScale {
  /** Falling-word font size. */
  wordPx: number;
  /** Floor stroke canvas height, keeping the generator's proportions. */
  floorPx: number;
  /** Multiplier applied to the HUD type ramp. */
  hudScale: number;
}

export const WORD_PX_MIN = 44;
export const WORD_PX_MAX = 72;
export const WORD_HEIGHT_RATIO = 0.065; // 52px at 800 tall
export const REFERENCE_WORD_PX = 40; // the first pass's fixed size, for proportion
export const HUD_SCALE = 1.15;

export function playScale(stageHeightPx: number): PlayScale {
  const raw = Math.round(stageHeightPx * WORD_HEIGHT_RATIO);
  const wordPx = Math.min(WORD_PX_MAX, Math.max(WORD_PX_MIN, raw));
  return {
    wordPx,
    floorPx: Math.round((BRUSH_HEIGHT * wordPx) / REFERENCE_WORD_PX),
    hudScale: HUD_SCALE,
  };
}
