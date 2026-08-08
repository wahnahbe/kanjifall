// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineSnapshot } from '../../engine/types';

const start = vi.fn();
const resume = vi.fn();
let mockSnapshot: EngineSnapshot;

vi.mock('../useEngine', () => ({
  useEngine: () => ({ snapshot: mockSnapshot, hostRef: { current: null }, start, resume, introCards: [] }),
  isGameKey: () => false,
}));

import App from '../../App';

const snap = (over: Partial<EngineSnapshot>): EngineSnapshot => ({
  status: 'playing', mode: 'reading', score: 0, lives: 3, wave: 1, combo: 0,
  kills: 0, wrongSubmits: 0, maxCombo: 0, bufferKana: '', bufferRomaji: '',
  lockedIds: [], missed: [], timeMs: 0, ...over,
});

beforeEach(() => {
  start.mockClear();
  mockSnapshot = snap({});
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('App list pools', () => {
  it('blocks reading mode on an all-kana list with the plain message', async () => {
    window.history.pushState({}, '', '/?mode=reading&pool=list:3');
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const u = String(url);
      if (u === '/api/lists/3/cards') {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({
            list: { id: 3, name: 'kana-only', updatedAt: 5 },
            customCards: [{
              id: 'custom-abcdefabcdef', kanji: null, kana: ['ぺけ'], gloss: 'x',
              pos: 'unclassified', jlpt: null, source: 'custom',
            }],
            jlptCardIds: [],
          }),
        } as Response);
      }
      if (u.includes('/api/plan')) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ newCardIds: [], seenCards: [], runBudget: 0, tiers: [] }),
        } as Response);
      }
      // loadListPool hydrates jlptCardIds against the four static level
      // files UNCONDITIONALLY (src/data/loader.ts) — even though this
      // list's jlptCardIds is empty, it still fetches all four before that
      // becomes apparent, same as `mixed` always pays that cost. One dummy
      // payload for all four, same shortcut App.replayPlan.test.tsx and
      // App.tierAdvance.test.tsx already take — nothing here is ever
      // actually hydrated into the pool.
      if (u.includes('/data/jlpt-')) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({
            listVersion: 'v1', level: 5,
            cards: [{ id: 'jlpt-dummy', kanji: '字', kana: ['じ'], gloss: 'x', pos: 'n', jlpt: 5, tier: 1, source: 'jlpt' }],
          }),
        } as Response);
      }
      return Promise.reject(new Error(`unhandled fetch: ${u}`));
    }));
    render(<App />);
    // App renders Title first; the auto-run effect drives beginFromPool in
    // the background, whose reading-guard error path sets loadError but
    // never touches `screen` (beginRun, the only setScreen('game') caller
    // on this path, is never reached — the guard `return`s before it). So
    // the auto-run's failure leaves screen === 'title', and load-error only
    // ever renders inside SetupScreen — the test must navigate there itself
    // via Start, same as a player would, before the message becomes
    // observable. The load-bearing assertions are unaffected by exactly
    // when that navigation happens relative to the fetch settling: pool
    // stays 'list:3' regardless of clicking through Title before or after
    // the background fetch resolves.
    await userEvent.click(screen.getByTestId('start-button'));
    await waitFor(() =>
      expect(screen.getByTestId('load-error')).toHaveTextContent(/no kanji words/i));
    expect(start).not.toHaveBeenCalled();
  });
});
