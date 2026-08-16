// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetSettingsCache, updateSettings } from '../../data/settings';
import type { EngineSnapshot } from '../../engine/types';
import { Hud } from '../hud/Hud';

const snapshot: EngineSnapshot = {
  status: 'playing', mode: 'reading', score: 1230, lives: 2, wave: 3, combo: 4, maxCombo: 0,
  kills: 0, wrongSubmits: 0,
  bufferKana: 'べんk', bufferRomaji: 'benk', lockedIds: [1], missed: [], timeMs: 0,
};

describe('Hud', () => {
  it('renders score, lives, wave, combo, and the kana buffer', () => {
    render(<Hud snapshot={snapshot} />);
    expect(screen.getByTestId('score')).toHaveTextContent('1230');
    expect(screen.getByTestId('lives').querySelectorAll('.hud-pip-live')).toHaveLength(2);
    expect(screen.getByTestId('wave')).toHaveTextContent('3');
    expect(screen.getByTestId('combo')).toHaveTextContent('4');
    expect(screen.getByTestId('kana-buffer')).toHaveTextContent('べんk');
  });

  it('pops the combo span (juice-pass spec §6) when combo > 0, and does not when combo is 0', () => {
    const { rerender } = render(<Hud snapshot={snapshot} />);
    expect(screen.getByTestId('combo').className).toContain('combo-pop');

    rerender(<Hud snapshot={{ ...snapshot, combo: 0 }} />);
    expect(screen.getByTestId('combo').className).not.toContain('combo-pop');
  });

  // Visual-identity spec §7's load-bearing invariant, fix wave M7: score,
  // wave, lives (pips), and the buffer convey game state and must render at
  // every effects level — only their glow (the `hud-glow` class, driven by
  // `effects === 'full'`) scales. This is distinct from the alpha values in
  // visualParams.test.ts, which test decoration *strength*; this tests
  // decoration-vs-presence, i.e. that turning effects off never also turns
  // off the element carrying game state. Would fail if `hud-glow` (or a
  // future gate) were ever used to conditionally omit `.hud-tab`/
  // `.hud-value`/`.hud-pip`/`.hud-buffer` themselves rather than just their
  // box-shadow.
  describe('presence survives every effects level (spec §7)', () => {
    beforeEach(() => {
      localStorage.clear();
      resetSettingsCache();
    });
    afterEach(() => {
      localStorage.clear();
      resetSettingsCache();
    });

    it.each(['full', 'reduced', 'off'] as const)('score, wave, lives, and buffer all render at effects=%s', (effects) => {
      updateSettings({ effects });
      render(<Hud snapshot={snapshot} />);
      expect(screen.getByTestId('score')).toHaveTextContent('1230');
      expect(screen.getByTestId('wave')).toHaveTextContent('3');
      expect(screen.getByTestId('lives').querySelectorAll('.hud-pip')).toHaveLength(3);
      expect(screen.getByTestId('kana-buffer')).toBeInTheDocument();
      // The ONLY thing allowed to change across levels is the glow class —
      // never the presence of the elements above.
      expect(screen.getByTestId('score').closest('.hud')?.className.includes('hud-glow')).toBe(effects === 'full');
    });
  });
});
