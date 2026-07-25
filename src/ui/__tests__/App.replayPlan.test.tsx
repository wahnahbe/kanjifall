// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../../engine/constants';
import { mulberry32 } from '../../engine/rng';
import { Spawner } from '../../engine/Spawner';
import type { Card, EnginePlan, EngineSnapshot } from '../../engine/types';

const start = vi.fn();
const resume = vi.fn();
let mockSnapshot: EngineSnapshot;

vi.mock('../useEngine', () => ({
  useEngine: () => ({ snapshot: mockSnapshot, hostRef: { current: null }, start, resume, introCards: [] }),
  isGameKey: () => false,
}));

import App from '../../App';

const card = (id: string): Card => ({
  id, kanji: '字', kana: ['かな'], gloss: 'g', pos: 'n', jlpt: 5, source: 'jlpt',
});

const snap = (over: Partial<EngineSnapshot>): EngineSnapshot => ({
  status: 'playing', mode: 'reading', score: 0, lives: 3, wave: 1, combo: 0,
  kills: 0, wrongSubmits: 0, maxCombo: 0, bufferKana: '', bufferRomaji: '',
  lockedIds: [], missed: [], timeMs: 0, ...over,
});

function stubFetch(pool: Card[], plan: { newCardIds: string[]; seenCardIds: string[]; runBudget: number }) {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const u = String(url);
    if (u.includes('/api/plan')) {
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
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * Once a card has an attempts row, the server classifies it as seen
 * PERMANENTLY - there is no un-see path (spec §4.2). So a card that spawns
 * without ever going through its acquisition ceremony has its ceremony
 * destroyed for good the moment it falls and is attempted.
 *
 * "Play again" replays the *entire loaded pool* (hundreds of cards in real
 * play) - most of which were never part of this run's plan. Spawner keys
 * its newPool/seenPool split entirely off `plan.newCardIds`
 * (src/engine/Spawner.ts): an empty (or absent) newCardIds list sends every
 * pool card to the seen pool, so a null plan makes Spawner treat a
 * genuinely-never-introduced card as fair game to draw.
 *
 * These tests drive the real App wiring (mocking only useEngine, exactly
 * like App.introFlow.test.tsx) plus the real Spawner - not a
 * reimplementation of either - so a failure here reflects the actual bug,
 * not a stand-in for it.
 */
describe('App replay wiring never lets an un-introduced card spawn', () => {
  it('onPlayAgain: replaying the whole pool keeps a never-introduced card out of every wave', async () => {
    const seenA = card('seen-a');
    const seenB = card('seen-b');
    const neverC = card('never-c'); // named in the plan's newCardIds; never drawn this run
    const pool = [seenA, seenB, neverC];

    window.history.pushState({}, '', '/?mode=reading&pool=n5');
    stubFetch(pool, { newCardIds: ['never-c'], seenCardIds: ['seen-a', 'seen-b'], runBudget: 1 });
    mockSnapshot = snap({ status: 'playing' });

    const { rerender } = render(<App />);
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));

    // Jump straight to the results screen and press Play again - onPlayAgain
    // only needs lastRunRef/lastPlanRef, both already populated by the
    // start() call above; no need to actually simulate a wave.
    mockSnapshot = snap({ status: 'gameOver', missed: [] });
    rerender(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /play again/i }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));

    // Feed exactly what App handed the engine into a real Spawner - the
    // same class GameEngine itself uses - so this proves actual spawn
    // behavior, not just the shape of the plan object App produced.
    const replayPlan = start.mock.calls[1]?.[0]?.plan as EnginePlan | undefined;
    const spawner = new Spawner(
      pool,
      mulberry32(1),
      DEFAULT_CONFIG,
      replayPlan ?? { newCardIds: [], runBudget: 0, perWaveNewCap: 0 },
    );
    expect(spawner.planWave(1).cards.map((c) => c.id)).not.toContain('never-c');
  });

  it('onRevenge: the same wiring holds even for a contrived missed-list containing a never-introduced card', async () => {
    const seenX = card('seen-x');
    const neverC = card('never-c');
    const pool = [seenX, neverC];

    window.history.pushState({}, '', '/?mode=reading&pool=n5');
    stubFetch(pool, { newCardIds: ['never-c'], seenCardIds: ['seen-x'], runBudget: 1 });
    mockSnapshot = snap({ status: 'playing' });

    const { rerender } = render(<App />);
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));

    // In real play, Revenge's cards are always previously-attempted misses,
    // so this exact input can't arise from legitimate gameplay - it stands
    // in for "some future caller hands onRevenge a card outside the plan's
    // seen set," proving the wiring itself enforces the invariant instead
    // of relying on Revenge's callers to always behave.
    mockSnapshot = snap({ status: 'gameOver', missed: [seenX, neverC] });
    rerender(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /revenge round/i }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));

    const replayPlan = start.mock.calls[1]?.[0]?.plan as EnginePlan | undefined;
    const spawner = new Spawner(
      pool,
      mulberry32(1),
      DEFAULT_CONFIG,
      replayPlan ?? { newCardIds: [], runBudget: 0, perWaveNewCap: 0 },
    );
    expect(spawner.planWave(1).cards.map((c) => c.id)).not.toContain('never-c');
  });
});
