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
// Settable like App.introFlow.test.tsx, so the fresh-run-introduction test
// below can drive the real AcquisitionCeremony; unused (stays []) for the
// two never-introduced-card tests, which never reach 'waveIntro'.
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
  lockedIds: [], missed: [], timeMs: 0, ...over,
});

function stubFetch(
  pool: Card[],
  plan: {
    newCardIds: string[];
    seenCards: { id: string; weight: number }[];
    tiers: {
      level: number;
      index: number | null;
      totalTiers: number;
      size: number;
      solid: number;
      amnestied: number;
    }[];
    runBudget: number;
  },
) {
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
  mockIntroCards = [];
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
 * play) - most of which were never part of this run's plan. Spawner's seen
 * pool comes solely from `plan.seenCards` (src/engine/Spawner.ts,
 * tiered-vocab spec §5.3): a card in NEITHER `newCardIds` nor `seenCards` is
 * locked and can never spawn. So a replay's plan must restate the original
 * run's seenCards (App.tsx's replayPlan) - and union it with whatever this
 * run itself introduced (App.tsx's introducedIdsRef), or a first-ever run's
 * mid-run ceremonies are lost to a stale, pre-ceremony snapshot and every
 * card outside that union - including ones this run legitimately met -
 * is unreachable.
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
    stubFetch(pool, {
      newCardIds: ['never-c'],
      seenCards: [{ id: 'seen-a', weight: 1 }, { id: 'seen-b', weight: 1 }],
      tiers: [{ level: 5, index: 1, totalTiers: 1, size: 1, solid: 0, amnestied: 0 }],
      runBudget: 1,
    });
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
      replayPlan ?? { newCardIds: [], seenCards: [], runBudget: 0, perWaveNewCap: 0 },
    );
    expect(spawner.planWave(1).cards.map((c) => c.id)).not.toContain('never-c');
  });

  it('onRevenge: the same wiring holds even for a contrived missed-list containing a never-introduced card', async () => {
    const seenX = card('seen-x');
    const neverC = card('never-c');
    const pool = [seenX, neverC];

    window.history.pushState({}, '', '/?mode=reading&pool=n5');
    stubFetch(pool, {
      newCardIds: ['never-c'],
      seenCards: [{ id: 'seen-x', weight: 1 }],
      tiers: [{ level: 5, index: 1, totalTiers: 1, size: 1, solid: 0, amnestied: 0 }],
      runBudget: 1,
    });
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
      replayPlan ?? { newCardIds: [], seenCards: [], runBudget: 0, perWaveNewCap: 0 },
    );
    expect(spawner.planWave(1).cards.map((c) => c.id)).not.toContain('never-c');
  });

  /**
   * The M4-A fix above guards a run-start snapshot that predates the run.
   * But a genuinely first-ever run for a pool starts with `seenCards: []` -
   * if this run's OWN ceremonies (which happen after that snapshot was
   * taken) aren't folded in too, "Play again" replays with an empty seen
   * pool, the starved fallback draws uniformly from every newCardIds entry
   * (including cards this run never reached), and their ceremony is burned
   * the instant they fall and get an attempt (spec §4.2). This drives the
   * real AcquisitionCeremony (via a settable `introCards`, same technique as
   * App.introFlow.test.tsx) so the introduction reaches App's actual
   * `onIntroduced` handler, not a stand-in for it.
   */
  it('onPlayAgain: a card this run itself introduced is folded into the replay\'s seen pool, not just the run-start snapshot', async () => {
    const newA = card('new-a'); // this run's wave 1 introduces it via the ceremony
    const newB = card('new-b'); // named in the plan too, but this run never reaches it
    const pool = [newA, newB];

    window.history.pushState({}, '', '/?mode=reading&pool=n5');
    stubFetch(pool, {
      // A genuinely first-ever run for this pool: nothing met yet.
      newCardIds: ['new-a', 'new-b'],
      seenCards: [],
      tiers: [{ level: 5, index: 1, totalTiers: 1, size: 2, solid: 0, amnestied: 0 }],
      runBudget: 2,
    });
    // Simulate wave 1 pausing on its ceremony with new-a as the only card to
    // introduce - GameScreen mounts the real AcquisitionCeremony off this,
    // exactly like production wiring.
    mockSnapshot = snap({ status: 'waveIntro' });
    mockIntroCards = [newA];

    const { rerender } = render(<App />);
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));

    // Escape still counts as introduced (spec §3.1) - it drives the real
    // ceremony's real onIntroduced callback, which is what populates
    // App.tsx's introducedIdsRef.
    await screen.findByTestId('ceremony', {}, { timeout: 3000 });
    await userEvent.keyboard('{Escape}');
    // The ceremony's onComplete (wired to resume) fires once its one card is
    // done - proof the introduction went through App's real handler, not
    // just AcquisitionCeremony's own internal state.
    await waitFor(() => expect(resume).toHaveBeenCalled());

    // Jump to results and press Play again, exactly like the test above.
    mockSnapshot = snap({ status: 'gameOver', missed: [] });
    rerender(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /play again/i }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));

    const replayPlan = start.mock.calls[1]?.[0]?.plan as EnginePlan | undefined;
    // The run-start snapshot's seenCards was empty; only this run's actual
    // introduction should appear, at weight 1.
    expect(replayPlan?.seenCards).toEqual([{ id: 'new-a', weight: 1 }]);

    // Feed exactly what App handed the engine into a real Spawner, across
    // several waves: the introduced card must be drawable (not starved) and
    // new-b - never reached this run - must stay locked.
    const spawner = new Spawner(
      pool,
      mulberry32(1),
      DEFAULT_CONFIG,
      replayPlan ?? { newCardIds: [], seenCards: [], runBudget: 0, perWaveNewCap: 0 },
    );
    for (let w = 1; w <= 10; w++) {
      const wave = spawner.planWave(w);
      expect(wave.cards.length).toBeGreaterThan(0);
      for (const c of wave.cards) expect(c.id).toBe('new-a');
    }
  });
});
