// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSettingsCache, updateSettings } from '../../data/settings';

vi.mock('../../data/listsClient', () => ({ fetchLists: vi.fn().mockResolvedValue(null) }));
vi.mock('../../data/planClient', () => ({ fetchRunPlan: vi.fn().mockResolvedValue(null) }));
vi.mock('../screens/titleFloor', () => ({ TITLE_FLOOR_URL: 'title-floor-sentinel.svg' }));

import { SetupScreen } from '../screens/SetupScreen';
import { TitleScreen } from '../screens/TitleScreen';

function renderSetup() {
  return render(<SetupScreen loading={false} error={null} onBegin={() => {}} onBack={() => {}} onImport={() => {}} initialListSelection={null} />);
}

describe('SetupScreen frame (second-pass spec §5.2)', () => {
  beforeEach(() => { localStorage.clear(); resetSettingsCache(); });
  afterEach(() => { localStorage.clear(); resetSettingsCache(); });

  it('inherits the title: stripe, dimmed ghosts, floor horizon, controls in the machine band', () => {
    render(<SetupScreen loading={false} error={null} onBegin={() => {}} onBack={() => {}} onImport={() => {}} initialListSelection={null} />);
    const root = screen.getByTestId('setup');
    expect(root.querySelector('.hud-stripe')).not.toBeNull();
    expect(screen.getByTestId('title-ghosts').style.getPropertyValue('--ghost-alpha')).toBe('0.5');
    expect(root.querySelector('.title-floor')).not.toBeNull();
    expect(screen.getByTestId('begin-button').closest('.machine-band')).not.toBeNull();
    expect(root.querySelector('h2')?.className).toContain('setup-heading');
    expect(screen.getByTestId('mode-reading')).toBeInTheDocument();
  });

  it('draws its horizon with the shared title floor stroke, not a copy of it', () => {
    // Both screens read TITLE_FLOOR_URL from titleFloor.ts; a private copy of
    // the stroke would not pick up the mocked value.
    renderSetup();
    render(<TitleScreen onStart={() => {}} onStats={() => {}} onSettings={() => {}} />);
    const roots = [screen.getByTestId('setup'), screen.getByTestId('title')];
    for (const root of roots) {
      const floor = root.querySelector('.title-floor') as HTMLElement;
      expect(floor).toHaveAttribute('aria-hidden', 'true');
      expect(floor.style.backgroundImage).toContain('title-floor-sentinel.svg');
    }
  });

  it('derives its motion gate from visualParams, not from effects === off', () => {
    renderSetup();
    const full = screen.getByTestId('setup');
    expect(full.dataset.motion).toBe('1');
    expect(full.dataset.flicker).toBe('1');
    updateSettings({ effects: 'reduced' });
    renderSetup();
    const reduced = screen.getAllByTestId('setup')[1];
    expect(reduced.dataset.motion).toBe('1'); // bleed stays on at reduced
    expect(reduced.dataset.flicker).toBe('0'); // CSS applies the stagger only under [data-flicker='1']
    expect(screen.getAllByTestId('title-ghosts')[1].style.getPropertyValue('--ghost-alpha')).toBe('0.25');
  });

  it('at effects off: static, no ghosts, every control still present', () => {
    updateSettings({ effects: 'off' });
    renderSetup();
    const root = screen.getByTestId('setup');
    expect(root.dataset.motion).toBe('0');
    expect(root.dataset.flicker).toBe('0');
    expect(screen.queryByTestId('title-ghosts')).toBeNull();
    expect(root.querySelector('.hud-stripe')).not.toBeNull();
    expect(root.querySelector('.title-floor')).not.toBeNull();
    for (const id of ['mode-reading', 'mode-recall', 'pool-n5', 'pool-mixed', 'import-button', 'begin-button']) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it('scopes the chooser stagger to full: no delay rule applies outside [data-flicker=\'1\']', () => {
    const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const delayRules = [...css.matchAll(/([^{}]*\.setup-screen[^{}]*)\{[^}]*animation-delay[^}]*\}/g)];
    expect(delayRules.length).toBeGreaterThanOrEqual(6);
    for (const rule of delayRules) {
      for (const selector of rule[1].split(',')) expect(selector).toContain(".setup-screen[data-flicker='1']");
    }
  });

  it('re-times the chooser hints and band buttons with a compound selector that outranks the title rules by specificity', () => {
    const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const delayRules = [...css.matchAll(/([^{}]*\.setup-screen[^{}]*)\{[^}]*animation-delay[^}]*\}/g)];
    const retimed = delayRules
      .map((rule) => rule[1].trim())
      .filter((selector) => /\.hint(?![\w-])|\.title-band > button/.test(selector));
    expect(retimed).toHaveLength(3);
    // Same specificity as `.title-screen[data-flicker='1'] .hint` would tie and
    // lean on source order; the extra class makes the win independent of it.
    for (const selector of retimed) expect(selector).toMatch(/^\.title-screen\.setup-screen\[data-flicker='1'\]/);
  });

  it('keeps the decorative floor stroke out of hit-testing so the scrolling stage gets every click and wheel', () => {
    const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const rule = /(?:^|\})\s*\.title-floor\s*\{([^}]*)\}/m.exec(css);
    expect(rule).not.toBeNull();
    expect(rule![1]).toContain('pointer-events: none');
  });
});
