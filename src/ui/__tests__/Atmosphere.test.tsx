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
