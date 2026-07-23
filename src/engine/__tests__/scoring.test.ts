import { describe, expect, it } from 'vitest';
import type { Card } from '../types';
import { comboMultiplier, pointsFor } from '../scoring';

const card = (reading: string): Card => ({
  id: 'x', kanji: '字', kana: [reading], gloss: 'g', pos: 'noun', jlpt: 5, source: 'jlpt',
});

describe('scoring', () => {
  it('longer readings score more', () => {
    expect(pointsFor(card('がっこう'), 1, 0)).toBeGreaterThan(pointsFor(card('ひ'), 1, 0));
  });

  it('later waves score more', () => {
    expect(pointsFor(card('ねこ'), 5, 0)).toBeGreaterThan(pointsFor(card('ねこ'), 1, 0));
  });

  it('combo multiplies and caps at 20 stacks', () => {
    expect(comboMultiplier(0)).toBe(1);
    expect(comboMultiplier(5)).toBe(1.5);
    expect(comboMultiplier(20)).toBe(3);
    expect(comboMultiplier(99)).toBe(3);
    expect(pointsFor(card('ねこ'), 1, 5)).toBe(Math.round(pointsFor(card('ねこ'), 1, 0) * 1.5));
  });

  it('returns integers', () => {
    expect(Number.isInteger(pointsFor(card('りょうり'), 3, 7))).toBe(true);
  });
});
