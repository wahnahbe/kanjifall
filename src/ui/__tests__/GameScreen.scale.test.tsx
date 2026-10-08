// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { EngineSnapshot } from '../../engine/types';
import { GameScreen } from '../screens/GameScreen';

const snapshot: EngineSnapshot = {
  status: 'playing', mode: 'reading', score: 0, lives: 3, wave: 1, combo: 0, maxCombo: 0,
  kills: 0, wrongSubmits: 0, bufferKana: '', bufferRomaji: '', lockedIds: [], missed: [], timeMs: 0,
};

function renderScreen() {
  return render(
    <GameScreen
      snapshot={snapshot} hostRef={{ current: null }} introCards={[]} planNotice={null} tierAdvance={null}
      onIntroduced={() => {}} onIntroComplete={() => {}} onRevenge={() => {}} onPlayAgain={() => {}} onTitle={() => {}}
    />,
  );
}

describe('GameScreen scale custom properties (second-pass spec §3.3)', () => {
  it('writes --size-word-play and --hud-scale from playScale on mount', () => {
    renderScreen();
    const root = screen.getByTestId('game-screen');
    expect(root.style.getPropertyValue('--size-word-play')).toBe('44px'); // jsdom: 0px tall → clamp floor
    expect(root.style.getPropertyValue('--hud-scale')).toBe('1.15');
  });

  it('rewrites them on window resize (Review Focus 1)', () => {
    renderScreen();
    const root = screen.getByTestId('game-screen');
    Object.defineProperty(root, 'clientHeight', { configurable: true, value: 1000 });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(root.style.getPropertyValue('--size-word-play')).toBe('72px'); // round(1000 × 0.0756) = 76, clamped to 72
  });
});
