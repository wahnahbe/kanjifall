// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineSnapshot } from '../../engine/types';

const idle: EngineSnapshot = {
  status: 'idle', mode: 'reading', score: 0, lives: 0, wave: 0, combo: 0, maxCombo: 0,
  kills: 0, wrongSubmits: 0, bufferKana: '', bufferRomaji: '', lockedIds: [], missed: [], timeMs: 0,
};
vi.mock('../useEngine', () => ({
  useEngine: () => ({ snapshot: idle, hostRef: { current: null }, start: vi.fn(), resume: vi.fn(), introCards: [] }),
  isGameKey: () => false,
}));

import App from '../../App';

describe('App mounts one atmosphere behind every screen (second-pass spec §3.1)', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve([]) }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is in the title scene at boot and the chooser scene after Start, with one atmosphere', async () => {
    render(<App />);
    expect(screen.getByTestId('atmosphere').dataset.scene).toBe('title');
    await userEvent.click(screen.getByTestId('start-button'));
    expect(screen.getByTestId('atmosphere').dataset.scene).toBe('chooser');
    expect(screen.getAllByTestId('atmosphere')).toHaveLength(1);
  });

  it('goes calm on Settings', async () => {
    render(<App />);
    await userEvent.click(screen.getByTestId('settings-button'));
    expect(screen.getByTestId('atmosphere').dataset.scene).toBe('calm');
  });
});
