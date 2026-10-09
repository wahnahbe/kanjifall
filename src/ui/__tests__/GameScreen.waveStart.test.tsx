// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSettingsCache } from '../../data/settings';
import { MOTION } from '../../design/motion';
import type { Card, EngineSnapshot } from '../../engine/types';
import { GameScreen } from '../screens/GameScreen';

const base: EngineSnapshot = {
  status: 'waveIntro', mode: 'reading', score: 0, lives: 3, wave: 2, combo: 0, maxCombo: 0,
  kills: 0, wrongSubmits: 0, bufferKana: '', bufferRomaji: '', lockedIds: [], missed: [], timeMs: 0,
};
const neko: Card = { id: 'neko', kanji: '猫', kana: ['ねこ'], gloss: 'cat', pos: 'n', jlpt: 5, source: 'jlpt' };
const inu: Card = { id: 'inu', kanji: '犬', kana: ['いぬ'], gloss: 'dog', pos: 'n', jlpt: 5, source: 'jlpt' };

function introScreen(introCards: Card[], onIntroComplete: () => void, snapshot = base) {
  return (
    <GameScreen
      snapshot={snapshot} hostRef={{ current: null }} introCards={introCards} planNotice={null} tierAdvance={null}
      onIntroduced={() => {}} onIntroComplete={onIntroComplete} onRevenge={() => {}} onPlayAgain={() => {}} onTitle={() => {}}
    />
  );
}

function renderIntro(introCards: Card[], onIntroComplete: () => void, snapshot = base) {
  return render(introScreen(introCards, onIntroComplete, snapshot));
}

describe('GameScreen: ceremony, then the beat, then resume (second-pass spec §4.5 as amended)', () => {
  beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); resetSettingsCache(); });
  afterEach(() => { vi.useRealTimers(); localStorage.clear(); resetSettingsCache(); });

  it('a wave with no new cards still gets exactly one beat before resume (Review Focus 2)', () => {
    const resume = vi.fn();
    renderIntro([], resume);
    expect(screen.queryByTestId('ceremony')).toBeNull(); // empty ceremony completes on mount
    expect(screen.getByTestId('wave-start')).toHaveTextContent('第2波');
    expect(resume).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(MOTION.beatMs));
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('with new cards, the ceremony shows first and the beat only after it completes', () => {
    const resume = vi.fn();
    renderIntro([neko], resume);
    expect(screen.getByTestId('ceremony')).toBeInTheDocument();
    expect(screen.queryByTestId('wave-start')).toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); // skip counts as introduced
    });
    expect(screen.queryByTestId('ceremony')).toBeNull();
    expect(screen.getByTestId('wave-start')).toBeInTheDocument();
    expect(resume).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(MOTION.beatMs));
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('resets to the ceremony for the next pause: wave 3 gets its own ceremony and its own beat', () => {
    const resume = vi.fn();
    const { rerender } = renderIntro([neko], resume);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    act(() => vi.advanceTimersByTime(MOTION.beatMs));
    expect(resume).toHaveBeenCalledTimes(1);

    // The engine resumed: play, then the next wave pauses again.
    rerender(introScreen([neko], resume, { ...base, status: 'playing' }));
    rerender(introScreen([inu], resume, { ...base, status: 'waveIntro', wave: 3 }));
    expect(screen.getByTestId('ceremony')).toBeInTheDocument();
    expect(screen.queryByTestId('wave-start')).toBeNull();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(screen.queryByTestId('ceremony')).toBeNull();
    expect(screen.getByTestId('wave-start')).toHaveTextContent('第3波');
    expect(resume).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(MOTION.beatMs));
    expect(resume).toHaveBeenCalledTimes(2);
  });

  it('hides the HUD wave label during the intro and shows it while playing', () => {
    const { rerender } = renderIntro([], () => {});
    expect(screen.getByTestId('wave').closest('.hud-wave')?.className).toContain('hud-wave-hidden');
    rerender(
      <GameScreen
        snapshot={{ ...base, status: 'playing' }} hostRef={{ current: null }} introCards={[]} planNotice={null} tierAdvance={null}
        onIntroduced={() => {}} onIntroComplete={() => {}} onRevenge={() => {}} onPlayAgain={() => {}} onTitle={() => {}}
      />,
    );
    expect(screen.getByTestId('wave').closest('.hud-wave')?.className).not.toContain('hud-wave-hidden');
    expect(screen.queryByTestId('wave-start')).toBeNull();
  });
});
