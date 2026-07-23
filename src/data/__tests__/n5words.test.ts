import { describe, expect, it } from 'vitest';
import { isKana } from 'wanakana';
import { N5_WORDS } from '../n5words';

describe('N5_WORDS data invariants', () => {
  it('has 50 cards', () => {
    expect(N5_WORDS).toHaveLength(50);
  });

  it('every card has kanji, at least one pure-kana reading, and a short gloss', () => {
    for (const card of N5_WORDS) {
      expect(card.kanji, card.id).toBeTruthy();
      expect(card.kana.length, card.id).toBeGreaterThan(0);
      for (const reading of card.kana) expect(isKana(reading), `${card.id}:${reading}`).toBe(true);
      expect(card.gloss.length, card.id).toBeLessThanOrEqual(28);
      expect(card.jlpt, card.id).toBe(5);
      expect(card.source, card.id).toBe('jlpt');
    }
  });

  it('ids and kanji are unique', () => {
    expect(new Set(N5_WORDS.map((c) => c.id)).size).toBe(50);
    expect(new Set(N5_WORDS.map((c) => c.kanji)).size).toBe(50);
  });
});
