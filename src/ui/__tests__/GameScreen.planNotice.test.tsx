// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { EngineSnapshot } from '../../engine/types';
import { GameScreen } from '../screens/GameScreen';

const base: EngineSnapshot = {
  status: 'playing', mode: 'reading', score: 0, lives: 3, wave: 1, combo: 0, maxCombo: 0,
  kills: 0, wrongSubmits: 0, bufferKana: '', bufferRomaji: '',
  lockedIds: [], missed: [], timeMs: 0,
};

const noop = () => {};

/**
 * .plan-notice used to render unconditionally, so it sat beneath the
 * acquisition ceremony (waveIntro) and the results screen (gameOver) -
 * both are absolutely-positioned overlays declared later in GameScreen's
 * JSX, so they paint over it (src/index.css .overlay / .plan-notice, no
 * z-index on either — later DOM order wins the stacking tie). The notice
 * text was in the DOM but never actually visible to a player at those
 * times. Gating on status === 'playing' makes that explicit.
 */
describe('GameScreen plan-notice visibility', () => {
  it('renders while actually playing', () => {
    render(
      <GameScreen
        snapshot={base}
        hostRef={{ current: null }}
        introCards={[]}
        planNotice="a notice"
        onIntroduced={noop}
        onIntroComplete={noop}
        onRevenge={noop}
        onPlayAgain={noop}
        onTitle={noop}
      />,
    );
    expect(screen.getByTestId('plan-notice')).toHaveTextContent('a notice');
  });

  it('is absent under the acquisition ceremony overlay (waveIntro)', () => {
    render(
      <GameScreen
        snapshot={{ ...base, status: 'waveIntro' }}
        hostRef={{ current: null }}
        introCards={[]}
        planNotice="a notice"
        onIntroduced={noop}
        onIntroComplete={noop}
        onRevenge={noop}
        onPlayAgain={noop}
        onTitle={noop}
      />,
    );
    expect(screen.queryByTestId('plan-notice')).toBeNull();
  });

  it('is absent under the results overlay (gameOver)', () => {
    render(
      <GameScreen
        snapshot={{ ...base, status: 'gameOver' }}
        hostRef={{ current: null }}
        introCards={[]}
        planNotice="a notice"
        onIntroduced={noop}
        onIntroComplete={noop}
        onRevenge={noop}
        onPlayAgain={noop}
        onTitle={noop}
      />,
    );
    expect(screen.queryByTestId('plan-notice')).toBeNull();
  });

  it('renders nothing when there is no notice, regardless of status', () => {
    render(
      <GameScreen
        snapshot={base}
        hostRef={{ current: null }}
        introCards={[]}
        planNotice={null}
        onIntroduced={noop}
        onIntroComplete={noop}
        onRevenge={noop}
        onPlayAgain={noop}
        onTitle={noop}
      />,
    );
    expect(screen.queryByTestId('plan-notice')).toBeNull();
  });
});
