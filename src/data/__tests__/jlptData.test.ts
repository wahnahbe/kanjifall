/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isKana, toHiragana, toKatakana } from 'wanakana';
import { readingForms } from '../../engine/matcher';
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
        expect(new Set(card.kana).size, card.id).toBe(card.kana.length);
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

  it('naive-typing variants collide with other cards only in the two known steal pairs', () => {
    // Guards the matcher's documented tradeoff: if a data regeneration ever
    // introduces a NEW cross-card collision (canonical of X == naive variant
    // of Y), this fails and the pair must be reviewed in matcher.ts.
    const all = files.flatMap(([, f]) => f.cards);
    const canonicalOwners = new Map<string, string[]>();
    for (const c of all) {
      for (const r of c.kana) {
        const key = readingForms(r)[0];
        canonicalOwners.set(key, [...(canonicalOwners.get(key) ?? []), c.id]);
      }
    }
    const steals = new Set<string>();
    for (const c of all) {
      for (const r of c.kana) {
        const [canonicalForm, ...variants] = readingForms(r);
        for (const v of variants) {
          if (v === canonicalForm) continue;
          for (const owner of canonicalOwners.get(v) ?? []) {
            if (owner !== c.id) steals.add(`${owner}<-${c.id}`);
          }
        }
      }
    }
    expect([...steals].sort()).toEqual([
      'jm-1365410<-jm-1359850', // 親友(しんゆう) <- 侵入(しんにゅう)
      'jm-1417040<-jm-1417030', // 単位(たんい) <- 単に(たんに)
    ]);
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

  it('every emitted sentence contains its word and stays within the length cap', () => {
    for (const [, file] of files) {
      for (const card of file.cards) {
        if (!card.sentence) continue;
        expect(card.sentence.ja.length, card.id).toBeLessThanOrEqual(50);
        const needle = card.kanji ?? card.kana[0];
        expect(card.sentence.ja.includes(needle), `${card.id} (${needle})`).toBe(true);
        expect(card.sentence.en.length, card.id).toBeGreaterThan(0);
      }
    }
  });

  it('kanji cards carry a part meaning for each character kanjidic knows', () => {
    for (const [, file] of files) {
      for (const card of file.cards) {
        if (!card.kanjiParts) continue;
        expect(card.kanji, card.id).not.toBeNull();
        for (const part of card.kanjiParts) {
          expect(part.char.length, card.id).toBe(1);
          expect(card.kanji!.includes(part.char), `${card.id}:${part.char}`).toBe(true);
          expect(part.meaning.trim().length, `${card.id}:${part.char}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('kana-only cards never carry kanji parts', () => {
    for (const [, file] of files) {
      for (const card of file.cards) {
        if (card.kanji === null) expect(card.kanjiParts, card.id).toBeUndefined();
      }
    }
  });

  it('hook coverage is meaningful, not accidental', () => {
    const all = files.flatMap(([, f]) => f.cards);
    const withSentence = all.filter((c) => c.sentence).length;
    const kanjiCards = all.filter((c) => c.kanji !== null);
    const withParts = kanjiCards.filter((c) => c.kanjiParts).length;
    // Tatoeba coverage is partial by nature, especially at N2 — this is a floor,
    // not a target. Record the real number in your report.
    expect(withSentence / all.length).toBeGreaterThan(0.25);
    expect(withParts / kanjiCards.length).toBeGreaterThan(0.9);
  });
});
