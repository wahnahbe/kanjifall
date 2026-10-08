// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetSettingsCache, updateSettings } from '../../data/settings';
import { Atmosphere, GHOST_GLYPHS } from '../Atmosphere';

describe('Atmosphere (second-pass spec §3.1)', () => {
  beforeEach(() => { localStorage.clear(); resetSettingsCache(); });
  afterEach(() => { localStorage.clear(); resetSettingsCache(); });

  it('renders exactly the three fixed ghost glyphs, never anything from a deck', () => {
    render(<Atmosphere scene="game" />);
    const glyphs = screen.getByTestId('atmosphere').querySelectorAll('.atmosphere-ghost');
    expect([...glyphs].map((g) => g.textContent)).toEqual([...GHOST_GLYPHS]);
    expect(GHOST_GLYPHS).toEqual(['言', '葉', '降']);
  });

  it('keeps 降 off the light shaft (spec §7.6; second-pass QA finding F6)', () => {
    // The shaft is centred and 28% wide, so its left edge is at 36%. Where
    // 降 crossed it, the glyph was the brightest point of the depth layer.
    // `left` is the glyph's left edge; the glyph itself is one em of a 12vw
    // font (index.css .atmosphere-ghost), i.e. 12% of the full-width layer,
    // so its right edge, not its left, has to clear the shaft. (At the old
    // 34% the left edge alone was under 36 while the glyph spanned 34–46%.)
    const SHAFT_LEFT_PCT = 36;
    const GLYPH_WIDTH_PCT = 12;
    render(<Atmosphere scene="game" />);
    const ghost = screen.getByTestId('atmosphere').querySelectorAll<HTMLElement>('.atmosphere-ghost')[2];
    expect(ghost.textContent).toBe('降');
    expect(parseFloat(ghost.style.left) + GLYPH_WIDTH_PCT).toBeLessThanOrEqual(SHAFT_LEFT_PCT);
  });

  it('exposes the scene for CSS and is hidden from assistive tech', () => {
    render(<Atmosphere scene="calm" />);
    const root = screen.getByTestId('atmosphere');
    expect(root.dataset.scene).toBe('calm');
    expect(root.getAttribute('aria-hidden')).toBe('true');
  });

  it.each([['full', '1', '1'], ['reduced', '0.5', '0'], ['off', '0', '0']] as const)(
    'at effects=%s the depth alpha is %s and drift is %s',
    (effects, alpha, drift) => {
      updateSettings({ effects });
      render(<Atmosphere scene="game" />);
      const root = screen.getByTestId('atmosphere');
      expect(root.style.getPropertyValue('--atmosphere-alpha')).toBe(alpha);
      expect(root.dataset.drift).toBe(drift);
    },
  );
});
