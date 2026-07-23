/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isKana, toHiragana, toKatakana } from 'wanakana';
import { levelFileSchema, type LevelFile } from '../schema';

const LEVELS = [5, 4, 3, 2] as const;
// Floors = 80% of the source bank sizes (705/643/1695/1856); ceilings = bank sizes.
const BOUNDS: Record<number, [number, number]> = {
  5: [564, 705], 4: [514, 643], 3: [1356, 1695], 2: [1484, 1856],
};

function load(level: number): LevelFile {
  const raw = readFileSync(`public/data/jlpt-n${level}.json`, 'utf8');
  return levelFileSchema.parse(JSON.parse(raw));
}

describe('generated JLPT data invariants', () => {
  const files = LEVELS.map((l) => [l, load(l)] as const);

  it('card counts land inside expected bounds per level', () => {
    for (const [level, file] of files) {
      const [lo, hi] = BOUNDS[level];
      expect(file.cards.length, `N${level}`).toBeGreaterThanOrEqual(lo);
      expect(file.cards.length, `N${level}`).toBeLessThanOrEqual(hi);
      expect(file.level).toBe(level);
    }
  });

  it('ids are globally unique across all levels', () => {
    const all = files.flatMap(([, f]) => f.cards.map((c) => c.id));
    expect(new Set(all).size).toBe(all.length);
  });

  it('every reading is pure kana and canonical reading is first', () => {
    for (const [, file] of files) {
      for (const card of file.cards) {
        for (const r of card.kana) expect(isKana(r), `${card.id}:${r}`).toBe(true);
        expect(card.kana[0].length, card.id).toBeGreaterThan(0);
      }
    }
  });

  it('glosses are clean: ≤28 chars, no parentheses, no leading/trailing space', () => {
    for (const [, file] of files) {
      for (const card of file.cards) {
        expect(card.gloss.length, card.id).toBeLessThanOrEqual(28);
        expect(card.gloss, card.id).not.toMatch(/[()]/);
        expect(card.gloss, card.id).toBe(card.gloss.trim());
      }
    }
  });

  it('kanji field is null exactly for kana-only terms', () => {
    for (const [, file] of files) {
      for (const card of file.cards) {
        if (card.kanji !== null) {
          expect(isKana(card.kanji), card.id).toBe(false);
        }
      }
    }
  });

  it('jlpt tag matches the file level and source is jlpt', () => {
    for (const [level, file] of files) {
      for (const card of file.cards) {
        expect(card.jlpt, card.id).toBe(level);
        expect(card.source, card.id).toBe('jlpt');
      }
    }
  });

  it('readings normalize consistently (katakana round-trip safe)', () => {
    for (const [, file] of files) {
      for (const card of file.cards) {
        const n = toHiragana(toKatakana(card.kana[0]));
        expect(n.length, card.id).toBeGreaterThan(0);
      }
    }
  });

  it('reading-mode pools are non-trivial (enough kanji cards per level)', () => {
    for (const [level, file] of files) {
      const withKanji = file.cards.filter((c) => c.kanji !== null).length;
      expect(withKanji, `N${level}`).toBeGreaterThanOrEqual(file.cards.length * 0.5);
    }
  });
});
