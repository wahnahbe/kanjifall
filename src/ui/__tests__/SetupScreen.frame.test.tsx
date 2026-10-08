// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSettingsCache, updateSettings } from '../../data/settings';

vi.mock('../../data/listsClient', () => ({ fetchLists: vi.fn().mockResolvedValue(null) }));
vi.mock('../../data/planClient', () => ({ fetchRunPlan: vi.fn().mockResolvedValue(null) }));

import { SetupScreen } from '../screens/SetupScreen';

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
    // jsdom's CSSOM discards a data-URI background-image, so the stroke can't
    // be read back off the element; pin the sharing at the source instead.
    const screens = join(process.cwd(), 'src/ui/screens');
    const setup = readFileSync(join(screens, 'SetupScreen.tsx'), 'utf8');
    const title = readFileSync(join(screens, 'TitleScreen.tsx'), 'utf8');
    for (const source of [setup, title]) expect(source).toContain("import { TITLE_FLOOR_URL } from './titleFloor';");
    expect(setup).not.toContain('brushStrokeDataUri');
    expect(title).not.toMatch(/FLOOR_SEED/);
    renderSetup();
    expect(screen.getByTestId('setup').querySelector('.title-floor')).toHaveAttribute('aria-hidden', 'true');
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
});
