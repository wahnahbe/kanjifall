// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Card } from '../../engine/types';
import { AcquisitionCeremony } from '../screens/AcquisitionCeremony';

const neko: Card = {
  id: 'neko', kanji: '猫', kana: ['ねこ'], gloss: 'cat', pos: 'n', jlpt: 5, source: 'jlpt',
  sentence: { ja: '猫が好きです。', en: 'I like cats.' },
  kanjiParts: [{ char: '猫', meaning: 'cat' }],
};
const sore: Card = {
  id: 'sore', kanji: null, kana: ['それ'], gloss: 'that', pos: 'pron', jlpt: 5, source: 'jlpt',
};

describe('AcquisitionCeremony', () => {
  it('renders the word with all of its hooks', () => {
    render(<AcquisitionCeremony cards={[neko]} onIntroduced={vi.fn()} onComplete={vi.fn()} />);
    const view = screen.getByTestId('ceremony');
    expect(view).toHaveTextContent('猫');
    expect(view).toHaveTextContent('ねこ');
    expect(view).toHaveTextContent('cat');
    expect(view).toHaveTextContent('猫が好きです。');
    expect(view).toHaveTextContent('I like cats.');
  });

  it('renders a card with no hooks without breaking', () => {
    render(<AcquisitionCeremony cards={[sore]} onIntroduced={vi.fn()} onComplete={vi.fn()} />);
    expect(screen.getByTestId('ceremony')).toHaveTextContent('それ');
    expect(screen.queryByTestId('ceremony-sentence')).toBeNull();
    expect(screen.queryByTestId('ceremony-parts')).toBeNull();
  });

  it('converts romaji to kana as you type', async () => {
    render(<AcquisitionCeremony cards={[neko]} onIntroduced={vi.fn()} onComplete={vi.fn()} />);
    await userEvent.keyboard('neko');
    expect(screen.getByTestId('ceremony-buffer')).toHaveTextContent('ねこ');
  });

  it('Enter accepts a correct reading and rejects an incorrect one', async () => {
    const onIntroduced = vi.fn();
    const onComplete = vi.fn();
    render(<AcquisitionCeremony cards={[neko]} onIntroduced={onIntroduced} onComplete={onComplete} />);

    await userEvent.keyboard('inu{Enter}');
    expect(onIntroduced).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByTestId('ceremony')).toHaveTextContent('猫');

    // A rejected Enter clears the buffer itself, so the correct reading can
    // be typed directly next — no Escape involved anywhere in this test.
    await userEvent.keyboard('neko{Enter}');
    expect(onIntroduced).toHaveBeenCalledTimes(1);
    expect(onIntroduced).toHaveBeenCalledWith('neko');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('Backspace clears the rejected state left by a wrong submission', async () => {
    render(<AcquisitionCeremony cards={[neko]} onIntroduced={vi.fn()} onComplete={vi.fn()} />);
    await userEvent.keyboard('inu{Enter}');
    expect(screen.getByTestId('ceremony-buffer')).toHaveClass('rejected');
    await userEvent.keyboard('{Backspace}');
    expect(screen.getByTestId('ceremony-buffer')).not.toHaveClass('rejected');
  });

  it('Escape skips the word, which still counts as introduced', async () => {
    const onIntroduced = vi.fn();
    const onComplete = vi.fn();
    render(<AcquisitionCeremony cards={[neko]} onIntroduced={onIntroduced} onComplete={onComplete} />);
    // Escape on an empty buffer skips the card entirely.
    await userEvent.keyboard('{Escape}');
    expect(onIntroduced).toHaveBeenCalledWith('neko');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('walks through several cards in order', async () => {
    const onIntroduced = vi.fn();
    const onComplete = vi.fn();
    render(
      <AcquisitionCeremony cards={[neko, sore]} onIntroduced={onIntroduced} onComplete={onComplete} />,
    );
    await userEvent.keyboard('neko{Enter}');
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByTestId('ceremony')).toHaveTextContent('それ');
    await userEvent.keyboard('sore{Enter}');
    expect(onIntroduced.mock.calls.map((c) => c[0])).toEqual(['neko', 'sore']);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('completes immediately when there is nothing new', () => {
    const onComplete = vi.fn();
    render(<AcquisitionCeremony cards={[]} onIntroduced={vi.fn()} onComplete={onComplete} />);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('ceremony')).toBeNull();
  });

  it('shows the required Tatoeba credit when a sentence is displayed', () => {
    render(<AcquisitionCeremony cards={[neko]} onIntroduced={vi.fn()} onComplete={vi.fn()} />);
    expect(screen.getByTestId('ceremony')).toHaveTextContent(/tatoeba/i);
  });

  it('removes its keydown listener on unmount', () => {
    const onIntroduced = vi.fn();
    const onComplete = vi.fn();
    const { unmount } = render(
      <AcquisitionCeremony cards={[neko]} onIntroduced={onIntroduced} onComplete={onComplete} />,
    );
    unmount();

    // If the listener were still attached, either of these would advance
    // (and thus call back) past the still-showing first card.
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(onIntroduced).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it('stays inert after the last card is done', async () => {
    const onIntroduced = vi.fn();
    const onComplete = vi.fn();
    render(<AcquisitionCeremony cards={[neko]} onIntroduced={onIntroduced} onComplete={onComplete} />);

    await userEvent.keyboard('neko{Enter}');
    expect(onIntroduced).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);

    // The ceremony is done and renders null; further keystrokes must be inert.
    await userEvent.keyboard('a{Enter}{Escape}');
    expect(onIntroduced).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});
