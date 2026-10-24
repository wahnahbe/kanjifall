import { Application, Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js';
import type { Filter, Texture } from 'pixi.js';
import { GlowFilter } from 'pixi-filters';
import { getSettings, subscribeSettings } from '../data/settings';
import { MOTION } from '../design/motion';
import { cssHex, PALETTE } from '../design/palette';
import { playScale, type PlayScale } from '../design/scale';
import { FONT_STACK, UI_FONT_STACK } from '../design/typography';
import { visualParams } from '../design/visualParams';
import type { AirborneWord, GameMode } from '../engine/types';
import { approachProgress, deadlineFlickerAlpha, DEADLINE_FLICKER_LIFE_MS, impactFrame, swellScaleX } from './approach';
import { loadBrushTexture } from './brushStroke';
import { buildFilters, filterKinds } from './filters';
import { tryFlareTexture } from './flareTexture';
import { flareFrame, SLASH_ANGLE_RAD, SLASH_LENGTH_RATIO, SLASH_LIFE_MS, SLASH_SEED, slashFrame, slashHeightPx } from './killFx';
import { LAPSE_TAG_RATIO, LIGHT_FLICKER_LIFE_MS, lightFlickerFrame, RELIT_LABEL, revealLayout, type RevealLayout } from './light';
import { buildLightGlyph, type LightGlyph } from './lightGlyph';
import { Particles } from './Particles';
import { WordSprite } from './WordSprite';

interface Fx {
  view: Container;
  ageMs: number;
  lifeMs: number;
  update: (view: Container, t: number) => void; // t in [0,1]
}

const PARTICLES_Z_INDEX = 10; // above word sprites and fx, which sit at the default 0
const SHAKE_DURATION_MS = 150;
// Spawn-bleed blur cap (second-pass spec §4.3). Every blurred bleed is a
// two-pass filter over the whole word, and a late wave can spawn a dozen
// words in a second — past this many simultaneous bleeds the newcomer fades
// in without the blur (still alpha, still flickers) rather than stacking
// another filter pass.
const MAX_CONCURRENT_BLEEDS = 4;

// Below word sprites and fx (default 0) — words visibly fall in front of the
// ground and disappear behind it at the kill line.
const FLOOR_Z_INDEX = -1;
// The kill line as a fraction of stage height. GameEngine.moveWords() misses
// a word once w.y >= 1 (src/engine/GameEngine.ts:220) — the *bottom edge* of
// the stage, not some fraction above it. Word sprites are centre-anchored,
// so a word dies the instant its centre reaches this line.
const FLOOR_Y_RATIO = 1.0;
// The stroke's lower edge already sits on the kill line (anchor (0, 1) below)
// so there is no room past it for a separate deadline offset — the deadline
// draws one pixel inside the canvas edge instead, immediately under the
// stroke's body.
const DEADLINE_INSET_PX = 1;
const FLOOR_GLOW_DISTANCE = 12;
const FLOOR_GLOW_OUTER_STRENGTH = 3;
const FLOOR_TEXTURE_SEED = 11;
// Miss-reveal underline (spec §5.4) — a flat rect, not a texture: see
// spawnReveal()'s doc comment for why this one skips the brush-stroke treatment.
const MISS_UNDERLINE_GAP_PX = 4;
const MISS_UNDERLINE_THICKNESS_PX = 2;
// The lapse reveal stacks the kanji above the reading and the micro-label
// below the underline (lapse spec §6.2). The label's letterSpacing is this
// multiple of its own font size: the canvas stand-in for --tracking-label.
const LAPSE_TAG_TRACKING_RATIO = 0.3;
// Words are centre-anchored, so a gap here is measured from each Text's own
// bounding box (line-height included).
const LAPSE_STACK_GAP_PX = 2;
const MISS_REVEAL_LIFE_MS = 1600;

// The pop-and-fade shared by the kill flashes (`×N!` and `relit`): grows 30% over
// the first 30% of the life, settles back over the next 30%, and fades over the
// last 30% (lapse spec §6.3: relit "using the ×N! mechanism").
const flashPop: (view: Container, t: number) => void = (view, t) => {
  const pop = t < 0.3 ? 1 + (t / 0.3) * 0.3 : 1.3 - Math.min((t - 0.3) / 0.3, 1) * 0.3;
  view.scale.set(pop);
  view.alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
};

// The kill slash (second-pass spec §4.3): a dry-brush stroke in ink. It is
// displayed at about 2.6 x wordPx long (roughly 100-260px), so the canvas
// width is sized near that, not at the floor's 1200 — squeezing a
// screen-width stroke down to slash scale collapses the noise wavelength into
// speckle (the same lesson as WordSprite's underline). `displacementScale` is
// turned down with the canvas so the short stroke's ends are not smeared.
// Vertically the sprite is scaled to `slashHeightPx` (killFx.ts), about 1.9x
// the 14-unit canvas at 52px words; that stretch was judged acceptable by eye
// in the second-pass QA walk (it reads as a dry-brush cut, not a smear).
const SLASH_STROKE_OPTIONS = { width: 300, height: 14, displacementScale: 8 };
// Shared and cached for the same reason as WordSprite's underline texture:
// every kill fires a slash, and none of them may kick off its own decode.
// Sprites never destroy their texture (updateFx's `context: true` is a
// Graphics concern and a Sprite ignores it), so sharing one is safe. Created
// lazily from an instance method, never at module scope — loadBrushTexture()
// touches `Image`/`document`, which node-environment tests do not have.
let slashTexturePromise: Promise<Texture> | null = null;
function slashTexture(): Promise<Texture> {
  slashTexturePromise ??= loadBrushTexture(cssHex(PALETTE.ink), SLASH_SEED, SLASH_STROKE_OPTIONS);
  return slashTexturePromise;
}

// Kicked off the moment this module is evaluated — i.e. at app boot, in
// flight while the player is still reading the title screen — rather than
// only when create() runs. Measured cold-cache click-to-first-frame with the
// load starting inside create() at ~240-285ms (production build, 1.9 MB
// japanese-600 slice); starting it here instead means create() usually just
// awaits a promise that's already settled. Non-fatal: a failed load resolves
// rather than rejects, so nothing here can produce an unhandled rejection
// before anyone awaits it, and Pixi falls back to a system face — same
// posture as filters.ts. Guarded for non-browser evaluation: this module is
// pulled in transitively by isGameKey.test.ts outside jsdom, where `document`
// doesn't exist — merely importing PixiStage must never throw.
const mincho600Ready: Promise<void> =
  typeof document === 'undefined'
    ? Promise.resolve()
    : document.fonts
        .load("600 40px 'Shippori Mincho B1'")
        .then(() => undefined)
        .catch((error: unknown) => {
          console.warn('[PixiStage] Shippori Mincho B1 preload failed — falling back', error);
        });

/** Dumb render layer: mirrors engine words, plays kill/miss effects. */
export class PixiStage {
  private sprites = new Map<number, WordSprite>();
  // One red swell per approaching word (second-pass spec §4.3), keyed by the
  // word's instanceId like `sprites`. Each shares the flare texture.
  private readonly swells = new Map<number, Sprite>();
  // Age of the miss deadline flicker; Infinity = no flicker playing, so the
  // per-frame update short-circuits.
  private deadlineFlickerMs = Number.POSITIVE_INFINITY;
  private fx: Fx[] = [];
  private readonly app: Application;
  private readonly particles: Particles;
  private readonly host: HTMLElement;
  private readonly unsubscribeSettings: () => void;
  private readonly handleResize = (): void => {
    // Sprites already airborne keep the size they were built at; only new
    // ones pick up the new size (second-pass spec §3.3). The floor keeps its
    // mount-time height and only stretches in width, as before.
    this.scale = playScale(this.app.screen.height);
    this.layoutFloor();
  };
  private scale: PlayScale;
  // Refreshed on every settings notification so a sprite built after an
  // effects change picks up the new bleed/flicker numbers; sprites already
  // airborne keep the treatment they were built under (see WordSprite).
  private params = visualParams(getSettings().effects);
  // The game mode of the last sync(), so a lapse or relit event can rebuild the
  // dead word's glyph (displayFor) when its sprite has already been swept
  // (lapse spec §6.2, §10). Reading until the first sync, which is before any
  // word exists to miss or kill.
  private mode: GameMode = 'reading';
  private shakeMs = 0;
  private destroyed = false;
  // Sentinel so the FIRST applyFilters() call always applies, no matter what
  // filterKinds(initial settings) happens to join to (including '' when
  // neither bloom nor crt is on) — see applyFilters' doc comment.
  private appliedFilterKinds = 'unset';
  // Same sentinel trick as appliedFilterKinds, for the same reason: settings
  // notify on every write (a volume-slider drag fires ~20 in a row), and
  // glowAlpha only ever takes the values 0/0.5/1 — never null — so this
  // always differs on the first real call.
  private appliedGlowAlpha: number | null = null;
  private floor: Sprite | null = null;
  private deadline: Graphics | null = null;

  private constructor(app: Application, host: HTMLElement) {
    this.app = app;
    this.host = host;
    this.app.stage.sortableChildren = true;
    this.particles = new Particles();
    this.particles.view.zIndex = PARTICLES_Z_INDEX;
    this.app.stage.addChild(this.particles.view);

    this.applyFilters();
    this.applyBackdrop();
    this.scale = playScale(app.screen.height);
    void this.mountFloor();
    // Warm the shared kill textures: the first kill of a session would
    // otherwise show its slash late while the texture decodes. The slash
    // chain's own `.catch` already logs a failure; this second `.catch` only
    // silences the warm-up's duplicate rejection.
    void slashTexture().catch(() => undefined);
    tryFlareTexture();
    this.unsubscribeSettings = subscribeSettings(() => {
      this.params = visualParams(getSettings().effects);
      this.applyFilters();
      this.applyBackdrop();
      this.applyFloorGlow();
    });
    app.renderer.on('resize', this.handleResize);

    app.ticker.add(() => {
      const delta = app.ticker.deltaMS;
      this.updateFx(delta);
      for (const sprite of this.sprites.values()) sprite.update(delta);
      this.particles.update(delta);
      this.updateShake(delta);
      this.updateDeadlineFlicker(delta);
    });
  }

  static async create(host: HTMLElement): Promise<PixiStage> {
    // Canvas text does not trigger @font-face loading, and document.fonts.ready
    // only resolves against fonts something has already requested — so the JP
    // glyph gate (main spec §7) can report ready while Pixi measures against a
    // fallback face. mincho600Ready (module scope, above) already requested
    // it at app boot; await the same promise here rather than kicking off a
    // second load.
    await mincho600Ready;
    await document.fonts.ready; // JP glyph measurement gate (spec §7)
    const app = new Application();
    await app.init({
      backgroundAlpha: 0,
      resizeTo: host,
      antialias: true,
    });
    host.appendChild(app.canvas);
    return new PixiStage(app, host);
  }

  /** Mirror engine word list into sprites; reposition everything. */
  sync(words: readonly AirborneWord[], lockedIds: readonly number[], mode: GameMode): void {
    this.mode = mode;
    const alive = new Set<number>();
    for (const word of words) {
      alive.add(word.instanceId);
      let sprite = this.sprites.get(word.instanceId);
      if (!sprite) {
        sprite = new WordSprite(word, mode, this.scale.wordPx);
        // bleed 0 (effects off) means the word appears (spec §6 "Appear"),
        // not fades: it never begins a spawn and so stays at full alpha.
        if (this.params.bleed === 1) {
          let bleeding = 0;
          for (const other of this.sprites.values()) if (other.isBleeding) bleeding += 1;
          sprite.beginSpawn(
            { blurPx: this.params.spawnBlurPx, flicker: this.params.flicker },
            bleeding < MAX_CONCURRENT_BLEEDS,
          );
        }
        this.sprites.set(word.instanceId, sprite);
        this.app.stage.addChild(sprite.view);
      }
      sprite.setLocked(lockedIds.includes(word.instanceId));
      if (word.hintShown && word.card.kanji !== null) sprite.showHint(word.card.kanji);
      sprite.setPosition(word.x * this.app.screen.width, word.y * this.app.screen.height);
      const progress = approachProgress(word.y);
      sprite.setApproach(progress);
      this.syncSwell(word.instanceId, word.x, progress);
    }
    for (const [id, sprite] of this.sprites) {
      if (!alive.has(id)) {
        // sprite.destroy() (not sprite.view.destroy() directly) so a locked
        // word's reticle/underline GlowFilter — added for spec §7 — frees its
        // compiled GPU program too; see WordSprite.destroy()'s doc comment.
        sprite.destroy();
        this.sprites.delete(id);
        this.removeSwell(id);
      }
    }
  }

  /** Red glow under the floor beneath an approaching word (spec §4.3), the
   *  flare texture tinted danger, growing with progress. Decoration only. */
  private syncSwell(id: number, x: number, progress: number): void {
    const { swellAlpha } = this.params;
    if (swellAlpha === 0 || progress <= 0) {
      this.removeSwell(id);
      return;
    }
    let swell = this.swells.get(id);
    if (swell === undefined) {
      const texture = tryFlareTexture();
      if (texture === null) return;
      swell = new Sprite(texture);
      // Centred on the kill line, not bottom-anchored: the flare texture is a
      // centred radial, so a bottom anchor puts its centre half a (squashed)
      // texture height, ~75px, above the floor and the glow floats in mid-air.
      // The stage ends at the floor, so centred, only the upper half shows, as
      // light welling up from under it.
      swell.anchor.set(0.5);
      swell.tint = PALETTE.danger;
      swell.zIndex = FLOOR_Z_INDEX + 0.25;
      this.swells.set(id, swell);
      this.app.stage.addChild(swell);
    }
    const killY = this.app.screen.height * FLOOR_Y_RATIO;
    const base = (this.scale.wordPx * 10) / swell.texture.width;
    swell.position.set(x * this.app.screen.width, killY);
    swell.scale.set(base * swellScaleX(progress), base * 0.35);
    swell.alpha = progress * swellAlpha;
  }

  private removeSwell(id: number): void {
    const swell = this.swells.get(id);
    if (swell === undefined) return;
    swell.destroy(); // texture is the shared flare: never { texture: true }
    this.swells.delete(id);
  }

  /** Three things at once (second-pass spec §4.3): a brush slash drawn across
   *  the word, an ink-droplet splatter that grows with combo tier, and a neon
   *  flare blooming behind. Each is gated by its own visualParams number, so
   *  effects 'off' plays none of them — the word simply vanishes. Every 5th
   *  combo step adds a `×N!` flash (skipped at 'off': spec §5.1).
   *
   *  Clearing a dark word is a relit kill (lapse spec §6.3). Today's kill plays
   *  first and unchanged, nothing deferred, and then the light comes on over
   *  it: a detached glyph copy flickers dark to lit under the slash, and a
   *  `relit` flash pops in accent, unless this kill is a ×5 step and `×N!`
   *  already has the flash. Both are decoration: the copy needs a halo to
   *  light, the flash needs effects above 'off'. */
  playKill(word: AirborneWord, combo: number): void {
    const px = word.x * this.app.screen.width;
    const py = Math.min(word.y, 0.95) * this.app.screen.height;
    // The kill event fires from inside handleKey()/tick(), before the next
    // sync() has swept the dead word's sprite away, so its measured size is
    // normally still here. If it ever is not, fall back to the nominal size
    // and no half-width (the slash then starts at the word's centre).
    const sprite = this.sprites.get(word.instanceId);
    const halfW = sprite?.halfWidth ?? 0;
    const wordPx = sprite?.wordPx ?? this.scale.wordPx;
    const { slashAlpha, flareAlpha } = this.params;

    // tryFlareTexture() never throws: a missing 2D context costs the flare,
    // never the kill (it logs once and returns null).
    const flareTex = flareAlpha > 0 ? tryFlareTexture() : null;
    if (flareTex !== null) {
      const flare = new Sprite(flareTex);
      flare.anchor.set(0.5);
      flare.position.set(px, py);
      flare.zIndex = FLOOR_Z_INDEX + 0.5; // behind words, in front of the floor
      const base = (wordPx * 3.2) / flare.texture.width;
      this.pushFx(flare, MOTION.flareMs, (view, t) => {
        const f = flareFrame(t * MOTION.flareMs);
        view.scale.set(base * f.scale);
        view.alpha = f.alpha * flareAlpha;
      });
    }
    if (slashAlpha > 0) {
      // Non-fatal, like the floor and the lock underline: a failed decode
      // costs the slash, never the kill — and must not surface as an
      // unhandled rejection.
      void slashTexture()
        .then((texture) => {
          if (this.destroyed) return;
          const slash = new Sprite(texture);
          slash.anchor.set(0, 0.5);
          slash.position.set(px - halfW, py);
          slash.rotation = SLASH_ANGLE_RAD;
          // width/height first: they set scale.x, which is then the full-width
          // scale the draw-on animates up to.
          slash.width = wordPx * SLASH_LENGTH_RATIO;
          slash.height = slashHeightPx(wordPx);
          const fullWidth = slash.scale.x;
          this.pushFx(slash, SLASH_LIFE_MS, (view, t) => {
            const f = slashFrame(t * SLASH_LIFE_MS);
            view.scale.x = fullWidth * f.scaleX;
            view.alpha = f.alpha * slashAlpha;
          });
        })
        .catch((error: unknown) => {
          console.warn('[PixiStage] slash stroke texture failed to load — kill plays without it', error);
        });
    }
    this.particles.killBurst(px, py, combo);

    // The light comes on (lapse spec §6.3). The copy is built from the event's
    // word, not the sprite (a swept sprite costs nothing), and pushed before
    // the flashes below so they draw over it; the slash, which lands a
    // microtask later, draws across it. It starts dark and runs dark, lit,
    // dark, lit over three snap steps (a single step to lit at reduced), then
    // rests lit and fades out with the flare.
    if (word.light === 'dark' && this.params.haloAlpha > 0) {
      const glyph = this.buildGlyphAt(word, wordPx);
      this.pushFx(glyph.view, MOTION.flareMs, (view, t) => {
        const age = t * MOTION.flareMs;
        glyph.setLit(lightFlickerFrame(age, this.params.flicker, 'lit').lit);
        view.alpha = age < LIGHT_FLICKER_LIFE_MS ? 1 : 1 - (age - LIGHT_FLICKER_LIFE_MS) / (MOTION.flareMs - LIGHT_FLICKER_LIFE_MS);
      });
    }

    const comboStep = combo > 0 && combo % 5 === 0;
    const flashes = getSettings().effects !== 'off';
    if (comboStep && flashes) {
      this.spawnFx(word, `×${combo}!`, PALETTE.accent, 500, flashPop);
    }
    // `×N!` wins a shared kill (spec §10); the relit voice still plays.
    if (word.light === 'dark' && flashes && !comboStep) {
      this.spawnFx(word, RELIT_LABEL, PALETTE.accent, 500, flashPop);
    }
  }

  /** Reveal the answer where the word landed (spec §3.1: miss is a learning
   *  moment), then the miss in the ink/neon grammar (second-pass spec §4.3): a
   *  vermillion splash, an impact glow along the floor, the deadline's
   *  flicker, and a 2px jolt. The reveal text is state and always plays; every
   *  other part is gated by its own visualParams number.
   *
   *  What the reveal shows follows the word's light (lapse spec §6.2, §6.4): a
   *  plain word is a lesson, a lit word is a lapse (the reading alone, the
   *  kanji above it, the tag below), a dark word is a second drop (the lesson
   *  in dead ink). A lapse also puts the light out: a detached glyph copy
   *  flickers off at the floor, decoration that needs a halo to lose. The rest
   *  of the miss is the same for all three. */
  playMiss(word: AirborneWord): void {
    const wordPx = this.sprites.get(word.instanceId)?.wordPx ?? this.scale.wordPx;
    // State, first and unconditional: never inside the halo gate below.
    this.spawnReveal(word, revealLayout(word.card, word.light, wordPx), wordPx);

    if (word.light === 'lit' && this.params.haloAlpha > 0) {
      const glyph = this.buildGlyphAt(word, wordPx);
      glyph.setLit(true);
      this.pushFx(glyph.view, LIGHT_FLICKER_LIFE_MS, (_view, t) => {
        glyph.setLit(lightFlickerFrame(t * LIGHT_FLICKER_LIFE_MS, this.params.flicker, 'dark').lit);
      });
    }

    const px = word.x * this.app.screen.width;
    const killY = this.app.screen.height * FLOOR_Y_RATIO;
    // Splash: vermillion droplets thrown up from the impact point.
    this.particles.splash(px, killY);
    // Impact glow along the floor.
    const { impactAlpha, shakePx, flicker } = this.params;
    const impactTex = impactAlpha > 0 ? tryFlareTexture() : null;
    if (impactTex !== null) {
      const impact = new Sprite(impactTex);
      // Centred on the floor line for the same reason as the swell: the flare
      // texture is a centred radial, so a bottom anchor would float the glow.
      impact.anchor.set(0.5);
      impact.tint = PALETTE.danger;
      impact.position.set(px, killY);
      impact.zIndex = FLOOR_Z_INDEX + 0.5;
      const base = (this.scale.wordPx * 12) / impact.texture.width;
      this.pushFx(impact, MOTION.flareMs, (view, t) => {
        const f = impactFrame(t * MOTION.flareMs);
        view.scale.set(base * f.scaleX, base * 0.3);
        view.alpha = f.alpha * impactAlpha;
      });
    }
    if (flicker === 1) this.deadlineFlickerMs = 0;
    if (shakePx > 0) this.shakeMs = SHAKE_DURATION_MS;
  }

  /** Brief confetti sweep across the top edge (spec §5.1). */
  playWaveClear(): void {
    this.particles.confettiSweep(this.app.screen.width);
  }

  destroy(): void {
    // Set before anything async-dependent runs: if mountFloor()'s texture
    // decode is still in flight, this tells it to discard the texture
    // instead of mounting a sprite onto a stage that's going away.
    this.destroyed = true;
    this.unsubscribeSettings();
    this.app.renderer.off('resize', this.handleResize);
    this.destroyFilters(this.app.stage.filters);
    if (this.floor !== null) {
      this.destroyFilters(this.floor.filters);
      // { texture: true } — Container.destroy() never frees a Sprite's
      // texture (see destroyFilters' doc comment for the equivalent gap on
      // filters), and this texture is a one-off decode, not a shared/cached
      // asset, so nothing else will ever free it.
      this.floor.destroy({ texture: true, textureSource: true });
    }
    this.deadline?.destroy();
    // The swells share the flare texture with every kill flare and impact
    // glow, so destroy the sprites only — never { texture: true }.
    for (const swell of this.swells.values()) swell.destroy();
    this.swells.clear();
    // Same gap as the floor/stage filters above: app.destroy({children:true})
    // below recursively destroys every sprite's view but never runs
    // WordSprite's own filter cleanup, so any currently-locked word's
    // reticle/underline GlowFilter (spec §7) would leak its compiled GPU
    // program otherwise.
    for (const sprite of this.sprites.values()) sprite.destroy();
    this.app.destroy(true, { children: true });
    this.sprites.clear();
    this.fx = [];
  }

  private spawnFx(word: AirborneWord, label: string, color: number, lifeMs: number, update: Fx['update']): void {
    const text = new Text({
      text: label,
      style: new TextStyle({
        fontFamily: FONT_STACK,
        fontSize: 30,
        fill: color,
      }),
      resolution: 2,
    });
    text.anchor.set(0.5);
    const view = new Container();
    view.addChild(text);
    const yPx = Math.min(word.y, 0.95) * this.app.screen.height;
    view.position.set(word.x * this.app.screen.width, yPx);
    this.app.stage.addChild(view);
    this.fx.push({ view, ageMs: 0, lifeMs, update });
  }

  /** The floor reveal where a missed word landed (spec §5.4, lapse spec §6.2,
   *  §6.4), laid out by revealLayout(). State, not decoration: it plays at
   *  every effects level and is never created inside a visualParams gate.
   *
   *  Spec §5.4: "becomes --color-ink on a vermillion underline rather than
   *  pink text" — the reveal is the game's most important teaching moment.
   *  Task 4's brief deferred this underline to Task 7; Task 7's own brief
   *  only ever specified the *target-lock* underline (§5.3), so it was never
   *  picked up — found during this task's matrix walk. §5.4 says "a vermillion
   *  underline", not §5.3's "vermillion brush underline", so this is a flat
   *  Graphics rect rather than the dry-brush texture: no new texture/tuning
   *  surface, and it matches the spec's literal wording.
   *
   *  The underline sits under the `main` line and is measured against the real
   *  Text, so it spans exactly the rendered line however long the string turns
   *  out to be. A lesson is `main` alone and renders as it always has. A lapse
   *  adds the kanji centred above `main` and the tag centred below the
   *  underline, in the UI face at LAPSE_TAG_RATIO of the word size. */
  private spawnReveal(word: AirborneWord, layout: RevealLayout, wordPx: number): void {
    const view = new Container();
    const main = new Text({
      text: layout.main.text,
      style: new TextStyle({ fontFamily: FONT_STACK, fontSize: layout.main.fontSize, fill: layout.fill }),
      resolution: 2,
    });
    main.anchor.set(0.5);
    view.addChild(main);

    const underlineTop = main.height / 2 + MISS_UNDERLINE_GAP_PX;
    const underline = new Graphics()
      .rect(-main.width / 2, underlineTop, main.width, MISS_UNDERLINE_THICKNESS_PX)
      .fill(PALETTE.danger);
    view.addChild(underline);
    // How far the block reaches below `main`'s centre; grows when a tag hangs
    // under the underline.
    let bottomPx = underlineTop + MISS_UNDERLINE_THICKNESS_PX;

    if (layout.above !== null) {
      const above = new Text({
        text: layout.above.text,
        style: new TextStyle({ fontFamily: FONT_STACK, fontSize: layout.above.fontSize, fill: layout.fill }),
        resolution: 2,
      });
      above.anchor.set(0.5);
      above.position.set(0, -(main.height / 2 + LAPSE_STACK_GAP_PX + above.height / 2));
      view.addChild(above);
    }
    if (layout.tag !== null) {
      const tagPx = Math.round(LAPSE_TAG_RATIO * wordPx);
      const tag = new Text({
        text: layout.tag.toUpperCase(),
        style: new TextStyle({
          fontFamily: UI_FONT_STACK,
          fontSize: tagPx,
          fill: PALETTE.danger,
          letterSpacing: LAPSE_TAG_TRACKING_RATIO * tagPx,
        }),
        resolution: 2,
      });
      tag.anchor.set(0.5);
      tag.position.set(0, bottomPx + LAPSE_STACK_GAP_PX + tag.height / 2);
      bottomPx = tag.position.y + tag.height / 2;
      view.addChild(tag);
    }

    // Where the word landed (the same 0.95 line as every other fx). A lesson
    // fits under it; a lapse's tag hangs below the underline, past the 5% the
    // stage leaves under that line. The stage ends at the kill line, so there
    // it would be cut off whole, and just above the edge it would sit on the
    // floor stroke's glow. A tagged reveal is lifted until the tag clears the
    // top of the floor stroke (its canvas is floorPx tall, lower edge on the
    // kill line).
    const landedY = Math.min(word.y, 0.95) * this.app.screen.height;
    const yPx = layout.tag === null ? landedY : Math.min(landedY, this.app.screen.height * FLOOR_Y_RATIO - this.scale.floorPx - bottomPx);
    view.position.set(word.x * this.app.screen.width, yPx);
    this.app.stage.addChild(view);
    this.fx.push({
      view,
      ageMs: 0,
      lifeMs: MISS_REVEAL_LIFE_MS,
      update: (v, t) => {
        v.alpha = t < 0.15 ? 1 : 1 - (t - 0.15) / 0.85;
      },
    });
  }

  /** The text a word shows on the field: its gloss in recall mode, else its
   *  kanji (kana for a kana-only card). The same rule WordSprite's constructor
   *  applies, kept here so a lapse or relit glyph copy can be rebuilt from the
   *  event's word after the sprite is gone. */
  private displayFor(word: AirborneWord): string {
    return this.mode === 'recall' ? word.card.gloss : word.card.kanji ?? word.card.kana[0];
  }

  /** A detached glyph copy of `word` at its place on the field (lapse spec
   *  §6.2, §6.3), unlit, built under the current effects level. The caller
   *  gates on haloAlpha and pushes it onto fx. */
  private buildGlyphAt(word: AirborneWord, wordPx: number): LightGlyph {
    const resolution = Math.min(Math.max(window.devicePixelRatio, 1) * 2, 4);
    const glyph = buildLightGlyph(this.displayFor(word), wordPx, resolution, this.params);
    glyph.view.position.set(word.x * this.app.screen.width, Math.min(word.y, 0.95) * this.app.screen.height);
    return glyph;
  }

  /** Like spawnFx, for a ready-made display object instead of a label. */
  private pushFx(view: Container, lifeMs: number, update: Fx['update']): void {
    this.app.stage.addChild(view);
    this.fx.push({ view, ageMs: 0, lifeMs, update });
  }

  private updateFx(deltaMs: number): void {
    for (const fx of this.fx) {
      fx.ageMs += deltaMs;
      fx.update(fx.view, Math.min(fx.ageMs / fx.lifeMs, 1));
    }
    this.fx = this.fx.filter((fx) => {
      if (fx.ageMs >= fx.lifeMs) {
        // context: true frees the miss-reveal underline Graphics's owned
        // GraphicsContext — see WordSprite.destroy()'s doc comment for why
        // `{children:true}` alone doesn't do this (verified against the
        // installed pixi.js 8.19 source). texture stays unset: the label
        // Text's own texture is per-instance, not shared, so Text's default
        // teardown already covers it without this flag.
        fx.view.destroy({ children: true, context: true });
        return false;
      }
      return true;
    });
  }

  /** Jitters the whole stage ±shakePx (visualParams: 2 at full, 0 elsewhere)
   *  while shakeMs is positive; restores the origin the instant it expires
   *  (miss-only, spec §5.1). */
  private updateShake(deltaMs: number): void {
    if (this.shakeMs <= 0) return;
    this.shakeMs -= deltaMs;
    if (this.shakeMs > 0) {
      const dx = (Math.random() * 2 - 1) * this.params.shakePx;
      const dy = (Math.random() * 2 - 1) * this.params.shakePx;
      this.app.stage.position.set(dx, dy);
    } else {
      this.app.stage.position.set(0, 0);
    }
  }

  /** Spec §4.3 Miss: the deadline dips and returns twice over three snaps. */
  private updateDeadlineFlicker(deltaMs: number): void {
    if (this.deadline === null || this.deadlineFlickerMs === Number.POSITIVE_INFINITY) return;
    this.deadlineFlickerMs += deltaMs;
    this.deadline.alpha = deadlineFlickerAlpha(this.deadlineFlickerMs, this.params.flicker);
    if (this.deadlineFlickerMs >= DEADLINE_FLICKER_LIFE_MS) {
      this.deadline.alpha = 1;
      this.deadlineFlickerMs = Number.POSITIVE_INFINITY;
    }
  }

  /** Rebuilds the stage's filter set from current settings and destroys the
   *  outgoing instances. Container.destroy() never touches .filters elements
   *  (verified against the installed pixi.js source: it just drops the
   *  `_filterEffect` reference), so without this, every settings change and
   *  every stage teardown would abandon live GPU shader programs.
   *
   *  Guarded by a kinds-equality check: subscribeSettings() notifies on
   *  every settings write, including audio-only ones (a volume-slider drag
   *  fires up to ~20 in a row) that leave filterKinds() unchanged. Without
   *  the guard, each no-op notification still tore down and rebuilt
   *  AdvancedBloomFilter/CRTFilter — destroy()ing the bloom filter on every
   *  one of those calls leaks its two un-cascaded sub-filters' compiled GPU
   *  programs (see destroyFilters' doc comment) for as long as the stage
   *  stays subscribed. `appliedFilterKinds` starts at the sentinel 'unset',
   *  which can never equal a real join of ('bloom' | 'crt')[] (whose only
   *  possible values are '', 'bloom', 'crt', 'bloom,crt') — so the first
   *  call always applies regardless of what the initial settings resolve to. */
  private applyFilters(): void {
    const settings = getSettings();
    const kinds = filterKinds(settings).join(',');
    if (kinds === this.appliedFilterKinds && this.app.stage.filters !== undefined) return;
    this.appliedFilterKinds = kinds;
    const outgoing = this.app.stage.filters;
    this.app.stage.filters = buildFilters(settings);
    this.destroyFilters(outgoing);
  }

  /** `destroyPrograms: true` is required — Shader#destroy defaults it to
   *  false, which frees bind groups but leaves glProgram/gpuProgram (the
   *  actual compiled GPU program) alive. Safe here because every filter we
   *  build compiles its own program rather than sharing a cached one
   *  (verified against the installed pixi-filters source for both
   *  AdvancedBloomFilter and CRTFilter).
   *
   *  `filters` is `undefined` the first time this runs (Container.filters
   *  reads `this._filterEffect?.filters`, and `_filterEffect` starts out
   *  null) — the installed .d.ts claims a non-nullable `readonly Filter[]`,
   *  which is inaccurate for that pre-init state, hence the explicit guard
   *  rather than trusting the declared type.
   *
   *  Known residual: AdvancedBloomFilter owns two private sub-filters
   *  (`_extractFilter`, `_blurFilter`) that are themselves independent
   *  Filter/Shader instances with their own compiled programs.
   *  AdvancedBloomFilter does not override destroy() to cascade into them,
   *  so this call frees the bloom filter's own program but not its two
   *  sub-filters' — an upstream gap in pixi-filters, not something safely
   *  closable from here without reaching into private fields. */
  private destroyFilters(filters: readonly Filter[] | undefined): void {
    if (!filters) return;
    for (const filter of filters) filter.destroy(true);
  }

  /** Backdrop grain is CSS (spec §5.1); its strength still follows the
   *  effects level, so it is driven through a custom property rather than a
   *  class toggle. */
  private applyBackdrop(): void {
    this.host.style.setProperty('--grain-alpha', String(visualParams(getSettings().effects).grainAlpha));
  }

  /** Loads the dry-brush stroke and the 1px deadline beneath it, and mounts
   *  both onto the stage. Fired once from the constructor without an await
   *  (the texture decode is async; nothing downstream depends on it being
   *  ready synchronously). Game state, not decoration — this is what marks
   *  the kill line, so unlike applyFilters()/applyBackdrop() it lives in
   *  Pixi and moves with screen shake rather than in CSS.
   *
   *  Wrapped in try/catch for the same reason buildFilters() is (see its doc
   *  comment): a failed decode must never block play, and — left unhandled —
   *  a rejected promise fired with `void` here would surface only as an
   *  unhandled rejection, not a caught, logged failure. */
  private async mountFloor(): Promise<void> {
    let texture: Texture;
    try {
      texture = await loadBrushTexture(cssHex(PALETTE.system), FLOOR_TEXTURE_SEED, { height: this.scale.floorPx });
    } catch (error) {
      console.warn('[PixiStage] floor stroke texture failed to load — running without it', error);
      return;
    }
    if (this.destroyed) {
      // destroy() ran while the decode was in flight — don't mount onto a
      // torn-down stage, and don't leak the texture we just decoded.
      texture.destroy(true);
      return;
    }
    const floor = new Sprite(texture);
    floor.anchor.set(0, 1); // lower edge lands exactly on the kill line
    floor.zIndex = FLOOR_Z_INDEX;
    this.floor = floor;
    this.app.stage.addChild(floor);

    const deadline = new Graphics();
    deadline.zIndex = FLOOR_Z_INDEX;
    this.deadline = deadline;
    this.app.stage.addChild(deadline);

    this.layoutFloor();
    this.applyFloorGlow();
  }

  /** Stretches the stroke across the stage width at the kill line and
   *  redraws the deadline beneath it. Called on mount and on every resize —
   *  never scales the stroke's height, only its width, so it never distorts. */
  private layoutFloor(): void {
    if (this.floor === null || this.deadline === null) return;
    const width = this.app.screen.width;
    const killY = this.app.screen.height * FLOOR_Y_RATIO;
    this.floor.width = width;
    this.floor.position.set(0, killY);
    this.deadline.clear();
    this.deadline.rect(0, killY - DEADLINE_INSET_PX, width, 1).fill(PALETTE.danger);
  }

  /** The floor is information, not decoration (spec §5.1 juice rule): it
   *  still renders at effects 'off', just flat — no glow filter, no alpha
   *  boost. Guarded the same way as applyFilters(), for the same reason
   *  (settings notify on every write, including volume-only ones). */
  private applyFloorGlow(): void {
    if (this.floor === null) return;
    const { glowAlpha } = visualParams(getSettings().effects);
    if (glowAlpha === this.appliedGlowAlpha) return;
    this.appliedGlowAlpha = glowAlpha;
    const outgoing = this.floor.filters;
    this.floor.filters =
      glowAlpha > 0
        ? [
            new GlowFilter({
              color: PALETTE.system,
              distance: FLOOR_GLOW_DISTANCE,
              outerStrength: FLOOR_GLOW_OUTER_STRENGTH * glowAlpha,
              quality: 0.3,
            }),
          ]
        : [];
    this.destroyFilters(outgoing);
  }
}
