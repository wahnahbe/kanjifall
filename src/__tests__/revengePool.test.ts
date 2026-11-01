import { describe, expect, it } from 'vitest';
import type { AirborneWord, Card, EnginePlan, GameEvent } from '../engine/types';
import { unlockForRevenge, updateRevengePool } from '../revengePool';

const card = (id: string): Card => ({
  id, kanji: '字', kana: ['かな'], gloss: 'g', pos: 'n', jlpt: 5, source: 'jlpt',
});

const word = (c: Card): AirborneWord => ({
  instanceId: 1, card: c, lane: 0, x: 0.5, y: 1, speed: 0.1, spawnedAt: 0, firstKeyAt: null,
  backspaceCount: 0, hintShown: false, wasTargeted: false, light: 'plain', comeback: false,
});

const missed = (c: Card): GameEvent => ({ type: 'wordMissed', word: word(c), lapse: false, light: 'plain' });
const killed = (c: Card): GameEvent =>
  ({ type: 'wordKilled', word: word(c), msToKill: 500, points: 100, combo: 1, relit: false });

describe('updateRevengePool', () => {
  it('a miss adds the card at the front, newest first', () => {
    const a = card('a');
    const b = card('b');
    const pool = updateRevengePool(updateRevengePool([], missed(a)), missed(b));
    expect(pool.map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('missing a card already in the pool moves it to the front without duplicating it', () => {
    const a = card('a');
    const b = card('b');
    const pool = updateRevengePool([b, a], missed(a));
    expect(pool.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('a kill removes the card from the pool, in any run', () => {
    const a = card('a');
    const b = card('b');
    expect(updateRevengePool([b, a], killed(a)).map((c) => c.id)).toEqual(['b']);
  });

  it('a kill of a card not in the pool, and every other event, return the same pool', () => {
    const a = card('a');
    const pool: readonly Card[] = [a];
    expect(updateRevengePool(pool, killed(card('zzz')))).toBe(pool);
    expect(updateRevengePool(pool, { type: 'waveCleared', wave: 1 })).toBe(pool);
    expect(updateRevengePool(pool, { type: 'gameOver', score: 0, wave: 1, ownedIds: [] })).toBe(pool);
  });
});

describe('unlockForRevenge', () => {
  const plan: EnginePlan = {
    newCardIds: ['parked'],
    seenCards: [{ id: 'seen', weight: 0.3, owned: true }],
    runBudget: 0,
    perWaveNewCap: 0,
  };

  it('adds a pool card from an earlier run to the seen list so it can spawn', () => {
    const out = unlockForRevenge(plan, [card('seen'), card('earlier')], new Set(['earlier']));
    expect(out.seenCards).toEqual([
      { id: 'seen', weight: 0.3, owned: true },
      { id: 'earlier', weight: 1, owned: true },
    ]);
    expect(out.newCardIds).toEqual(['parked']);
  });

  it('leaves a never-introduced (parked) card out of revenge', () => {
    const out = unlockForRevenge(plan, [card('parked')], new Set());
    expect(out.seenCards).toEqual(plan.seenCards);
  });

  it('does not duplicate a card the plan already lists as seen', () => {
    const out = unlockForRevenge(plan, [card('seen')], new Set());
    expect(out.seenCards).toEqual(plan.seenCards);
  });
});
