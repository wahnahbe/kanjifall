import { Container, Text, TextStyle } from 'pixi.js';
import type { AirborneWord, GameMode } from '../engine/types';

const BASE_STYLE: Partial<TextStyle> = {
  fontFamily: "'Yu Gothic UI', 'Meiryo', 'Noto Sans JP', sans-serif",
  fontSize: 40,
  fill: 0xe8f0ff,
};

const LOCKED_TINT = 0x7fdfff;
const UNLOCKED_TINT = 0xffffff;

export class WordSprite {
  readonly view: Container;
  private readonly text: Text;

  constructor(word: AirborneWord, mode: GameMode) {
    const display = mode === 'reading'
      ? word.card.kanji ?? word.card.kana[0]
      : word.card.gloss;
    this.text = new Text({
      text: display,
      style: new TextStyle({ ...BASE_STYLE }),
      resolution: Math.min(Math.max(window.devicePixelRatio, 1) * 2, 4),
    });
    this.text.anchor.set(0.5);
    this.view = new Container();
    this.view.addChild(this.text);
  }

  setLocked(locked: boolean): void {
    this.text.tint = locked ? LOCKED_TINT : UNLOCKED_TINT;
  }

  setPosition(xPx: number, yPx: number): void {
    this.view.position.set(xPx, yPx);
  }
}
