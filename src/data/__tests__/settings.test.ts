// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultSettings, getSettings, resetSettingsCache, subscribeSettings, updateSettings,
} from '../settings';

beforeEach(() => {
  localStorage.clear();
  resetSettingsCache();
});
afterEach(() => vi.unstubAllGlobals());

describe('settings store', () => {
  it('defaults: sound on, volume 0.6, effects full (no reduced-motion), crt off', () => {
    expect(getSettings()).toEqual({ sound: true, volume: 0.6, effects: 'full', crt: false });
  });

  it('prefers-reduced-motion defaults effects to reduced', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    resetSettingsCache();
    expect(defaultSettings().effects).toBe('reduced');
    expect(getSettings().effects).toBe('reduced');
  });

  it('corrupt storage falls back to defaults without throwing', () => {
    localStorage.setItem('kotoba-settings-v1', '{not json');
    resetSettingsCache();
    expect(getSettings()).toEqual(defaultSettings());
    localStorage.setItem('kotoba-settings-v1', JSON.stringify({ volume: 9 }));
    resetSettingsCache();
    expect(getSettings()).toEqual(defaultSettings());
  });

  it('updateSettings writes through, persists, and notifies subscribers', () => {
    const seen = vi.fn();
    const unsubscribe = subscribeSettings(seen);
    updateSettings({ sound: false, volume: 0.2 });
    expect(getSettings().sound).toBe(false);
    expect(JSON.parse(localStorage.getItem('kotoba-settings-v1')!)).toMatchObject({
      sound: false, volume: 0.2,
    });
    expect(seen).toHaveBeenCalledTimes(1);
    unsubscribe();
    updateSettings({ crt: true });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it('a persisted value survives a cache reset (reload simulation)', () => {
    updateSettings({ effects: 'off' });
    resetSettingsCache();
    expect(getSettings().effects).toBe('off');
  });
});
