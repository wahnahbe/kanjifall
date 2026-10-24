import { Container, Text, TextStyle } from 'pixi.js';
import { PALETTE } from '../design/palette';
import { FONT_STACK } from '../design/typography';
import type { VisualParams } from '../design/visualParams';
import { LIT_CORE_ALPHA, LIT_CORE_BLUR } from './light';
import { HALO_BLUR, HALO_PADDING } from './WordSprite';

/** A word's glyph, detached from any WordSprite, with both light states
 *  prebuilt so a flicker only flips visibility (lapse spec §6.2, §6.3). The
 *  stage builds one from the event's word, never from the live sprite, which
 *  `sync()` may already have swept by the time a lapse or a relit kill
 *  arrives (spec §10). */
export interface LightGlyph {
  view: Container;
  /** Lit shows the white core and cyan halo; unlit shows the dark word. */
  setLit(lit: boolean): void;
  destroy(): void;
}

/** Builds the glyph copy for one word, centred on its own origin so the
 *  caller can position `view` at the word. It starts unlit. Decoration only:
 *  the stage builds one when `params.haloAlpha > 0`, which is also what keeps
 *  the lit halo and core from being built at alpha 0.
 *
 *  `lit` is the look WordSprite gives a lit word: the core Text (ink, with a
 *  tight ink dropShadow) under the ink glyph that carries the cyan halo.
 *  `dark` is the look it gives a dark word: dim ink, no shadow. The two are
 *  siblings, so neither changes the other's measured size. */
export function buildLightGlyph(display: string, wordPx: number, resolution: number, params: VisualParams): LightGlyph {
  const base = { fontFamily: FONT_STACK, fontSize: wordPx };

  const dark = new Text({
    text: display,
    style: new TextStyle({ ...base, fill: PALETTE.inkDim }),
    resolution,
  });
  dark.anchor.set(0.5);

  const core = new Text({
    text: display,
    style: new TextStyle({
      ...base,
      fill: PALETTE.ink,
      dropShadow: { color: PALETTE.ink, blur: LIT_CORE_BLUR, distance: 0, alpha: LIT_CORE_ALPHA * params.haloAlpha },
      padding: HALO_PADDING,
    }),
    resolution,
  });
  core.anchor.set(0.5);

  const ink = new Text({
    text: display,
    style: new TextStyle({
      ...base,
      fill: PALETTE.ink,
      dropShadow: { color: PALETTE.system, blur: HALO_BLUR, distance: 0, alpha: params.haloAlpha },
      padding: HALO_PADDING,
    }),
    resolution,
  });
  ink.anchor.set(0.5);

  const lit = new Container();
  lit.addChild(core, ink);

  const view = new Container();
  view.addChild(dark, lit);

  const setLit = (on: boolean): void => {
    lit.visible = on;
    dark.visible = !on;
  };
  setLit(false);

  return {
    view,
    setLit,
    destroy: () => view.destroy({ children: true }),
  };
}
