// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REVENGE_CONFIG } from '../../engine/constants';
import type { Card, EngineSnapshot } from '../../engine/types';
import type { RunOptions } from '../useEngine';

const start = vi.fn();
const resume = vi.fn();
let mockSnapshot: EngineSnapshot;
// Same mock shape as App.replayPlan.test.tsx; nothing here reaches
// 'waveIntro', so it stays [].
let mockIntroCards: Card[] = [];

vi.mock('../useEngine', () => ({
  useEngine: () => (
    { snapshot: mockSnapshot, hostRef: { current: null }, start, resume, introCards: mockIntroCards }
  ),
  isGameKey: () => false,
}));

import App from '../../App';

const card = (id: string): Card => ({
  id, kanji: '字', kana: ['かな'], gloss: 'g', pos: 'n', jlpt: 5, source: 'jlpt', tier: 1,
});

const snap = (over: Partial<EngineSnapshot>): EngineSnapshot => ({
  status: 'playing', mode: 'reading', score: 0, lives: 3, wave: 1, combo: 0,
  kills: 0, wrongSubmits: 0, maxCombo: 0, bufferKana: '', bufferRomaji: '',
  lockedIds: [], missed: [], timeMs: 0, maxWaves: 0, cleared: false, ...over,
});

function stubFetch(
  pool: Card[],
  plan: {
    newCardIds: string[];
    seenCards: { id: string; weight: number; owned?: boolean }[];
    tiers: {
      level: number;
      index: number | null;
      totalTiers: number;
      size: number;
      solid: number;
      amnestied: number;
      unreachable: number;
    }[];
    runBudget: number;
  },
  // planFails: the plan endpoint rejects, so fetchRunPlan returns null and the
  // run starts with no plan at all (spec §7: the server being down never
  // blocks play).
  options: { planFails?: boolean } = {},
) {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const u = String(url);
    if (u.includes('/api/plan')) {
      if (options.planFails) return Promise.reject(new Error('plan endpoint down'));
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(plan) } as Response);
    }
    if (u.includes('/data/jlpt-')) {
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ listVersion: 'v1', level: 5, cards: pool }),
      } as Response);
    }
    // createRun/events/finalize aren't under test here; RunRecorder catches
    // any failure and queues to the outbox, so rejecting is safe.
    return Promise.reject(new Error(`unhandled fetch in test: ${u}`));
  }));
}

beforeEach(() => {
  start.mockClear();
  resume.mockClear();
  mockIntroCards = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * A revenge run is capped at five waves (revenge cap, plan 2026-10-31); a
 * normal run stays endless. The cap travels as the `config` App hands
 * `start()`, so these tests drive the real App wiring (mocking only
 * useEngine, as App.replayPlan.test.tsx does) and read that option off each
 * start() call: undefined for a fresh run and its play again, REVENGE_CONFIG
 * for a revenge run and for play again from a revenge results screen.
 */
describe('App passes REVENGE_CONFIG to revenge runs only', () => {
  it('fresh run: no config; revenge: REVENGE_CONFIG; play again after revenge: REVENGE_CONFIG', async () => {
    const pool = [card('a'), card('b'), card('c')];
    window.history.pushState({}, '', '/?mode=reading&pool=n5');
    stubFetch(pool, { newCardIds: [], seenCards: pool.map((c) => ({ id: c.id, weight: 1 })), tiers: [], runBudget: 0 });
    mockSnapshot = snap({ status: 'playing' });
    const { rerender } = render(<App />);
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect((start.mock.calls[0][0] as RunOptions).config).toBeUndefined();

    mockSnapshot = snap({ status: 'gameOver', missed: [pool[0], pool[1]] });
    rerender(<App />);
    await userEvent.click(await screen.findByTestId('revenge-button'));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
    const revenge = start.mock.calls[1][0] as RunOptions;
    expect(revenge.config).toEqual(REVENGE_CONFIG);
    expect(revenge.cards.map((c) => c.id)).toEqual(['a', 'b']);

    mockSnapshot = snap({ status: 'gameOver', cleared: true, maxWaves: 5, missed: [] });
    rerender(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /play again/i }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(3));
    expect((start.mock.calls[2][0] as RunOptions).config).toEqual(REVENGE_CONFIG);
  });

  it('play again from a normal run stays endless: no config (Review Focus 4)', async () => {
    const pool = [card('a'), card('b')];
    window.history.pushState({}, '', '/?mode=reading&pool=n5');
    stubFetch(pool, { newCardIds: [], seenCards: pool.map((c) => ({ id: c.id, weight: 1 })), tiers: [], runBudget: 0 });
    mockSnapshot = snap({ status: 'playing' });
    const { rerender } = render(<App />);
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    mockSnapshot = snap({ status: 'gameOver', missed: [] });
    rerender(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /play again/i }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
    expect((start.mock.calls[1][0] as RunOptions).config).toBeUndefined();
  });
});
