import { Application, Container, Text, TextStyle } from 'pixi.js';
import type { AirborneWord, GameMode } from '../engine/types';
import { WordSprite } from './WordSprite';

interface Fx {
  view: Container;
  ageMs: number;
  lifeMs: number;
  update: (view: Container, t: number) => void; // t in [0,1]
}

/** Dumb render layer: mirrors engine words, plays kill/miss effects. */
export class PixiStage {
  private sprites = new Map<number, WordSprite>();
  private fx: Fx[] = [];
  private readonly app: Application;

  private constructor(app: Application) {
    this.app = app;
    app.ticker.add(() => {
      const delta = app.ticker.deltaMS;
      this.updateFx(delta);
      for (const sprite of this.sprites.values()) sprite.update(delta);
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

  /** Scale-up + fade-out at the word's last position. */
  playKill(word: AirborneWord): void {
    this.spawnFx(word, word.card.gloss, 0x9dffb0, 350, (view, t) => {
      view.scale.set(1 + t * 0.8);
      view.alpha = 1 - t;
    });
  }

  /** Reveal the answer where the word landed (spec §3.1: miss is a learning moment). */
  playMiss(word: AirborneWord): void {
    const reveal = `${word.card.kanji ?? ''} ${word.card.kana[0]} — ${word.card.gloss}`.trim();
    this.spawnFx(word, reveal, 0xff8f8f, 1600, (view, t) => {
      view.alpha = t < 0.15 ? 1 : 1 - (t - 0.15) / 0.85;
    });
  }

  destroy(): void {
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
}
