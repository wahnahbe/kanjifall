// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Card, EngineSnapshot } from '../../engine/types';

const start = vi.fn();
const resume = vi.fn();
let mockSnapshot: EngineSnapshot;
let mockIntroCards: Card[];

vi.mock('../useEngine', () => ({
  useEngine: () => ({ snapshot: mockSnapshot, hostRef: { current: null }, start, resume, introCards: mockIntroCards }),
  isGameKey: () => false,
}));

import App from '../../App';

const card = (id: string): Card => ({
  id, kanji: '字', kana: ['かな'], gloss: 'g', pos: 'n', jlpt: 5, source: 'jlpt',
});

const snap = (over: Partial<EngineSnapshot>): EngineSnapshot => ({
  status: 'waveIntro', mode: 'reading', score: 0, lives: 3, wave: 1, combo: 0,
  kills: 0, wrongSubmits: 0, maxCombo: 0, bufferKana: '', bufferRomaji: '',
  lockedIds: [], missed: [], timeMs: 0, ...over,
});

describe('App plan wiring', () => {
  it('shows the server-absent notice and completes an empty ceremony without blocking play', async () => {
    window.history.pushState({}, '', '/?mode=reading&pool=n5');
    // A failed /api/plan fetch means fetchRunPlan resolves null, and the real
    // engine/Spawner turn a null plan into an empty newCards on every wave
    // (see useEngine.waves.test.tsx and waveIntroSeam.test.tsx, which drive
    // the real hook) — so the only introCards value that can genuinely
    // co-occur with a failed fetch is empty. Anything else, with useEngine
    // mocked, would just be GameScreen rendering whatever it's handed —
    // proving nothing about the plan-fetch-failure path specifically.
    mockIntroCards = [];
    mockSnapshot = snap({});
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        String(url).includes('/api/plan')
          ? Promise.reject(new Error('offline'))
          : Promise.resolve({
              ok: true, status: 200,
              json: () => Promise.resolve({ listVersion: 'v', level: 5, cards: [card('a')] }),
            } as Response),
      ),
    );

    const { rerender } = render(<App />);

    // Nothing to introduce: the real AcquisitionCeremony (not mocked) never
    // renders for an empty card list, and its onComplete (wired to resume)
    // fires immediately — proving App's wiring doesn't get stuck behind an
    // empty ceremony when the plan is unavailable.
    expect(screen.queryByTestId('ceremony')).toBeNull();
    // Awaited, not a bare expect: setPlanNotice and setScreen batch into one
    // commit, so the notice above lands together with the ceremony's mount —
    // but onComplete runs in that commit's passive effects, which React
    // schedules as a setImmediate, while waitFor only hands back after a
    // setTimeout(0). Node's timers phase beats its check phase whenever ~1ms
    // of jitter intervenes, so a bare expect read resume one task too early
    // and failed ~1 run in 12.
    await waitFor(() => expect(resume).toHaveBeenCalled());

    // GameScreen gates plan-notice on status === 'playing' (it must not sit
    // under the ceremony/results overlays — see GameScreen.planNotice.test.tsx
    // for that contract directly). useEngine is fully mocked here, so the
    // real engine never actually flips this; we simulate the transition
    // resume() would have driven, to prove the notice is what a player
    // reaches once play resumes, not merely present somewhere in the tree.
    mockSnapshot = snap({ status: 'playing' });
    rerender(<App />);
    await waitFor(() => expect(screen.getByTestId('plan-notice')).toHaveTextContent(/need the server/i));

    vi.unstubAllGlobals();
  });
});
