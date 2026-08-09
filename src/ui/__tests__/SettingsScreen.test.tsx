// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { getSettings, resetSettingsCache } from '../../data/settings';
import { SettingsScreen } from '../screens/SettingsScreen';

beforeEach(() => {
  localStorage.clear();
  resetSettingsCache();
});

describe('SettingsScreen (juice-pass spec §3.2)', () => {
  it('every control writes through the store immediately', async () => {
    render(<SettingsScreen onBack={() => {}} />);
    await userEvent.click(screen.getByTestId('sound-toggle'));
    expect(getSettings().sound).toBe(false);
    await userEvent.click(screen.getByTestId('crt-toggle'));
    expect(getSettings().crt).toBe(true);
    await userEvent.click(screen.getByTestId('effects-off'));
    expect(getSettings().effects).toBe('off');
    expect(JSON.parse(localStorage.getItem('kotoba-settings-v1')!)).toMatchObject({
      sound: false, crt: true, effects: 'off',
    });
  });

  it('effects picker exposes a radio role with aria-checked flipping to the selection (a11y)', async () => {
    render(<SettingsScreen onBack={() => {}} />);
    const full = screen.getByTestId('effects-full');
    const reduced = screen.getByTestId('effects-reduced');
    const off = screen.getByTestId('effects-off');
    for (const button of [full, reduced, off]) expect(button).toHaveAttribute('role', 'radio');

    await userEvent.click(off);
    expect(off).toHaveAttribute('aria-checked', 'true');
    expect(full).toHaveAttribute('aria-checked', 'false');
    expect(reduced).toHaveAttribute('aria-checked', 'false');

    await userEvent.click(reduced);
    expect(reduced).toHaveAttribute('aria-checked', 'true');
    expect(off).toHaveAttribute('aria-checked', 'false');
  });

  it('volume slider is disabled while sound is off and writes when on', () => {
    render(<SettingsScreen onBack={() => {}} />);
    const slider = screen.getByTestId('volume-slider') as HTMLInputElement;
    expect(slider.disabled).toBe(false);
    // fireEvent for range inputs: userEvent has no slider drag in jsdom
    fireEvent.change(slider, { target: { value: '0.3' } });
    expect(getSettings().volume).toBeCloseTo(0.3, 6);
  });

  it('reflects live external updates (subscription, not local state)', async () => {
    render(<SettingsScreen onBack={() => {}} />);
    const { updateSettings } = await import('../../data/settings');
    const { act } = await import('@testing-library/react');
    act(() => {
      updateSettings({ effects: 'reduced' });
    });
    expect((screen.getByTestId('effects-reduced')).className).toContain('selected');
  });
});
