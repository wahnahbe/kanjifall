import { describe, expect, it, vi } from 'vitest';
import type { GameEvent } from '../../engine/types';
import { attachSfx } from '../attachSfx';
import type { Sfx } from '../sfx';

function fakePlayer(): Sfx {
  return {
    kill: vi.fn(), miss: vi.fn(), wrongSubmit: vi.fn(), waveClear: vi.fn(),
    gameOver: vi.fn(), ceremonyChime: vi.fn(), tierFanfare: vi.fn(),
    lapse: vi.fn(), relit: vi.fn(),
  } as unknown as Sfx;
}

const word = {} as never; // payloads the listener never reads

describe('attachSfx', () => {
  it('maps the five in-run events to their voices, combo included', () => {
    const player = fakePlayer();
    const listen = attachSfx(player);
    listen({ type: 'wordKilled', word, msToKill: 400, points: 10, combo: 7, relit: false } as GameEvent);
    listen({ type: 'wordMissed', word, lapse: false, light: 'plain' } as GameEvent);
    listen({ type: 'wrongSubmit', submittedKana: 'x' } as GameEvent);
    listen({ type: 'waveCleared', wave: 1 } as GameEvent);
    listen({ type: 'gameOver', score: 1, wave: 1, ownedIds: [] } as GameEvent);
    expect(player.kill).toHaveBeenCalledWith(7);
    expect(player.miss).toHaveBeenCalledTimes(1);
    expect(player.wrongSubmit).toHaveBeenCalledTimes(1);
    expect(player.waveClear).toHaveBeenCalledTimes(1);
    expect(player.gameOver).toHaveBeenCalledTimes(1);
  });

  it('routes a lapse and a second drop to lapse(), a lesson to miss()', () => {
    const player = fakePlayer();
    const listen = attachSfx(player);
    listen({ type: 'wordMissed', word, lapse: true, light: 'lit' } as GameEvent);
    listen({ type: 'wordMissed', word, lapse: false, light: 'dark' } as GameEvent);
    listen({ type: 'wordMissed', word, lapse: false, light: 'plain' } as GameEvent);
    expect(player.lapse).toHaveBeenCalledTimes(2);
    expect(player.miss).toHaveBeenCalledTimes(1);
  });

  it('routes a relit kill to relit(combo), a plain kill to kill(combo)', () => {
    const player = fakePlayer();
    const listen = attachSfx(player);
    listen({ type: 'wordKilled', word, msToKill: 1, points: 1, combo: 3, relit: true } as GameEvent);
    listen({ type: 'wordKilled', word, msToKill: 1, points: 1, combo: 4, relit: false } as GameEvent);
    expect(player.relit).toHaveBeenCalledWith(3);
    expect(player.kill).toHaveBeenCalledWith(4);
  });

  it('ignores every other event and never touches the React-owned voices', () => {
    const player = fakePlayer();
    const listen = attachSfx(player);
    listen({ type: 'bufferChanged', kana: '', romaji: '', lockedIds: [] } as GameEvent);
    listen({ type: 'waveStarting', wave: 1, cards: [], newCards: [] } as GameEvent);
    listen({ type: 'resumed', wave: 1 } as GameEvent);
    expect(player.kill).not.toHaveBeenCalled();
    expect(player.ceremonyChime).not.toHaveBeenCalled();
    expect(player.tierFanfare).not.toHaveBeenCalled();
  });
});
