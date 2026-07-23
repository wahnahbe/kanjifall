// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Card } from '../../engine/types';
import { WaveIntroOverlay } from '../screens/WaveIntroOverlay';

const card = (id: string, kanji: string | null, kana: string, gloss: string): Card => ({
  id, kanji, kana: [kana], gloss, pos: 'n', jlpt: 5, source: 'jlpt',
});

describe('WaveIntroOverlay', () => {
  it('renders one row per new word with kanji, reading, and meaning', () => {
    render(
      <WaveIntroOverlay
        cards={[card('a', '猫', 'ねこ', 'cat'), card('b', null, 'それ', 'that')]}
        wave={2}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByTestId('wave-intro')).toHaveTextContent('猫');
    expect(screen.getByTestId('wave-intro')).toHaveTextContent('ねこ');
    expect(screen.getByTestId('wave-intro')).toHaveTextContent('cat');
    expect(screen.getByTestId('wave-intro')).toHaveTextContent('それ');
    expect(screen.getAllByRole('row')).toHaveLength(2);
  });

  it('auto-dismisses when there are no new words', () => {
    const onDismiss = vi.fn();
    render(<WaveIntroOverlay cards={[]} wave={3} onDismiss={onDismiss} />);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('wave-intro')).toBeNull();
  });
});
