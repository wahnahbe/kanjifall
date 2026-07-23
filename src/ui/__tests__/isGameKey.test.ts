import { describe, expect, it } from 'vitest';
import { isGameKey } from '../useEngine';

const ev = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; isComposing: boolean }> = {}) => ({
  key, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, ...mods,
});

describe('isGameKey', () => {
  it('accepts game keys', () => {
    for (const key of ['a', 'z', 'A', '-', 'Enter', 'Escape', 'Backspace']) {
      expect(isGameKey(ev(key)), key).toBe(true);
    }
  });

  it('rejects modifier chords so browser shortcuts survive', () => {
    expect(isGameKey(ev('r', { ctrlKey: true }))).toBe(false);
    expect(isGameKey(ev('s', { metaKey: true }))).toBe(false);
    expect(isGameKey(ev('f', { altKey: true }))).toBe(false);
    expect(isGameKey(ev('Enter', { ctrlKey: true }))).toBe(false);
  });

  it('rejects IME composition and non-game keys', () => {
    expect(isGameKey(ev('a', { isComposing: true }))).toBe(false);
    for (const key of ['1', ' ', 'F5', 'F12', 'Tab', 'Shift']) {
      expect(isGameKey(ev(key)), key).toBe(false);
    }
  });
});
