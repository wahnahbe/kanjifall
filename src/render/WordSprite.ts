import { BlurFilter, Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js';
import type { Filter, Texture } from 'pixi.js';
import { GlowFilter } from 'pixi-filters';
import { getSettings } from '../data/settings';
import { MOTION } from '../design/motion';
import { cssHex, PALETTE } from '../design/palette';
import { FONT_STACK } from '../design/typography';
import { visualParams } from '../design/visualParams';
import type { AirborneWord, GameMode } from '../engine/types';
import { HEIGHT as BRUSH_STROKE_HEIGHT, loadBrushTexture, type BrushStrokeOptions } from './brushStroke';
import { reticleBrackets } from './reticle';
import { lockFlickerAlpha, spawnFrame, type SpawnParams } from './spawnTween';

const BASE_STYLE: Partial<TextStyle> = {
  fontFamily: FONT_STACK,
  fill: PALETTE.ink,
};

const HINT_STYLE: Partial<TextStyle> = {
  fontFamily: FONT_STACK,
  fill: PALETTE.inkDim,
};
// Recall hint renders at this fraction of the word size (was a fixed 26 at 40).
const HINT_SIZE_RATIO = 0.65;

const HINT_FADE_MS = 300;
// The lock flicker (snap 0.9, dip 0.2, settle 1 — spec §4.3) spans two snap
// steps; past that lockFlickerAlpha() is a flat 1 and the per-frame loop has
// nothing left to write.
const MOTION_LOCK_SETTLE_MS = MOTION.snapMs * 2;
// Was a flat 34px offset, independent of the falling word's own measured
// height — Task 7 flagged (but never tested) that this could crowd the
// target underline in recall mode; Task 11's browser walk confirmed it does
// (the underline sits at halfH + UNDERLINE_GAP_PX + ~13, which for the
// English gloss words recall mode falls — taller than kanji at the same
// font size, due to ascenders/descenders — landed at roughly the same y as
// the fixed 34px hint). Placed relative to this.text.height instead, same
// "derive from the real measurement" posture ensureTargetArt() already
// uses for the brackets/underline, so hint spacing now clears the underline
// for any word instead of only the ones the original constant happened to fit.
// Half of brushStroke's default HEIGHT — UNDERLINE_STROKE_OPTIONS never
// overrides height, so the underline sprite always renders at that native
// size. Derived from the exported constant (not a re-typed literal) so the
// two cannot drift.
const UNDERLINE_HALF_HEIGHT_PX = BRUSH_STROKE_HEIGHT / 2;
const HINT_CLEARANCE_PX = 8; // gap below the underline's bottom edge (or where it would sit, if this word is ever locked)

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
// The floor's brush texture (PixiStage.ts, width 1200) is displayed near
// 1:1 scale against the full screen width. Reusing it here would squeeze it
// down to underline scale (~40-140px, via Sprite.width, which only sets
// scale.x) by 15-25x — the noise wavelength collapses to sub-pixel and
// aliases into speckle instead of reading as a stroke (visual-identity
// review, fix round 1). `width: 150` keeps the canvas close to the
// underline's actual on-screen size; `displacementScale` is turned down
// from the floor's 17 to match — at width 150 the same 17 would smear the
// short stroke's ends disproportionately (17 is over 10% of 150, vs ~1.4%
// of the floor's 1200). `baseFrequency`/`numOctaves` are left at the
// floor's values on purpose: same noise density, just realized on a
// stroke-sized canvas instead of a screen-sized one. Chosen by rendering
// candidates at 45-140px across several seeds and comparing by eye.
const UNDERLINE_STROKE_OPTIONS: BrushStrokeOptions = {
  width: 150,
  displacementScale: 10,
};

// Target reticle + underline glow (spec §7: "Glow" at full and reduced,
// "Flat" only at off) — scaled by visualParams().glowAlpha the same way
// PixiStage.applyFloorGlow() scales the floor's glow, so the two match in
// character. Distinct constants (not reused from PixiStage) because the
// reticle/underline are far smaller on screen than the full-width floor
// stroke and a floor-sized glow would blow out their edges.
const RETICLE_GLOW_DISTANCE = 6;
const RETICLE_GLOW_OUTER_STRENGTH = 1.6;
const UNDERLINE_GLOW_DISTANCE = 5;
const UNDERLINE_GLOW_OUTER_STRENGTH = 1.6;

const HALO_BLUR = 18;
// TextStyle._getFinalPadding() sizes the backing canvas from `padding` and
// filter padding only — it does not know about dropShadow.blur. Without
// this, the shadow's soft falloff is hard-clipped at the canvas edge and
// reads as a visible rectangle around the glyph instead of fading out
// (visual-identity review, fix round 1). 1.5x the blur radius comfortably
// covers the falloff.
const HALO_PADDING = HALO_BLUR * 1.5;

// Spec §9.1: kanji stroke detail wins over any effect. The chromatic split
// must never apply below this font size, no matter what visualParams says —
// enforced here as a runtime gate, not left to review discipline.
const CHROMATIC_SPLIT_MIN_FONT_SIZE = 40;
const CHROMATIC_SPLIT_ALPHA = 0.5;

// Exported (only) so the gate itself can be pinned by a unit test — this is
// the one rule Task 7 asked to be enforced in code rather than in review.
export function chromaticSplitAllowed(fontSize: number): boolean {
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
  underlineTexturePromise ??= loadBrushTexture(cssHex(PALETTE.danger), UNDERLINE_SEED, UNDERLINE_STROKE_OPTIONS);
  return underlineTexturePromise;
}

export class WordSprite {
  readonly view: Container;
  /** The font size this word was built at (second-pass spec §3.3). Fixed for
   *  the sprite's lifetime, like its effects treatment. */
  readonly wordPx: number;
  private readonly text: Text;
  private hintText: Text | null = null;
  private locked = false;
  private brackets: Graphics | null = null;
  private underline: Sprite | null = null;
  private targetArtRequested = false;
  // Read once at construction, same posture as chromaticSplitPx/haloAlpha
  // below: a word's own effects treatment is fixed for its lifetime rather
  // than reactive (see task-7-report.md's "ruled not to fix" — no in-flight
  // settings-change path exists during play).
  private readonly glowAlpha: number;
  // Same fixed-for-life posture: the lock flicker follows the effects level
  // the word was built under (spec §7.7 — flicker is a single event, gone
  // whenever it is 0).
  private readonly flicker: 0 | 1;
  // Non-null from beginSpawn() until the bleed completes (or the sprite is
  // destroyed). `filter` is the short-lived BlurFilter, null when the blur is
  // skipped (alpha-only levels, or past PixiStage's concurrency cap).
  private spawn: { ageMs: number; params: SpawnParams; filter: BlurFilter | null } | null = null;
  // Infinity = not locked (or already settled), so the per-frame lock branch
  // in update() short-circuits on its `< MOTION_LOCK_SETTLE_MS` test.
  private lockAgeMs = Number.POSITIVE_INFINITY;

  constructor(word: AirborneWord, mode: GameMode, wordPx: number) {
    const display = mode === 'recall'
      ? word.card.gloss
      : word.card.kanji ?? word.card.kana[0];
    const resolution = Math.min(Math.max(window.devicePixelRatio, 1) * 2, 4);
    const { chromaticSplitPx, haloAlpha, glowAlpha, flicker } = visualParams(getSettings().effects);
    this.glowAlpha = glowAlpha;
    this.flicker = flicker;
    this.wordPx = wordPx;
    const fontSize = wordPx;

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
          style: new TextStyle({ ...BASE_STYLE, fontSize }),
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
        fontSize,
        // Word halo (spec §7): a soft glow behind the glyph, strength tied
        // to haloAlpha. Omitted entirely at 0 rather than passed with
        // alpha: 0, so effects 'off' renders genuinely flat, not a
        // zero-opacity shadow still costing a draw pass. `padding` grows only
        // the backing canvas (Text.updateBounds() measures the unpadded
        // glyph when style.trim is false, its default, so this.text.width/
        // height — and therefore bracket/underline sizing below — are
        // unaffected); without it the shadow's blur falloff is hard-clipped
        // at the canvas edge and reads as a visible rectangle around the
        // glyph instead of fading out.
        ...(haloAlpha > 0
          ? {
              dropShadow: { color: PALETTE.system, blur: HALO_BLUR, distance: 0, alpha: haloAlpha },
              padding: HALO_PADDING,
            }
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
      style: new TextStyle({ ...HINT_STYLE, fontSize: Math.round(this.wordPx * HINT_SIZE_RATIO) }),
      resolution: 2,
    });
    this.hintText.anchor.set(0.5);
    const halfH = this.text.height / 2;
    // hintText.anchor is 0.5, so this sets the hint's CENTRE. The underline's
    // bottom edge (its own centre plus its own half-height, not just one
    // half-height added once) is halfH + UNDERLINE_GAP_PX + (half-height *
    // 2); the hint's centre then needs to clear that edge by
    // HINT_CLEARANCE_PX *plus* the hint's own half-height, or the clearance
    // constant lands on the hint's centre instead of its top edge.
    const underlineBottom = halfH + UNDERLINE_GAP_PX + UNDERLINE_HALF_HEIGHT_PX * 2;
    this.hintText.position.set(0, underlineBottom + HINT_CLEARANCE_PX + this.hintText.height / 2);
    this.hintText.alpha = 0;
    this.view.addChild(this.hintText);
  }

  /** Per-frame: advance the spawn bleed, the lock flicker and the hint fade. */
  update(deltaMS: number): void {
    if (this.spawn !== null) {
      this.spawn.ageMs += deltaMS;
      const frame = spawnFrame(this.spawn.ageMs, this.spawn.params);
      // The halo is baked into the Text's texture (dropShadow), so the light
      // cannot be scaled on its own without re-rasterizing the glyph — the
      // flicker multiplies the whole sprite's alpha instead, so the lit glyph
      // flickers on like a tube.
      this.view.alpha = frame.alpha * frame.lightScale;
      if (this.spawn.filter !== null) this.spawn.filter.strength = frame.blurPx;
      if (frame.done) {
        // Detach before destroying so the view never holds a dead filter.
        this.view.filters = [];
        this.spawn.filter?.destroy(true);
        this.spawn = null;
        this.view.alpha = 1;
      }
    }
    // The reticle and underline are separate objects from the Text, so unlike
    // the spawn flicker the lock flicker can address them directly. Both are
    // null until a word is first locked (and the underline until its texture
    // decodes — ensureTargetArt() catches it up with the current lock age).
    if (this.lockAgeMs < MOTION_LOCK_SETTLE_MS) {
      this.lockAgeMs += deltaMS;
      const alpha = lockFlickerAlpha(this.lockAgeMs, this.flicker);
      if (this.brackets !== null) this.brackets.alpha = alpha;
      if (this.underline !== null) this.underline.alpha = alpha;
    }
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
    this.lockAgeMs = locked ? 0 : Number.POSITIVE_INFINITY;
    this.ensureTargetArt();
    if (this.brackets !== null) this.brackets.visible = locked;
    if (this.underline !== null) this.underline.visible = locked;
    // A re-lock restarts the flicker from its first step rather than from
    // wherever the previous lock left the alpha.
    if (locked) {
      if (this.brackets !== null) this.brackets.alpha = lockFlickerAlpha(0, this.flicker);
      if (this.underline !== null) this.underline.alpha = lockFlickerAlpha(0, this.flicker);
    }
  }

  setPosition(xPx: number, yPx: number): void {
    this.view.position.set(xPx, yPx);
  }

  /** Second-pass spec §4.3: bleed in from blur while the light flickers on.
   *  `withBlur` is PixiStage's concurrency cap — past four simultaneous
   *  bleeds the blur is skipped so late waves never stack filters. PixiStage
   *  skips this call entirely at `bleed === 0` (effects off, spec §6
   *  "Appear"): a sprite that never begins a spawn simply stays at alpha 1. */
  beginSpawn(params: SpawnParams, withBlur: boolean): void {
    const filter = withBlur && params.blurPx > 0 ? new BlurFilter({ strength: params.blurPx, quality: 2 }) : null;
    if (filter !== null) this.view.filters = [filter];
    this.view.alpha = 0;
    this.spawn = { ageMs: 0, params, filter };
  }

  /** True from beginSpawn() until the bleed completes; PixiStage counts these
   *  to enforce its concurrent-blur cap. */
  get isBleeding(): boolean {
    return this.spawn !== null;
  }

  /** Half the rendered glyph width — the kill slash anchors at the word's
   *  left edge (second-pass spec §4.3). */
  get halfWidth(): number {
    return this.text.width / 2;
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
    // Spec §7: the reticle glows at full/reduced, flat only at off — mirrors
    // PixiStage.applyFloorGlow()'s glowAlpha scaling. Omitted (not a
    // zero-strength filter) at glowAlpha 0, same "genuinely flat, not a
    // zero-opacity pass" posture the halo above already takes.
    if (this.glowAlpha > 0) {
      brackets.filters = [
        new GlowFilter({
          color: PALETTE.system,
          distance: RETICLE_GLOW_DISTANCE,
          outerStrength: RETICLE_GLOW_OUTER_STRENGTH * this.glowAlpha,
          quality: 0.3,
        }),
      ];
    }
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
        // The texture decodes after the lock began: join the flicker at its
        // current step (flat 1 once settled or when never locked) instead of
        // popping in at full alpha mid-dip.
        underline.alpha = lockFlickerAlpha(this.lockAgeMs, this.flicker);
        // Same glow rule as the brackets above (spec §7).
        if (this.glowAlpha > 0) {
          underline.filters = [
            new GlowFilter({
              color: PALETTE.danger,
              distance: UNDERLINE_GLOW_DISTANCE,
              outerStrength: UNDERLINE_GLOW_OUTER_STRENGTH * this.glowAlpha,
              quality: 0.3,
            }),
          ];
        }
        this.underline = underline;
        view.addChild(underline);
      })
      .catch((error: unknown) => {
        console.warn('[WordSprite] underline texture failed to load — running without it', error);
      });
  }

  /** Frees the reticle/underline GlowFilter's compiled GPU program, and the
   *  BlurFilter of a spawn bleed still in flight, before the view itself is
   *  torn down. Container.destroy() never touches a child's .filters (same
   *  gap PixiStage.destroyFilters()'s doc comment documents for the stage's
   *  own filters and the floor's). Safe to call unconditionally:
   *  brackets/underline are null until a word is ever locked, glow filters are
   *  only ever assigned when glowAlpha > 0, and a spawn exists only between
   *  beginSpawn() and the bleed's end. */
  destroy(): void {
    this.destroyFilters(this.brackets?.filters);
    this.destroyFilters(this.underline?.filters);
    // A word killed mid-bleed still owns its BlurFilter — the per-frame loop
    // that would have released it at done never runs again. Same
    // destroy(true) as the lock-art filters above. BlurFilter keeps no
    // compiled program of its own (it lives on its two private pass
    // filters, which Pixi shares across every blur through its program
    // cache), so this releases the filter itself and leaves that shared
    // program alone for the next bleed — destroying the passes' programs
    // would break any other sprite still bleeding.
    this.spawn?.filter?.destroy(true);
    this.spawn = null;
    // context: true frees the brackets Graphics's owned GraphicsContext —
    // Container.destroy({children:true}) forwards this same options object
    // to each child's own destroy(), and Graphics.destroy() only frees its
    // context when `options === true` or `options.context === true`
    // (verified against the installed pixi.js 8.19 source); `{children:true}`
    // alone matches neither, so the context leaked before this. texture
    // stays unset deliberately: the underline Sprite's texture is the
    // module-scope shared/cached one (see underlineTexture()), and other
    // WordSprite instances may still be using or awaiting it.
    this.view.destroy({ children: true, context: true });
  }

  private destroyFilters(filters: readonly Filter[] | undefined): void {
    if (!filters) return;
    for (const filter of filters) filter.destroy(true);
  }
}
