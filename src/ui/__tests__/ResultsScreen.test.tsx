// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Card, EngineSnapshot } from '../../engine/types';
import { ResultsScreen } from '../screens/ResultsScreen';

const card = (id: string): Card => ({
  id, kanji: '字', kana: ['かな'], gloss: 'g', pos: 'n', jlpt: 5, source: 'jlpt',
});

const base: EngineSnapshot = {
  status: 'gameOver', mode: 'reading', score: 4200, lives: 0, wave: 5, combo: 0,
  kills: 12, wrongSubmits: 2, bufferKana: '', bufferRomaji: '',
  lockedIds: [], missed: [card('m1'), card('m2'), card('m1')], timeMs: 0,
};

describe('ResultsScreen', () => {
  it('shows score, wave, and accuracy = kills/(kills+misses+wrongSubmits)', () => {
    render(<ResultsScreen snapshot={base} onRevenge={() => {}} onPlayAgain={() => {}} onTitle={() => {}} />);
    expect(screen.getByTestId('final-score')).toHaveTextContent('4200');
    // 12 / (12 + 3 + 2) = 70.5… → 71%
    expect(screen.getByTestId('accuracy')).toHaveTextContent('71%');
  });

  it('accuracy is 0% with no attempts', () => {
    render(
      <ResultsScreen
        snapshot={{ ...base, kills: 0, wrongSubmits: 0, missed: [] }}
        onRevenge={() => {}} onPlayAgain={() => {}} onTitle={() => {}}
      />,
    );
    expect(screen.getByTestId('accuracy')).toHaveTextContent('0%');
  });

  it('revenge passes DEDUPED missed cards and is disabled when nothing was missed', async () => {
    const onRevenge = vi.fn();
    const { rerender } = render(
      <ResultsScreen snapshot={base} onRevenge={onRevenge} onPlayAgain={() => {}} onTitle={() => {}} />,
    );
    await userEvent.click(screen.getByTestId('revenge-button'));
    expect(onRevenge).toHaveBeenCalledTimes(1);
    expect(onRevenge.mock.calls[0][0].map((c: Card) => c.id)).toEqual(['m1', 'm2']);

    rerender(
      <ResultsScreen
        snapshot={{ ...base, missed: [] }}
        onRevenge={onRevenge} onPlayAgain={() => {}} onTitle={() => {}}
      />,
    );
    expect(screen.getByTestId('revenge-button')).toBeDisabled();
  });
});
