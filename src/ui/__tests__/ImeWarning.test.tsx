// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImeWarning } from '../hud/ImeWarning';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const compose = () =>
  act(() => {
    window.dispatchEvent(new CompositionEvent('compositionstart'));
  });

describe('ImeWarning (main spec §7 row: IME intercepts keystrokes)', () => {
  it('is hidden until a composition event fires', () => {
    render(<ImeWarning />);
    expect(screen.queryByTestId('ime-warning')).toBeNull();
    compose();
    expect(screen.getByTestId('ime-warning')).toHaveTextContent(/Win\+Space/);
  });

  it('hides 4s after the last composition event, timer reset per event', () => {
    render(<ImeWarning />);
    compose();
    act(() => vi.advanceTimersByTime(3000));
    compose(); // reset
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByTestId('ime-warning')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1100));
    expect(screen.queryByTestId('ime-warning')).toBeNull();
  });
});
