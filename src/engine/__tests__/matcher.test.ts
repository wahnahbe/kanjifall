import { describe, expect, it } from 'vitest';
import type { AirborneWord, Card } from '../types';
import { findExactMatches, findPrefixMatches, normalizeReading, selectTarget } from '../matcher';

const card = (id: string, readings: string[], kanji: string | null = '字'): Card => ({
  id, kanji, kana: readings, gloss: 'x', pos: 'noun', jlpt: 5, source: 'jlpt',
});

const airborne = (id: number, c: Card, y: number): AirborneWord => ({
  instanceId: id, card: c, lane: 0, x: 0.5, y, speed: 0.1,
  spawnedAt: 0, firstKeyAt: null, backspaceCount: 0, hintShown: false, wasTargeted: false,
});

describe('normalizeReading', () => {
  it('equates hiragana and katakana forms', () => {
    expect(normalizeReading('ネコ')).toBe(normalizeReading('ねこ'));
  });
  it('equates long-vowel-mark forms regardless of source script', () => {
    expect(normalizeReading('コーヒー')).toBe(normalizeReading('こーひー'));
  });
});

describe('findExactMatches', () => {
  const neko = airborne(1, card('a', ['ねこ']), 0.3);
  const koohii = airborne(2, card('b', ['コーヒー']), 0.5);

  it('matches any accepted reading', () => {
    const multi = airborne(3, card('c', ['いく', 'ゆく']), 0.2);
    expect(findExactMatches('ゆく', [multi])).toHaveLength(1);
    expect(findExactMatches('いく', [multi])).toHaveLength(1);
  });

  it('matches katakana words typed as hiragana with hyphen long vowels', () => {
    expect(findExactMatches('こーひー', [neko, koohii]).map((w) => w.instanceId)).toEqual([2]);
  });

  it('returns empty on no match', () => {
    expect(findExactMatches('いぬ', [neko])).toHaveLength(0);
  });
});

describe('findPrefixMatches', () => {
  const benkyou = airborne(1, card('a', ['べんきょう']), 0.3);
  const bengoshi = airborne(2, card('b', ['べんごし']), 0.4);

  it('locks all words sharing the typed kana prefix', () => {
    expect(findPrefixMatches('べん', [benkyou, bengoshi])).toHaveLength(2);
  });

  it('ignores an unconverted romaji tail', () => {
    expect(findPrefixMatches('べんk', [benkyou, bengoshi])).toHaveLength(2);
  });

  it('empty converted prefix locks nothing', () => {
    expect(findPrefixMatches('k', [benkyou])).toHaveLength(0);
    expect(findPrefixMatches('', [benkyou])).toHaveLength(0);
  });
});

describe('selectTarget', () => {
  it('picks the word closest to the floor (max y)', () => {
    const c = card('a', ['こうえん']);
    const high = airborne(1, c, 0.2);
    const low = airborne(2, c, 0.8);
    expect(selectTarget([high, low])?.instanceId).toBe(2);
  });
  it('returns null for empty input', () => {
    expect(selectTarget([])).toBeNull();
  });
});
