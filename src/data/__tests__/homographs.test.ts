import { describe, expect, it } from 'vitest';
import type { Card } from '../../engine/types';
import { mergeLevelHomographs } from '../homographs';

const card = (over: Partial<Card> & Pick<Card, 'id'>): Card => ({
  kanji: '私',
  kana: ['わたし'],
  gloss: 'I',
  pos: 'pn',
  jlpt: 5,
  source: 'jlpt',
  ...over,
});

const notCommon = () => false;

describe('mergeLevelHomographs', () => {
  it('merges two cards sharing a kanji into one card accepting both readings', () => {
    const watashi = card({ id: 'jm-1311110', kana: ['わたし', 'ワタシ'] });
    const watakushi = card({ id: 'jm-2842390', kana: ['わたくし', 'ワタクシ'] });

    const { cards } = mergeLevelHomographs([watashi, watakushi], notCommon);

    expect(cards).toHaveLength(1);
    expect(cards[0].id).toBe('jm-1311110');
    expect(cards[0].kana).toEqual(['わたし', 'ワタシ', 'わたくし', 'ワタクシ']);
  });

  it('keeps the survivor first-listed reading canonical and never duplicates readings', () => {
    const a = card({ id: 'jm-100', kanji: '何', kana: ['なに', 'なん'] });
    const b = card({ id: 'jm-200', kanji: '何', kana: ['なん'] });

    const { cards } = mergeLevelHomographs([a, b], notCommon);

    expect(cards[0].kana).toEqual(['なに', 'なん']);
  });

  it('prefers a jmdict-common card as survivor over a lower id', () => {
    const rare = card({ id: 'jm-100', kana: ['わたくし'] });
    const common = card({ id: 'jm-200', kana: ['わたし'] });

    const { cards } = mergeLevelHomographs([rare, common], (id) => id === 'jm-200');

    expect(cards[0].id).toBe('jm-200');
    expect(cards[0].kana).toEqual(['わたし', 'わたくし']);
  });

  it('joins differing glosses and keeps identical glosses as-is', () => {
    const kimi = card({ id: 'jm-100', kanji: '君', kana: ['きみ'], gloss: 'you' });
    const kun = card({ id: 'jm-200', kanji: '君', kana: ['くん'], gloss: 'Mr' });
    const merged = mergeLevelHomographs([kimi, kun], notCommon).cards[0];
    expect(merged.gloss).toBe('you / Mr');

    const same = mergeLevelHomographs(
      [card({ id: 'jm-100' }), card({ id: 'jm-200', kana: ['わたくし'] })],
      notCommon,
    ).cards[0];
    expect(same.gloss).toBe('I');
  });

  it('keeps the survivor gloss alone when joining would exceed the 28-char cap', () => {
    const aku = card({ id: 'jm-100', kanji: '空く', kana: ['あく'], gloss: 'to open' });
    const suku = card({
      id: 'jm-200',
      kanji: '空く',
      kana: ['すく'],
      gloss: 'to become less crowded',
    });

    const { cards } = mergeLevelHomographs([aku, suku], notCommon);

    expect(cards[0].gloss).toBe('to open');
    expect(cards[0].kana).toEqual(['あく', 'すく']);
  });

  it('skips an overflowing twin gloss but still joins a later one that fits', () => {
    const aku = card({ id: 'jm-100', kanji: '空く', kana: ['あく'], gloss: 'to open' });
    const suku = card({
      id: 'jm-200',
      kanji: '空く',
      kana: ['すく'],
      gloss: 'to become less crowded', // joined would be 32 chars > 28
    });
    const hima = card({ id: 'jm-300', kanji: '空く', kana: ['ひま'], gloss: 'free' });

    const { cards } = mergeLevelHomographs([aku, suku, hima], notCommon);

    expect(cards[0].gloss).toBe('to open / free');
    expect(cards[0].kana).toEqual(['あく', 'すく', 'ひま']);
  });

  it('collapses a three-card homograph group into a single card', () => {
    const ue = card({ id: 'jm-100', kanji: '上', kana: ['うわ'], jlpt: 3 });
    const kami = card({ id: 'jm-200', kanji: '上', kana: ['かみ'], jlpt: 3 });
    const jou = card({ id: 'jm-300', kanji: '上', kana: ['じょう'], jlpt: 3 });

    const { cards } = mergeLevelHomographs([ue, kami, jou], notCommon);

    expect(cards).toHaveLength(1);
    expect(cards[0].kana).toEqual(['うわ', 'かみ', 'じょう']);
  });

  it('never merges kana-only cards even when their readings coincide', () => {
    const bridge = card({ id: 'jm-100', kanji: null, kana: ['はし'], gloss: 'bridge' });
    const chopsticks = card({ id: 'jm-200', kanji: null, kana: ['はし'], gloss: 'chopsticks' });

    const { cards } = mergeLevelHomographs([bridge, chopsticks], notCommon);

    expect(cards).toHaveLength(2);
  });

  it('passes distinct-kanji cards through untouched, preserving order and inputs', () => {
    const a = card({ id: 'jm-100', kanji: '今', kana: ['いま'], gloss: 'now' });
    const b = card({ id: 'jm-200', kanji: '右', kana: ['みぎ'], gloss: 'right' });
    const frozenKana = [...a.kana];

    const { cards, merges } = mergeLevelHomographs([a, b], notCommon);

    expect(cards).toEqual([a, b]);
    expect(merges).toEqual([]);
    expect(a.kana).toEqual(frozenKana); // inputs are not mutated
  });

  it('reports one audit line per absorbed card', () => {
    const watashi = card({ id: 'jm-1311110' });
    const watakushi = card({ id: 'jm-2842390', kana: ['わたくし'] });

    const { merges } = mergeLevelHomographs([watashi, watakushi], notCommon);

    expect(merges).toHaveLength(1);
    expect(merges[0]).toContain('jm-2842390');
    expect(merges[0]).toContain('jm-1311110');
    expect(merges[0]).toContain('私');
  });
});
