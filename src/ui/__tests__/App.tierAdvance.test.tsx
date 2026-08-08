// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card, EngineSnapshot } from '../../engine/types';

const start = vi.fn();
const resume = vi.fn();
let mockSnapshot: EngineSnapshot;

vi.mock('../useEngine', () => ({
  useEngine: () => (
    { snapshot: mockSnapshot, hostRef: { current: null }, start, resume, introCards: [] }
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

const TIER_BEFORE =
  [{ level: 5, index: 1, totalTiers: 64, size: 10, solid: 8, amnestied: 0, unreachable: 0 }];
const TIER_AFTER =
  [{ level: 5, index: 2, totalTiers: 64, size: 10, solid: 0, amnestied: 0, unreachable: 0 }];

/**
 * Distinguishes App's run-start plan fetch (beginFromPool, populating
 * lastTiersRef) from its post-gameOver re-fetch (the tierAdvance effect)
 * purely by call order, so the wiring is proven against the REAL effect —
 * not a hand-rolled stand-in for it. Same overall shape as the stubFetch
 * helper in App.replayPlan.test.tsx.
 */
function stubFetchWithTierProgression(pool: Card[]) {
  let planCalls = 0;
  const fetchMock = vi.fn((url: string) => {
    const u = String(url);
    if (u.includes('/api/plan')) {
      planCalls += 1;
      const tiers = planCalls === 1 ? TIER_BEFORE : TIER_AFTER;
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ newCardIds: [], seenCards: [], runBudget: 0, tiers }),
      } as Response);
    }
    if (u.includes('/data/jlpt-')) {
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ listVersion: 'v1', level: 5, cards: pool }),
      } as Response);
    }
    return Promise.reject(new Error(`unhandled fetch in test: ${u}`));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  start.mockClear();
  resume.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe('App tier-advance wiring (final-review Fix 2)', () => {
  it('shows the tier-advance line once the run-start and post-game tier snapshots differ', async () => {
    const pool = [card('a'), card('b')];
    window.history.pushState({}, '', '/?mode=reading&pool=n5');
    stubFetchWithTierProgression(pool);
    mockSnapshot = snap({ status: 'playing' });

    const { rerender } = render(<App />);
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));

    mockSnapshot = snap({ status: 'gameOver', missed: [] });
    rerender(<App />);

    await waitFor(() =>
      expect(screen.getByTestId('tier-advance')).toHaveTextContent(
        'N5 tier 1 cleared — tier 2 is next.',
      ),
    );
  });

  it('a revenge round never fetches for the tier-advance line (revenge is not a plannable pool)', async () => {
    const missedCard = card('missed-1');
    const pool = [missedCard, card('b')];
    window.history.pushState({}, '', '/?mode=reading&pool=n5');
    const fetchMock = stubFetchWithTierProgression(pool);
    mockSnapshot = snap({ status: 'playing' });

    const { rerender } = render(<App />);
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));

    mockSnapshot = snap({ status: 'gameOver', missed: [missedCard] });
    rerender(<App />);
    await waitFor(() =>
      expect(screen.getByTestId('tier-advance')).toHaveTextContent(
        'N5 tier 1 cleared — tier 2 is next.',
      ),
    );
    // Counts only /api/plan calls, not the total: beginRun also constructs a
    // RunRecorder, which fires its own (here-rejected, outbox-queued) run
    // creation request - a real, unrelated fetch this assertion must not
    // trip over.
    const planCalls = () =>
      fetchMock.mock.calls.filter(([url]) => String(url).includes('/api/plan')).length;
    const planCallsBeforeRevenge = planCalls();

    await userEvent.click(await screen.findByTestId('revenge-button'));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
    // beginRun resets tierAdvance synchronously - proven before simulating
    // the replay's own status transitions below.
    await waitFor(() => expect(screen.queryByTestId('tier-advance')).toBeNull());

    // Simulate the revenge run actually playing out: status must genuinely
    // CHANGE away from 'gameOver' and back, or the gameOver effect's
    // dependency array ([snapshot.status]) never re-fires at all (React
    // skips an effect whose deps are unchanged from the last run) - which
    // would make this test pass for the wrong reason (effect never tried)
    // rather than the right one (effect tried and the guard skipped it).
    mockSnapshot = snap({ status: 'playing' });
    rerender(<App />);
    mockSnapshot = snap({ status: 'gameOver', missed: [] });
    rerender(<App />);

    // Give the (skipped) effect a tick to prove it stays skipped, not just
    // pending: no new /api/plan call for the 'revenge' pool, so the line
    // stays null.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByTestId('tier-advance')).toBeNull();
    expect(planCalls()).toBe(planCallsBeforeRevenge);
  });
});
