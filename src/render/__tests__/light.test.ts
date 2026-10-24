import { describe, expect, it } from 'vitest';
import { MOTION } from '../../design/motion';
import { PALETTE } from '../../design/palette';
import { visualParams } from '../../design/visualParams';
import type { Card } from '../../engine/types';
import { LIGHT_FLICKER_LIFE_MS, lightFlickerFrame, lightStyle, revealLayout } from '../light';

const FULL = visualParams('full'), REDUCED = visualParams('reduced'), OFF = visualParams('off');
const card: Card = { id: 'hito', kanji: '人', kana: ['ひと'], gloss: 'person', pos: 'n', jlpt: 5, source: 'jlpt' };
const kanaOnly: Card = { ...card, id: 'sore', kanji: null, kana: ['それ'], gloss: 'that' };

describe('lightStyle', () => {
  it('plain is today at every level', () => {
    expect(lightStyle('plain', FULL)).toEqual({ fill: PALETTE.ink, halo: true, coreAlpha: 0, chromaticSplit: true, spawnFlicker: true });
    expect(lightStyle('plain', OFF)).toEqual({ fill: PALETTE.ink, halo: false, coreAlpha: 0, chromaticSplit: true, spawnFlicker: true });
  });
  it('lit adds a core scaled by haloAlpha and equals plain at off', () => {
    expect(lightStyle('lit', FULL).coreAlpha).toBe(0.9);
    expect(lightStyle('lit', REDUCED).coreAlpha).toBe(0.45);
    expect(lightStyle('lit', OFF)).toEqual(lightStyle('plain', OFF));
  });
  it('dark is dim ink with no halo, no split, no spawn flicker, at every level', () => {
    for (const p of [FULL, REDUCED, OFF]) expect(lightStyle('dark', p)).toEqual({ fill: PALETTE.inkDim, halo: false, coreAlpha: 0, chromaticSplit: false, spawnFlicker: false });
  });
});
describe('lightFlickerFrame', () => {
  it('going out: off, on, off over three snaps, then done dark', () => {
    expect(lightFlickerFrame(0, 1, 'dark')).toEqual({ lit: false, done: false });
    expect(lightFlickerFrame(MOTION.snapMs + 1, 1, 'dark').lit).toBe(true);
    expect(lightFlickerFrame(MOTION.snapMs * 2 + 1, 1, 'dark').lit).toBe(false);
    expect(lightFlickerFrame(LIGHT_FLICKER_LIFE_MS, 1, 'dark')).toEqual({ lit: false, done: true });
  });
  it('coming on: dark, lit, dark, then done lit', () => {
    expect(lightFlickerFrame(0, 1, 'lit').lit).toBe(false);
    expect(lightFlickerFrame(MOTION.snapMs + 1, 1, 'lit').lit).toBe(true);
    expect(lightFlickerFrame(LIGHT_FLICKER_LIFE_MS, 1, 'lit')).toEqual({ lit: true, done: true });
  });
  it('flicker 0 is a single step to the ending', () => {
    expect(lightFlickerFrame(0, 0, 'lit')).toEqual({ lit: true, done: false });
    expect(lightFlickerFrame(MOTION.snapMs, 0, 'dark')).toEqual({ lit: false, done: true });
  });
});
describe('revealLayout', () => {
  it('plain is today\'s lesson line in ink at 30px', () => {
    expect(revealLayout(card, 'plain', 52)).toEqual({ kind: 'lesson', fill: PALETTE.ink, main: { text: '人 ひと — person', fontSize: 30 }, above: null, tag: null });
  });
  it('lit is the reading only, dead, with the kanji above and the tag', () => {
    expect(revealLayout(card, 'lit', 52)).toEqual({ kind: 'lapse', fill: PALETTE.inkFaint, main: { text: 'ひと', fontSize: 39 }, above: { text: '人', fontSize: 34 }, tag: 'you had this' });
  });
  it('dark is the lesson line in dead ink', () => {
    expect(revealLayout(card, 'dark', 52)).toMatchObject({ kind: 'lesson', fill: PALETTE.inkFaint, main: { text: '人 ひと — person' } });
  });
  it('a kana-only card has no kanji line and no leading space', () => {
    expect(revealLayout(kanaOnly, 'lit', 52).above).toBeNull();
    expect(revealLayout(kanaOnly, 'plain', 52).main.text).toBe('それ — that');
  });
});
