// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSettingsCache, updateSettings } from '../../data/settings';
import { MOTION } from '../../design/motion';
import { ScreenTransition } from '../ScreenTransition';

describe('ScreenTransition (second-pass spec §4.4)', () => {
  beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); resetSettingsCache(); });
  afterEach(() => { vi.useRealTimers(); localStorage.clear(); resetSettingsCache(); });

  it('keeps the outgoing screen inert for the transition, then drops it', () => {
    const { rerender } = render(<ScreenTransition screenKey="title"><p>Title</p></ScreenTransition>);
    expect(screen.queryByTestId('screen-out')).toBeNull();
    rerender(<ScreenTransition screenKey="setup"><p>Setup</p></ScreenTransition>);
    const out = screen.getByTestId('screen-out');
    expect(out).toHaveTextContent('Title');
    expect(out).toHaveAttribute('inert');
    expect(out).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('screen-in')).toHaveTextContent('Setup');
    act(() => vi.advanceTimersByTime(MOTION.transitionMs));
    expect(screen.queryByTestId('screen-out')).toBeNull();
  });

  it('moves focus to the incoming screen at once, so the first keystroke lands there', () => {
    const { rerender } = render(<ScreenTransition screenKey="title"><p>Title</p></ScreenTransition>);
    document.body.focus();
    rerender(<ScreenTransition screenKey="game"><p>Game</p></ScreenTransition>);
    expect(document.activeElement).toBe(screen.getByTestId('screen-in'));
  });

  it('does not steal focus from a control the incoming screen already focused', () => {
    const { rerender } = render(<ScreenTransition screenKey="title"><p>Title</p></ScreenTransition>);
    rerender(<ScreenTransition screenKey="results"><button autoFocus>Play again</button></ScreenTransition>);
    expect(document.activeElement?.tagName).toBe('BUTTON');
  });

  it('two changes inside one transition keep only the most recent previous screen (Review Focus 3)', () => {
    const { rerender } = render(<ScreenTransition screenKey="title"><p>Title</p></ScreenTransition>);
    rerender(<ScreenTransition screenKey="setup"><p>Setup</p></ScreenTransition>);
    act(() => vi.advanceTimersByTime(100));
    rerender(<ScreenTransition screenKey="title"><p>Title again</p></ScreenTransition>);
    expect(screen.getAllByTestId('screen-out')).toHaveLength(1);
    expect(screen.getByTestId('screen-out')).toHaveTextContent('Setup');
    act(() => vi.advanceTimersByTime(MOTION.transitionMs - 1));
    expect(screen.queryByTestId('screen-out')).not.toBeNull(); // timer restarted at the second change
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId('screen-out')).toBeNull();
  });

  it('still drops the outgoing screen when the effects setting changes mid-drain', () => {
    const { rerender } = render(<ScreenTransition screenKey="title"><p>Title</p></ScreenTransition>);
    rerender(<ScreenTransition screenKey="setup"><p>Setup</p></ScreenTransition>);
    act(() => vi.advanceTimersByTime(100));
    act(() => { updateSettings({ effects: 'off' }); }); // transitionMs 360 → 120 while Title drains
    expect(screen.getByTestId('screen-out')).toHaveTextContent('Title');
    act(() => vi.advanceTimersByTime(MOTION.fastMs));
    expect(screen.queryByTestId('screen-out')).toBeNull();
  });

  it('keeps the draining screen instance mounted: its state survives the change, nothing remounts', () => {
    function Counter() {
      const [n, setN] = useState(0);
      return <button data-testid="counter" onClick={() => setN((v) => v + 1)}>{n}</button>;
    }
    const { rerender } = render(<ScreenTransition screenKey="a"><Counter /></ScreenTransition>);
    fireEvent.click(screen.getByTestId('counter'));
    fireEvent.click(screen.getByTestId('counter'));
    rerender(<ScreenTransition screenKey="b"><p>B</p></ScreenTransition>);
    // A remounted copy would start again at 0.
    expect(within(screen.getByTestId('screen-out')).getByTestId('counter')).toHaveTextContent('2');
  });

  it('coming back to a screen that is still draining mounts it fresh, with no key collision', () => {
    // A screen reads its initial props at mount (Setup's preselected list), so
    // a return trip inside the window must not revive the old instance's state.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    function Counter() {
      const [n, setN] = useState(0);
      return <button data-testid="counter" onClick={() => setN((v) => v + 1)}>{n}</button>;
    }
    const { rerender } = render(<ScreenTransition screenKey="a"><Counter /></ScreenTransition>);
    fireEvent.click(screen.getByTestId('counter'));
    rerender(<ScreenTransition screenKey="b"><p>B</p></ScreenTransition>);
    act(() => vi.advanceTimersByTime(100));
    rerender(<ScreenTransition screenKey="a"><Counter /></ScreenTransition>);
    expect(within(screen.getByTestId('screen-in')).getByTestId('counter')).toHaveTextContent('0');
    expect(screen.getAllByTestId('screen-out')).toHaveLength(1);
    expect(screen.getByTestId('screen-out')).toHaveTextContent('B');
    expect(errors).not.toHaveBeenCalled(); // React's duplicate-key warning goes through console.error
    errors.mockRestore();
  });

  it('is never a cut: at effects off it is a 120ms crossfade with no blur', () => {
    updateSettings({ effects: 'off' });
    render(<ScreenTransition screenKey="title"><p>Title</p></ScreenTransition>);
    const stack = screen.getByTestId('screen-in').parentElement as HTMLElement;
    expect(stack.style.getPropertyValue('--transition-ms')).toBe(`${MOTION.fastMs}ms`);
    expect(stack.style.getPropertyValue('--transition-blur')).toBe('0px');
    expect(stack.dataset.flicker).toBe('0');
  });
});
