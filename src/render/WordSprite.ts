import { Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { getSettings } from '../data/settings';
import { cssHex, PALETTE } from '../design/palette';
import { visualParams } from '../design/visualParams';
import type { AirborneWord, GameMode } from '../engine/types';
import { loadBrushTexture } from './brushStroke';
import { reticleBrackets } from './reticle';

const FONT_STACK = "'Shippori Mincho B1', 'Yu Gothic UI', 'Meiryo', serif";

const BASE_STYLE: Partial<TextStyle> = {
  fontFamily: FONT_STACK,
  fontSize: 40,
  fill: PALETTE.ink,
};

const HINT_STYLE: Partial<TextStyle> = {
  fontFamily: FONT_STACK,
  fontSize: 26,
  fill: PALETTE.inkDim,
};

const HINT_FADE_MS = 300;
const HINT_OFFSET_Y = 34;

// Target reticle geometry (visual-identity spec §5.3) — corner brackets are
// the shape signal; the brush underline below is the colour signal. Never
// colour alone (spec §9.4), which is why the old tint-only setLocked is gone.
const RETICLE_PAD = 14;
const RETICLE_ARM_LEN = 18;
const RETICLE_THICKNESS = 2;

// Underline sizing/seed. Seed 4 is distinct from the floor's seed 11
// (PixiStage.ts) so the underline isn't a scaled copy of the same stroke.
const UNDERLINE_SEED = 4;
const UNDERLINE_WIDTH_RATIO = 1.24;
const UNDERLINE_GAP_PX = 6;

const HALO_BLUR = 18;

// Spec §9.1: kanji stroke detail wins over any effect. The chromatic split
// must never apply below this font size, no matter what visualParams says —
// enforced here as a runtime gate, not left to review discipline.
const CHROMATIC_SPLIT_MIN_FONT_SIZE = 40;
const CHROMATIC_SPLIT_ALPHA = 0.5;

function chromaticSplitAllowed(fontSize: number): boolean {
  return fontSize >= CHROMATIC_SPLIT_MIN_FONT_SIZE;
}

// The underline texture is shared by every locked word, decoded once and
// cached behind a single promise — setLocked() fires from the render loop
// every time a word locks/unlocks, and must never kick off its own decode.
// Left uninitialised at module scope and only ever created lazily from an
// instance method: WordSprite.ts is imported transitively by node-environment
// tests, and loadBrushTexture() touches `Image`/`document` the instant it
// runs, which throws outside a DOM (see brushStroke.ts's own doc comment).
let underlineTexturePromise: Promise<Texture> | null = null;
function underlineTexture(): Promise<Texture> {
  underlineTexturePromise ??= loadBrushTexture(cssHex(PALETTE.danger), UNDERLINE_SEED);
  return underlineTexturePromise;
}

export class WordSprite {
  readonly view: Container;
  private readonly text: Text;
  private hintText: Text | null = null;
  private locked = false;
  private brackets: Graphics | null = null;
  private underline: Sprite | null = null;
  private targetArtRequested = false;

  constructor(word: AirborneWord, mode: GameMode) {
    const display = mode === 'recall'
      ? word.card.gloss
      : word.card.kanji ?? word.card.kana[0];
    const resolution = Math.min(Math.max(window.devicePixelRatio, 1) * 2, 4);
    const { chromaticSplitPx, haloAlpha } = visualParams(getSettings().effects);
    const fontSize = BASE_STYLE.fontSize ?? 0;

    this.view = new Container();

    // Chromatic split: two ghost copies of the glyph behind the main one,
    // offset ±chromaticSplitPx on x and tinted red/cyan at low alpha. Added
    // first so they render behind `this.text`, added below.
    if (chromaticSplitPx > 0 && chromaticSplitAllowed(fontSize)) {
      const offsets: readonly [color: number, dx: number][] = [
        [PALETTE.danger, -chromaticSplitPx],
        [PALETTE.system, chromaticSplitPx],
      ];
      for (const [tint, dx] of offsets) {
        const ghost = new Text({
          text: display,
          style: new TextStyle({ ...BASE_STYLE }),
          resolution,
        });
        ghost.anchor.set(0.5);
        ghost.tint = tint;
        ghost.alpha = CHROMATIC_SPLIT_ALPHA;
        ghost.position.set(dx, 0);
        this.view.addChild(ghost);
      }
    }

    this.text = new Text({
      text: display,
      style: new TextStyle({
        ...BASE_STYLE,
        // Word halo (spec §7): a soft glow behind the glyph, strength tied
        // to haloAlpha. Omitted entirely at 0 rather than passed with
        // alpha: 0, so effects 'off' renders genuinely flat, not a
        // zero-opacity shadow still costing a draw pass.
        ...(haloAlpha > 0
          ? { dropShadow: { color: PALETTE.system, blur: HALO_BLUR, distance: 0, alpha: haloAlpha } }
          : {}),
      }),
      resolution,
    });
    this.text.anchor.set(0.5);
    this.view.addChild(this.text);
  }

  /** Recall grace hint: the kanji form fades in below the gloss. Idempotent. */
  showHint(kanji: string): void {
    if (this.hintText !== null) return;
    this.hintText = new Text({
      text: kanji,
      style: new TextStyle({ ...HINT_STYLE }),
      resolution: 2,
    });
    this.hintText.anchor.set(0.5);
    this.hintText.position.set(0, HINT_OFFSET_Y);
    this.hintText.alpha = 0;
    this.view.addChild(this.hintText);
  }

  /** Per-frame: advance the hint fade. */
  update(deltaMS: number): void {
    if (this.hintText !== null && this.hintText.alpha < 1) {
      this.hintText.alpha = Math.min(1, this.hintText.alpha + deltaMS / HINT_FADE_MS);
    }
  }

  /** Target reticle (spec §5.3, §9.4): cyan corner brackets (shape) plus a
   *  vermillion brush underline (colour) replace the old tint-only lock
   *  signal — colour alone is never the only signal for the current target. */
  setLocked(locked: boolean): void {
    if (locked === this.locked) return;
    this.locked = locked;
    this.ensureTargetArt();
    if (this.brackets !== null) this.brackets.visible = locked;
    if (this.underline !== null) this.underline.visible = locked;
  }

  setPosition(xPx: number, yPx: number): void {
    this.view.position.set(xPx, yPx);
  }

  /** Builds the brackets synchronously (cheap Graphics fill) and starts the
   *  underline's texture fetch (shared, cached — see underlineTexture()).
   *  Idempotent: only the first lock pays for either. Both start invisible;
   *  setLocked() toggles visibility once they exist. */
  private ensureTargetArt(): void {
    if (this.targetArtRequested) return;
    this.targetArtRequested = true;

    // Real glyph metrics, not fallback-font ones: Task 2's preload
    // (mincho600Ready + document.fonts.ready, awaited before any WordSprite
    // is constructed — see PixiStage.create()) guarantees Shippori Mincho is
    // already loaded, so this.text is laid out against the real face here.
    const width = this.text.width;
    const halfW = width / 2;
    const halfH = this.text.height / 2;

    const brackets = new Graphics();
    for (const r of reticleBrackets(halfW, halfH, RETICLE_PAD, RETICLE_ARM_LEN, RETICLE_THICKNESS)) {
      brackets.rect(r.x, r.y, r.w, r.h).fill(PALETTE.system);
    }
    brackets.visible = false;
    this.brackets = brackets;
    this.view.addChild(brackets);

    const view = this.view;
    underlineTexture()
      .then((texture) => {
        // The view (a Pixi Container) sets `destroyed = true` synchronously
        // at the top of its own destroy() — same idiom as PixiStage's
        // `destroyed` flag for mincho600Ready/mountFloor(). Words are killed
        // far more often than the stage is torn down, so this decode can
        // easily lose the race to a mid-flight kill/miss. Unlike the floor's
        // one-off texture, this one is the shared module-scope cache: on the
        // losing race we must NOT destroy it — other sprites may still be
        // awaiting or using the same promise.
        if (view.destroyed) return;
        const underline = new Sprite(texture);
        underline.anchor.set(0.5);
        underline.width = width * UNDERLINE_WIDTH_RATIO; // width only, like the floor — never stretches the stroke's thickness
        underline.position.set(0, halfH + UNDERLINE_GAP_PX + texture.height / 2);
        underline.visible = this.locked;
        this.underline = underline;
        view.addChild(underline);
      })
      .catch((error: unknown) => {
        console.warn('[WordSprite] underline texture failed to load — running without it', error);
      });
  }
}
