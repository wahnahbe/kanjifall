import { describe, expect, it, vi } from 'vitest';
import type { GameEvent } from '../../engine/types';
import { attachSfx } from '../attachSfx';
import type { Sfx } from '../sfx';

function fakePlayer(): Sfx {
  return {
    kill: vi.fn(), miss: vi.fn(), wrongSubmit: vi.fn(), waveClear: vi.fn(),
    gameOver: vi.fn(), ceremonyChime: vi.fn(), tierFanfare: vi.fn(),
  } as unknown as Sfx;
}

const word = {} as never; // payloads the listener never reads

describe('attachSfx', () => {
  it('maps the five in-run events to their voices, combo included', () => {
    const player = fakePlayer();
    const listen = attachSfx(player);
    listen({ type: 'wordKilled', word, msToKill: 400, points: 10, combo: 7 } as GameEvent);
    listen({ type: 'wordMissed', word } as GameEvent);
    listen({ type: 'wrongSubmit', submittedKana: 'x' } as GameEvent);
    listen({ type: 'waveCleared', wave: 1 } as GameEvent);
    listen({ type: 'gameOver', score: 1, wave: 1 } as GameEvent);
    expect(player.kill).toHaveBeenCalledWith(7);
    expect(player.miss).toHaveBeenCalledTimes(1);
    expect(player.wrongSubmit).toHaveBeenCalledTimes(1);
    expect(player.waveClear).toHaveBeenCalledTimes(1);
    expect(player.gameOver).toHaveBeenCalledTimes(1);
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
