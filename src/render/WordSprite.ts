import { Container, Text, TextStyle } from 'pixi.js';
import type { AirborneWord, GameMode } from '../engine/types';

const FONT_STACK = "'Yu Gothic UI', 'Meiryo', 'Noto Sans JP', sans-serif";

const BASE_STYLE: Partial<TextStyle> = {
  fontFamily: FONT_STACK,
  fontSize: 40,
  fill: 0xe8f0ff,
};

const HINT_STYLE: Partial<TextStyle> = {
  fontFamily: FONT_STACK,
  fontSize: 26,
  fill: 0xbfd4ff,
};

const HINT_FADE_MS = 300;
const HINT_OFFSET_Y = 34;
const LOCKED_TINT = 0x7fdfff;
const UNLOCKED_TINT = 0xffffff;

export class WordSprite {
  readonly view: Container;
  private readonly text: Text;
  private hintText: Text | null = null;

  constructor(word: AirborneWord, mode: GameMode) {
    const display = mode === 'recall'
      ? word.card.gloss
      : word.card.kanji ?? word.card.kana[0];
    this.text = new Text({
      text: display,
      style: new TextStyle({ ...BASE_STYLE }),
      resolution: Math.min(Math.max(window.devicePixelRatio, 1) * 2, 4),
    });
    this.text.anchor.set(0.5);
    this.view = new Container();
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

  setLocked(locked: boolean): void {
    this.text.tint = locked ? LOCKED_TINT : UNLOCKED_TINT;
  }

  setPosition(xPx: number, yPx: number): void {
    this.view.position.set(xPx, yPx);
  }
}
