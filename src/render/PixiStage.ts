import { Application, Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js';
import type { Filter, Texture } from 'pixi.js';
import { GlowFilter } from 'pixi-filters';
import { getSettings, subscribeSettings } from '../data/settings';
import { cssHex, PALETTE } from '../design/palette';
import { visualParams } from '../design/visualParams';
import type { AirborneWord, GameMode } from '../engine/types';
import { loadBrushTexture } from './brushStroke';
import { buildFilters, filterKinds } from './filters';
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
const SHAKE_JITTER_PX = 4;

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
// playMiss()'s doc comment for why this one skips the brush-stroke treatment.
const MISS_UNDERLINE_GAP_PX = 4;
const MISS_UNDERLINE_THICKNESS_PX = 2;

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
  private fx: Fx[] = [];
  private readonly app: Application;
  private readonly particles: Particles;
  private readonly host: HTMLElement;
  private readonly unsubscribeSettings: () => void;
  private readonly handleResize = (): void => this.layoutFloor();
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
    void this.mountFloor();
    this.unsubscribeSettings = subscribeSettings(() => {
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
    const alive = new Set<number>();
    for (const word of words) {
      alive.add(word.instanceId);
      let sprite = this.sprites.get(word.instanceId);
      if (!sprite) {
        sprite = new WordSprite(word, mode);
        this.sprites.set(word.instanceId, sprite);
        this.app.stage.addChild(sprite.view);
      }
      sprite.setLocked(lockedIds.includes(word.instanceId));
      if (word.hintShown && word.card.kanji !== null) sprite.showHint(word.card.kanji);
      sprite.setPosition(word.x * this.app.screen.width, word.y * this.app.screen.height);
    }
    for (const [id, sprite] of this.sprites) {
      if (!alive.has(id)) {
        // sprite.destroy() (not sprite.view.destroy() directly) so a locked
        // word's reticle/underline GlowFilter — added for spec §7 — frees its
        // compiled GPU program too; see WordSprite.destroy()'s doc comment.
        sprite.destroy();
        this.sprites.delete(id);
      }
    }
  }

  /** Scale-up + fade-out gloss tween, a kill particle burst that grows
   *  with combo tier, and — every 5th combo step — a bigger burst plus a
   *  `×N!` flash (skipped entirely at effects 'off': spec §5.1). */
  playKill(word: AirborneWord, combo: number): void {
    this.spawnFx(word, word.card.gloss, PALETTE.ink, 350, (view, t) => {
      view.scale.set(1 + t * 0.8);
      view.alpha = 1 - t;
    });

    const px = word.x * this.app.screen.width;
    const py = Math.min(word.y, 0.95) * this.app.screen.height;
    this.particles.killBurst(px, py, combo);

    if (combo > 0 && combo % 5 === 0 && getSettings().effects !== 'off') {
      this.spawnFx(word, `×${combo}!`, PALETTE.accent, 500, (view, t) => {
        const pop = t < 0.3 ? 1 + (t / 0.3) * 0.3 : 1.3 - Math.min((t - 0.3) / 0.3, 1) * 0.3;
        view.scale.set(pop);
        view.alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      });
    }
  }

  /** Reveal the answer where the word landed (spec §3.1: miss is a learning
   *  moment), a particle puff, and — effects 'full' only — a brief
   *  screen shake. */
  playMiss(word: AirborneWord): void {
    const reveal = `${word.card.kanji ?? ''} ${word.card.kana[0]} — ${word.card.gloss}`.trim();
    // Spec §5.4: "becomes --color-ink on a vermillion underline rather than
    // pink text" — the reveal is the game's most important teaching moment.
    // Task 4's brief deferred this underline to Task 7; Task 7's own brief
    // only ever specified the *target-lock* underline (§5.3), so it was
    // never picked up — found during this task's matrix walk. §5.4 says
    // "a vermillion underline", not §5.3's "vermillion brush underline", so
    // this is a flat Graphics rect rather than the dry-brush texture: no new
    // texture/tuning surface, and it matches the spec's literal wording.
    this.spawnFx(word, reveal, PALETTE.ink, 1600, (view, t) => {
      view.alpha = t < 0.15 ? 1 : 1 - (t - 0.15) / 0.85;
    }, { underline: true });

    const px = word.x * this.app.screen.width;
    const py = Math.min(word.y, 0.95) * this.app.screen.height;
    this.particles.missPuff(px, py);

    if (getSettings().effects === 'full') this.shakeMs = SHAKE_DURATION_MS;
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

  private spawnFx(
    word: AirborneWord,
    label: string,
    color: number,
    lifeMs: number,
    update: Fx['update'],
    options: { underline?: boolean } = {},
  ): void {
    const text = new Text({
      text: label,
      style: new TextStyle({
        fontFamily: "'Shippori Mincho B1', 'Yu Gothic UI', 'Meiryo', serif",
        fontSize: 30,
        fill: color,
      }),
      resolution: 2,
    });
    text.anchor.set(0.5);
    const view = new Container();
    view.addChild(text);
    // Miss reveal only (spec §5.4) — measured against the real label, so it
    // spans exactly the rendered text regardless of how long the reveal
    // string (kanji + kana + gloss) turns out to be.
    if (options.underline === true) {
      const underline = new Graphics()
        .rect(-text.width / 2, text.height / 2 + MISS_UNDERLINE_GAP_PX, text.width, MISS_UNDERLINE_THICKNESS_PX)
        .fill(PALETTE.danger);
      view.addChild(underline);
    }
    const yPx = Math.min(word.y, 0.95) * this.app.screen.height;
    view.position.set(word.x * this.app.screen.width, yPx);
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
        fx.view.destroy({ children: true });
        return false;
      }
      return true;
    });
  }

  /** Jitters the whole stage ±SHAKE_JITTER_PX while shakeMs is positive;
   *  restores the origin the instant it expires (miss-only, spec §5.1). */
  private updateShake(deltaMs: number): void {
    if (this.shakeMs <= 0) return;
    this.shakeMs -= deltaMs;
    if (this.shakeMs > 0) {
      const dx = (Math.random() * 2 - 1) * SHAKE_JITTER_PX;
      const dy = (Math.random() * 2 - 1) * SHAKE_JITTER_PX;
      this.app.stage.position.set(dx, dy);
    } else {
      this.app.stage.position.set(0, 0);
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
      texture = await loadBrushTexture(cssHex(PALETTE.system), FLOOR_TEXTURE_SEED);
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
