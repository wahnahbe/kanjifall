// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetSettingsCache, updateSettings } from '../../data/settings';
import { TITLE_GHOST_LANES_PCT, TITLE_GHOST_WORDS } from '../screens/TitleGhosts';
import { TitleScreen } from '../screens/TitleScreen';

function renderTitle() {
  return render(<TitleScreen onStart={() => {}} onStats={() => {}} onSettings={() => {}} />);
}

describe('TitleScreen (second-pass spec §5.1)', () => {
  beforeEach(() => { localStorage.clear(); resetSettingsCache(); });
  afterEach(() => { localStorage.clear(); resetSettingsCache(); });

  it('is a neon sign over the floor with the Japanese wordmark, and keeps its controls', () => {
    renderTitle();
    const sign = screen.getByTestId('title-sign');
    expect(sign).toHaveTextContent('KanjiFall');
    expect(sign).toHaveTextContent('漢字落');
    expect(screen.getByTestId('start-button')).toBeInTheDocument();
    expect(screen.getByTestId('stats-button')).toBeInTheDocument();
    expect(screen.getByTestId('settings-button')).toBeInTheDocument();
    expect(screen.getByTestId('title').querySelector('.title-floor')).not.toBeNull();
  });

  it('drops six fixed ghost words in the outer lanes only, never behind the sign', () => {
    renderTitle();
    const ghosts = [...screen.getByTestId('title-ghosts').querySelectorAll('.title-ghost')];
    expect(ghosts.map((g) => g.textContent)).toEqual([...TITLE_GHOST_WORDS]);
    expect(TITLE_GHOST_WORDS).toEqual(['雨', '勉強', '光', '図書館', '女', '犬']);
    for (const lane of TITLE_GHOST_LANES_PCT) expect(lane < 25 || lane > 75).toBe(true);
    ghosts.forEach((g, i) => expect((g as HTMLElement).style.left).toBe(`${TITLE_GHOST_LANES_PCT[i]}%`));
  });

  it('flickers the sign on at full and bleeds it at reduced', () => {
    renderTitle();
    expect(screen.getByTestId('title-sign').dataset.flicker).toBe('1');
    updateSettings({ effects: 'reduced' });
    renderTitle();
    expect(screen.getAllByTestId('title-sign')[1].dataset.flicker).toBe('0');
  });

  it('scopes the copy stagger to full: the root carries flicker, and reduced still bleeds (spec §6)', () => {
    renderTitle();
    expect(screen.getByTestId('title').dataset.flicker).toBe('1');
    expect(screen.getByTestId('title').dataset.motion).toBe('1');
    updateSettings({ effects: 'reduced' });
    renderTitle();
    const reduced = screen.getAllByTestId('title')[1];
    expect(reduced.dataset.flicker).toBe('0'); // CSS applies the stagger delays only under [data-flicker='1']
    expect(reduced.dataset.motion).toBe('1'); // bleed stays on at reduced, so the copy still bleeds in
    expect(screen.getAllByTestId('title-ghosts')[1].style.getPropertyValue('--ghost-alpha')).toBe('0.5');
  });

  it('keeps the sign flicker to three brightness steps (spec §7.7)', () => {
    const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');
    const block = /@keyframes sign-on\s*\{([\s\S]*?)\n\}/.exec(css);
    expect(block).not.toBeNull();
    // 0%, 25%, 50% and the 75%/100% rest are the three steps over 520ms (130ms each).
    expect(block![1].match(/brightness\(/g)?.length).toBeLessThanOrEqual(4);
  });

  it('at effects off: no ghosts, no flicker, every control still present (Review Focus 5)', () => {
    updateSettings({ effects: 'off' });
    renderTitle();
    expect(screen.queryByTestId('title-ghosts')).toBeNull();
    expect(screen.getByTestId('title').dataset.motion).toBe('0');
    expect(screen.getByTestId('start-button')).toBeInTheDocument();
    expect(screen.getByTestId('title-sign')).toHaveTextContent('漢字落');
  });
});
