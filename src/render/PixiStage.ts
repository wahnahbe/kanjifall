import { Application, Container, Text, TextStyle } from 'pixi.js';
import type { Filter } from 'pixi.js';
import { getSettings, subscribeSettings } from '../data/settings';
import type { AirborneWord, GameMode } from '../engine/types';
import { buildFilters } from './filters';
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

/** Dumb render layer: mirrors engine words, plays kill/miss effects. */
export class PixiStage {
  private sprites = new Map<number, WordSprite>();
  private fx: Fx[] = [];
  private readonly app: Application;
  private readonly particles: Particles;
  private readonly unsubscribeSettings: () => void;
  private shakeMs = 0;

  private constructor(app: Application) {
    this.app = app;
    this.app.stage.sortableChildren = true;
    this.particles = new Particles();
    this.particles.view.zIndex = PARTICLES_Z_INDEX;
    this.app.stage.addChild(this.particles.view);

    this.applyFilters();
    this.unsubscribeSettings = subscribeSettings(() => this.applyFilters());

    app.ticker.add(() => {
      const delta = app.ticker.deltaMS;
      this.updateFx(delta);
      for (const sprite of this.sprites.values()) sprite.update(delta);
      this.particles.update(delta);
      this.updateShake(delta);
    });
  }

  static async create(host: HTMLElement): Promise<PixiStage> {
    await document.fonts.ready; // JP glyph measurement gate (spec §7)
    const app = new Application();
    await app.init({
      background: 0x0b0e14,
      resizeTo: host,
      antialias: true,
    });
    host.appendChild(app.canvas);
    return new PixiStage(app);
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

  /** Scale-up + fade-out gloss tween, a kill-green particle burst that grows
   *  with combo tier, and — every 5th combo step — a bigger burst plus a
   *  `×N!` flash (skipped entirely at effects 'off': spec §5.1). */
  playKill(word: AirborneWord, combo: number): void {
    this.spawnFx(word, word.card.gloss, 0x9dffb0, 350, (view, t) => {
      view.scale.set(1 + t * 0.8);
      view.alpha = 1 - t;
    });

    const px = word.x * this.app.screen.width;
    const py = Math.min(word.y, 0.95) * this.app.screen.height;
    this.particles.killBurst(px, py, combo);

    if (combo > 0 && combo % 5 === 0 && getSettings().effects !== 'off') {
      this.spawnFx(word, `×${combo}!`, 0xffd166, 500, (view, t) => {
        const pop = t < 0.3 ? 1 + (t / 0.3) * 0.3 : 1.3 - Math.min((t - 0.3) / 0.3, 1) * 0.3;
        view.scale.set(pop);
        view.alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      });
    }
  }

  /** Reveal the answer where the word landed (spec §3.1: miss is a learning
   *  moment), a dim red particle puff, and — effects 'full' only — a brief
   *  screen shake. */
  playMiss(word: AirborneWord): void {
    const reveal = `${word.card.kanji ?? ''} ${word.card.kana[0]} — ${word.card.gloss}`.trim();
    this.spawnFx(word, reveal, 0xff8f8f, 1600, (view, t) => {
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
        fontFamily: "'Yu Gothic UI', 'Meiryo', 'Noto Sans JP', sans-serif",
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
   *  every stage teardown would abandon live GPU shader programs. */
  private applyFilters(): void {
    const outgoing = this.app.stage.filters;
    this.app.stage.filters = buildFilters(getSettings());
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
}
