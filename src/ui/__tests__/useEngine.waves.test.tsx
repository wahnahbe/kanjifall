// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card, EnginePlan } from '../../engine/types';

vi.mock('../../render/PixiStage', () => ({
  PixiStage: {
    create: vi.fn().mockResolvedValue({
      sync: vi.fn(), playKill: vi.fn(), playMiss: vi.fn(), playWaveClear: vi.fn(), destroy: vi.fn(),
    }),
  },
}));

import { useEngine } from '../useEngine';

const cards: Card[] = [
  { id: 'neko', kanji: '猫', kana: ['ねこ'], gloss: 'cat', pos: 'n', jlpt: 5, source: 'jlpt' },
  { id: 'inu', kanji: '犬', kana: ['いぬ'], gloss: 'dog', pos: 'n', jlpt: 5, source: 'jlpt' },
];

const FAST = {
  baseWaveSize: 1, waveSizeGrowth: 0, maxWaveSize: 1, maxAirborne: 2,
  baseFallSpeed: 0.01, baseSpawnIntervalMs: 50, minSpawnIntervalMs: 10,
  interWaveDelayMs: 50,
};

// Both cards flagged new with budget/cap enough for one per wave: introCards
// (sourced from waveStarting.newCards, not all wave cards) has length 1 at
// wave 1 AND wave 2, which is what this test actually needs to observe.
const PLAN: EnginePlan = { newCardIds: ['neko', 'inu'], seenCards: [], runBudget: 2, perWaveNewCap: 2 };

const pressKeys = (keys: string[]) => {
  for (const key of keys) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  }
};

describe('useEngine wave transitions (the wave-2 intro seam)', () => {
  beforeEach(() => vi.useRealTimers());
  afterEach(() => vi.restoreAllMocks());

  it('publishes waveIntro with introCards at wave 1 AND wave 2', async () => {
    const host = document.createElement('div');
    const { result } = renderHook(() => useEngine());
    (result.current.hostRef as { current: HTMLDivElement | null }).current = host;

    act(() => {
      result.current.start({ mode: 'reading', cards, seed: 1, config: FAST, plan: PLAN });
    });

    await waitFor(() => expect(result.current.snapshot.status).toBe('waveIntro'), { timeout: 3000 });
    expect(result.current.snapshot.wave).toBe(1);
    expect(result.current.introCards).toHaveLength(1);
    const firstReading = result.current.introCards[0].kana[0];

    // useEngine no longer forwards keys to the engine during waveIntro (the
    // ceremony owns that seam); in production AcquisitionCeremony's
    // onComplete calls resume() once every new card has had its turn, so
    // simulate that directly rather than pressing Enter.
    act(() => { result.current.resume(); });
    await waitFor(() => expect(result.current.snapshot.status).toBe('playing'), { timeout: 3000 });

    // Kill the wave's single word once it spawns, typed via real key events.
    const romaji = firstReading === 'ねこ' ? 'neko' : 'inu';
    await waitFor(() => {
      act(() => pressKeys([...romaji, 'Enter']));
      expect(result.current.snapshot.kills).toBe(1);
    }, { timeout: 4000 });

    // Wave 2 must republish waveIntro with its own cards — the seam the Critical hid.
    await waitFor(() => {
      expect(result.current.snapshot.status).toBe('waveIntro');
      expect(result.current.snapshot.wave).toBe(2);
    }, { timeout: 4000 });
    expect(result.current.introCards).toHaveLength(1);
  });
});
