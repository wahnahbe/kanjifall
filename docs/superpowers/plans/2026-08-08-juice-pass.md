# The Juice Pass (M4-C) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every structural moment — kill, combo, miss, wave clear, acquisition, tier conquered — gets a synthesized sound and a visual shape, with settings, filters, an IME banner and a README, per `docs/superpowers/specs/2026-08-08-juice-pass-design.md`.

**Architecture:** Passive consumers on the existing seams: a Web Audio `sfx` module and the Pixi stage both react to `GameEvent`s inside `useEngine`'s `onEvent`; React-owned moments (ceremony chime, tier fanfare/banner/confetti) call voices directly; one zod-validated `localStorage` settings store feeds audio, particles, and filters live. Zero engine changes.

**Tech Stack:** Web Audio API (no assets), PixiJS v8, `pixi-filters` (new dependency, the v8-compatible major), zod, React 19, Vitest. Nothing else new.

## Global Constraints

- **Zero engine changes.** `src/engine/` is untouched in every task; a diff line inside it is a defect.
- Settings key `kotoba-settings-v1`; shape `{sound: boolean, volume: 0–1, effects: 'full'|'reduced'|'off', crt: boolean}`; defaults sound true / volume 0.6 / crt false / effects `full` unless `prefers-reduced-motion` matches at first load → `reduced`. Corrupt or missing storage → defaults, never a throw (spec §3.1).
- `comboPitch(combo) = 440 × 2^(min(max(combo,0),12)/12)` — a semitone per step, capped +1 octave, exported pure (spec §4.1).
- Missing/failing `AudioContext` → every voice call is a silent no-op; `sound: false` short-circuits BEFORE any audio node is built (spec §9, §4.1).
- **Two ref-guard patterns coexist deliberately — do not "unify" them:** ImportScreen's `disposedRef` RESETS at effect setup (StrictMode must not poison teardown detection); the fanfare's `playedRef` NEVER resets inside one component instance (StrictMode's double effect must not double-play; a fresh results screen is a fresh instance and plays again). Each carries a comment saying which pattern it is and why.
- Particle sim: hard cap 200 live particles, oldest recycled; `reduced` halves burst counts; `off` spawns none. The sim mutates its pool in place — a deliberate 60fps-hot-path exception to the immutability norm, documented at the module head.
- Filters: bloom only when `effects === 'full'`; CRT only when `crt === true` (independent); construction failure logs one warning and runs unfiltered (spec §5.2, §9).
- Menus stay silent — no generic UI click sounds (spec decisions log).
- The three existing e2e specs pass unchanged; no new e2e.
- Commit format `<type>: <description>`, no attribution footer. Every task ends green: `npm run check`.

---

### Task 1: Settings store + hook

**Files:**
- Create: `src/data/settings.ts`, `src/ui/useSettings.ts`
- Test: `src/data/__tests__/settings.test.ts`

**Interfaces (produced — every later task consumes these):**
```ts
export const settingsSchema: z.ZodObject<…>;           // src/data/settings.ts
export type Settings = z.infer<typeof settingsSchema>;
export function defaultSettings(): Settings;
export function getSettings(): Settings;               // cached; loads storage once
export function updateSettings(partial: Partial<Settings>): Settings; // write-through + notify
export function subscribeSettings(cb: () => void): () => void;
export function resetSettingsCache(): void;            // tests only
export function useSettings(): Settings;               // src/ui/useSettings.ts (useSyncExternalStore)
```

- [ ] **Step 1: Failing tests**

Create `src/data/__tests__/settings.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify failure** — `npx vitest run src/data/__tests__/settings.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

`src/data/settings.ts`:

```ts
import { z } from 'zod';

/** Device-local preferences (juice-pass spec §3.1). NOT study data — the
 *  profile row stays server-side. One key, whole-object writes, corrupt
 *  data falls back to defaults silently. */
export const settingsSchema = z.object({
  sound: z.boolean(),
  volume: z.number().min(0).max(1),
  effects: z.union([z.literal('full'), z.literal('reduced'), z.literal('off')]),
  crt: z.boolean(),
});
export type Settings = z.infer<typeof settingsSchema>;

const STORAGE_KEY = 'kotoba-settings-v1';

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function defaultSettings(): Settings {
  return {
    sound: true,
    volume: 0.6,
    effects: prefersReducedMotion() ? 'reduced' : 'full',
    crt: false,
  };
}

let current: Settings | null = null;
const listeners = new Set<() => void>();

function load(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return defaultSettings();
    return settingsSchema.parse(JSON.parse(raw));
  } catch {
    return defaultSettings();
  }
}

export function getSettings(): Settings {
  if (current === null) current = load();
  return current;
}

export function updateSettings(partial: Partial<Settings>): Settings {
  // Amended after review: the write path validates too — a runtime-invalid
  // partial (volume 5 from a buggy slider) must not poison the session and
  // then be silently discarded wholesale on next load. Never-throw posture:
  // invalid updates are rejected with a warn, current state stands.
  const parsed = settingsSchema.safeParse({ ...getSettings(), ...partial });
  if (!parsed.success) {
    console.warn('[settings] rejected invalid update', partial);
    return getSettings();
  }
  const next = parsed.data;
  current = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage unavailable (private mode, quota) — settings stay session-local.
  }
  // Amended after review: per-subscriber isolation — four tasks register
  // consumers here; one throwing callback must not starve the rest.
  for (const cb of listeners) {
    try {
      cb();
    } catch (error) {
      console.warn('[settings] subscriber threw', error);
    }
  }
  return next;
}

export function subscribeSettings(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Tests only: drop the cache so the next read reloads storage. */
export function resetSettingsCache(): void {
  current = null;
}
```

`src/ui/useSettings.ts`:

```ts
import { useSyncExternalStore } from 'react';
import { getSettings, subscribeSettings } from '../data/settings';

/** Live settings for React surfaces — getSettings returns a stable object
 *  between updates, which is exactly what useSyncExternalStore wants. */
export function useSettings() {
  return useSyncExternalStore(subscribeSettings, getSettings);
}
```

- [ ] **Step 4: Verify green** — focused suite PASS, then `npm run check`.
- [ ] **Step 5: Commit** — `git add src/data/settings.ts src/ui/useSettings.ts src/data/__tests__/settings.test.ts && git commit -m "feat: device-local settings store with live subscription"`

---

### Task 2: SfxPlayer + event wiring

**Files:**
- Create: `src/audio/sfx.ts`, `src/audio/attachSfx.ts`
- Modify: `src/ui/useEngine.ts` (one line in the `onEvent` seam)
- Test: `src/audio/__tests__/sfx.test.ts`, `src/audio/__tests__/attachSfx.test.ts`

**Interfaces:**
- Consumes: `getSettings` (Task 1), `GameEvent` (engine types, read-only).
- Produces:
  ```ts
  export function comboPitch(combo: number): number;           // pure
  export const sfx: {
    kill(combo: number): void; miss(): void; wrongSubmit(): void;
    waveClear(): void; gameOver(): void; ceremonyChime(): void; tierFanfare(): void;
  };
  export type Sfx = typeof sfx;
  export function attachSfx(player: Sfx): (event: GameEvent) => void; // attachSfx.ts
  ```

- [ ] **Step 1: Failing tests**

`src/audio/__tests__/sfx.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSettingsCache, updateSettings } from '../../data/settings';
import { comboPitch, sfx } from '../sfx';

beforeEach(() => {
  localStorage.clear();
  resetSettingsCache();
});
afterEach(() => vi.unstubAllGlobals());

describe('comboPitch', () => {
  it('is A4 at combo 0 and rises a semitone per step', () => {
    expect(comboPitch(0)).toBeCloseTo(440, 6);
    expect(comboPitch(1)).toBeCloseTo(440 * 2 ** (1 / 12), 6);
    expect(comboPitch(12)).toBeCloseTo(880, 6);
  });

  it('caps at one octave and clamps negatives', () => {
    expect(comboPitch(30)).toBeCloseTo(880, 6);
    expect(comboPitch(-3)).toBeCloseTo(440, 6);
  });
});

describe('sfx voices', () => {
  it('are silent no-ops without AudioContext (jsdom) — nothing throws', () => {
    expect(() => {
      sfx.kill(3); sfx.miss(); sfx.wrongSubmit(); sfx.waveClear();
      sfx.gameOver(); sfx.ceremonyChime(); sfx.tierFanfare();
    }).not.toThrow();
  });

  it('sound:false short-circuits before the context is even constructed', () => {
    const ctor = vi.fn(() => {
      throw new Error('must not construct');
    });
    vi.stubGlobal('AudioContext', ctor);
    updateSettings({ sound: false });
    sfx.kill(1);
    expect(ctor).not.toHaveBeenCalled();
  });
});
```

`src/audio/__tests__/attachSfx.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import type { GameEvent } from '../../engine/types';
import { attachSfx } from '../attachSfx';
import type { Sfx } from '../sfx';

function fakePlayer(): Sfx {
  return {
    kill: vi.fn(), miss: vi.fn(), wrongSubmit: vi.fn(), waveClear: vi.fn(),
    gameOver: vi.fn(), ceremonyChime: vi.fn(), tierFanfare: vi.fn(),
  } as unknown as Sfx;
}

const word = {} as never; // payloads the listener never reads

describe('attachSfx', () => {
  it('maps the five in-run events to their voices, combo included', () => {
    const player = fakePlayer();
    const listen = attachSfx(player);
    listen({ type: 'wordKilled', word, msToKill: 400, points: 10, combo: 7 } as GameEvent);
    listen({ type: 'wordMissed', word } as GameEvent);
    listen({ type: 'wrongSubmit', submittedKana: 'x' } as GameEvent);
    listen({ type: 'waveCleared', wave: 1 } as GameEvent);
    listen({ type: 'gameOver', score: 1, wave: 1 } as GameEvent);
    expect(player.kill).toHaveBeenCalledWith(7);
    expect(player.miss).toHaveBeenCalledTimes(1);
    expect(player.wrongSubmit).toHaveBeenCalledTimes(1);
    expect(player.waveClear).toHaveBeenCalledTimes(1);
    expect(player.gameOver).toHaveBeenCalledTimes(1);
  });

  it('ignores every other event and never touches the React-owned voices', () => {
    const player = fakePlayer();
    const listen = attachSfx(player);
    listen({ type: 'bufferChanged', kana: '', romaji: '', lockedIds: [] } as GameEvent);
    listen({ type: 'waveStarting', wave: 1, cards: [], newCards: [] } as GameEvent);
    listen({ type: 'resumed', wave: 1 } as GameEvent);
    expect(player.kill).not.toHaveBeenCalled();
    expect(player.ceremonyChime).not.toHaveBeenCalled();
    expect(player.tierFanfare).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Verify failure**, then **Step 3: Implement**

`src/audio/sfx.ts`:

```ts
import { getSettings } from '../data/settings';

/**
 * Synthesized SFX (juice-pass spec §4): no assets, all voices are small
 * oscillator + envelope recipes on a lazily-created AudioContext. Every
 * trigger sits downstream of a user key press, so autoplay policy is
 * satisfied; a missing or broken AudioContext makes every call a silent
 * no-op, and sound:false short-circuits before any node exists.
 */

/** Pitch for the kill blip: a semitone per combo step above A4, capped one
 *  octave (spec §4.1). Pure — unit-tested directly. */
export function comboPitch(combo: number): number {
  return 440 * 2 ** (Math.min(Math.max(combo, 0), 12) / 12);
}

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

function ensureContext(): { ctx: AudioContext; master: GainNode } | null {
  if (typeof AudioContext === 'undefined') return null;
  if (ctx === null) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.connect(ctx.destination);
    } catch {
      ctx = null;
      master = null;
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  master!.gain.value = getSettings().volume;
  return { ctx, master: master! };
}

interface NoteSpec {
  type: OscillatorType;
  freq: number;
  startMs: number;
  durMs: number;
  peak?: number;
  endFreq?: number;
}

function playNotes(notes: readonly NoteSpec[]): void {
  if (!getSettings().sound) return; // BEFORE ensureContext — mute never builds audio
  const audio = ensureContext();
  if (audio === null) return;
  const t0 = audio.ctx.currentTime;
  for (const note of notes) {
    const osc = audio.ctx.createOscillator();
    const gain = audio.ctx.createGain();
    osc.type = note.type;
    const start = t0 + note.startMs / 1000;
    const end = start + note.durMs / 1000;
    osc.frequency.setValueAtTime(note.freq, start);
    if (note.endFreq !== undefined) osc.frequency.exponentialRampToValueAtTime(note.endFreq, end);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(note.peak ?? 0.25, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, end);
    osc.connect(gain);
    gain.connect(audio.master);
    osc.start(start);
    osc.stop(end + 0.02);
  }
}

export const sfx = {
  kill(combo: number): void {
    playNotes([{ type: 'triangle', freq: comboPitch(combo), startMs: 0, durMs: 90 }]);
  },
  miss(): void {
    playNotes([{ type: 'sawtooth', freq: 160, endFreq: 70, startMs: 0, durMs: 320, peak: 0.3 }]);
  },
  wrongSubmit(): void {
    playNotes([
      { type: 'square', freq: 220, startMs: 0, durMs: 60, peak: 0.12 },
      { type: 'square', freq: 196, startMs: 90, durMs: 60, peak: 0.12 },
    ]);
  },
  waveClear(): void {
    playNotes([
      { type: 'triangle', freq: 523.25, startMs: 0, durMs: 110 },
      { type: 'triangle', freq: 659.25, startMs: 110, durMs: 110 },
      { type: 'triangle', freq: 783.99, startMs: 220, durMs: 160 },
    ]);
  },
  gameOver(): void {
    playNotes([
      { type: 'sawtooth', freq: 392, startMs: 0, durMs: 180, peak: 0.2 },
      { type: 'sawtooth', freq: 311.13, startMs: 180, durMs: 180, peak: 0.2 },
      { type: 'sawtooth', freq: 261.63, startMs: 360, durMs: 320, peak: 0.2 },
    ]);
  },
  ceremonyChime(): void {
    playNotes([
      { type: 'sine', freq: 880, startMs: 0, durMs: 240, peak: 0.15 },
      { type: 'sine', freq: 1318.5, startMs: 60, durMs: 300, peak: 0.1 },
    ]);
  },
  tierFanfare(): void {
    playNotes([
      { type: 'triangle', freq: 523.25, startMs: 0, durMs: 140 },
      { type: 'triangle', freq: 659.25, startMs: 140, durMs: 140 },
      { type: 'triangle', freq: 783.99, startMs: 280, durMs: 140 },
      { type: 'triangle', freq: 1046.5, startMs: 420, durMs: 420, peak: 0.3 },
      { type: 'sine', freq: 2093, startMs: 460, durMs: 380, peak: 0.08 },
    ]);
  },
};
export type Sfx = typeof sfx;
```

`src/audio/attachSfx.ts`:

```ts
import type { GameEvent } from '../engine/types';
import type { Sfx } from './sfx';

/** Passive event consumer (main spec §4 boundary): the five in-run moments
 *  map to voices; mute/volume are enforced inside the player at play time,
 *  so nothing re-wires on settings changes. Installed in useEngine's
 *  onEvent seam alongside the stage effects. */
export function attachSfx(player: Sfx): (event: GameEvent) => void {
  return (event) => {
    switch (event.type) {
      case 'wordKilled':
        player.kill(event.combo);
        break;
      case 'wordMissed':
        player.miss();
        break;
      case 'wrongSubmit':
        player.wrongSubmit();
        break;
      case 'waveCleared':
        player.waveClear();
        break;
      case 'gameOver':
        player.gameOver();
        break;
      default:
        break;
    }
  };
}
```

`src/ui/useEngine.ts` — add imports and one line in `onEvent` (after the stage effect lines, before `publish()`):

```ts
import { attachSfx } from '../audio/attachSfx';
import { sfx } from '../audio/sfx';
```
```ts
const playSfx = attachSfx(sfx); // module scope, above useEngine
```
```ts
      playSfx(event);
```

- [ ] **Step 4: Verify green** — both focused suites, then `npm run check` (the useEngine tests must pass untouched: in jsdom the voices are silent no-ops by design).
- [ ] **Step 5: Commit** — `git add src/audio src/ui/useEngine.ts && git commit -m "feat: synthesized sfx voices wired to the engine event seam"`

---

### Task 3: Settings screen + Title entry

**Files:**
- Create: `src/ui/screens/SettingsScreen.tsx`
- Modify: `src/ui/screens/TitleScreen.tsx` (one prop + one button), `src/App.tsx` (screen union + wiring)
- Test: `src/ui/__tests__/SettingsScreen.test.tsx`

**Interfaces:**
- Consumes: `useSettings`/`updateSettings` (Task 1).
- Produces: `SettingsScreen({ onBack })`; TitleScreen gains `onSettings: () => void` and a `settings-button` testid; App's `Screen` union gains `'settings'`.

- [ ] **Step 1: Failing tests**

`src/ui/__tests__/SettingsScreen.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
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

  it('volume slider is disabled while sound is off and writes when on', () => {
    render(<SettingsScreen onBack={() => {}} />);
    const slider = screen.getByTestId('volume-slider') as HTMLInputElement;
    expect(slider.disabled).toBe(false);
    // fireEvent for range inputs: userEvent has no slider drag in jsdom
    slider.value = '0.3';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
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
```

(If the range-input event doesn't propagate through React in jsdom as written, use `fireEvent.change(slider, { target: { value: '0.3' } })` from `@testing-library/react` — note the adaptation in the report.)

- [ ] **Step 2: Verify failure**, then **Step 3: Implement**

`src/ui/screens/SettingsScreen.tsx`:

```tsx
import { updateSettings } from '../../data/settings';
import { useSettings } from '../useSettings';

interface SettingsScreenProps {
  onBack: () => void;
}

/** Live-applied device settings (juice-pass spec §3.2): no save button —
 *  every control writes through the store, and the running stage/audio
 *  subscribe to the same store. */
export function SettingsScreen({ onBack }: SettingsScreenProps) {
  const settings = useSettings();
  return (
    <div className="screen-center" data-testid="settings">
      <h2>Settings</h2>
      <label htmlFor="sound-toggle">
        <input
          id="sound-toggle"
          data-testid="sound-toggle"
          type="checkbox"
          checked={settings.sound}
          onChange={(e) => updateSettings({ sound: e.target.checked })}
        />{' '}
        Sound
      </label>
      <label htmlFor="volume-slider">
        Volume{' '}
        <input
          id="volume-slider"
          data-testid="volume-slider"
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={settings.volume}
          disabled={!settings.sound}
          onChange={(e) => updateSettings({ volume: Number(e.target.value) })}
        />
      </label>
      <div className="picker-row" role="radiogroup" aria-label="Effects level">
        {(['full', 'reduced', 'off'] as const).map((level) => (
          <button
            key={level}
            data-testid={`effects-${level}`}
            className={settings.effects === level ? 'picker selected' : 'picker'}
            onClick={() => updateSettings({ effects: level })}
          >
            {level}
          </button>
        ))}
      </div>
      <label htmlFor="crt-toggle">
        <input
          id="crt-toggle"
          data-testid="crt-toggle"
          type="checkbox"
          checked={settings.crt}
          onChange={(e) => updateSettings({ crt: e.target.checked })}
        />{' '}
        CRT
      </label>
      <div className="picker-row">
        <button onClick={onBack}>Back</button>
      </div>
    </div>
  );
}
```

TitleScreen: props gain `onSettings: () => void`; below the Stats button add `<button data-testid="settings-button" onClick={onSettings}>Settings</button>`.

App.tsx: `Screen` union gains `'settings'`; TitleScreen gets `onSettings={() => setScreen('settings')}`; a new branch `if (screen === 'settings') return <SettingsScreen onBack={() => setScreen('title')} />;`.

- [ ] **Step 4: Verify green** — focused suite, then `npm run check`.
- [ ] **Step 5: Commit** — `git add src/ui/screens/SettingsScreen.tsx src/ui/screens/TitleScreen.tsx src/App.tsx src/ui/__tests__/SettingsScreen.test.tsx && git commit -m "feat: settings screen with live-applied controls"`

---

### Task 4: Particles, filters, stage juice

**Files:**
- Modify: `package.json` (add `pixi-filters` — install the current major that peers with pixi v8: `npm install pixi-filters` and VERIFY `npx tsc -b` accepts the imports; if the latest major mispeers, pin the newest that declares pixi ^8)
- Create: `src/render/particleSim.ts` (pure), `src/render/Particles.ts` (Pixi layer), `src/render/filters.ts`
- Modify: `src/render/PixiStage.ts` (own particles + filters + shake + milestone flash; `playKill` gains `combo`), `src/ui/useEngine.ts` (pass `event.combo`)
- Test: `src/render/__tests__/particleSim.test.ts`, `src/render/__tests__/filters.test.ts`

**Interfaces:**
- Consumes: `Settings`/`getSettings`/`subscribeSettings` (Task 1).
- Produces:
  ```ts
  // particleSim.ts (pure, no pixi imports)
  export interface SimParticle { x: number; y: number; vx: number; vy: number; ageMs: number; lifeMs: number; color: number; size: number }
  export const PARTICLE_CAP = 200;
  export function burstCount(effects: Settings['effects'], base: number): number; // off→0, reduced→ceil(base/2), full→base
  export function killBurstBase(combo: number): number;  // 10 + min(floor(combo/5),4)*6 → 10..34
  export function spawnBurst(pool: SimParticle[], x: number, y: number, color: number, count: number, rng: () => number): void; // cap-recycles oldest
  export function stepParticles(pool: SimParticle[], deltaMs: number): void; // integrate + gravity; expired removed in place
  // filters.ts
  export function filterKinds(settings: Settings): ('bloom' | 'crt')[]; // pure
  export function buildFilters(settings: Settings): Filter[];           // try/catch → [] + one warn
  // PixiStage additions
  playKill(word: AirborneWord, combo: number): void;  // burst + milestone flash at ×5 steps
  playMiss(word: AirborneWord): void;                 // existing reveal + red puff + shake (full only)
  ```

- [ ] **Step 1: Failing pure tests**

`src/render/__tests__/particleSim.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  burstCount, killBurstBase, PARTICLE_CAP, spawnBurst, stepParticles, type SimParticle,
} from '../particleSim';

const rng = () => 0.5;

describe('particle sim (pure)', () => {
  it('burstCount scales by effects level', () => {
    expect(burstCount('full', 10)).toBe(10);
    expect(burstCount('reduced', 10)).toBe(5);
    expect(burstCount('reduced', 9)).toBe(5);
    expect(burstCount('off', 10)).toBe(0);
  });

  it('killBurstBase grows with combo tier and caps', () => {
    expect(killBurstBase(0)).toBe(10);
    expect(killBurstBase(4)).toBe(10);
    expect(killBurstBase(5)).toBe(16);
    expect(killBurstBase(20)).toBe(34);
    expect(killBurstBase(99)).toBe(34);
  });

  it('spawnBurst enforces the cap by recycling the oldest', () => {
    const pool: SimParticle[] = [];
    spawnBurst(pool, 0, 0, 0xffffff, PARTICLE_CAP + 50, rng);
    expect(pool.length).toBe(PARTICLE_CAP);
  });

  it('stepParticles integrates and expires in place', () => {
    const pool: SimParticle[] = [];
    spawnBurst(pool, 100, 100, 0xffffff, 5, rng);
    const before = pool[0].y;
    stepParticles(pool, 16);
    expect(pool[0].ageMs).toBe(16);
    expect(pool[0].y).not.toBe(before);
    stepParticles(pool, 10_000);
    expect(pool.length).toBe(0);
  });
});
```

`src/render/__tests__/filters.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { Settings } from '../../data/settings';
import { filterKinds } from '../filters';

const base: Settings = { sound: true, volume: 0.6, effects: 'full', crt: false };

describe('filterKinds (juice-pass spec §5.2)', () => {
  it('full → bloom; full+crt → both; reduced+crt → crt only; off → none', () => {
    expect(filterKinds(base)).toEqual(['bloom']);
    expect(filterKinds({ ...base, crt: true })).toEqual(['bloom', 'crt']);
    expect(filterKinds({ ...base, effects: 'reduced', crt: true })).toEqual(['crt']);
    expect(filterKinds({ ...base, effects: 'off' })).toEqual([]);
  });
});
```

- [ ] **Step 2: Verify failure**, then **Step 3: Implement**

`src/render/particleSim.ts` (module head comment: *"Mutates its pools in place — a deliberate 60fps hot-path exception to the repo's immutability norm; the pool never escapes the render layer."*): implement exactly the produced interface. `spawnBurst` gives each particle a random direction (`angle = rng() * Math.PI * 2`), speed `40 + rng() * 120` px/s split into vx/vy, upward bias `vy -= 60`, `lifeMs 400 + rng() * 500`, `size 2 + rng() * 3`; over-cap → `pool.shift()` per overflow before push. `stepParticles`: `vy += 240 * dt` gravity, positions integrate, expired (`ageMs >= lifeMs`) removed via in-place splice-filter.

`src/render/Particles.ts`: a `Container` with one `Graphics`; owns a `SimParticle[]`; methods `killBurst(x, y, combo)` (color `0x9dffb0`, count `burstCount(effects, killBurstBase(combo))`), `missPuff(x, y)` (color `0xff8f8f`, base 8), `confettiSweep(width)` (staggered spawns across the top edge, palette `[0xffd166, 0x9dffb0, 0x7cc7ff, 0xff9de2]`, base 40), `update(deltaMs)` (step sim then redraw: `graphics.clear()`, one `circle().fill({color, alpha: 1 - age/life})` per particle). Effects level read from `getSettings()` at spawn time.

`src/render/filters.ts` — exactly:

```ts
import { AdvancedBloomFilter, CRTFilter } from 'pixi-filters';
import type { Filter } from 'pixi.js';
import type { Settings } from '../data/settings';

/** Pure decision half (unit-tested): which filters this settings state wants. */
export function filterKinds(settings: Settings): ('bloom' | 'crt')[] {
  const kinds: ('bloom' | 'crt')[] = [];
  if (settings.effects === 'full') kinds.push('bloom');
  if (settings.crt) kinds.push('crt');
  return kinds;
}

/** Construction half: a filter that fails to build logs one warning and the
 *  game runs unfiltered — juice must never block play (spec §9). */
export function buildFilters(settings: Settings): Filter[] {
  try {
    return filterKinds(settings).map((kind) =>
      kind === 'bloom'
        ? new AdvancedBloomFilter({ threshold: 0.6, bloomScale: 0.8 })
        : new CRTFilter({ lineWidth: 2, vignetting: 0.25 }),
    );
  } catch (error) {
    console.warn('[filters] construction failed — running unfiltered', error);
    return [];
  }
}
```

`PixiStage` integration: constructor creates `Particles`, adds its container above word sprites; applies `buildFilters(getSettings())` to `app.stage.filters` and re-applies inside `subscribeSettings` (unsubscribed in `destroy`); ticker calls `particles.update(deltaMS)` and advances a `shakeMs` countdown that jitters `app.stage.position` ±4px while positive (reset to `(0,0)` after). `playKill(word, combo)`: existing gloss tween + `particles.killBurst(px, py, combo)` + when `combo > 0 && combo % 5 === 0` also `spawnFx(word, `×${combo}!`, 0xffd166, 500, pop-scale update)` — skipped entirely when effects are `off`. `playMiss(word)`: existing reveal + `missPuff` + `shakeMs = 150` only when `effects === 'full'`. Wave-clear confetti: `useEngine`'s `onEvent` gains `if (event.type === 'waveCleared') stage?.playWaveClear();` calling `particles.confettiSweep(app.screen.width)`. `useEngine` updates the `playKill` call to pass `event.combo`.

- [ ] **Step 4: Verify green** — focused suites; `npm run check`; confirm `npx vite build` (part of `npm run build` — optional here) is NOT required by check; tsc across projects accepts `pixi-filters` types.
- [ ] **Step 5: Commit** — `git add package.json package-lock.json src/render src/ui/useEngine.ts && git commit -m "feat: particles, bloom/crt filters, shake and milestone flashes"`

---

### Task 5: Tier celebration, ceremony chime, HUD pop

**Files:**
- Modify: `src/ui/screens/ResultsScreen.tsx`, `src/ui/screens/AcquisitionCeremony.tsx` (one line), `src/ui/hud/Hud.tsx` (combo pop), `src/index.css` (keyframes + celebration/confetti/pop/banner styles)
- Test: modify `src/ui/__tests__/ResultsScreen.test.tsx` (celebration cases), `src/ui/__tests__/AcquisitionCeremony.test.tsx` (chime), `src/ui/__tests__/Hud.test.tsx` (pop)

**Interfaces:**
- Consumes: `sfx.tierFanfare`/`sfx.ceremonyChime` (Task 2), `useSettings` (Task 1), the existing `tierAdvance: string | null` prop.
- Produces: celebration DOM — `tier-celebration` wrapper (full/reduced), `confetti` (full only), the `tier-advance` testid preserved in ALL effects levels; combo span pops via a keyed `combo-pop` class.

- [ ] **Step 1: Failing tests**

Add to `src/ui/__tests__/ResultsScreen.test.tsx` (mock the sfx module at the top of the file):

```tsx
vi.mock('../../audio/sfx', () => ({
  sfx: { tierFanfare: vi.fn(), ceremonyChime: vi.fn() },
}));
import { sfx } from '../../audio/sfx';
```

```tsx
describe('tier celebration (juice-pass spec §6)', () => {
  beforeEach(() => {
    localStorage.clear();
    resetSettingsCache();
    vi.mocked(sfx.tierFanfare).mockClear();
  });

  it('full effects: banner + confetti render and the fanfare fires exactly once under StrictMode', () => {
    render(
      <StrictMode>
        <ResultsScreen snapshot={snap({ status: 'gameOver' })} tierAdvance="N5 tier 1 cleared — tier 2 is next."
          onRevenge={noop} onPlayAgain={noop} onTitle={noop} />
      </StrictMode>,
    );
    expect(screen.getByTestId('tier-celebration')).toBeInTheDocument();
    expect(screen.getByTestId('confetti')).toBeInTheDocument();
    expect(screen.getByTestId('tier-advance')).toHaveTextContent('tier 2 is next');
    expect(sfx.tierFanfare).toHaveBeenCalledTimes(1);
  });

  it('reduced effects: banner and fanfare, no confetti', () => {
    updateSettings({ effects: 'reduced' });
    render(<ResultsScreen snapshot={snap({ status: 'gameOver' })} tierAdvance="x"
      onRevenge={noop} onPlayAgain={noop} onTitle={noop} />);
    expect(screen.getByTestId('tier-celebration')).toBeInTheDocument();
    expect(screen.queryByTestId('confetti')).toBeNull();
    expect(sfx.tierFanfare).toHaveBeenCalledTimes(1);
  });

  it('effects off: the plain line only, still with its testid, no fanfare suppression by effects (sound handles that)', () => {
    updateSettings({ effects: 'off' });
    render(<ResultsScreen snapshot={snap({ status: 'gameOver' })} tierAdvance="x"
      onRevenge={noop} onPlayAgain={noop} onTitle={noop} />);
    expect(screen.queryByTestId('tier-celebration')).toBeNull();
    expect(screen.getByTestId('tier-advance')).toBeInTheDocument();
    expect(sfx.tierFanfare).toHaveBeenCalledTimes(1);
  });

  it('no tierAdvance: nothing renders, nothing plays', () => {
    render(<ResultsScreen snapshot={snap({ status: 'gameOver' })} tierAdvance={null}
      onRevenge={noop} onPlayAgain={noop} onTitle={noop} />);
    expect(screen.queryByTestId('tier-advance')).toBeNull();
    expect(sfx.tierFanfare).not.toHaveBeenCalled();
  });
});
```

(Adapt `snap`/`noop` helpers to the file's existing fixtures; import `StrictMode`, `resetSettingsCache`, `updateSettings`.)

`AcquisitionCeremony.test.tsx` additions (same `vi.mock` pattern): a correct-reading Enter calls `sfx.ceremonyChime` once; an Escape skip does NOT; a rejected Enter does NOT.

`Hud.test.tsx` addition: the combo span carries class `combo-pop` and a `key` remount per combo change — assert `getByTestId('combo').className` contains `combo-pop` when combo > 0.

- [ ] **Step 2: Verify failure**, then **Step 3: Implement**

ResultsScreen — replace the tier-advance block:

```tsx
const settings = useSettings();
const playedRef = useRef(false);
useEffect(() => {
  // Deliberately NOT reset on effect re-run: StrictMode's double-invocation
  // must not double-play, and a fresh results screen is a fresh component
  // instance with a fresh ref (the OPPOSITE of ImportScreen's disposedRef
  // pattern — see the juice-pass plan's Global Constraints).
  if (tierAdvance === null || playedRef.current) return;
  playedRef.current = true;
  sfx.tierFanfare();
}, [tierAdvance]);
```

```tsx
{tierAdvance !== null && settings.effects !== 'off' && (
  <div className="tier-celebration" data-testid="tier-celebration">
    <p className="tier-advance tier-banner" data-testid="tier-advance">{tierAdvance}</p>
    {settings.effects === 'full' && (
      <div className="confetti" data-testid="confetti" aria-hidden="true">
        {Array.from({ length: 24 }, (_, i) => (
          <span
            key={i}
            className="confetti-dot"
            style={{
              left: `${(i * 41) % 100}%`,
              animationDelay: `${(i % 8) * 90}ms`,
              backgroundColor: ['#ffd166', '#9dffb0', '#7cc7ff', '#ff9de2'][i % 4],
            }}
          />
        ))}
      </div>
    )}
  </div>
)}
{tierAdvance !== null && settings.effects === 'off' && (
  <p className="tier-advance" data-testid="tier-advance">{tierAdvance}</p>
)}
```

AcquisitionCeremony — in the Enter branch, on the match success path only: `sfx.ceremonyChime();` immediately before `advance(card.id)`.

Hud — combo span becomes:

```tsx
<span data-testid="combo" key={snapshot.combo} className={snapshot.combo > 0 ? 'combo-pop' : ''}>
  {snapshot.combo > 0 ? `×${snapshot.combo}` : ''}
</span>
```

`src/index.css` — append `.tier-banner` (scale 0.85→1.04→1 + fade keyframes, ~600ms), `.confetti`/`.confetti-dot` (absolute dots, `confetti-fall` translateY(-10px→70vh) + fade over 2s, `animation-fill-mode: forwards`), `.combo-pop` (scale 1→1.35→1, 220ms).

- [ ] **Step 4: Verify green** — the three focused suites, then `npm run check`.
- [ ] **Step 5: Commit** — `git add src/ui/screens/ResultsScreen.tsx src/ui/screens/AcquisitionCeremony.tsx src/ui/hud/Hud.tsx src/index.css src/ui/__tests__/ && git commit -m "feat: tier celebration, ceremony chime, combo pop"`

---

### Task 6: IME warning banner

**Files:**
- Create: `src/ui/hud/ImeWarning.tsx`
- Modify: `src/ui/screens/GameScreen.tsx` (render it)
- Test: `src/ui/__tests__/ImeWarning.test.tsx`

- [ ] **Step 1: Failing tests**

```tsx
// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImeWarning } from '../hud/ImeWarning';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const compose = () =>
  act(() => {
    window.dispatchEvent(new CompositionEvent('compositionstart'));
  });

describe('ImeWarning (main spec §7 row: IME intercepts keystrokes)', () => {
  it('is hidden until a composition event fires', () => {
    render(<ImeWarning />);
    expect(screen.queryByTestId('ime-warning')).toBeNull();
    compose();
    expect(screen.getByTestId('ime-warning')).toHaveTextContent(/Win\+Space/);
  });

  it('hides 4s after the last composition event, timer reset per event', () => {
    render(<ImeWarning />);
    compose();
    act(() => vi.advanceTimersByTime(3000));
    compose(); // reset
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByTestId('ime-warning')).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(1100));
    expect(screen.queryByTestId('ime-warning')).toBeNull();
  });
});
```

- [ ] **Step 2: Verify failure**, then **Step 3: Implement**

```tsx
import { useEffect, useState } from 'react';

const HIDE_AFTER_MS = 4000;

/** The engine already ignores composing keys (isGameKey); this makes the
 *  silent failure visible: an active Japanese IME during play eats every
 *  keystroke with no feedback at all (main spec §7). */
export function ImeWarning() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    let timer: number | undefined;
    const onComposition = () => {
      setVisible(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setVisible(false), HIDE_AFTER_MS);
    };
    window.addEventListener('compositionstart', onComposition);
    window.addEventListener('compositionupdate', onComposition);
    return () => {
      window.removeEventListener('compositionstart', onComposition);
      window.removeEventListener('compositionupdate', onComposition);
      window.clearTimeout(timer);
    };
  }, []);
  if (!visible) return null;
  return (
    <p className="ime-warning" data-testid="ime-warning">
      Japanese IME is on — switch to EN input (Win+Space).
    </p>
  );
}
```

GameScreen renders `<ImeWarning />` right after `<Hud …/>` (mounted for the whole game screen — ceremony typing benefits too). `src/index.css` gains a `.ime-warning` style (amber banner, top-center, above the canvas).

- [ ] **Step 4: Verify green**, then **Step 5: Commit** — `git add src/ui/hud/ImeWarning.tsx src/ui/screens/GameScreen.tsx src/index.css src/ui/__tests__/ImeWarning.test.tsx && git commit -m "feat: IME warning banner during play"`

---

### Task 7: README, docs, gates

**Files:**
- Create: `README.md`
- Modify: `docs/superpowers/specs/2026-08-08-juice-pass-design.md` (status line → `**Status:** Implemented — see docs/superpowers/plans/2026-08-08-juice-pass.md`)

- [ ] **Step 1: Write `README.md`**

```markdown
# kotoba-drop

A falling-words Japanese typing game. JLPT-tagged vocabulary falls from the
top of the screen; you type the reading in romaji (converted live to kana)
and press Enter to destroy each word before it hits the floor. Every attempt
is recorded to a local SQLite database that powers a personal analytics
profile — words learned per direction, a vocab-only JLPT level estimate, and
pace tracking against an exam date.

It is a **reinforcement** tool: arcade pressure cements half-known words.
New words arrive through paced acquisition ceremonies, gated by
frequency-ordered tiers; custom lists (e.g. exported from your SRS) can be
imported and played with the same treatment.

## Quick start

    npm install
    npm run start        # build + serve the game and API, opens the browser

Development (client + server with hot reload):

    npm run dev

## Tests

    npm run check        # typecheck + lint + unit/component tests
    npm run e2e          # Playwright end-to-end specs (wipes data/e2e.db)

## Rebuilding the card data

The committed JLPT data files in `public/data/` are generated by
`npm run build:data` from raw datasets expected in `data/raw/` (JMdict,
KANJIDIC2, Tatoeba pairs, and yomitan-jlpt-vocab term banks — see
`scripts/build-data.ts` for the exact filenames). The build is
deterministic: identical inputs produce byte-identical output.

## Documentation

Design specs and implementation plans live in `docs/superpowers/` —
`specs/2026-07-22-kotoba-drop-design.md` is the main design document; each
sub-project (word introduction, tiered vocabulary, list import, the juice
pass) has its own dated spec and plan.

Example sentences: Tatoeba (CC-BY 2.0 FR). Dictionary data: JMdict/KANJIDIC2
(EDRDG licence), via jmdict-simplified.
```

- [ ] **Step 2: Doc status flip** — exactly the one line.
- [ ] **Step 3: Gates** — `npm run check` AND `npm run e2e` (all three specs; the juice layer must not have altered any flow they exercise). Include both tails in the report.
- [ ] **Step 4: Commit** — `git add README.md docs/superpowers/specs/2026-08-08-juice-pass-design.md && git commit -m "docs: README and juice-pass status"`

---

## Manual QA checklist (run at finish, before merge — needs ears and eyes)

1. `npm run start` — play a run at effects `full`: kill blips rise with combo; ×5 milestone flashes; miss thunks + brief shake; wave-clear arpeggio + confetti sweep; wrong submit double-blip.
2. Ceremony chime on a correct Enter; silence on Escape.
3. Advance a tier (or replay until one advances): fanfare once + banner + confetti on results; Play again immediately → no repeat.
4. Settings: mute mid-run silences the next sound instantly; volume slider audible; effects `reduced` (fewer particles, no shake/bloom) and `off` (no juice, plain tier line); CRT toggle restyles live.
5. Switch to the Japanese IME mid-run → banner appears, disappears ~4s after switching back.
6. 60fps feel at max airborne words + heavy combo bursts at `full` (the main spec §8 gate) — watch for hitching on kill bursts.

## Spec coverage map (self-review)

| Spec section | Where |
|---|---|
| §3.1 store, defaults, reduced-motion, corrupt fallback | Task 1 |
| §3.2 settings screen | Task 3 |
| §4.1 voices + comboPitch + no-op/short-circuit rules | Task 2 |
| §4.2 wiring (five events + two React-owned voices) | Tasks 2, 5 |
| §5.1 particles (kill/milestone/miss+shake/wave clear, caps, levels) | Task 4 |
| §5.2 filters + filterKinds + failure posture | Task 4 |
| §5.3 HUD combo pop | Task 5 |
| §6 celebration (fanfare-once StrictMode-safe, banner, confetti, level/sound gating) | Task 5 |
| §7 IME banner | Task 6 |
| §8 README | Task 7 |
| §9 error table | Tasks 1 (corrupt storage), 2 (no AudioContext/suspended), 4 (filter failure, pool cap), 1 (matchMedia absent) |
| §10 testing incl. manual QA checklist | every task + the checklist above |
