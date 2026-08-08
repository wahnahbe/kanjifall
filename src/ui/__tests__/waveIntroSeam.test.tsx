// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RunRecorder } from '../../data/recorder';
import type { Card, EnginePlan } from '../../engine/types';
import { GameScreen } from '../screens/GameScreen';

vi.mock('../../render/PixiStage', () => ({
  PixiStage: {
    create: vi.fn().mockResolvedValue({
      sync: vi.fn(), playKill: vi.fn(), playMiss: vi.fn(), destroy: vi.fn(),
    }),
  },
}));

import { useEngine } from '../useEngine';

const neko: Card = { id: 'neko', kanji: '猫', kana: ['ねこ'], gloss: 'cat', pos: 'n', jlpt: 5, source: 'jlpt' };
const inu: Card = { id: 'inu', kanji: '犬', kana: ['いぬ'], gloss: 'dog', pos: 'n', jlpt: 5, source: 'jlpt' };
const CARDS = [neko, inu];

// Both cards flagged new, with budget/cap/wave-size all >= 2: wave 1
// introduces both, with newCards leading the wave's composition — the exact
// shape (Spawner) that exposes the Critical (an un-introduced word spawning
// first because its ceremony never got its turn).
const PLAN: EnginePlan = { newCardIds: ['neko', 'inu'], seenCards: [], runBudget: 2, perWaveNewCap: 2 };
const FAST = {
  baseWaveSize: 2, waveSizeGrowth: 0, maxWaveSize: 2, maxAirborne: 2,
  baseFallSpeed: 0.01, baseSpawnIntervalMs: 50, minSpawnIntervalMs: 10,
  interWaveDelayMs: 50,
};

/** Which of the two cards the ceremony is currently showing, read from its rendered kanji. */
function currentReading(): string {
  const text = screen.getByTestId('ceremony').textContent ?? '';
  if (text.includes('猫')) return 'ねこ';
  if (text.includes('犬')) return 'いぬ';
  throw new Error(`ceremony not showing a known card: ${text}`);
}

function romajiFor(kana: string): string {
  return kana === 'ねこ' ? 'neko' : 'inu';
}

/**
 * Real useEngine + real GameScreen (hence the real AcquisitionCeremony) + a
 * real RunRecorder, wired exactly as App.tsx wires them. Only PixiStage is
 * mocked (rendering is irrelevant here); the seam under test is two window
 * keydown listeners — useEngine's and the ceremony's — racing each other.
 */
function Harness() {
  const { snapshot, hostRef, start, resume, introCards } = useEngine();
  const recorderRef = useRef<RunRecorder | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const recorder = new RunRecorder({
      runId: 'seam-test', mode: 'reading', pool: 'n5', cards: CARDS, listVersion: 'v1',
    });
    recorderRef.current = recorder;
    start({
      mode: 'reading', cards: CARDS, seed: 1, config: FAST, plan: PLAN,
      onEvent: (event, view) => recorder.onEvent(event, view),
    });
  }, [start]);

  return (
    <GameScreen
      snapshot={snapshot}
      hostRef={hostRef}
      introCards={introCards}
      planNotice={null}
      tierAdvance={null}
      onIntroduced={(cardId) => recorderRef.current?.recordIntroduction(cardId)}
      onIntroComplete={resume}
      onRevenge={() => {}}
      onPlayAgain={() => {}}
      onTitle={() => {}}
    />
  );
}

describe('waveIntro seam: the ceremony, not the engine, owns Enter', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true, status: 200, json: () => Promise.resolve({}),
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('an incorrect Enter neither resumes the engine nor records anything; two correct readings introduce both cards; only after the second does the engine leave waveIntro', async () => {
    const recordSpy = vi.spyOn(RunRecorder.prototype, 'recordIntroduction');

    render(<Harness />);
    await screen.findByTestId('ceremony', {}, { timeout: 3000 });

    // --- card 1: wrong reading first ---
    const firstCard = currentReading();
    await userEvent.keyboard('xyz{Enter}');
    // Same card must still be showing: a wrong Enter must not have started
    // the wave (which would unmount the ceremony) nor advanced to card 2.
    expect(screen.getByTestId('ceremony')).toBeInTheDocument();
    expect(currentReading()).toBe(firstCard);
    expect(recordSpy).not.toHaveBeenCalled();

    // --- card 1: correct reading ---
    await userEvent.keyboard(`${romajiFor(firstCard)}{Enter}`);
    expect(recordSpy).toHaveBeenCalledTimes(1);
    expect(recordSpy).toHaveBeenCalledWith(romajiFor(firstCard) === 'neko' ? 'neko' : 'inu');

    // Critical regression check: introducing card 1 must NOT resume the
    // engine. The ceremony must still be mounted, now showing card 2 — if
    // the engine's own listener had already resumed (the bug), GameScreen's
    // `status === 'waveIntro'` gate would have unmounted the ceremony here,
    // and card 2 would never get its turn.
    expect(screen.getByTestId('ceremony')).toBeInTheDocument();
    const secondCard = currentReading();
    expect(secondCard).not.toBe(firstCard);

    // --- card 2: wrong reading first ---
    await userEvent.keyboard('xyz{Enter}');
    expect(recordSpy).toHaveBeenCalledTimes(1); // unchanged
    expect(screen.getByTestId('ceremony')).toBeInTheDocument(); // still showing card 2, not resumed

    // --- card 2: correct reading ---
    await userEvent.keyboard(`${romajiFor(secondCard)}{Enter}`);
    expect(recordSpy).toHaveBeenCalledTimes(2);
    expect(recordSpy).toHaveBeenNthCalledWith(2, romajiFor(secondCard) === 'neko' ? 'neko' : 'inu');

    // Only now, after both cards, does the engine leave waveIntro.
    await waitFor(() => expect(screen.queryByTestId('ceremony')).toBeNull());
  });
});
