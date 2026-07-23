import type { Card } from './types';

const BASE_POINTS = 100;
const POINTS_PER_KANA = 20;
const WAVE_BONUS_RATE = 0.1;
const COMBO_STEP = 0.1;
const COMBO_CAP = 20;

export function comboMultiplier(combo: number): number {
  return 1 + Math.min(combo, COMBO_CAP) * COMBO_STEP;
}

/** Points for killing `card` during `wave` with `combo` prior consecutive kills. */
export function pointsFor(card: Card, wave: number, combo: number): number {
  const base = BASE_POINTS + POINTS_PER_KANA * card.kana[0].length;
  const waveBonus = base * WAVE_BONUS_RATE * (wave - 1);
  return Math.round((base + waveBonus) * comboMultiplier(combo));
}
