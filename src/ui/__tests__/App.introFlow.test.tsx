// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Card, EngineSnapshot } from '../../engine/types';

const start = vi.fn();
const resume = vi.fn();
let mockSnapshot: EngineSnapshot;
let mockIntroCards: Card[];

// App only ever consumes the `useEngine` hook itself (not any other named
// export), so replace the whole module rather than spreading the real one
// via importOriginal: that would pull in the real PixiStage -> pixi.js,
// which probes canvas 2D context support at import time and logs a noisy
// (harmless but confusing) "not implemented" error under jsdom.
vi.mock('../useEngine', () => ({
  useEngine: () => ({
    snapshot: mockSnapshot,
    hostRef: { current: null },
    start,
    resume,
    introCards: mockIntroCards,
  }),
}));

import App from '../../App';

const card = (id: string): Card => ({
  id, kanji: '字', kana: ['かな'], gloss: 'g', pos: 'n', jlpt: 5, source: 'jlpt',
});

const snap = (over: Partial<EngineSnapshot>): EngineSnapshot => ({
  status: 'waveIntro', mode: 'reading', score: 0, lives: 3, wave: 1, combo: 0,
  kills: 0, wrongSubmits: 0, bufferKana: '', bufferRomaji: '',
  lockedIds: [], missed: [], timeMs: 0, ...over,
});

describe('App intro flow wiring', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    start.mockClear();
    resume.mockClear();
  });

  it('auto-skips the intro (resume called) when every intro card is already seen', async () => {
    mockIntroCards = [card('a')];
    mockSnapshot = snap({ status: 'waveIntro', wave: 1 });

    // Auto-start URL (spec §7 dev/e2e determinism): drives App past title/setup
    // straight into the game screen without any UI interaction.
    window.history.pushState({}, '', '/?mode=reading&pool=n5');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200,
      json: () => Promise.resolve({ listVersion: 'v', level: 5, cards: [card('a')] }),
    }));

    const { rerender } = render(<App />);

    // Auto-start resolves the load and flips to the game screen; wave 1's
    // intro shows card 'a' because seenIdsRef starts empty.
    await screen.findByTestId('wave-intro');
    expect(screen.getByTestId('wave-intro')).toHaveTextContent('かな');

    // Wave 1 ends: the engine leaves waveIntro for playing. App's
    // status-transition effect marks every current introCard (card 'a') seen.
    mockSnapshot = snap({ status: 'playing', wave: 1 });
    rerender(<App />);

    // Wave 2 spawns and reintroduces the SAME card. It is already seen, so
    // App must pass an empty unseen list to the overlay; WaveIntroOverlay's
    // own empty-cards effect then auto-dismisses (calls resume()) with no
    // overlay ever shown — this is also the revenge-skip semantics.
    mockSnapshot = snap({ status: 'waveIntro', wave: 2 });
    rerender(<App />);

    expect(resume).toHaveBeenCalled();
    expect(screen.queryByTestId('wave-intro')).toBeNull();
  });
});
