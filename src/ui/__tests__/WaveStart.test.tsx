// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSettingsCache, updateSettings } from '../../data/settings';
import { MOTION } from '../../design/motion';
import { WaveStart } from '../WaveStart';

describe('WaveStart (second-pass spec §4.5)', () => {
  beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); resetSettingsCache(); });
  afterEach(() => { vi.useRealTimers(); localStorage.clear(); resetSettingsCache(); });

  it('shows the wave number at centre and calls onDone exactly once after --duration-beat', () => {
    const onDone = vi.fn();
    render(<WaveStart wave={3} onDone={onDone} />);
    expect(screen.getByTestId('wave-start')).toHaveTextContent('第3波');
    expect(screen.getByTestId('wave-start').dataset.beat).toBe('centre');
    act(() => vi.advanceTimersByTime(MOTION.beatMs - 1));
    expect(onDone).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDone).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(MOTION.beatMs));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('at reduced it fades at centre with no light sweep', () => {
    updateSettings({ effects: 'reduced' });
    render(<WaveStart wave={2} onDone={() => {}} />);
    expect(screen.getByTestId('wave-start').dataset.beat).toBe('fade');
  });

  it('at off the number is state only: nothing renders and onDone fires at once', () => {
    updateSettings({ effects: 'off' });
    const onDone = vi.fn();
    render(<WaveStart wave={2} onDone={onDone} />);
    expect(screen.queryByTestId('wave-start')).toBeNull();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('does not fire after unmount', () => {
    const onDone = vi.fn();
    const { unmount } = render(<WaveStart wave={1} onDone={onDone} />);
    unmount();
    act(() => vi.advanceTimersByTime(MOTION.beatMs * 2));
    expect(onDone).not.toHaveBeenCalled();
  });
});
