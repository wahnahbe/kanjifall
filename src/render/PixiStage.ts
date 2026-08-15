import { Application, Container, Text, TextStyle } from 'pixi.js';
import type { Filter } from 'pixi.js';
import { getSettings, subscribeSettings } from '../data/settings';
import { PALETTE } from '../design/palette';
import { visualParams } from '../design/visualParams';
import type { AirborneWord, GameMode } from '../engine/types';
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
  private shakeMs = 0;
  // Sentinel so the FIRST applyFilters() call always applies, no matter what
  // filterKinds(initial settings) happens to join to (including '' when
  // neither bloom nor crt is on) — see applyFilters' doc comment.
  private appliedFilterKinds = 'unset';

  private constructor(app: Application, host: HTMLElement) {
    this.app = app;
    this.host = host;
    this.app.stage.sortableChildren = true;
    this.particles = new Particles();
    this.particles.view.zIndex = PARTICLES_Z_INDEX;
    this.app.stage.addChild(this.particles.view);

    this.applyFilters();
    this.applyBackdrop();
    this.unsubscribeSettings = subscribeSettings(() => {
      this.applyFilters();
      this.applyBackdrop();
    });

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
        sprite.view.destroy({ children: true });
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
    this.spawnFx(word, reveal, PALETTE.ink, 1600, (view, t) => {
      view.alpha = t < 0.15 ? 1 : 1 - (t - 0.15) / 0.85;
    });

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
    this.unsubscribeSettings();
    this.destroyFilters(this.app.stage.filters);
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
}
