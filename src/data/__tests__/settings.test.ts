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

  it('invalid partial rejected: out-of-range volume', () => {
    const spy = vi.spyOn(console, 'warn');
    updateSettings({ volume: 0.5 });
    const before = getSettings();
    const result = updateSettings({ volume: 5 });
    expect(result).toEqual(before);
    expect(JSON.parse(localStorage.getItem('kotoba-settings-v1')!)).toEqual(before);
    expect(spy).toHaveBeenCalledWith('[settings] rejected invalid update', { volume: 5 });
    spy.mockRestore();
  });

  it('storage write failure swallowed: updateSettings still updates and notifies', () => {
    const seen = vi.fn();
    subscribeSettings(seen);
    const originalSetItem = localStorage.setItem;
    localStorage.setItem = vi.fn(() => {
      throw new Error('quota exceeded');
    });
    const result = updateSettings({ crt: true });
    expect(result.crt).toBe(true);
    expect(getSettings().crt).toBe(true);
    expect(seen).toHaveBeenCalledTimes(1);
    localStorage.setItem = originalSetItem;
  });

  it('throwing subscriber does not starve the next: two subscribers, first throws', () => {
    const first = vi.fn(() => {
      throw new Error('first subscriber failed');
    });
    const second = vi.fn();
    const spyWarn = vi.spyOn(console, 'warn');
    subscribeSettings(first);
    subscribeSettings(second);
    updateSettings({ sound: false });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(spyWarn).toHaveBeenCalledWith(
      '[settings] subscriber threw',
      expect.any(Error),
    );
    spyWarn.mockRestore();
  });
});
