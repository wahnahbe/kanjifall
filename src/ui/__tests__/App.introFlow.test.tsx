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
  it('shows the ceremony for the wave’s new cards, and the notice when the server is absent', async () => {
    window.history.pushState({}, '', '/?mode=reading&pool=n5');
    mockIntroCards = [card('a')];
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

    render(<App />);
    await screen.findByTestId('ceremony');
    await waitFor(() => expect(screen.getByTestId('plan-notice')).toHaveTextContent(/need the server/i));
    vi.unstubAllGlobals();
  });
});
