// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card, EngineSnapshot } from '../../engine/types';
import { resetSettingsCache, updateSettings } from '../../data/settings';

vi.mock('../../audio/sfx', () => ({
  sfx: { tierFanfare: vi.fn(), ceremonyChime: vi.fn() },
}));
import { sfx } from '../../audio/sfx';
import { ResultsScreen } from '../screens/ResultsScreen';

const card = (id: string): Card => ({
  id, kanji: '字', kana: ['かな'], gloss: 'g', pos: 'n', jlpt: 5, source: 'jlpt',
});

const base: EngineSnapshot = {
  status: 'gameOver', mode: 'reading', score: 4200, lives: 0, wave: 5, combo: 0, maxCombo: 0,
  kills: 12, wrongSubmits: 2, bufferKana: '', bufferRomaji: '',
  lockedIds: [], missed: [card('m1'), card('m2'), card('m1')], timeMs: 0,
};

const snap = (over: Partial<EngineSnapshot> = {}): EngineSnapshot => ({ ...base, ...over });
const noop = () => {};

describe('ResultsScreen', () => {
  it('shows score, wave, and accuracy = kills/(kills+misses+wrongSubmits)', () => {
    render(
      <ResultsScreen
        snapshot={base} tierAdvance={null}
        onRevenge={() => {}} onPlayAgain={() => {}} onTitle={() => {}}
      />,
    );
    expect(screen.getByTestId('final-score')).toHaveTextContent('4200');
    // 12 / (12 + 3 + 2) = 70.5… → 71%
    expect(screen.getByTestId('accuracy')).toHaveTextContent('71%');
  });

  it('accuracy is 0% with no attempts', () => {
    render(
      <ResultsScreen
        snapshot={{ ...base, kills: 0, wrongSubmits: 0, missed: [] }}
        tierAdvance={null}
        onRevenge={() => {}} onPlayAgain={() => {}} onTitle={() => {}}
      />,
    );
    expect(screen.getByTestId('accuracy')).toHaveTextContent('0%');
  });

  it('revenge passes DEDUPED missed cards and is disabled when nothing was missed', async () => {
    const onRevenge = vi.fn();
    const { rerender } = render(
      <ResultsScreen
        snapshot={base} tierAdvance={null}
        onRevenge={onRevenge} onPlayAgain={() => {}} onTitle={() => {}}
      />,
    );
    await userEvent.click(screen.getByTestId('revenge-button'));
    expect(onRevenge).toHaveBeenCalledTimes(1);
    expect(onRevenge.mock.calls[0][0].map((c: Card) => c.id)).toEqual(['m1', 'm2']);

    rerender(
      <ResultsScreen
        snapshot={{ ...base, missed: [] }}
        tierAdvance={null}
        onRevenge={onRevenge} onPlayAgain={() => {}} onTitle={() => {}}
      />,
    );
    expect(screen.getByTestId('revenge-button')).toBeDisabled();
  });
});

describe('ResultsScreen tier-advance line (tiered spec §5.4, final-review Fix 2)', () => {
  it('renders the line when a tier advanced this run', () => {
    render(
      <ResultsScreen
        snapshot={base} tierAdvance="N5 tier 1 cleared — tier 2 is next."
        onRevenge={() => {}} onPlayAgain={() => {}} onTitle={() => {}}
      />,
    );
    expect(screen.getByTestId('tier-advance')).toHaveTextContent(
      'N5 tier 1 cleared — tier 2 is next.',
    );
  });

  it('is absent when nothing advanced', () => {
    render(
      <ResultsScreen
        snapshot={base} tierAdvance={null}
        onRevenge={() => {}} onPlayAgain={() => {}} onTitle={() => {}}
      />,
    );
    expect(screen.queryByTestId('tier-advance')).toBeNull();
  });
});

describe('tier celebration (juice-pass spec §6)', () => {
  beforeEach(() => {
    localStorage.clear();
    resetSettingsCache();
    vi.mocked(sfx.tierFanfare).mockClear();
  });

  it('full effects: banner + confetti render and the fanfare fires exactly once under StrictMode', () => {
    render(
      <StrictMode>
        <ResultsScreen snapshot={snap({ status: 'gameOver' })} tierAdvance="N5 tier 1 cleared — tier 2 is next."
          onRevenge={noop} onPlayAgain={noop} onTitle={noop} />
      </StrictMode>,
    );
    expect(screen.getByTestId('tier-celebration')).toBeInTheDocument();
    expect(screen.getByTestId('confetti')).toBeInTheDocument();
    expect(screen.getByTestId('tier-advance')).toHaveTextContent('tier 2 is next');
    expect(sfx.tierFanfare).toHaveBeenCalledTimes(1);
  });

  it('reduced effects: banner and fanfare, no confetti', () => {
    updateSettings({ effects: 'reduced' });
    render(<ResultsScreen snapshot={snap({ status: 'gameOver' })} tierAdvance="x"
      onRevenge={noop} onPlayAgain={noop} onTitle={noop} />);
    expect(screen.getByTestId('tier-celebration')).toBeInTheDocument();
    expect(screen.queryByTestId('confetti')).toBeNull();
    expect(sfx.tierFanfare).toHaveBeenCalledTimes(1);
  });

  it('effects off: the plain line only, still with its testid, no fanfare suppression by effects (sound handles that)', () => {
    updateSettings({ effects: 'off' });
    render(<ResultsScreen snapshot={snap({ status: 'gameOver' })} tierAdvance="x"
      onRevenge={noop} onPlayAgain={noop} onTitle={noop} />);
    expect(screen.queryByTestId('tier-celebration')).toBeNull();
    expect(screen.getByTestId('tier-advance')).toBeInTheDocument();
    expect(sfx.tierFanfare).toHaveBeenCalledTimes(1);
  });

  it('no tierAdvance: nothing renders, nothing plays', () => {
    render(<ResultsScreen snapshot={snap({ status: 'gameOver' })} tierAdvance={null}
      onRevenge={noop} onPlayAgain={noop} onTitle={noop} />);
    expect(screen.queryByTestId('tier-advance')).toBeNull();
    expect(sfx.tierFanfare).not.toHaveBeenCalled();
  });
});
