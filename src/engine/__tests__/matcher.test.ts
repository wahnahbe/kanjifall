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

  it('empty and whitespace-only buffers match nothing', () => {
    expect(findExactMatches('', [neko])).toHaveLength(0);
    expect(findExactMatches('   ', [neko])).toHaveLength(0);
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

  it('non-empty prefix with no matching card locks nothing', () => {
    expect(findPrefixMatches('いぬ', [benkyou, bengoshi])).toHaveLength(0);
  });
});

describe('lenient acceptance (input-bug fix: naive-IME typings must kill)', () => {
  const onna = airborne(1, card('onna', ['おんな'], '女'), 0.4);
  const kinen = airborne(2, card('kinen', ['きんえん'], '禁煙'), 0.3);
  const kinnen = airborne(3, card('kinnen', ['きんねん'], '近年'), 0.5);
  const koohii = airborne(4, card('koohii', ['コーヒー'], null), 0.4);
  const katazukeru = airborne(5, card('katazukeru', ['かたづける'], '片付ける'), 0.4);

  it('accepts naive geminate-n typing (onna arrives as おんあ, kills おんな)', () => {
    expect(findExactMatches('おんあ', [onna]).map((w) => w.instanceId)).toEqual([1]);
  });

  it('an exact reading outranks another word\'s geminate-n alternate', () => {
    // Typed きんえん with BOTH 禁煙(きんえん) and 近年(きんねん) airborne → only 禁煙 matches.
    expect(findExactMatches('きんえん', [kinnen, kinen]).map((w) => w.instanceId)).toEqual([2]);
  });

  it('the geminate-n alternate applies when no exact match exists', () => {
    // Only 近年 airborne: typed きんえん (explicit-nn convention for きんねん) kills it.
    expect(findExactMatches('きんえん', [kinnen]).map((w) => w.instanceId)).toEqual([3]);
  });

  it('accepts all three long-vowel typings for コーヒー', () => {
    for (const typed of ['こおひい', 'こうひい', 'こーひー']) {
      expect(findExactMatches(typed, [koohii]), typed).toHaveLength(1);
    }
  });

  it('treats づ/ず (and ぢ/じ) as phonetically equivalent', () => {
    expect(findExactMatches('かたずける', [katazukeru])).toHaveLength(1);
  });

  it('handles geminate n before ゃゅょ compounds (shinnyuu → しんゆう kills 侵入)', () => {
    const shinnyuu = airborne(6, card('shinnyuu', ['しんにゅう'], '侵入'), 0.4);
    expect(findExactMatches('しんゆう', [shinnyuu]).map((w) => w.instanceId)).toEqual([6]);
  });

  it('the real word 親友(しんゆう) outranks 侵入\'s naive variant when both are airborne', () => {
    const shinnyuu = airborne(6, card('shinnyuu', ['しんにゅう'], '侵入'), 0.9);
    const shinyuu = airborne(7, card('shinyuu', ['しんゆう'], '親友'), 0.1);
    expect(findExactMatches('しんゆう', [shinnyuu, shinyuu]).map((w) => w.instanceId)).toEqual([7]);
  });

  it('the same-level steal pair 単位/単に resolves to the exact word', () => {
    const tanni = airborne(8, card('tanni', ['たんに'], '単に'), 0.9);
    const tani = airborne(9, card('tani', ['たんい'], '単位'), 0.1);
    expect(findExactMatches('たんい', [tanni, tani]).map((w) => w.instanceId)).toEqual([9]);
  });

  it('victims of steal pairs stay reachable via their exact readings', () => {
    const tanni = airborne(8, card('tanni', ['たんに'], '単に'), 0.9);
    const kinnen = airborne(10, card('kinnen', ['きんねん'], '近年'), 0.9);
    expect(findExactMatches('たんに', [tanni]).map((w) => w.instanceId)).toEqual([8]);
    expect(findExactMatches('きんねん', [kinnen]).map((w) => w.instanceId)).toEqual([10]);
  });

  it('locks on through alternate forms too', () => {
    expect(findPrefixMatches('こおひ', [koohii])).toHaveLength(1);
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

  it('breaks equal-y ties by array order (first match wins)', () => {
    const c = card('a', ['こうえん']);
    const first = airborne(1, c, 0.5);
    const second = airborne(2, c, 0.5);
    expect(selectTarget([first, second])?.instanceId).toBe(1);
  });
});
