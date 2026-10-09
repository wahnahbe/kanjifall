# Visual Identity, Second Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish "brushed ink lit as neon": give the playfield depth and ink material, a motion grammar for every moment of play, one screen transition, a wave-start beat, and a title showpiece — presentation only, no engine, data, or server changes.

**Architecture:** A persistent DOM atmosphere layer sits behind every screen; Pixi keeps everything tied to game coordinates. Brush borders are colour-free SVG masks so colour still comes only from tokens. One pure `playScale()` feeds both Pixi and CSS from a single number. Motion durations and easings are tokens mirrored into TS with the same parity test as colours, and the per-level effects numbers grow inside the existing pure `visualParams()`, so no component ever branches on `effects` ad hoc. Every new effect is a passive consumer of the engine events the stage already consumes.

**Tech Stack:** TypeScript, React 19, Pixi.js 8, pixi-filters, Vitest (+ jsdom via per-file pragma), Playwright, Fontsource. One new dev dependency (`opentype.js`, Task 14 only).

**Spec:** `docs/superpowers/specs/2026-10-07-visual-identity-second-pass-design.md` — read it before Task 1, and keep `docs/superpowers/specs/2026-08-15-visual-identity-design.md` open: this spec inherits its §3 tokens, §7 contract and §9 rules. Sections are cited per task as "spec §N" (second pass) or "first spec §N".

## Global Constraints

- **No engine, data, or server changes.** Nothing under `src/engine/`, `src/data/`, or `server/` changes. `src/engine/constants.ts` (`LANES`, `DEFAULT_CONFIG`) is untouched; `src/data/settings.ts` is read, never modified — this plan adds no settings.
- **No new runtime dependencies.** The only new dependency is `opentype.js` as a devDependency (Task 14), run once to generate a committed asset; the app never imports it.
- **No raw colour literals outside `src/ui/tokens.css` and `src/design/palette.ts`.** Every colour an effect uses is `PALETTE.*`, `cssHex(PALETTE.*)`, a `var(--color-*)`, or `mixColor()` of two palette entries. Mask SVGs are colour-free (`white`) by design.
- **Anything that conveys game state renders at every effects level; only decoration scales** (first spec §7, spec §6). The §6 table is the oracle for `visualParams`; every new consumer reads its number from there.
- **A flicker is a single event** (spec §7.7): at most three brightness steps, under 300ms each, never repeating, and gone whenever `visualParams(effects).flicker === 0`.
- **Legibility rules (first spec §9, spec §7)** override aesthetics: nothing in the depth layer may exceed ~8% luminance over the ground; no letterform in the depth layer may be a live card; kanji stroke detail wins.
- **`npm run check` must pass** (`tsc -b && oxlint && vitest run`) before every commit. `npm run e2e` must pass at the end of Task 11 and Task 15.
- **TypeScript style:** explicit types on exported functions, `interface` for object shapes, `type` for unions, no `any`, immutable updates. `src/render/particleSim.ts` remains the documented in-place-mutation exception — do not "fix" it; new pure helpers that live beside it must not mutate.
- **Pixi objects are never constructed in unit tests.** Pure helpers (`spawnTween`, `killFx`, `approach`, `colorMix`, `scale`, `motion`) carry the tests; Pixi call sites stay thin, as `particleSim.ts`/`Particles.ts` already model.
- **Commits are conventional** (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`) and end with the attribution line the session requires.

## Review Focus

Inputs the spec implies but no task's tests exercised until the lines below pinned them. Each has its test added to the owning task.

1. **The window resizes mid-run.** Words already airborne keep their size; new ones use the new size, and the CSS-side sizes must follow at once. Expected: `GameScreen` rewrites `--size-word-play` on `resize`, and `playScale` clamps at both ends (Task 2).
2. **A wave with no new cards** (server down, or a replay). The ceremony completes on mount; the beat must still play exactly once and `resume()` must be called exactly once after it (Task 11).
3. **Two screen changes inside one transition** (title → setup → title in under 360ms). The outgoing layer must be the most recent previous screen, the timer must reset, and no stale layer may survive (Task 10).
4. **A word killed while still bleeding in.** Its blur filter must be destroyed with the sprite, and the pure tween must return clean end-state values past its life (Task 7).
5. **`effects: 'off'` at the title.** The sign must appear without flicker, the ghosts must be absent, and every control must still render (Task 12).

---

## File Structure

**Created:**
- `src/design/motion.ts` — duration and easing tokens as TS constants (mirror of `--duration-*`/`--ease-*`).
- `src/design/scale.ts` — pure `playScale(stageHeightPx)`.
- `src/design/colorMix.ts` — pure `mixColor(a, b, t)` for `0xRRGGBB` numbers.
- `src/design/__tests__/{motion,scale,colorMix}.test.ts`
- `src/render/spawnTween.ts` — pure spawn bleed/flicker and lock flicker frames.
- `src/render/killFx.ts` — pure slash, flare and droplet geometry/frames.
- `src/render/approach.ts` — pure `approachProgress`, `approachTint`.
- `src/render/flareTexture.ts` — one cached radial texture (canvas), used by flare, swell and impact.
- `src/render/__tests__/{spawnTween,killFx,approach,brushFrame}.test.ts`
- `src/ui/brushChrome.ts` — installs the brush-frame mask custom properties at boot.
- `src/ui/Atmosphere.tsx` — the persistent depth layer.
- `src/ui/ScreenTransition.tsx` — the bleed crossfade wrapper.
- `src/ui/WaveStart.tsx` — the wave-start beat overlay.
- `src/ui/screens/TitleGhosts.tsx` — the six falling ghost words (title and chooser).
- `src/ui/__tests__/{Atmosphere,ScreenTransition,WaveStart,GameScreen.waveStart,TitleScreen,SetupScreen.frame}.test.tsx`
- `scripts/build-favicon.ts` — one-off glyph-to-path generator.
- `docs/qa/2026-10-07-second-pass-checklist.md` — manual QA matrix.

**Modified:** `src/ui/tokens.css`, `src/index.css` (large), `src/main.tsx`, `src/App.tsx`, `src/design/visualParams.ts` (+test), `src/design/__tests__/tokenParity.test.ts`, `src/render/{PixiStage,WordSprite,Particles,particleSim,brushStroke}.ts` (+tests), `src/ui/hud/Hud.tsx` (+test), `src/ui/screens/{GameScreen,TitleScreen,SetupScreen}.tsx`, `public/favicon.svg`, `package.json`, `README.md`, the spec (one amendment, Task 11).

---

### Task 1: Motion tokens, wash tokens, and the parity test

**Files:**
- Modify: `src/ui/tokens.css`
- Create: `src/design/motion.ts`
- Create: `src/design/__tests__/motion.test.ts`
- Modify: `src/design/__tests__/tokenParity.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `MOTION` — `{ bleedMs: 260, snapMs: 90, slashMs: 120, flareMs: 420, burstMs: 480, transitionMs: 360, beatMs: 1200 }` as a frozen const; `EASE` — `{ ink: 'cubic-bezier(0.15, 0.85, 0.35, 1)', drain: 'cubic-bezier(0.6, 0, 0.9, 0.6)' }`. Every later task reads durations from `MOTION`, never from a literal. CSS reads the same values as `--duration-bleed` etc.

Spec: §3.5, §4.2.

- [ ] **Step 1: Write the failing parity test**

Append to `src/design/__tests__/tokenParity.test.ts` (inside the existing `describe`, after the `FONT_STACK` test; add `import { EASE, MOTION } from '../motion';` at the top):

```ts
  /** `--duration-bleed` → `bleedMs`; `--ease-ink` → `ink`. */
  function readCssMotion(): { durations: Map<string, number>; eases: Map<string, string> } {
    const css = readFileSync(join(process.cwd(), 'src/ui/tokens.css'), 'utf8');
    const durations = new Map<string, number>();
    for (const [, name, ms] of css.matchAll(/--duration-([a-z]+):\s*(\d+)ms\s*;/g)) {
      durations.set(`${name}Ms`, Number(ms));
    }
    const eases = new Map<string, string>();
    for (const [, name, value] of css.matchAll(/--ease-([a-z]+):\s*([^;]+);/g)) {
      eases.set(name, value.trim());
    }
    return { durations, eases };
  }

  // Second-pass spec §4.2: motion tokens get the same CSS↔TS parity as colours.
  it('every --duration-* token has an equal MOTION entry, and vice versa', () => {
    const { durations } = readCssMotion();
    for (const [key, ms] of durations) {
      expect(MOTION, `tokens.css declares --duration-${key} but MOTION does not`).toHaveProperty(key);
      expect(MOTION[key as keyof typeof MOTION]).toBe(ms);
    }
    for (const key of Object.keys(MOTION)) {
      expect(durations.has(key), `MOTION.${key} has no --duration-* token`).toBe(true);
    }
  });

  it('every --ease-* token has an equal EASE entry, and vice versa', () => {
    const { eases } = readCssMotion();
    for (const [key, value] of eases) {
      expect(EASE, `tokens.css declares --ease-${key} but EASE does not`).toHaveProperty(key);
      expect(EASE[key as keyof typeof EASE]).toBe(value);
    }
    for (const key of Object.keys(EASE)) {
      expect(eases.has(key), `EASE.${key} has no --ease-* token`).toBe(true);
    }
  });
```

Note: the existing `--duration-fast/base/slow` tokens will now also be parsed, so `MOTION` must carry `fastMs: 120, baseMs: 220, slowMs: 600` too. That is the point — one table.

- [ ] **Step 2: Write the failing motion test**

`src/design/__tests__/motion.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { EASE, MOTION } from '../motion';

describe('motion tokens (second-pass spec §4.2)', () => {
  it('declares the seven new durations and keeps the three existing ones', () => {
    expect(MOTION).toEqual({
      fastMs: 120, baseMs: 220, slowMs: 600,
      bleedMs: 260, snapMs: 90, slashMs: 120, flareMs: 420, burstMs: 480, transitionMs: 360, beatMs: 1200,
    });
  });

  it('a flicker step never exceeds the 300ms rule (spec §7.7)', () => {
    expect(MOTION.snapMs * 3).toBeLessThanOrEqual(300);
  });

  it('ink decelerates and drain accelerates', () => {
    expect(EASE.ink).toBe('cubic-bezier(0.15, 0.85, 0.35, 1)');
    expect(EASE.drain).toBe('cubic-bezier(0.6, 0, 0.9, 0.6)');
  });
});
```

- [ ] **Step 3: Run both tests to verify they fail**

Run: `npx vitest run src/design/__tests__/motion.test.ts src/design/__tests__/tokenParity.test.ts`
Expected: FAIL — `Cannot find module '../motion'`.

- [ ] **Step 4: Add the tokens**

In `src/ui/tokens.css`, replace the `/* --- duration --- */` block with:

```css
  /* --- duration (second-pass spec §4.2) ----------------------------- */
  --duration-fast: 120ms;
  --duration-base: 220ms;
  --duration-slow: 600ms;
  --duration-bleed: 260ms;      /* spawn bleed-in, header bleed, control stagger */
  --duration-snap: 90ms;        /* one flicker step: lock, spawn halo, settle */
  --duration-slash: 120ms;      /* the kill slash drawing itself */
  --duration-flare: 420ms;      /* kill flare, impact glow */
  --duration-burst: 480ms;      /* droplet life (splatter and splash) */
  --duration-transition: 360ms; /* screen crossfade */
  --duration-beat: 1200ms;      /* the wave-start beat, end to end */
  /* Forms arrive decelerating; forms leave accelerating. Flicker is not an
     easing — it is a stepped keyframe over --duration-snap multiples. */
  --ease-ink: cubic-bezier(0.15, 0.85, 0.35, 1);
  --ease-drain: cubic-bezier(0.6, 0, 0.9, 0.6);
```

And add, after the `--color-fibre` declaration:

```css
  /* Ground-family washes for the atmosphere (second-pass spec §3.1, §3.5):
     CSS-only rgba, excluded from hex parity like --color-surface. Never on
     text or chrome. */
  --color-ground-wash: rgba(110, 130, 180, 0.12);
  --color-ground-wash-deep: rgba(90, 100, 140, 0.11);
```

And a new block after the `/* --- space --- */` ramp:

```css
  /* --- play-layer sizes (second-pass spec §3.3, §3.4) ---------------- */
  --size-machine-band: clamp(72px, 14vh, 120px);
  /* Defaults only: GameScreen rewrites both from playScale() at runtime. */
  --size-word-play: 52px;
  --hud-scale: 1.15;
```

- [ ] **Step 5: Create the TS mirror**

`src/design/motion.ts`:

```ts
/** Mirrors `--duration-*` (as `<name>Ms`) and `--ease-*` from
 *  `src/ui/tokens.css` (second-pass spec §4.2). Pixi tweens and React timers
 *  need numbers, not custom properties — same reason `palette.ts` exists.
 *  `tokenParity.test.ts` fails if either side drifts. */
export const MOTION = Object.freeze({
  fastMs: 120,
  baseMs: 220,
  slowMs: 600,
  bleedMs: 260,
  snapMs: 90,
  slashMs: 120,
  flareMs: 420,
  burstMs: 480,
  transitionMs: 360,
  beatMs: 1200,
});

export const EASE = Object.freeze({
  /** Forms arriving: decelerating. */
  ink: 'cubic-bezier(0.15, 0.85, 0.35, 1)',
  /** Forms leaving: accelerating. */
  drain: 'cubic-bezier(0.6, 0, 0.9, 0.6)',
});
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/design`
Expected: PASS (motion, tokenParity, visualParams).

- [ ] **Step 7: Commit**

```bash
git add src/ui/tokens.css src/design/motion.ts src/design/__tests__/motion.test.ts src/design/__tests__/tokenParity.test.ts
git commit -m "feat: motion and wash tokens with CSS/TS parity"
```

---

### Task 2: One scale for Pixi and CSS

**Files:**
- Create: `src/design/scale.ts`
- Create: `src/design/__tests__/scale.test.ts`
- Modify: `src/render/WordSprite.ts:12-22, 131-138`
- Modify: `src/render/PixiStage.ts` (constructor, `sync`, `handleResize`, `mountFloor`)
- Modify: `src/ui/screens/GameScreen.tsx`
- Modify: `src/index.css` (HUD type sizes)
- Modify: `src/render/__tests__/WordSprite.test.ts`

**Interfaces:**
- Consumes: `HEIGHT` from `src/render/brushStroke.ts`.
- Produces: `playScale(stageHeightPx: number): PlayScale` with `interface PlayScale { wordPx: number; floorPx: number; hudScale: number }`; constants `WORD_PX_MIN = 44`, `WORD_PX_MAX = 72`, `WORD_HEIGHT_RATIO = 0.065`, `REFERENCE_WORD_PX = 40`, `HUD_SCALE = 1.15`. `WordSprite`'s constructor becomes `new WordSprite(word, mode, wordPx)`; it exposes `readonly wordPx: number` and `get halfWidth(): number` (Tasks 8–9 use both). `PixiStage` keeps `private scale: PlayScale`.

Spec: §3.3.

- [ ] **Step 1: Write the failing test**

`src/design/__tests__/scale.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { HEIGHT as BRUSH_HEIGHT } from '../../render/brushStroke';
import { HUD_SCALE, playScale, WORD_PX_MAX, WORD_PX_MIN } from '../scale';

describe('playScale (second-pass spec §3.3)', () => {
  it('gives 52px words on the 800px-tall reference window', () => {
    expect(playScale(800).wordPx).toBe(52);
  });

  it('clamps at both ends', () => {
    expect(playScale(100).wordPx).toBe(WORD_PX_MIN);
    expect(playScale(5000).wordPx).toBe(WORD_PX_MAX);
    expect(playScale(0).wordPx).toBe(WORD_PX_MIN); // jsdom reports 0 heights
  });

  it('never drops below the chromatic-split floor of 40px', () => {
    expect(WORD_PX_MIN).toBeGreaterThanOrEqual(40);
  });

  it('scales the floor with the word, from the stroke generator\'s native height', () => {
    expect(playScale(800).floorPx).toBe(Math.round(BRUSH_HEIGHT * 52 / 40)); // 34
  });

  it('lifts the HUD a little less than the play layer', () => {
    expect(playScale(800).hudScale).toBe(HUD_SCALE);
    expect(HUD_SCALE).toBeLessThan(52 / 40);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/design/__tests__/scale.test.ts`
Expected: FAIL — `Cannot find module '../scale'`.

- [ ] **Step 3: Implement**

`src/design/scale.ts`:

```ts
import { HEIGHT as BRUSH_HEIGHT } from '../render/brushStroke';

/** Second-pass spec §3.3: shipped words were a fixed 40px at any window size,
 *  exactly the floor below which the chromatic split switches off. One pure
 *  function now feeds Pixi (WordSprite, the floor texture) and CSS
 *  (--size-word-play, --hud-scale via GameScreen) from the stage height. */
export interface PlayScale {
  /** Falling-word font size. */
  wordPx: number;
  /** Floor stroke canvas height, keeping the generator's proportions. */
  floorPx: number;
  /** Multiplier applied to the HUD type ramp. */
  hudScale: number;
}

export const WORD_PX_MIN = 44;
export const WORD_PX_MAX = 72;
export const WORD_HEIGHT_RATIO = 0.065; // 52px at 800 tall
export const REFERENCE_WORD_PX = 40; // the first pass's fixed size, for proportion
export const HUD_SCALE = 1.15;

export function playScale(stageHeightPx: number): PlayScale {
  const raw = Math.round(stageHeightPx * WORD_HEIGHT_RATIO);
  const wordPx = Math.min(WORD_PX_MAX, Math.max(WORD_PX_MIN, raw));
  return {
    wordPx,
    floorPx: Math.round((BRUSH_HEIGHT * wordPx) / REFERENCE_WORD_PX),
    hudScale: HUD_SCALE,
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/design/__tests__/scale.test.ts`
Expected: PASS.

- [ ] **Step 5: Thread `wordPx` through WordSprite**

In `src/render/WordSprite.ts`:

Replace the two style constants (lines 12–22) with:

```ts
const BASE_STYLE: Partial<TextStyle> = {
  fontFamily: FONT_STACK,
  fill: PALETTE.ink,
};

const HINT_STYLE: Partial<TextStyle> = {
  fontFamily: FONT_STACK,
  fill: PALETTE.inkDim,
};
// Recall hint renders at this fraction of the word size (was a fixed 26 at 40).
const HINT_SIZE_RATIO = 0.65;
```

Change the class header and constructor start to:

```ts
export class WordSprite {
  readonly view: Container;
  /** The font size this word was built at (second-pass spec §3.3). Fixed for
   *  the sprite's lifetime, like its effects treatment. */
  readonly wordPx: number;
  private readonly text: Text;
  // ...existing fields unchanged...

  constructor(word: AirborneWord, mode: GameMode, wordPx: number) {
    const display = mode === 'recall'
      ? word.card.gloss
      : word.card.kanji ?? word.card.kana[0];
    const resolution = Math.min(Math.max(window.devicePixelRatio, 1) * 2, 4);
    const { chromaticSplitPx, haloAlpha, glowAlpha } = visualParams(getSettings().effects);
    this.glowAlpha = glowAlpha;
    this.wordPx = wordPx;
    const fontSize = wordPx;
```

Then every `new TextStyle({ ...BASE_STYLE })` in the constructor becomes `new TextStyle({ ...BASE_STYLE, fontSize })` (the two ghost copies and the main text — the main text's spread already starts with `...BASE_STYLE,`; add `fontSize,` right after it). In `showHint`, `new TextStyle({ ...HINT_STYLE })` becomes `new TextStyle({ ...HINT_STYLE, fontSize: Math.round(this.wordPx * HINT_SIZE_RATIO) })`.

Add the accessor after `setPosition`:

```ts
  /** Half the rendered glyph width — the kill slash anchors at the word's
   *  left edge (second-pass spec §4.3). */
  get halfWidth(): number {
    return this.text.width / 2;
  }
```

- [ ] **Step 6: Make PixiStage own the scale**

In `src/render/PixiStage.ts`:

```ts
import { playScale, type PlayScale } from '../design/scale';
```

Add the field and set it in the constructor before `void this.mountFloor();`:

```ts
  private scale: PlayScale;
  // ...
    this.scale = playScale(app.screen.height);
```

Change `handleResize` to:

```ts
  private readonly handleResize = (): void => {
    // Sprites already airborne keep the size they were built at; only new
    // ones pick up the new size (second-pass spec §3.3). The floor keeps its
    // mount-time height and only stretches in width, as before.
    this.scale = playScale(this.app.screen.height);
    this.layoutFloor();
  };
```

In `sync`, `new WordSprite(word, mode)` becomes `new WordSprite(word, mode, this.scale.wordPx)`.

In `mountFloor`, the texture load becomes:

```ts
      texture = await loadBrushTexture(cssHex(PALETTE.system), FLOOR_TEXTURE_SEED, { height: this.scale.floorPx });
```

- [ ] **Step 7: Write the CSS side from the same function**

In `src/ui/screens/GameScreen.tsx`, add:

```tsx
import { useLayoutEffect, useRef, type RefObject } from 'react';
import { playScale } from '../../design/scale';
```

and inside the component, before `return`:

```tsx
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Second-pass spec §3.3: the buffer kana and the HUD ramp scale with the
  // Pixi word size from the one pure function, keyed on the playfield's
  // height (the screen minus the machine band). Re-run on resize so the
  // CSS side never lags Pixi's. jsdom reports 0 → playScale clamps to 44.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const apply = (): void => {
      const host = root.querySelector<HTMLElement>('.pixi-host');
      const { wordPx, hudScale } = playScale(host?.clientHeight ?? root.clientHeight);
      root.style.setProperty('--size-word-play', `${wordPx}px`);
      root.style.setProperty('--hud-scale', String(hudScale));
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);
```

and `<div className="game-screen">` becomes `<div className="game-screen" ref={rootRef} data-testid="game-screen">`.

In `src/index.css`, change the HUD sizes to read the scale:

```css
.hud-tab { /* ...existing... */ font-size: calc(var(--text-2xs) * var(--hud-scale)); }
.hud-value-word { font-family: var(--font-word); font-size: calc(var(--text-lg) * var(--hud-scale)); color: var(--color-ink); }
.hud-value-accent { font-family: var(--font-ui); font-weight: 700; font-size: calc(var(--text-lg) * var(--hud-scale)); color: var(--color-accent); }
.hud-wave-jp { font-family: var(--font-display); font-size: calc(var(--text-lg) * var(--hud-scale)); color: var(--color-ink); }
.hud-wave-lat { /* ...existing... */ font-size: calc(var(--text-2xs) * var(--hud-scale)); }
.hud-buffer-tick { /* ...existing... */ font-size: calc(var(--text-2xs) * var(--hud-scale)); }
.hud-buffer-kana { font-family: var(--font-word); font-size: var(--size-word-play); color: var(--color-ink); }
.hud-pip { width: calc(20px * var(--hud-scale)); height: calc(6px * var(--hud-scale)); transform: skewX(-22deg); }
```

(Edit each existing rule in place; only the `font-size`/size declarations change.)

- [ ] **Step 8: Pin the resize behaviour (Review Focus 1)**

Append to `src/ui/__tests__/Hud.test.tsx`? No — it belongs to GameScreen. Create `src/ui/__tests__/GameScreen.scale.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { EngineSnapshot } from '../../engine/types';
import { GameScreen } from '../screens/GameScreen';

const snapshot: EngineSnapshot = {
  status: 'playing', mode: 'reading', score: 0, lives: 3, wave: 1, combo: 0, maxCombo: 0,
  kills: 0, wrongSubmits: 0, bufferKana: '', bufferRomaji: '', lockedIds: [], missed: [], timeMs: 0,
};

function renderScreen() {
  return render(
    <GameScreen
      snapshot={snapshot} hostRef={{ current: null }} introCards={[]} planNotice={null} tierAdvance={null}
      onIntroduced={() => {}} onIntroComplete={() => {}} onRevenge={() => {}} onPlayAgain={() => {}} onTitle={() => {}}
    />,
  );
}

describe('GameScreen scale custom properties (second-pass spec §3.3)', () => {
  it('writes --size-word-play and --hud-scale from playScale on mount', () => {
    renderScreen();
    const root = screen.getByTestId('game-screen');
    expect(root.style.getPropertyValue('--size-word-play')).toBe('44px'); // jsdom: 0px tall → clamp floor
    expect(root.style.getPropertyValue('--hud-scale')).toBe('1.15');
  });

  it('rewrites them on window resize (Review Focus 1)', () => {
    renderScreen();
    const root = screen.getByTestId('game-screen');
    Object.defineProperty(root, 'clientHeight', { configurable: true, value: 1000 });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(root.style.getPropertyValue('--size-word-play')).toBe('65px'); // round(1000 × 0.065)
  });
});
```

Run: `npx vitest run src/ui/__tests__/GameScreen.scale.test.tsx`
Expected: PASS. (The `.pixi-host` child also reports 0 in jsdom, so the fallback to the root's height is what the resize case exercises.)

- [ ] **Step 9: Update the WordSprite unit test**

`chromaticSplitAllowed` is unchanged; add to `src/render/__tests__/WordSprite.test.ts`:

```ts
  it('is satisfied by every size playScale can produce (second-pass spec §3.3)', () => {
    expect(chromaticSplitAllowed(44)).toBe(true);
  });
```

- [ ] **Step 10: Check, then commit**

Run: `npm run check`
Expected: PASS.

```bash
git add src/design/scale.ts src/design/__tests__/scale.test.ts src/render/WordSprite.ts src/render/PixiStage.ts src/ui/screens/GameScreen.tsx src/index.css src/render/__tests__/WordSprite.test.ts src/ui/__tests__/GameScreen.scale.test.tsx
git commit -m "feat: window-relative play scale shared by Pixi and CSS"
```

---

### Task 3: The machine band — buffer below the kill line

**Files:**
- Modify: `src/ui/tokens.css` (one token)
- Modify: `src/index.css` (`.pixi-host`, `.hud-buffer`, new `.hud-band`)
- Modify: `src/ui/hud/Hud.tsx:41-45`
- Modify: `src/ui/__tests__/Hud.test.tsx`

**Interfaces:**
- Consumes: `--size-machine-band` (Task 1).
- Produces: a `.hud-band` element (last child of `.hud`) that owns the buffer; `.pixi-host` ends `--size-machine-band` above the screen's bottom edge. Tasks 12–13 reuse the `.machine-band` look for the title and chooser controls.

Spec: §3.4. The engine lands words at `y >= 1` of the canvas, so moving the canvas's bottom edge up moves the kill line up with it; fall *time* is unchanged because speed is in normalized units.

- [ ] **Step 1: Write the failing test**

Add to `src/ui/__tests__/Hud.test.tsx`, inside the top-level `describe('Hud', …)`:

```tsx
  // Second-pass spec §3.4: the buffer lives in the machine band below the
  // kill line, never inside the playfield where a centre-lane word falls
  // straight through it.
  it('renders the kana buffer inside the machine band, the last child of the HUD', () => {
    render(<Hud snapshot={snapshot} />);
    const band = screen.getByTestId('kana-buffer').closest('.hud-band');
    expect(band).not.toBeNull();
    expect(band?.parentElement?.className).toContain('hud');
    expect(band?.parentElement?.lastElementChild).toBe(band);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/ui/__tests__/Hud.test.tsx`
Expected: FAIL — `closest('.hud-band')` is null.

- [ ] **Step 3: Restructure the HUD markup**

In `src/ui/hud/Hud.tsx`, replace the buffer block (lines 41–45) with:

```tsx
      <div className="hud-band">
        <div className="hud-buffer" data-testid="kana-buffer">
          <span className="hud-buffer-tick">IN</span>
          <span className="hud-buffer-kana">{snapshot.bufferKana || ' '}</span>
          <span className="hud-buffer-caret" aria-hidden="true" />
        </div>
      </div>
```

- [ ] **Step 4: Move the canvas up and style the band**

`src/ui/tokens.css`, after `--color-grid-line`:

```css
  /* The cyan underglow that fills the machine band below the kill line
     (second-pass spec §3.4). */
  --color-underglow: rgba(0, 229, 255, 0.10);
```

`src/index.css`: in `.pixi-host`, change `inset: 0;` to `inset: 0 0 var(--size-machine-band) 0;`. Replace the whole `.hud-buffer` rule with:

```css
/* Second-pass spec §3.4: the band is the machine. It sits under the kill
   line (the canvas's bottom edge), holds the buffer, and carries the cyan
   underglow that used to have nowhere to go. */
.hud-band {
  margin-top: auto; height: var(--size-machine-band); flex: none;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(to top, var(--color-underglow), transparent);
}
.hud-buffer {
  display: flex; align-items: center; gap: var(--space-3);
  border: 1px solid var(--color-line); background: var(--color-surface);
  padding: var(--space-2) var(--space-5);
}
```

- [ ] **Step 5: Run the HUD tests, then everything**

Run: `npx vitest run src/ui/__tests__/Hud.test.tsx` → PASS. Then `npm run check` → PASS.

- [ ] **Step 6: Look at it**

Run the dev server (`npm run dev`), start a run, and confirm: the floor stroke's lower edge sits exactly at the top of the band, the deadline just above it, the buffer centred in the band, and no word ever overlaps the buffer. Keep a screenshot for the task report.

- [ ] **Step 7: Commit**

```bash
git add src/ui/tokens.css src/index.css src/ui/hud/Hud.tsx src/ui/__tests__/Hud.test.tsx
git commit -m "feat: machine band - buffer moves below the kill line"
```

---

### Task 4: Brush-edged chrome

**Files:**
- Modify: `src/render/brushStroke.ts` (add `brushFrameDataUri`)
- Create: `src/render/__tests__/brushFrame.test.ts`
- Create: `src/ui/brushChrome.ts`
- Create: `src/ui/__tests__/brushChrome.test.ts`
- Modify: `src/main.tsx`
- Modify: `src/index.css` (buttons, pickers, HUD value, buffer, tab, pips)

**Interfaces:**
- Consumes: nothing new.
- Produces: `brushFrameDataUri(seed: number, options: BrushFrameOptions): string` with `interface BrushFrameOptions { width: number; height: number; displacementScale?: number; strokeWidth?: number }`, a colour-free (white) stroked rect for use as a CSS mask. `installBrushChrome(root: HTMLElement): void` sets `--brush-frame-wide` (200×40, seed 7), `--brush-frame-tall` (260×70, seed 3) and `--brush-frame-sign` (520×220, seed 3) on `root` as `url("…")` values. Task 12 reads `--brush-frame-sign`.

Spec: §3.2.

- [ ] **Step 1: Write the failing generator test**

`src/render/__tests__/brushFrame.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { brushFrameDataUri } from '../brushStroke';

describe('brushFrameDataUri (second-pass spec §3.2)', () => {
  const uri = brushFrameDataUri(7, { width: 200, height: 40 });

  it('returns an inline SVG data URI sized to the box', () => {
    expect(uri).toMatch(/^data:image\/svg\+xml,/);
    expect(uri).toContain("width='200'");
    expect(uri).toContain("height='40'");
    expect(uri).toContain("preserveAspectRatio='none'");
  });

  it('is colour-free: it is a mask, and colour comes from the token behind it', () => {
    expect(uri).toContain("stroke='white'");
    expect(uri).not.toMatch(/%23[0-9a-f]{6}/i);
  });

  it('is a stroked outline, not a fill', () => {
    expect(uri).toContain("fill='none'");
    expect(uri).toContain('stroke-width');
  });

  it('varies with the seed and is stable for a seed', () => {
    expect(brushFrameDataUri(7, { width: 200, height: 40 })).toBe(uri);
    expect(brushFrameDataUri(8, { width: 200, height: 40 })).not.toBe(uri);
  });

  it('leaves no raw characters that break a data URI', () => {
    for (const illegal of ['<', '>', '"', '#']) expect(uri).not.toContain(illegal);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/render/__tests__/brushFrame.test.ts`
Expected: FAIL — `brushFrameDataUri is not a function`.

- [ ] **Step 3: Implement the generator**

Add to `src/render/brushStroke.ts`, before `loadBrushTexture`:

```ts
/** Options for `brushFrameDataUri`. Width and height are required: a frame
 *  is always drawn at the aspect of the box it masks, so the stroke weight
 *  does not visibly distort under `preserveAspectRatio='none'`. */
export interface BrushFrameOptions {
  width: number;
  height: number;
  /** Edge raggedness; keep at or under 2% of the shorter side. Default 3.5. */
  displacementScale?: number;
  /** Default 1.8. */
  strokeWidth?: number;
}

const FRAME_BASE_FREQUENCY = '0.05 0.4';
const FRAME_NUM_OCTAVES = 2;
const FRAME_DISPLACEMENT_SCALE = 3.5;
const FRAME_STROKE_WIDTH = 1.8;

/** A dry-brush rectangle outline for CSS `mask-image` (second-pass spec
 *  §3.2): the same turbulence-displacement construction as the floor, drawn
 *  as a white stroke so the element's `background-color` (a token) supplies
 *  the colour. Colour never enters this SVG, which is what keeps the
 *  "no literals outside tokens" rule intact. */
export function brushFrameDataUri(seed: number, options: BrushFrameOptions): string {
  const { width, height } = options;
  const displacementScale = options.displacementScale ?? FRAME_DISPLACEMENT_SCALE;
  const strokeWidth = options.strokeWidth ?? FRAME_STROKE_WIDTH;
  const inset = strokeWidth;
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' preserveAspectRatio='none'>` +
    `<filter id='b' x='-10%' y='-20%' width='120%' height='140%'>` +
    `<feTurbulence type='fractalNoise' baseFrequency='${FRAME_BASE_FREQUENCY}' numOctaves='${FRAME_NUM_OCTAVES}' seed='${seed}'/>` +
    `<feDisplacementMap in='SourceGraphic' scale='${displacementScale}' xChannelSelector='R' yChannelSelector='G'/>` +
    `</filter>` +
    `<rect x='${inset}' y='${inset}' width='${width - inset * 2}' height='${height - inset * 2}' ` +
    `fill='none' stroke='white' stroke-width='${strokeWidth}' stroke-linejoin='round' filter='url(#b)'/>` +
    `</svg>`;
  const encoded = svg
    .replaceAll('<', '%3C')
    .replaceAll('>', '%3E')
    .replaceAll('#', '%23')
    .replaceAll('"', '%22');
  return `data:image/svg+xml,${encoded}`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/render/__tests__/brushFrame.test.ts` → PASS.

- [ ] **Step 5: Write the failing installer test**

`src/ui/__tests__/brushChrome.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { installBrushChrome } from '../brushChrome';

describe('installBrushChrome (second-pass spec §3.2)', () => {
  it('sets the three frame masks as url() custom properties on the root it is given', () => {
    const root = document.createElement('div');
    installBrushChrome(root);
    for (const name of ['--brush-frame-wide', '--brush-frame-tall', '--brush-frame-sign']) {
      const value = root.style.getPropertyValue(name);
      expect(value, name).toMatch(/^url\("data:image\/svg\+xml,/);
      expect(value, name).toContain("stroke='white'");
    }
  });

  it('uses a distinct aspect per mask so strokes do not distort', () => {
    const root = document.createElement('div');
    installBrushChrome(root);
    expect(root.style.getPropertyValue('--brush-frame-wide')).toContain("width='200' height='40'");
    expect(root.style.getPropertyValue('--brush-frame-tall')).toContain("width='260' height='70'");
    expect(root.style.getPropertyValue('--brush-frame-sign')).toContain("width='520' height='220'");
  });
});
```

Run: `npx vitest run src/ui/__tests__/brushChrome.test.ts` → FAIL (module missing).

- [ ] **Step 6: Implement the installer and call it at boot**

`src/ui/brushChrome.ts`:

```ts
import { brushFrameDataUri } from '../render/brushStroke';

// Seeds: the wide frame shares the title rule's 7 on purpose (same stroke
// family as the mark it sits under); 3 is distinct from the floor (11) and
// the underline (4).
const FRAMES = [
  ['--brush-frame-wide', 7, { width: 200, height: 40 }],
  ['--brush-frame-tall', 3, { width: 260, height: 70, displacementScale: 4 }],
  ['--brush-frame-sign', 3, { width: 520, height: 220, displacementScale: 5, strokeWidth: 2 }],
] as const;

/** Second-pass spec §3.2: every 1px chrome border becomes a dry-brush stroke.
 *  The strokes are masks (colour-free SVG), applied in index.css as
 *  `mask-image: var(--brush-frame-*)` on a pseudo-element whose
 *  background-color is the token. Generated once at boot; pure, synchronous. */
export function installBrushChrome(root: HTMLElement): void {
  for (const [name, seed, options] of FRAMES) {
    root.style.setProperty(name, `url("${brushFrameDataUri(seed, options)}")`);
  }
}
```

In `src/main.tsx`, after the `./index.css` import add `import { installBrushChrome } from './ui/brushChrome'`, and before `createRoot(...)` add `installBrushChrome(document.documentElement)`.

- [ ] **Step 7: Apply the masks in CSS**

In `src/index.css`:

In the base `button` rule, replace `border: 1px solid var(--color-line);` with `border: 1px solid transparent; position: relative;`. In `button:hover`, delete `border-color: var(--color-system);`. Add directly after the `button:hover` rule:

```css
/* Second-pass spec §3.2, brush-edged chrome. The border is a mask on a
   pseudo-element; the token behind it is the colour. Hover, disabled and
   selection states recolour the mask, never the border. */
button::before, .hud-value::before, .hud-buffer::before, .picker::before {
  content: ''; position: absolute; inset: -1px; pointer-events: none;
  background-color: var(--color-line);
  -webkit-mask: var(--brush-frame-wide) center / 100% 100% no-repeat;
  mask: var(--brush-frame-wide) center / 100% 100% no-repeat;
}
.hud-buffer::before, .picker::before {
  -webkit-mask-image: var(--brush-frame-tall);
  mask-image: var(--brush-frame-tall);
}
button:hover::before { background-color: var(--color-system); }
button:disabled::before, button:disabled:hover::before { background-color: var(--color-line-soft); }
/* The primary action is a solid tab, not a frame: a torn trailing edge instead. */
button.primary::before { display: none; }
button.primary, .hud-tab {
  clip-path: polygon(0 0, 100% 0, 97% 30%, 100% 55%, 96% 80%, 100% 100%, 0 100%);
  padding-right: calc(var(--space-5) + 4px);
}
```

Then: in `.hud-value`, replace `border: 1px solid var(--color-line); border-left: none;` with `border: 1px solid transparent; position: relative;`; in `.hud-buffer` (Task 3's rule), replace `border: 1px solid var(--color-line);` with `border: 1px solid transparent; position: relative;`; in `.picker.selected, .picker.selected:hover`, delete `border-color: var(--color-system);` and add after that rule:

```css
.picker.selected::before, .picker.selected:hover::before { background-color: var(--color-system); }
```

and in `.hud-pip`, add `clip-path: polygon(0 15%, 100% 0, 96% 100%, 4% 90%);`.

- [ ] **Step 8: Verify by eye and by check**

`npm run check` → PASS. In the dev server: every button, picker, HUD value block and the buffer show a ragged cyan outline; the primary buttons and the HUD tabs have a torn right edge; hover brightens the outline; the selected picker's outline is bright cyan with its inset stripe; the disabled Save on Stats is dim. The reticle is unchanged (geometric).

- [ ] **Step 9: Commit**

```bash
git add src/render/brushStroke.ts src/render/__tests__/brushFrame.test.ts src/ui/brushChrome.ts src/ui/__tests__/brushChrome.test.ts src/main.tsx src/index.css
git commit -m "feat: brush-edged chrome - borders as colour-free dry-brush masks"
```

---

### Task 5: The atmosphere

**Files:**
- Modify: `src/design/visualParams.ts` (+ `atmosphereAlpha`)
- Modify: `src/design/__tests__/visualParams.test.ts`
- Create: `src/ui/Atmosphere.tsx`
- Create: `src/ui/__tests__/Atmosphere.test.tsx`
- Create: `src/ui/__tests__/App.atmosphere.test.tsx`
- Modify: `src/App.tsx` (single return, atmosphere behind every screen)
- Modify: `src/index.css` (`.atmosphere*`, `.app-screen`, `.pixi-host` background)

**Interfaces:**
- Consumes: `visualParams`, `useSettings`.
- Produces: `type AtmosphereScene = 'title' | 'chooser' | 'game' | 'calm'`; `GHOST_GLYPHS = ['言', '葉', '降'] as const`; `<Atmosphere scene={…} />`. `visualParams` gains `atmosphereAlpha: number` (1 / 0.5 / 0). Tasks 12–13 set scenes `title`/`chooser`.

Spec: §3.1, §6 rows 1–2.

- [ ] **Step 1: Write the failing visualParams test**

In `src/design/__tests__/visualParams.test.ts`, add to `'full gets every decoration'`: `expect(p.atmosphereAlpha).toBe(1);`; to `'reduced …'`: `expect(p.atmosphereAlpha).toBe(0.5);`; and change the `off` expectation to:

```ts
    expect(visualParams('off')).toEqual({
      chromaticSplitPx: 0, haloAlpha: 0, glowAlpha: 0, grainAlpha: 0, atmosphereAlpha: 0,
    });
```

Run: `npx vitest run src/design/__tests__/visualParams.test.ts` → FAIL.

- [ ] **Step 2: Add the field**

In `src/design/visualParams.ts`, add to the interface:

```ts
  /** Atmosphere washes, shaft, vignette, ghost glyphs, 0..1 (second-pass spec §3.1). */
  atmosphereAlpha: number;
```

and to the three constants: FULL `atmosphereAlpha: 1`, REDUCED `atmosphereAlpha: 0.5`, OFF `atmosphereAlpha: 0`. Run the test → PASS.

- [ ] **Step 3: Write the failing component test**

`src/ui/__tests__/Atmosphere.test.tsx`:

```tsx
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
```

Run: `npx vitest run src/ui/__tests__/Atmosphere.test.tsx` → FAIL (module missing).

- [ ] **Step 4: Implement the component**

`src/ui/Atmosphere.tsx`:

```tsx
import type { CSSProperties } from 'react';
import { visualParams } from '../design/visualParams';
import { useSettings } from './useSettings';

export type AtmosphereScene = 'title' | 'chooser' | 'game' | 'calm';

/** Second-pass spec §3.1: a fixed ambient set chosen for the identity.
 *  Never drawn from the deck, so a ghost can never resemble a live card. */
export const GHOST_GLYPHS = ['言', '葉', '降'] as const;
const GHOST_PLACEMENT: readonly CSSProperties[] = [
  { left: '6%', top: '10%' }, { left: '62%', top: '6%' }, { left: '34%', top: '62%' },
];

/** The persistent depth layer behind every screen (second-pass spec §3.1).
 *  Mounted once at the app root so the title, chooser and game share one
 *  continuous ground and the blurred layers rasterize once. `scene` only
 *  changes a data attribute; index.css decides what each scene shows. */
export function Atmosphere({ scene }: { scene: AtmosphereScene }) {
  const { effects } = useSettings();
  const { atmosphereAlpha } = visualParams(effects);
  const style = { '--atmosphere-alpha': String(atmosphereAlpha) } as CSSProperties;
  return (
    <div
      className="atmosphere"
      data-scene={scene}
      data-drift={effects === 'full' ? '1' : '0'}
      data-testid="atmosphere"
      aria-hidden="true"
      style={style}
    >
      <div className="atmosphere-depth">
        <div className="atmosphere-wash atmosphere-wash-system" />
        <div className="atmosphere-wash atmosphere-wash-cool" />
        <div className="atmosphere-wash atmosphere-wash-deep" />
        <div className="atmosphere-sumi" />
        <div className="atmosphere-shaft" />
        {GHOST_GLYPHS.map((glyph, i) => (
          <span key={glyph} className="atmosphere-ghost" style={GHOST_PLACEMENT[i]}>{glyph}</span>
        ))}
        <div className="atmosphere-vignette" />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Style it**

Add to `src/index.css`, a new section before `/* --- Title screen --- */`:

```css
/* --- Atmosphere (second-pass spec §3.1) -------------------------------
   One persistent layer behind every screen. CSS owns the backdrop; Pixi
   owns anything tied to game coordinates. No blend modes: the sumi tint is
   baked into its SVG. Washes animate transform only, on promoted layers, so
   their blur rasterizes once. Brightness ceiling: nothing here lifts the
   ground by more than ~8% luminance (spec §7.6). */
.atmosphere {
  position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden;
  background: var(--gradient-ground);
}
.app-screen { position: relative; z-index: 1; height: 100%; }
.atmosphere-depth {
  position: absolute; inset: 0; opacity: var(--atmosphere-alpha);
  transition: opacity var(--duration-transition) var(--ease-drain);
}
.atmosphere[data-scene='calm'] .atmosphere-depth { opacity: 0; }
.atmosphere-depth > * { position: absolute; }
.atmosphere-wash { border-radius: 50%; filter: blur(30px); will-change: transform; }
.atmosphere-wash-system {
  left: -12%; top: 8%; width: 56%; height: 46%;
  background: radial-gradient(ellipse at center, color-mix(in srgb, var(--color-system) 8.5%, transparent), transparent 70%);
  animation: atmosphere-sway 46s ease-in-out infinite alternate;
}
.atmosphere-wash-cool {
  right: -16%; top: 34%; width: 62%; height: 52%;
  background: radial-gradient(ellipse at center, var(--color-ground-wash), transparent 70%);
  animation: atmosphere-sway 58s ease-in-out infinite alternate-reverse;
}
.atmosphere-wash-deep {
  left: 22%; top: -24%; width: 52%; height: 42%;
  background: radial-gradient(ellipse at center, var(--color-ground-wash-deep), transparent 70%);
}
@keyframes atmosphere-sway { from { transform: translate(0, 0); } to { transform: translate(4%, 3%); } }
.atmosphere-sumi {
  inset: 0; opacity: 0.11; background-size: cover;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='400'%3E%3Cfilter id='s'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.006 0.012' numOctaves='3' seed='4'/%3E%3CfeColorMatrix values='0 0 0 0 0.75  0 0 0 0 0.9  0 0 0 0 1  0 0 0 1.5 -0.55'/%3E%3CfeGaussianBlur stdDeviation='5'/%3E%3C/filter%3E%3Crect width='600' height='400' filter='url(%23s)'/%3E%3C/svg%3E");
}
.atmosphere-shaft {
  left: 50%; bottom: var(--size-machine-band); width: 28%; height: 72%; transform: translateX(-50%);
  background: linear-gradient(to top, color-mix(in srgb, var(--color-system) 11%, transparent), color-mix(in srgb, var(--color-system) 3%, transparent) 45%, transparent 80%);
  filter: blur(16px);
}
.atmosphere-ghost {
  font-family: var(--font-word); font-weight: 600; line-height: 1; font-size: 12vw;
  color: color-mix(in srgb, var(--color-ink) 4.5%, transparent); filter: blur(2.4px);
  animation: atmosphere-drift 70s ease-in-out infinite alternate; will-change: transform;
}
@keyframes atmosphere-drift { from { transform: translateY(-5%); } to { transform: translateY(5%); } }
.atmosphere-vignette {
  inset: 0;
  background: radial-gradient(ellipse at 50% 60%, transparent 48%, color-mix(in srgb, var(--color-ground-deep) 70%, transparent) 100%);
}
.atmosphere[data-drift='0'] .atmosphere-wash, .atmosphere[data-drift='0'] .atmosphere-ghost { animation: none; }
```

The sumi SVG's `feColorMatrix` numbers are tint multipliers inside a noise mask, not a colour literal; they are the one place a number stands in for "cool ink wash" and this comment documents it.

Then make the canvas host transparent so the atmosphere shows through. In `.pixi-host`, delete `background-color: var(--color-ground);` and replace the `background-image`/`background-repeat`/`background-size` declarations with:

```css
  background-image: repeating-linear-gradient(to right, var(--color-grid-line) 0 1px, transparent 1px 76px);
```

- [ ] **Step 6: Mount it once at the app root**

In `src/App.tsx`: add `import type { ReactElement } from 'react';` and `import { Atmosphere, type AtmosphereScene } from './ui/Atmosphere';`. Replace the sequence of `if (screen === …) return <…/>` blocks at the end of `App` with one computed element:

```tsx
  const scene: AtmosphereScene =
    screen === 'title' ? 'title' : screen === 'setup' ? 'chooser' : screen === 'game' ? 'game' : 'calm';

  let content: ReactElement;
  if (screen === 'game') {
    content = (
      <GameScreen /* the existing props, unchanged */ />
    );
  } else if (screen === 'import') {
    content = <ImportScreen /* existing props */ />;
  } else if (screen === 'setup') {
    content = <SetupScreen /* existing props */ />;
  } else if (screen === 'stats') {
    content = <StatsScreen onBack={() => setScreen('title')} />;
  } else if (screen === 'settings') {
    content = <SettingsScreen onBack={() => setScreen('title')} />;
  } else {
    content = <TitleScreen onStart={() => setScreen('setup')} onStats={() => setScreen('stats')} onSettings={() => setScreen('settings')} />;
  }

  return (
    <>
      <Atmosphere scene={scene} />
      <div className="app-screen">{content}</div>
    </>
  );
```

Copy each screen's props verbatim from the current `return` blocks; nothing about them changes.

- [ ] **Step 7: Write the wiring test**

`src/ui/__tests__/App.atmosphere.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineSnapshot } from '../../engine/types';

const idle: EngineSnapshot = {
  status: 'idle', mode: 'reading', score: 0, lives: 0, wave: 0, combo: 0, maxCombo: 0,
  kills: 0, wrongSubmits: 0, bufferKana: '', bufferRomaji: '', lockedIds: [], missed: [], timeMs: 0,
};
vi.mock('../useEngine', () => ({
  useEngine: () => ({ snapshot: idle, hostRef: { current: null }, start: vi.fn(), resume: vi.fn(), introCards: [] }),
  isGameKey: () => false,
}));

import App from '../../App';

describe('App mounts one atmosphere behind every screen (second-pass spec §3.1)', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve([]) }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is in the title scene at boot and the chooser scene after Start, with one atmosphere', async () => {
    render(<App />);
    expect(screen.getByTestId('atmosphere').dataset.scene).toBe('title');
    await userEvent.click(screen.getByTestId('start-button'));
    expect(screen.getByTestId('atmosphere').dataset.scene).toBe('chooser');
    expect(screen.getAllByTestId('atmosphere')).toHaveLength(1);
  });

  it('goes calm on Settings', async () => {
    render(<App />);
    await userEvent.click(screen.getByTestId('settings-button'));
    expect(screen.getByTestId('atmosphere').dataset.scene).toBe('calm');
  });
});
```

- [ ] **Step 8: Run everything**

`npm run check` → PASS (every existing `App.*.test.tsx` must still pass: the refactor changes structure, not props).

- [ ] **Step 9: Verify the stacking by eye**

Dev server, start a run at effects full: the washes and shaft are visible behind the words, the grid and grain still sit above the canvas (the first spec's `.pixi-host canvas` rule is untouched), and the words remain the brightest thing on screen. Open Stats: the depth fades out over the transition duration and the stats gradient is unchanged. Keep a screenshot at full and at off.

- [ ] **Step 10: Commit**

```bash
git add src/design/visualParams.ts src/design/__tests__/visualParams.test.ts src/ui/Atmosphere.tsx src/ui/__tests__/Atmosphere.test.tsx src/ui/__tests__/App.atmosphere.test.tsx src/App.tsx src/index.css
git commit -m "feat: persistent sumi atmosphere behind every screen"
```

---

### Task 6: The effects contract, extended

**Files:**
- Modify: `src/design/visualParams.ts`
- Modify: `src/design/__tests__/visualParams.test.ts`

**Interfaces:**
- Consumes: `MOTION` (Task 1).
- Produces: `VisualParams` gains `spawnBlurPx`, `flicker`, `slashAlpha`, `flareAlpha`, `approachTintAlpha`, `swellAlpha`, `impactAlpha`, `shakePx`, `transitionBlurPx`, `transitionMs`, `waveBeat: 'centre' | 'fade' | 'slot'`. Tasks 7–13 read these and never branch on `effects` themselves.

Spec: §6 (the table is the oracle).

- [ ] **Step 1: Write the failing test**

Replace the whole of `src/design/__tests__/visualParams.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { MOTION } from '../motion';
import { visualParams } from '../visualParams';

// Second-pass spec §6, one row per field. The table is the oracle: a value
// here that disagrees with the spec is a bug in whichever one changed last.
describe('visualParams (first spec §7, second-pass spec §6)', () => {
  it('full gets every decoration', () => {
    expect(visualParams('full')).toEqual({
      chromaticSplitPx: 1.4, haloAlpha: 1, glowAlpha: 1, grainAlpha: 1, atmosphereAlpha: 1,
      spawnBlurPx: 8, flicker: 1, slashAlpha: 1, flareAlpha: 1, approachTintAlpha: 1, swellAlpha: 1,
      impactAlpha: 1, shakePx: 2, transitionBlurPx: 12, transitionMs: MOTION.transitionMs, waveBeat: 'centre',
    });
  });

  it('reduced keeps forms and drops every flicker, blur and shake', () => {
    expect(visualParams('reduced')).toEqual({
      chromaticSplitPx: 0, haloAlpha: 0.5, glowAlpha: 0.5, grainAlpha: 0.5, atmosphereAlpha: 0.5,
      spawnBlurPx: 0, flicker: 0, slashAlpha: 1, flareAlpha: 0.5, approachTintAlpha: 1, swellAlpha: 0,
      impactAlpha: 0.5, shakePx: 0, transitionBlurPx: 0, transitionMs: MOTION.transitionMs, waveBeat: 'fade',
    });
  });

  it('off strips all decoration but never a state carrier', () => {
    expect(visualParams('off')).toEqual({
      chromaticSplitPx: 0, haloAlpha: 0, glowAlpha: 0, grainAlpha: 0, atmosphereAlpha: 0,
      spawnBlurPx: 0, flicker: 0, slashAlpha: 0, flareAlpha: 0, approachTintAlpha: 0, swellAlpha: 0,
      impactAlpha: 0, shakePx: 0, transitionBlurPx: 0, transitionMs: MOTION.fastMs, waveBeat: 'slot',
    });
  });

  it('never returns a negative or out-of-range alpha', () => {
    for (const level of ['full', 'reduced', 'off'] as const) {
      const p = visualParams(level);
      for (const alpha of [p.haloAlpha, p.glowAlpha, p.grainAlpha, p.atmosphereAlpha, p.slashAlpha, p.flareAlpha, p.approachTintAlpha, p.swellAlpha, p.impactAlpha]) {
        expect(alpha).toBeGreaterThanOrEqual(0);
        expect(alpha).toBeLessThanOrEqual(1);
      }
      expect(p.chromaticSplitPx).toBeGreaterThanOrEqual(0);
      expect(p.shakePx).toBeGreaterThanOrEqual(0);
    }
  });

  it('the shake is a jolt, not a hit (spec §4.3: 2px, down from 4)', () => {
    expect(visualParams('full').shakePx).toBe(2);
  });

  it('a transition is never a cut (spec §4.4)', () => {
    for (const level of ['full', 'reduced', 'off'] as const) expect(visualParams(level).transitionMs).toBeGreaterThan(0);
  });
});
```

Run: `npx vitest run src/design/__tests__/visualParams.test.ts` → FAIL (missing fields).

- [ ] **Step 2: Extend the module**

Replace `src/design/visualParams.ts` with:

```ts
import type { Settings } from '../data/settings';
import { MOTION } from './motion';

export type WaveBeat = 'centre' | 'fade' | 'slot';

/** Rendering numbers derived from the effects level (first spec §7,
 *  second-pass spec §6). Decoration only — anything that conveys game state
 *  (the floor, the deadline, the reticle, lives, score, the buffer, the miss
 *  reveal, the wave number) renders regardless of these values, at flat
 *  intensity when they are 0. */
export interface VisualParams {
  /** Red/cyan offset on falling words, in px. 0 disables the split. */
  chromaticSplitPx: number;
  /** Word halo strength, 0..1. */
  haloAlpha: number;
  /** Floor / reticle / accent glow strength, 0..1. */
  glowAlpha: number;
  /** Backdrop grain + fibre strength, 0..1. */
  grainAlpha: number;
  /** Atmosphere washes, shaft, vignette, ghost glyphs, 0..1 (§3.1). */
  atmosphereAlpha: number;
  /** Spawn bleed-in blur radius, px. 0 = alpha-only (§4.3). */
  spawnBlurPx: number;
  /** 1 = flickers happen (lock, spawn halo, settle, deadline, sign); 0 = none (§7.7). */
  flicker: 0 | 1;
  /** Kill slash, 0..1 (§4.3). */
  slashAlpha: number;
  /** Kill flare, 0..1 (§4.3). */
  flareAlpha: number;
  /** Approach halo tint toward vermillion, 0..1 (§4.3). */
  approachTintAlpha: number;
  /** Red swell under the floor during approach, 0..1 (§4.3). */
  swellAlpha: number;
  /** Miss impact glow, 0..1 (§4.3). */
  impactAlpha: number;
  /** Miss screen-shake jitter, px (§4.3). */
  shakePx: number;
  /** Screen transition blur radius, px (§4.4). */
  transitionBlurPx: number;
  /** Screen transition duration, ms — never 0: a transition is never a cut (§4.4). */
  transitionMs: number;
  /** How the wave header arrives (§4.5). */
  waveBeat: WaveBeat;
}

const FULL: VisualParams = Object.freeze({
  chromaticSplitPx: 1.4, haloAlpha: 1, glowAlpha: 1, grainAlpha: 1, atmosphereAlpha: 1,
  spawnBlurPx: 8, flicker: 1, slashAlpha: 1, flareAlpha: 1, approachTintAlpha: 1, swellAlpha: 1,
  impactAlpha: 1, shakePx: 2, transitionBlurPx: 12, transitionMs: MOTION.transitionMs, waveBeat: 'centre',
});
const REDUCED: VisualParams = Object.freeze({
  chromaticSplitPx: 0, haloAlpha: 0.5, glowAlpha: 0.5, grainAlpha: 0.5, atmosphereAlpha: 0.5,
  spawnBlurPx: 0, flicker: 0, slashAlpha: 1, flareAlpha: 0.5, approachTintAlpha: 1, swellAlpha: 0,
  impactAlpha: 0.5, shakePx: 0, transitionBlurPx: 0, transitionMs: MOTION.transitionMs, waveBeat: 'fade',
});
const OFF: VisualParams = Object.freeze({
  chromaticSplitPx: 0, haloAlpha: 0, glowAlpha: 0, grainAlpha: 0, atmosphereAlpha: 0,
  spawnBlurPx: 0, flicker: 0, slashAlpha: 0, flareAlpha: 0, approachTintAlpha: 0, swellAlpha: 0,
  impactAlpha: 0, shakePx: 0, transitionBlurPx: 0, transitionMs: MOTION.fastMs, waveBeat: 'slot',
});

export function visualParams(effects: Settings['effects']): VisualParams {
  if (effects === 'off') return OFF;
  if (effects === 'reduced') return REDUCED;
  return FULL;
}
```

- [ ] **Step 3: Run the tests, then check**

`npx vitest run src/design` → PASS. `npm run check` → PASS (`presenceInvariant.test.ts` parses sources, not this module, and stays green).

- [ ] **Step 4: Commit**

```bash
git add src/design/visualParams.ts src/design/__tests__/visualParams.test.ts
git commit -m "feat: extend the effects contract with the second-pass decoration fields"
```

---

### Task 7: Spawn bleed and lock flicker

**Files:**
- Create: `src/render/spawnTween.ts`
- Create: `src/render/__tests__/spawnTween.test.ts`
- Modify: `src/render/WordSprite.ts`
- Modify: `src/render/PixiStage.ts` (`sync`, settings subscription)

**Interfaces:**
- Consumes: `MOTION`, `visualParams().spawnBlurPx`, `.flicker`.
- Produces: `spawnFrame(ageMs, params: SpawnParams): SpawnFrame` with `interface SpawnParams { blurPx: number; flicker: 0 | 1 }` and `interface SpawnFrame { alpha: number; blurPx: number; lightScale: number; done: boolean }`; `lockFlickerAlpha(ageMs: number, flicker: 0 | 1): number`. `WordSprite` gains `beginSpawn(params: SpawnParams, withBlur: boolean): void` and `get isBleeding(): boolean`. `PixiStage` gains `MAX_CONCURRENT_BLEEDS = 4`.

Spec: §4.3 Spawn, Lock; §6 rows "Spawn bleed / halo flicker", "Lock reticle + underline".

Design note: the halo is baked into the Text's texture (`dropShadow`), so it cannot be scaled per frame without re-rasterizing the glyph. The spawn flicker therefore multiplies the sprite's alpha — the whole lit glyph flickers on like a tube, which is the grammar's intent ("light moves like neon") at a fraction of the cost. The lock flicker scales the reticle and underline alpha, which are separate objects.

- [ ] **Step 1: Write the failing test**

`src/render/__tests__/spawnTween.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MOTION } from '../../design/motion';
import { lockFlickerAlpha, spawnFrame } from '../spawnTween';

const FULL = { blurPx: 8, flicker: 1 as const };
const CALM = { blurPx: 0, flicker: 0 as const };

describe('spawnFrame (second-pass spec §4.3 Spawn)', () => {
  it('starts invisible and fully blurred, ends opaque and sharp', () => {
    expect(spawnFrame(0, FULL)).toMatchObject({ alpha: 0, blurPx: 8, done: false });
    expect(spawnFrame(MOTION.bleedMs, FULL)).toMatchObject({ alpha: 1, blurPx: 0, done: true });
  });

  it('is clean past its life (Review Focus 4: a word killed mid-bleed must not leave a half state)', () => {
    expect(spawnFrame(MOTION.bleedMs * 10, FULL)).toEqual({ alpha: 1, blurPx: 0, lightScale: 1, done: true });
  });

  it('decelerates: the blur is more than half gone at the midpoint', () => {
    expect(spawnFrame(MOTION.bleedMs / 2, FULL).blurPx).toBeLessThan(4);
  });

  it('flickers the light in three steps inside the first two snaps, then holds', () => {
    expect(spawnFrame(0, FULL).lightScale).toBe(1);
    expect(spawnFrame(MOTION.snapMs + 1, FULL).lightScale).toBe(0.3);
    expect(spawnFrame(MOTION.snapMs * 2 + 1, FULL).lightScale).toBe(1);
  });

  it('with flicker 0 and blur 0 it is an alpha fade and nothing else', () => {
    for (const age of [0, 50, 130, 259, 260]) {
      const f = spawnFrame(age, CALM);
      expect(f.blurPx).toBe(0);
      expect(f.lightScale).toBe(1);
    }
  });
});

describe('lockFlickerAlpha (second-pass spec §4.3 Lock)', () => {
  it('snaps 0.9, dips to 0.2, settles at 1 over two snaps', () => {
    expect(lockFlickerAlpha(0, 1)).toBe(0.9);
    expect(lockFlickerAlpha(MOTION.snapMs + 1, 1)).toBe(0.2);
    expect(lockFlickerAlpha(MOTION.snapMs * 2, 1)).toBe(1);
  });

  it('is a flat 1 when flicker is off', () => {
    expect(lockFlickerAlpha(0, 0)).toBe(1);
    expect(lockFlickerAlpha(MOTION.snapMs + 1, 0)).toBe(1);
  });
});
```

Run: `npx vitest run src/render/__tests__/spawnTween.test.ts` → FAIL (module missing).

- [ ] **Step 2: Implement the pure tween**

`src/render/spawnTween.ts`:

```ts
import { MOTION } from '../design/motion';

export interface SpawnParams {
  /** Blur radius at age 0, px; 0 means alpha-only (visualParams.spawnBlurPx). */
  blurPx: number;
  /** 1 = the light flickers on; 0 = it fades on (visualParams.flicker). */
  flicker: 0 | 1;
}

export interface SpawnFrame {
  alpha: number;
  blurPx: number;
  /** Multiplier on the sprite's alpha for the neon flicker; 1 when settled. */
  lightScale: number;
  done: boolean;
}

/** `--ease-ink`'s shape, good enough as a scalar: fast start, soft landing. */
function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

/** Second-pass spec §4.3 Spawn: the form bleeds in (alpha and blur over
 *  --duration-bleed) while the light flickers on (1, 0.3, 1 inside the first
 *  two snap steps). Pure; the sprite applies the numbers. */
export function spawnFrame(ageMs: number, params: SpawnParams): SpawnFrame {
  if (ageMs >= MOTION.bleedMs) return { alpha: 1, blurPx: 0, lightScale: 1, done: true };
  const t = Math.max(0, ageMs) / MOTION.bleedMs;
  const eased = easeOut(t);
  let lightScale = 1;
  if (params.flicker === 1 && ageMs > MOTION.snapMs && ageMs <= MOTION.snapMs * 2) lightScale = 0.3;
  return { alpha: eased, blurPx: params.blurPx * (1 - eased), lightScale, done: false };
}

/** Second-pass spec §4.3 Lock: the reticle snaps on at 0.9, dips to 0.2 for
 *  one snap step, then settles at full. A single event (§7.7). */
export function lockFlickerAlpha(ageMs: number, flicker: 0 | 1): number {
  if (flicker === 0) return 1;
  if (ageMs <= MOTION.snapMs) return 0.9;
  if (ageMs < MOTION.snapMs * 2) return 0.2;
  return 1;
}
```

Run the test → PASS.

- [ ] **Step 3: Apply it in WordSprite**

In `src/render/WordSprite.ts`:

```ts
import { BlurFilter, Container, Graphics, Sprite, Text, TextStyle } from 'pixi.js';
import { lockFlickerAlpha, spawnFrame, type SpawnParams } from './spawnTween';
```

Add fields:

```ts
  private readonly flicker: 0 | 1;
  private spawn: { ageMs: number; params: SpawnParams; filter: BlurFilter | null } | null = null;
  private lockAgeMs = Number.POSITIVE_INFINITY;
```

In the constructor, destructure `flicker` from `visualParams(...)` alongside the others and set `this.flicker = flicker;`.

Add after `setPosition`:

```ts
  /** Second-pass spec §4.3: bleed in from blur while the light flickers on.
   *  `withBlur` is PixiStage's concurrency cap — past four simultaneous
   *  bleeds the blur is skipped so late waves never stack filters. */
  beginSpawn(params: SpawnParams, withBlur: boolean): void {
    const filter = withBlur && params.blurPx > 0 ? new BlurFilter({ strength: params.blurPx, quality: 2 }) : null;
    if (filter !== null) this.view.filters = [filter];
    this.view.alpha = 0;
    this.spawn = { ageMs: 0, params, filter };
  }

  get isBleeding(): boolean {
    return this.spawn !== null;
  }
```

Replace `update` with:

```ts
  /** Per-frame: advance the spawn bleed, the lock flicker and the hint fade. */
  update(deltaMS: number): void {
    if (this.spawn !== null) {
      this.spawn.ageMs += deltaMS;
      const frame = spawnFrame(this.spawn.ageMs, this.spawn.params);
      this.view.alpha = frame.alpha * frame.lightScale;
      if (this.spawn.filter !== null) this.spawn.filter.strength = frame.blurPx;
      if (frame.done) {
        this.view.filters = [];
        this.spawn.filter?.destroy(true);
        this.spawn = null;
        this.view.alpha = 1;
      }
    }
    if (this.lockAgeMs < MOTION_LOCK_SETTLE_MS) {
      this.lockAgeMs += deltaMS;
      const alpha = lockFlickerAlpha(this.lockAgeMs, this.flicker);
      if (this.brackets !== null) this.brackets.alpha = alpha;
      if (this.underline !== null) this.underline.alpha = alpha;
    }
    if (this.hintText !== null && this.hintText.alpha < 1) {
      this.hintText.alpha = Math.min(1, this.hintText.alpha + deltaMS / HINT_FADE_MS);
    }
  }
```

with, near the other constants, `import { MOTION } from '../design/motion';` and `const MOTION_LOCK_SETTLE_MS = MOTION.snapMs * 2;`.

In `setLocked`, after `this.locked = locked;` add `this.lockAgeMs = locked ? 0 : Number.POSITIVE_INFINITY;` and, after the two `visible` assignments, when locking reset alphas so a re-lock starts the flicker from its first step: `if (locked) { if (this.brackets) this.brackets.alpha = lockFlickerAlpha(0, this.flicker); if (this.underline) this.underline.alpha = lockFlickerAlpha(0, this.flicker); }`. In `ensureTargetArt`'s underline `.then`, set `underline.alpha = lockFlickerAlpha(this.lockAgeMs, this.flicker);` right after `underline.visible = this.locked;`.

In `destroy()`, before `this.view.destroy(...)` add `this.spawn?.filter?.destroy(true);` (Review Focus 4: a sprite killed mid-bleed frees its filter's program).

- [ ] **Step 4: Cap concurrency in PixiStage**

In `src/render/PixiStage.ts` add `const MAX_CONCURRENT_BLEEDS = 4;` beside the other constants, a field `private params = visualParams(getSettings().effects);`, and in the settings subscription callback add `this.params = visualParams(getSettings().effects);`. In `sync`, replace the sprite creation with:

```ts
      if (!sprite) {
        sprite = new WordSprite(word, mode, this.scale.wordPx);
        let bleeding = 0;
        for (const other of this.sprites.values()) if (other.isBleeding) bleeding += 1;
        sprite.beginSpawn(
          { blurPx: this.params.spawnBlurPx, flicker: this.params.flicker },
          bleeding < MAX_CONCURRENT_BLEEDS,
        );
        this.sprites.set(word.instanceId, sprite);
        this.app.stage.addChild(sprite.view);
      }
```

- [ ] **Step 5: Check and look**

`npm run check` → PASS. Dev server at full: words bleed in from blur with a flicker; at reduced (Settings → effects reduced) they fade in with no blur or flicker; locking a word shows the reticle snap-dip-settle at full and a plain snap at reduced.

- [ ] **Step 6: Commit**

```bash
git add src/render/spawnTween.ts src/render/__tests__/spawnTween.test.ts src/render/WordSprite.ts src/render/PixiStage.ts
git commit -m "feat: spawn bleed-in and lock flicker in the ink/neon grammar"
```

---

### Task 8: The kill — slash, splatter, flare

**Files:**
- Create: `src/design/colorMix.ts`, `src/design/__tests__/colorMix.test.ts`
- Modify: `src/design/palette.ts` (add `cssRgba`)
- Create: `src/render/killFx.ts`, `src/render/__tests__/killFx.test.ts`
- Create: `src/render/flareTexture.ts`
- Modify: `src/render/particleSim.ts`, `src/render/__tests__/particleSim.test.ts`
- Modify: `src/render/Particles.ts`
- Modify: `src/render/PixiStage.ts` (`playKill`, a sprite-fx helper)

**Interfaces:**
- Consumes: `MOTION`, `visualParams().slashAlpha/.flareAlpha`, `WordSprite.halfWidth/.wordPx`, `loadBrushTexture`.
- Produces: `mixColor(a: number, b: number, t: number): number`; `cssRgba(n: number, alpha: number): string`; `slashFrame(ageMs): { scaleX; alpha; done }`; `flareFrame(ageMs): { scale; alpha; done }`; `dropletPolygon(seed: number, size: number): number[]` (eight numbers, four points, centre origin); `SLASH_SEED`, `SLASH_LENGTH_RATIO`, `SLASH_ANGLE_RAD`; `flareTexture(): Promise<Texture>` (cached). `SimParticle` gains `shape: ParticleShape` and `seed: number`; `spawnBurst` gains a trailing `options: BurstOptions = {}` with `{ shape?: ParticleShape; upwardBias?: number }`. `Particles` gains `splash(x, y)` (Task 9 calls it). Task 9 reuses `flareTexture` and `cssRgba`.

Spec: §4.3 Kill; §6 row "Slash / splatter / flare".

- [ ] **Step 1: Write the failing colour tests**

`src/design/__tests__/colorMix.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mixColor } from '../colorMix';
import { cssRgba, PALETTE } from '../palette';

describe('mixColor', () => {
  it('returns the endpoints at t=0 and t=1', () => {
    expect(mixColor(PALETTE.system, PALETTE.danger, 0)).toBe(PALETTE.system);
    expect(mixColor(PALETTE.system, PALETTE.danger, 1)).toBe(PALETTE.danger);
  });
  it('lerps each channel and rounds', () => {
    expect(mixColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(mixColor(0xff0000, 0x0000ff, 0.25)).toBe(0xbf0040);
  });
  it('clamps t', () => {
    expect(mixColor(0x000000, 0xffffff, 2)).toBe(0xffffff);
    expect(mixColor(0x000000, 0xffffff, -1)).toBe(0x000000);
  });
});

describe('cssRgba', () => {
  it('renders a palette number as rgba()', () => {
    expect(cssRgba(PALETTE.system, 0.5)).toBe('rgba(0, 229, 255, 0.5)');
  });
});
```

Run → FAIL. Then create `src/design/colorMix.ts`:

```ts
/** Linear per-channel mix of two `0xRRGGBB` colours (second-pass spec §4.3:
 *  the approach tint and the cyan-cast droplets are mixes of two palette
 *  entries, never a third literal). */
export function mixColor(a: number, b: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const ca = (a >> shift) & 0xff;
    const cb = (b >> shift) & 0xff;
    out |= Math.round(ca + (cb - ca) * k) << shift;
  }
  return out >>> 0;
}
```

and add to `src/design/palette.ts`:

```ts
/** `rgba(r, g, b, a)` for canvas gradients that need alpha stops. */
export function cssRgba(n: number, alpha: number): string {
  return `rgba(${(n >> 16) & 0xff}, ${(n >> 8) & 0xff}, ${n & 0xff}, ${alpha})`;
}
```

Run → PASS.

- [ ] **Step 2: Write the failing kill-geometry tests**

`src/render/__tests__/killFx.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MOTION } from '../../design/motion';
import { dropletPolygon, flareFrame, slashFrame } from '../killFx';

describe('slashFrame (second-pass spec §4.3 Kill)', () => {
  it('draws itself over --duration-slash, holds one snap, fades over two', () => {
    expect(slashFrame(0)).toMatchObject({ scaleX: 0, alpha: 1, done: false });
    expect(slashFrame(MOTION.slashMs)).toMatchObject({ scaleX: 1, alpha: 1, done: false });
    expect(slashFrame(MOTION.slashMs + MOTION.snapMs)).toMatchObject({ scaleX: 1, alpha: 1 });
    const mid = slashFrame(MOTION.slashMs + MOTION.snapMs * 2);
    expect(mid.alpha).toBeCloseTo(0.5, 5);
    expect(slashFrame(MOTION.slashMs + MOTION.snapMs * 3)).toEqual({ scaleX: 1, alpha: 0, done: true });
  });
  it('decelerates while drawing', () => {
    expect(slashFrame(MOTION.slashMs / 2).scaleX).toBeGreaterThan(0.5);
  });
});

describe('flareFrame', () => {
  it('blooms from 0.1 to 1.7 and fades out over --duration-flare', () => {
    expect(flareFrame(0)).toMatchObject({ scale: 0.1, alpha: 1, done: false });
    expect(flareFrame(MOTION.flareMs)).toEqual({ scale: 1.7, alpha: 0, done: true });
    expect(flareFrame(MOTION.flareMs * 3)).toEqual({ scale: 1.7, alpha: 0, done: true });
  });
});

describe('dropletPolygon', () => {
  it('is four points around the origin, irregular, within 0.7–1.3 of the size', () => {
    const pts = dropletPolygon(0.37, 4);
    expect(pts).toHaveLength(8);
    const radii = [0, 2, 4, 6].map((i) => Math.hypot(pts[i], pts[i + 1]));
    for (const r of radii) {
      expect(r).toBeGreaterThanOrEqual(4 * 0.7 - 1e-9);
      expect(r).toBeLessThanOrEqual(4 * 1.3 + 1e-9);
    }
    expect(new Set(radii.map((r) => r.toFixed(6))).size).toBeGreaterThan(1);
  });
  it('is a pure function of its seed', () => {
    expect(dropletPolygon(0.5, 3)).toEqual(dropletPolygon(0.5, 3));
    expect(dropletPolygon(0.5, 3)).not.toEqual(dropletPolygon(0.9, 3));
  });
});
```

Run → FAIL. Then create `src/render/killFx.ts`:

```ts
import { MOTION } from '../design/motion';

/** Second-pass spec §4.3 Kill. Pure frames and geometry; PixiStage applies them. */

export const SLASH_SEED = 9; // distinct from floor 11, underline 4, title rule 7, frames 3
export const SLASH_LENGTH_RATIO = 2.6; // × wordPx
export const SLASH_ANGLE_RAD = (-16 * Math.PI) / 180;
export const FLARE_SCALE_MIN = 0.1;
export const FLARE_SCALE_MAX = 1.7;

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

const SLASH_HOLD_MS = MOTION.snapMs;
const SLASH_FADE_MS = MOTION.snapMs * 2;
export const SLASH_LIFE_MS = MOTION.slashMs + SLASH_HOLD_MS + SLASH_FADE_MS;

/** scaleX 0→1 over --duration-slash (decelerating), hold one snap, fade over two. */
export function slashFrame(ageMs: number): { scaleX: number; alpha: number; done: boolean } {
  if (ageMs >= SLASH_LIFE_MS) return { scaleX: 1, alpha: 0, done: true };
  if (ageMs < MOTION.slashMs) return { scaleX: easeOut(ageMs / MOTION.slashMs), alpha: 1, done: false };
  const sinceDrawn = ageMs - MOTION.slashMs;
  if (sinceDrawn < SLASH_HOLD_MS) return { scaleX: 1, alpha: 1, done: false };
  return { scaleX: 1, alpha: 1 - (sinceDrawn - SLASH_HOLD_MS) / SLASH_FADE_MS, done: false };
}

/** Scale 0.1→1.7 (decelerating), alpha 1→0, over --duration-flare. */
export function flareFrame(ageMs: number): { scale: number; alpha: number; done: boolean } {
  if (ageMs >= MOTION.flareMs) return { scale: FLARE_SCALE_MAX, alpha: 0, done: true };
  const t = Math.max(0, ageMs) / MOTION.flareMs;
  return { scale: FLARE_SCALE_MIN + (FLARE_SCALE_MAX - FLARE_SCALE_MIN) * easeOut(t), alpha: 1 - t, done: false };
}

/** Four points around the origin at radii 0.7–1.3 × size, derived from a
 *  seed in [0, 1) so each droplet is irregular but stable frame to frame. */
export function dropletPolygon(seed: number, size: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    // A tiny hash: fractional part of a large multiple of the seed, offset per point.
    const h = ((seed * 9301 + i * 49297) % 1 + 1) % 1;
    const r = size * (0.7 + 0.6 * h);
    const angle = (i / 4) * Math.PI * 2 + h * 0.6;
    out.push(Math.cos(angle) * r, Math.sin(angle) * r);
  }
  return out;
}
```

Run → PASS.

- [ ] **Step 3: Give particles a shape and a bias**

In `src/render/__tests__/particleSim.test.ts` add:

```ts
  it('defaults to dots with the standard upward bias, and takes droplets with a custom one', () => {
    const dots: SimParticle[] = [];
    spawnBurst(dots, 0, 0, 0xffffff, 1, rng);
    expect(dots[0].shape).toBe('dot');
    expect(dots[0].seed).toBe(0.5);
    const drops: SimParticle[] = [];
    spawnBurst(drops, 0, 0, 0xffffff, 1, rng, { shape: 'droplet', upwardBias: 220 });
    expect(drops[0].shape).toBe('droplet');
    expect(drops[0].vy).toBe(dots[0].vy - 160); // 220 − 60 more upward
  });
```

Run → FAIL. In `src/render/particleSim.ts`: add `export type ParticleShape = 'dot' | 'droplet';` and `export interface BurstOptions { shape?: ParticleShape; upwardBias?: number }`; add `shape: ParticleShape; seed: number;` to `SimParticle`; add the trailing parameter `options: BurstOptions = {}` to `spawnBurst`; inside the loop use `const upwardBias = options.upwardBias ?? UPWARD_BIAS;` in the `vy` expression and push `shape: options.shape ?? 'dot', seed: rng(),` — take the extra `rng()` call for `seed` *after* `size` so the existing fields' rng sequence is unchanged. Run → PASS (the existing tests use a constant rng, so they are unaffected).

- [ ] **Step 4: Draw droplets, and add the splash**

Replace `src/render/Particles.ts` with:

```ts
import { Container, Graphics } from 'pixi.js';
import { getSettings } from '../data/settings';
import { mixColor } from '../design/colorMix';
import { PALETTE } from '../design/palette';
import { dropletPolygon } from './killFx';
import {
  burstCount, killBurstBase, spawnBurst, stepParticles, type SimParticle,
} from './particleSim';

const KILL_COLOR = PALETTE.ink;
// Second-pass spec §4.3: every second droplet is tinted toward cyan — a mix
// of two palette entries, not a third colour.
const KILL_CAST_COLOR = mixColor(PALETTE.ink, PALETTE.system, 0.35);
const MISS_COLOR = PALETTE.danger;
const MISS_BASE = 8;
const SPLASH_BASE = 7;
const SPLASH_UPWARD_BIAS = 220; // rises, then gravity (240px/s²) brings it back within --duration-burst
const CONFETTI_PALETTE = [PALETTE.ink, PALETTE.system, PALETTE.accent];
const CONFETTI_BASE = 40;

/** Pixi-facing half of the particle system: owns the live pool and the single
 *  `Graphics` used to draw it every frame. The pool/physics live in
 *  particleSim.ts (pure, unit-tested); this class only spawns bursts (via
 *  the current effects level) and redraws. */
export class Particles {
  readonly view: Container;
  private readonly graphics: Graphics;
  private readonly pool: SimParticle[] = [];

  constructor() {
    this.graphics = new Graphics();
    this.view = new Container();
    this.view.addChild(this.graphics);
  }

  /** Kill splatter at a word's death position; size grows with combo tier.
   *  Half ink, half ink-with-a-cyan-cast, all droplets (spec §4.3). */
  killBurst(x: number, y: number, combo: number): void {
    const count = burstCount(getSettings().effects, killBurstBase(combo));
    const cast = Math.floor(count / 2);
    spawnBurst(this.pool, x, y, KILL_COLOR, count - cast, Math.random, { shape: 'droplet' });
    spawnBurst(this.pool, x, y, KILL_CAST_COLOR, cast, Math.random, { shape: 'droplet' });
  }

  /** Particle puff where a word landed (kept for the juice pass's contract). */
  missPuff(x: number, y: number): void {
    const count = burstCount(getSettings().effects, MISS_BASE);
    spawnBurst(this.pool, x, y, MISS_COLOR, count, Math.random, { shape: 'droplet' });
  }

  /** Miss splash (spec §4.3): vermillion droplets thrown up from the impact
   *  point; the sim's gravity brings them back down. */
  splash(x: number, y: number): void {
    const count = burstCount(getSettings().effects, SPLASH_BASE);
    spawnBurst(this.pool, x, y, MISS_COLOR, count, Math.random, { shape: 'droplet', upwardBias: SPLASH_UPWARD_BIAS });
  }

  /** Wave-clear confetti: one particle per staggered x position across the
   *  top edge, cycling through the palette. Dots, unchanged. */
  confettiSweep(width: number): void {
    const count = burstCount(getSettings().effects, CONFETTI_BASE);
    for (let i = 0; i < count; i += 1) {
      const x = ((i + 0.5) / count) * width;
      const color = CONFETTI_PALETTE[i % CONFETTI_PALETTE.length];
      spawnBurst(this.pool, x, 0, color, 1, Math.random);
    }
  }

  /** Per-frame: advance the sim, then fully redraw from the live pool. */
  update(deltaMs: number): void {
    stepParticles(this.pool, deltaMs);
    this.graphics.clear();
    for (const p of this.pool) {
      const alpha = 1 - p.ageMs / p.lifeMs;
      if (p.shape === 'droplet') {
        const pts = dropletPolygon(p.seed, p.size);
        for (let i = 0; i < pts.length; i += 2) {
          pts[i] += p.x;
          pts[i + 1] += p.y;
        }
        this.graphics.poly(pts, true).fill({ color: p.color, alpha });
      } else {
        this.graphics.circle(p.x, p.y, p.size).fill({ color: p.color, alpha });
      }
    }
  }
}
```

- [ ] **Step 5: The flare texture**

`src/render/flareTexture.ts`:

```ts
import { Texture } from 'pixi.js';
import { cssRgba, PALETTE } from '../design/palette';

const SIZE = 256;
let cached: Texture | null = null;

/** One radial sprite texture shared by the kill flare, the approach swell
 *  and the miss impact glow (second-pass spec §4.3): ink core, cyan edge,
 *  transparent rim. Tint the sprite for the vermillion uses. Built once on
 *  a canvas; must only be called from an instance method, never module
 *  scope (no DOM in node-environment tests). */
export function flareTexture(): Texture {
  if (cached !== null) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('2d canvas unavailable');
  const g = ctx.createRadialGradient(SIZE / 2, SIZE / 2, 0, SIZE / 2, SIZE / 2, SIZE / 2);
  g.addColorStop(0, cssRgba(PALETTE.ink, 0.95));
  g.addColorStop(0.3, cssRgba(PALETTE.system, 0.55));
  g.addColorStop(0.55, cssRgba(PALETTE.system, 0.18));
  g.addColorStop(0.72, cssRgba(PALETTE.system, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);
  cached = Texture.from(canvas);
  return cached;
}
```

- [ ] **Step 6: Play the kill in PixiStage**

In `src/render/PixiStage.ts`:

```ts
import { flareTexture } from './flareTexture';
import { flareFrame, SLASH_ANGLE_RAD, SLASH_LENGTH_RATIO, SLASH_LIFE_MS, SLASH_SEED, slashFrame } from './killFx';
```

Add beside the other module-scope constants:

```ts
const SLASH_STROKE_OPTIONS = { width: 300, height: 14, displacementScale: 8 };
// Shared and cached for the same reason as WordSprite's underline texture.
let slashTexturePromise: Promise<Texture> | null = null;
function slashTexture(): Promise<Texture> {
  slashTexturePromise ??= loadBrushTexture(cssHex(PALETTE.ink), SLASH_SEED, SLASH_STROKE_OPTIONS);
  return slashTexturePromise;
}
```

Add a sprite-fx helper after `spawnFx`:

```ts
  /** Like spawnFx, for a ready-made display object instead of a label. */
  private pushFx(view: Container, lifeMs: number, update: Fx['update']): void {
    this.app.stage.addChild(view);
    this.fx.push({ view, ageMs: 0, lifeMs, update });
  }
```

(`updateFx` already destroys expired views with `{ children: true, context: true }`; a Sprite ignores `context`.)

Replace the body of `playKill` with:

```ts
    const px = word.x * this.app.screen.width;
    const py = Math.min(word.y, 0.95) * this.app.screen.height;
    const sprite = this.sprites.get(word.instanceId);
    const halfW = sprite?.halfWidth ?? 0;
    const wordPx = sprite?.wordPx ?? this.scale.wordPx;
    const { slashAlpha, flareAlpha } = this.params;

    // Three things at once (spec §4.3): the slash cuts, the word bursts into
    // droplets, a neon flare blooms behind. Each is gated by its own alpha.
    if (flareAlpha > 0) {
      const flare = new Sprite(flareTexture());
      flare.anchor.set(0.5);
      flare.position.set(px, py);
      flare.zIndex = FLOOR_Z_INDEX + 0.5; // behind words, in front of the floor
      const base = (wordPx * 3.2) / flare.texture.width;
      this.pushFx(flare, MOTION.flareMs, (view, t) => {
        const f = flareFrame(t * MOTION.flareMs);
        view.scale.set(base * f.scale);
        view.alpha = f.alpha * flareAlpha;
      });
    }
    if (slashAlpha > 0) {
      void slashTexture().then((texture) => {
        if (this.destroyed) return;
        const slash = new Sprite(texture);
        slash.anchor.set(0, 0.5);
        slash.position.set(px - halfW, py);
        slash.rotation = SLASH_ANGLE_RAD;
        slash.width = wordPx * SLASH_LENGTH_RATIO;
        slash.height = Math.max(4, wordPx * 0.12);
        const fullWidth = slash.scale.x;
        this.pushFx(slash, SLASH_LIFE_MS, (view, t) => {
          const f = slashFrame(t * SLASH_LIFE_MS);
          view.scale.x = fullWidth * f.scaleX;
          view.alpha = f.alpha * slashAlpha;
        });
      });
    }
    this.particles.killBurst(px, py, combo);

    if (combo > 0 && combo % 5 === 0 && getSettings().effects !== 'off') {
      this.spawnFx(word, `×${combo}!`, PALETTE.accent, 500, (view, t) => {
        const pop = t < 0.3 ? 1 + (t / 0.3) * 0.3 : 1.3 - Math.min((t - 0.3) / 0.3, 1) * 0.3;
        view.scale.set(pop);
        view.alpha = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
      });
    }
```

(`import { MOTION } from '../design/motion';` too. The gloss scale-up tween that used to open `playKill` is dropped: the slash and flare replace it, and the reveal text is a miss-only teaching moment.) The slash texture decode is one-off and shared, so the `destroyed` check matches `mountFloor`'s posture; the slash sprite's texture is the cached one and `updateFx` never destroys textures.

- [ ] **Step 7: Check and look**

`npm run check` → PASS. Dev server at full: a kill shows the slash drawing across the word, droplets scattering (half with a cyan cast), a flare behind. At reduced: slash and half-strength flare, half the droplets. At off: the word vanishes and the score ticks, nothing else. Watch a wave-10 run for frame drops; note any in the task report.

- [ ] **Step 8: Commit**

```bash
git add src/design/colorMix.ts src/design/__tests__/colorMix.test.ts src/design/palette.ts src/render/killFx.ts src/render/__tests__/killFx.test.ts src/render/flareTexture.ts src/render/particleSim.ts src/render/__tests__/particleSim.test.ts src/render/Particles.ts src/render/PixiStage.ts
git commit -m "feat: kill as slash, ink splatter and neon flare"
```

---

### Task 9: Approach tension and the miss

**Files:**
- Create: `src/render/approach.ts`, `src/render/__tests__/approach.test.ts`
- Modify: `src/render/WordSprite.ts` (`setApproach`)
- Modify: `src/render/PixiStage.ts` (`sync`, `playMiss`, shake, deadline flicker)

**Interfaces:**
- Consumes: `mixColor`, `flareTexture`, `Particles.splash`, `visualParams().approachTintAlpha/.swellAlpha/.impactAlpha/.shakePx/.flicker`.
- Produces: `APPROACH_START_Y = 0.8`; `approachProgress(y: number): number`; `approachTint(progress: number): number`; `swellScaleX(progress: number): number`; `impactFrame(ageMs): { scaleX; alpha; done }`; `deadlineFlickerAlpha(ageMs: number, flicker: 0 | 1): number`. `WordSprite.setApproach(progress: number): void`.

Spec: §4.3 Approach, Miss; §6 rows "Approach tint / swell", "Miss splash / impact glow", "Deadline flicker / shake", "Miss reveal text, pip change" (state, unchanged).

- [ ] **Step 1: Write the failing tests**

`src/render/__tests__/approach.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { MOTION } from '../../design/motion';
import { PALETTE } from '../../design/palette';
import {
  APPROACH_START_Y, approachProgress, approachTint, deadlineFlickerAlpha, impactFrame, swellScaleX,
} from '../approach';

describe('approachProgress (second-pass spec §4.3 Approach)', () => {
  it('is 0 until the last fifth of the fall and 1 at the kill line', () => {
    expect(approachProgress(0)).toBe(0);
    expect(approachProgress(APPROACH_START_Y)).toBe(0);
    expect(approachProgress(0.9)).toBeCloseTo(0.5, 10);
    expect(approachProgress(1)).toBe(1);
    expect(approachProgress(1.2)).toBe(1);
  });
});

describe('approachTint', () => {
  it('runs from the system colour to danger, through a mix and never a third literal', () => {
    expect(approachTint(0)).toBe(PALETTE.system);
    expect(approachTint(1)).toBe(PALETTE.danger);
    const mid = approachTint(0.5);
    expect(mid).not.toBe(PALETTE.system);
    expect(mid).not.toBe(PALETTE.danger);
  });
});

describe('swellScaleX', () => {
  it('grows from 0.2 to 1 with progress', () => {
    expect(swellScaleX(0)).toBeCloseTo(0.2, 10);
    expect(swellScaleX(1)).toBeCloseTo(1, 10);
  });
});

describe('impactFrame (Miss)', () => {
  it('spreads 0.5→1.4 along the floor and fades over --duration-flare', () => {
    expect(impactFrame(0)).toMatchObject({ scaleX: 0.5, alpha: 1, done: false });
    expect(impactFrame(MOTION.flareMs)).toEqual({ scaleX: 1.4, alpha: 0, done: true });
  });
});

describe('deadlineFlickerAlpha (Miss)', () => {
  it('dips, returns, dips, returns, over three snaps, and only when flicker is on', () => {
    expect(deadlineFlickerAlpha(0, 1)).toBe(0.45);
    expect(deadlineFlickerAlpha(MOTION.snapMs, 1)).toBe(1);
    expect(deadlineFlickerAlpha(MOTION.snapMs * 2, 1)).toBe(0.45);
    expect(deadlineFlickerAlpha(MOTION.snapMs * 3, 1)).toBe(1);
    expect(deadlineFlickerAlpha(0, 0)).toBe(1);
  });
});
```

Run → FAIL. Then `src/render/approach.ts`:

```ts
import { mixColor } from '../design/colorMix';
import { MOTION } from '../design/motion';
import { PALETTE } from '../design/palette';

/** Second-pass spec §4.3 Approach/Miss: pure numbers; PixiStage and
 *  WordSprite apply them. Everything here is decoration — the floor and the
 *  deadline are the state, and position is already the signal (§9.4). */

export const APPROACH_START_Y = 0.8;
export const SWELL_SCALE_MIN = 0.2;
export const IMPACT_SCALE_MIN = 0.5;
export const IMPACT_SCALE_MAX = 1.4;
export const DEADLINE_FLICKER_LIFE_MS = MOTION.snapMs * 3;

/** 0 until the last fifth of the fall, 1 at the kill line. */
export function approachProgress(y: number): number {
  return Math.min(1, Math.max(0, (y - APPROACH_START_Y) / (1 - APPROACH_START_Y)));
}

/** Halo colour: system → danger with progress. */
export function approachTint(progress: number): number {
  return mixColor(PALETTE.system, PALETTE.danger, progress);
}

export function swellScaleX(progress: number): number {
  return SWELL_SCALE_MIN + (1 - SWELL_SCALE_MIN) * Math.min(1, Math.max(0, progress));
}

function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

export function impactFrame(ageMs: number): { scaleX: number; alpha: number; done: boolean } {
  if (ageMs >= MOTION.flareMs) return { scaleX: IMPACT_SCALE_MAX, alpha: 0, done: true };
  const t = Math.max(0, ageMs) / MOTION.flareMs;
  return { scaleX: IMPACT_SCALE_MIN + (IMPACT_SCALE_MAX - IMPACT_SCALE_MIN) * easeOut(t), alpha: 1 - t, done: false };
}

/** 0.45 → 1 → 0.45 → 1 over three snap steps; a single event (§7.7). */
export function deadlineFlickerAlpha(ageMs: number, flicker: 0 | 1): number {
  if (flicker === 0 || ageMs >= DEADLINE_FLICKER_LIFE_MS) return 1;
  const step = Math.floor(ageMs / MOTION.snapMs);
  return step % 2 === 0 ? 0.45 : 1;
}
```

Run → PASS.

- [ ] **Step 2: The halo warms in WordSprite**

In `src/render/WordSprite.ts` add imports `import { approachTint } from './approach';` and fields:

```ts
  private readonly approachTintAlpha: number;
  private readonly haloAlpha: number;
  private hotText: Text | null = null;
  private readonly display: string;
  private readonly resolution: number;
```

In the constructor destructure `approachTintAlpha` too, and store `this.approachTintAlpha = approachTintAlpha; this.haloAlpha = haloAlpha; this.display = display; this.resolution = resolution;`. Add after `setPosition`:

```ts
  /** Second-pass spec §4.3 Approach: over the last fifth of the fall the halo
   *  warms from cyan toward vermillion. The halo is baked into the glyph
   *  texture, so rather than re-rasterizing every frame, a second copy with a
   *  danger-coloured halo sits behind the first and cross-fades in. Built
   *  lazily on the first non-zero progress; most words die before it exists. */
  setApproach(progress: number): void {
    if (this.approachTintAlpha === 0 || this.haloAlpha === 0) return;
    if (progress <= 0) {
      if (this.hotText !== null) this.hotText.alpha = 0;
      return;
    }
    if (this.hotText === null) {
      this.hotText = new Text({
        text: this.display,
        style: new TextStyle({
          ...BASE_STYLE,
          fontSize: this.wordPx,
          dropShadow: { color: approachTint(1), blur: HALO_BLUR, distance: 0, alpha: this.haloAlpha },
          padding: HALO_PADDING,
        }),
        resolution: this.resolution,
      });
      this.hotText.anchor.set(0.5);
      this.view.addChildAt(this.hotText, this.view.getChildIndex(this.text));
    }
    this.hotText.alpha = progress * this.approachTintAlpha;
  }
```

`approachTint(1)` is `PALETTE.danger`; the mid-tones come from the cross-fade of the two halos, which is the same visual result as lerping the colour and costs one texture instead of sixty a second.

- [ ] **Step 3: Swell, splash, impact, flicker and the 2px shake in PixiStage**

In `src/render/PixiStage.ts`:

```ts
import { approachProgress, deadlineFlickerAlpha, DEADLINE_FLICKER_LIFE_MS, impactFrame, swellScaleX } from './approach';
```

Delete `const SHAKE_JITTER_PX = 4;` (the amplitude now comes from `visualParams`). Add fields:

```ts
  private readonly swells = new Map<number, Sprite>();
  private deadlineFlickerMs = Number.POSITIVE_INFINITY;
```

In the constructor's ticker callback add `this.updateDeadlineFlicker(delta);`.

In `sync`, inside the `for (const word of words)` loop after `sprite.setPosition(...)`, add:

```ts
      const progress = approachProgress(word.y);
      sprite.setApproach(progress);
      this.syncSwell(word.instanceId, word.x, progress);
```

and in the removal loop, next to `this.sprites.delete(id)`, add `this.removeSwell(id);`. Add the helpers:

```ts
  /** Red glow under the floor beneath an approaching word (spec §4.3), the
   *  flare texture tinted danger, growing with progress. Decoration only. */
  private syncSwell(id: number, x: number, progress: number): void {
    const { swellAlpha } = this.params;
    if (swellAlpha === 0 || progress <= 0) {
      this.removeSwell(id);
      return;
    }
    let swell = this.swells.get(id);
    if (swell === undefined) {
      swell = new Sprite(flareTexture());
      swell.anchor.set(0.5, 1);
      swell.tint = PALETTE.danger;
      swell.zIndex = FLOOR_Z_INDEX + 0.25;
      this.swells.set(id, swell);
      this.app.stage.addChild(swell);
    }
    const killY = this.app.screen.height * FLOOR_Y_RATIO;
    const base = (this.scale.wordPx * 10) / swell.texture.width;
    swell.position.set(x * this.app.screen.width, killY);
    swell.scale.set(base * swellScaleX(progress), base * 0.35);
    swell.alpha = progress * swellAlpha;
  }

  private removeSwell(id: number): void {
    const swell = this.swells.get(id);
    if (swell === undefined) return;
    swell.destroy(); // texture is the shared flare: never { texture: true }
    this.swells.delete(id);
  }

  /** Spec §4.3 Miss: the deadline dips and returns twice over three snaps. */
  private updateDeadlineFlicker(deltaMs: number): void {
    if (this.deadline === null || this.deadlineFlickerMs === Number.POSITIVE_INFINITY) return;
    this.deadlineFlickerMs += deltaMs;
    this.deadline.alpha = deadlineFlickerAlpha(this.deadlineFlickerMs, this.params.flicker);
    if (this.deadlineFlickerMs >= DEADLINE_FLICKER_LIFE_MS) {
      this.deadline.alpha = 1;
      this.deadlineFlickerMs = Number.POSITIVE_INFINITY;
    }
  }
```

Replace `playMiss`'s tail (from `const px = …` to the end) with:

```ts
    const px = word.x * this.app.screen.width;
    const killY = this.app.screen.height * FLOOR_Y_RATIO;
    // Splash: vermillion droplets thrown up from the impact point.
    this.particles.splash(px, killY);
    // Impact glow along the floor.
    const { impactAlpha, shakePx, flicker } = this.params;
    if (impactAlpha > 0) {
      const impact = new Sprite(flareTexture());
      impact.anchor.set(0.5, 1);
      impact.tint = PALETTE.danger;
      impact.position.set(px, killY);
      impact.zIndex = FLOOR_Z_INDEX + 0.5;
      const base = (this.scale.wordPx * 12) / impact.texture.width;
      this.pushFx(impact, MOTION.flareMs, (view, t) => {
        const f = impactFrame(t * MOTION.flareMs);
        view.scale.set(base * f.scaleX, base * 0.3);
        view.alpha = f.alpha * impactAlpha;
      });
    }
    if (flicker === 1) this.deadlineFlickerMs = 0;
    if (shakePx > 0) this.shakeMs = SHAKE_DURATION_MS;
```

(`missPuff` stays on `Particles` but is no longer called; delete it and its `MISS_BASE` constant.) In `updateShake`, replace both `SHAKE_JITTER_PX` uses with `this.params.shakePx`. In `destroy()`, add `for (const swell of this.swells.values()) swell.destroy(); this.swells.clear();` before `this.app.destroy(...)`.

- [ ] **Step 4: Check and look**

`npm run check` → PASS (`presenceInvariant.test.ts` still finds the floor and deadline mounts ungated). Dev server at full: let a word fall — in its last fifth the halo warms red and a red glow swells under the floor beneath it; on landing, droplets splash upward and fall, the floor glows red at the point, the deadline flickers, the stage jolts 2px, the reveal text appears as before. At reduced: tint only, half-strength impact, no flicker, no shake. At off: reveal and pip only.

- [ ] **Step 5: Commit**

```bash
git add src/render/approach.ts src/render/__tests__/approach.test.ts src/render/WordSprite.ts src/render/PixiStage.ts src/render/Particles.ts
git commit -m "feat: approach tension and the miss as splash, impact glow, deadline flicker"
```

---

### Task 10: The screen transition

**Files:**
- Create: `src/ui/ScreenTransition.tsx`
- Create: `src/ui/__tests__/ScreenTransition.test.tsx`
- Modify: `src/App.tsx` (wrap `content`)
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `visualParams().transitionMs/.transitionBlurPx/.flicker`, `useSettings`.
- Produces: `<ScreenTransition screenKey={string}>{children}</ScreenTransition>`; DOM: `.screen-stack > .screen-layer-out[inert]` (while draining, `data-testid="screen-out"`) and `.screen-layer-in` (`data-testid="screen-in"`, `tabIndex={-1}`).

Spec: §4.4; §6 row "Screen transition".

- [ ] **Step 1: Write the failing test**

`src/ui/__tests__/ScreenTransition.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSettingsCache, updateSettings } from '../../data/settings';
import { MOTION } from '../../design/motion';
import { ScreenTransition } from '../ScreenTransition';

describe('ScreenTransition (second-pass spec §4.4)', () => {
  beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); resetSettingsCache(); });
  afterEach(() => { vi.useRealTimers(); localStorage.clear(); resetSettingsCache(); });

  it('keeps the outgoing screen inert for the transition, then drops it', () => {
    const { rerender } = render(<ScreenTransition screenKey="title"><p>Title</p></ScreenTransition>);
    expect(screen.queryByTestId('screen-out')).toBeNull();
    rerender(<ScreenTransition screenKey="setup"><p>Setup</p></ScreenTransition>);
    const out = screen.getByTestId('screen-out');
    expect(out).toHaveTextContent('Title');
    expect(out).toHaveAttribute('inert');
    expect(out).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByTestId('screen-in')).toHaveTextContent('Setup');
    act(() => vi.advanceTimersByTime(MOTION.transitionMs));
    expect(screen.queryByTestId('screen-out')).toBeNull();
  });

  it('moves focus to the incoming screen at once, so the first keystroke lands there', () => {
    const { rerender } = render(<ScreenTransition screenKey="title"><p>Title</p></ScreenTransition>);
    document.body.focus();
    rerender(<ScreenTransition screenKey="game"><p>Game</p></ScreenTransition>);
    expect(document.activeElement).toBe(screen.getByTestId('screen-in'));
  });

  it('does not steal focus from a control the incoming screen already focused', () => {
    const { rerender } = render(<ScreenTransition screenKey="title"><p>Title</p></ScreenTransition>);
    rerender(<ScreenTransition screenKey="results"><button autoFocus>Play again</button></ScreenTransition>);
    expect(document.activeElement?.tagName).toBe('BUTTON');
  });

  it('two changes inside one transition keep only the most recent previous screen (Review Focus 3)', () => {
    const { rerender } = render(<ScreenTransition screenKey="title"><p>Title</p></ScreenTransition>);
    rerender(<ScreenTransition screenKey="setup"><p>Setup</p></ScreenTransition>);
    act(() => vi.advanceTimersByTime(100));
    rerender(<ScreenTransition screenKey="title"><p>Title again</p></ScreenTransition>);
    expect(screen.getAllByTestId('screen-out')).toHaveLength(1);
    expect(screen.getByTestId('screen-out')).toHaveTextContent('Setup');
    act(() => vi.advanceTimersByTime(MOTION.transitionMs - 1));
    expect(screen.queryByTestId('screen-out')).not.toBeNull(); // timer restarted at the second change
    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByTestId('screen-out')).toBeNull();
  });

  it('is never a cut: at effects off it is a 120ms crossfade with no blur', () => {
    updateSettings({ effects: 'off' });
    render(<ScreenTransition screenKey="title"><p>Title</p></ScreenTransition>);
    const stack = screen.getByTestId('screen-in').parentElement as HTMLElement;
    expect(stack.style.getPropertyValue('--transition-ms')).toBe(`${MOTION.fastMs}ms`);
    expect(stack.style.getPropertyValue('--transition-blur')).toBe('0px');
    expect(stack.dataset.flicker).toBe('0');
  });
});
```

Run → FAIL (module missing).

- [ ] **Step 2: Implement**

`src/ui/ScreenTransition.tsx`:

```tsx
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { visualParams } from '../design/visualParams';
import { useSettings } from './useSettings';

interface Layer {
  key: string;
  node: ReactNode;
}

interface ScreenTransitionProps {
  /** Changes when the screen changes; the old children drain, the new bleed in. */
  screenKey: string;
  children: ReactNode;
}

/** Second-pass spec §4.4: one transition, every direction. The outgoing
 *  screen stays mounted, inert and non-interactive, while it blurs and
 *  drains; the incoming screen mounts at once and receives focus so the
 *  first keystroke lands on it. Durations and blur come from visualParams:
 *  360ms with blur at full, 360ms crossfade at reduced, 120ms at off —
 *  never a cut. Decoration only; the screen itself is always mounted. */
export function ScreenTransition({ screenKey, children }: ScreenTransitionProps) {
  const { transitionMs, transitionBlurPx, flicker } = visualParams(useSettings().effects);
  const [outgoing, setOutgoing] = useState<Layer | null>(null);
  const previousRef = useRef<Layer>({ key: screenKey, node: children });
  const incomingRef = useRef<HTMLDivElement | null>(null);

  // Runs first on a key change: previousRef still holds the old screen's
  // last render (the tracker effect below updates it afterwards).
  useLayoutEffect(() => {
    if (previousRef.current.key === screenKey) return;
    setOutgoing(previousRef.current);
    const incoming = incomingRef.current;
    if (incoming !== null && !incoming.contains(document.activeElement)) incoming.focus({ preventScroll: true });
    const timer = window.setTimeout(() => setOutgoing(null), transitionMs);
    return () => window.clearTimeout(timer);
  }, [screenKey, transitionMs]);

  useEffect(() => {
    previousRef.current = { key: screenKey, node: children };
  });

  const style = {
    '--transition-ms': `${transitionMs}ms`,
    '--transition-blur': `${transitionBlurPx}px`,
  } as CSSProperties;

  return (
    <div className="screen-stack" style={style} data-flicker={flicker}>
      {outgoing !== null && (
        <div key={`out-${outgoing.key}`} className="screen-layer screen-layer-out" inert aria-hidden="true" data-testid="screen-out">
          {outgoing.node}
        </div>
      )}
      <div key={`in-${screenKey}`} ref={incomingRef} tabIndex={-1} className="screen-layer screen-layer-in" data-testid="screen-in">
        {children}
      </div>
    </div>
  );
}
```

(React 19 supports the boolean `inert` prop; `@types/react` 19 types it.)

- [ ] **Step 3: Style it**

Add to `src/index.css` after the atmosphere section:

```css
/* --- Screen transition (second-pass spec §4.4) --------------------- */
.screen-stack { position: relative; height: 100%; }
.screen-layer { position: absolute; inset: 0; outline: none; }
.screen-layer-out {
  pointer-events: none;
  animation: screen-drain var(--transition-ms) var(--ease-drain) forwards;
}
.screen-layer-in { animation: screen-bleed var(--transition-ms) var(--ease-ink); }
/* One brightness flicker as the new screen settles — light moves like neon. */
.screen-stack[data-flicker='1'] .screen-layer-in {
  animation: screen-bleed var(--transition-ms) var(--ease-ink),
             screen-settle calc(var(--duration-snap) * 2) steps(1, end) var(--transition-ms);
}
@keyframes screen-drain { to { opacity: 0; filter: blur(var(--transition-blur)); } }
@keyframes screen-bleed { from { opacity: 0; filter: blur(var(--transition-blur)); } }
@keyframes screen-settle { 0% { filter: brightness(2); } 50% { filter: brightness(0.5); } 100% { filter: brightness(1); } }
```

- [ ] **Step 4: Wrap the app's screen**

In `src/App.tsx`: `import { ScreenTransition } from './ui/ScreenTransition';` and change the final return to:

```tsx
  return (
    <>
      <Atmosphere scene={scene} />
      <div className="app-screen">
        <ScreenTransition screenKey={screen}>{content}</ScreenTransition>
      </div>
    </>
  );
```

- [ ] **Step 5: Run everything, including e2e**

`npm run check` → PASS. The existing `App.*.test.tsx` suites render through the wrapper now; a test that asserts on a screen *immediately* after a change still finds it (the incoming layer mounts synchronously), and the outgoing copy carries no `data-testid` collisions for them because `screen-out` is inert and they query by their own test ids — if any suite now finds two matches (e.g. `getByTestId('setup')` during the 360ms), wrap that assertion's screen change in `act(() => vi.advanceTimersByTime(360))` or query within `screen.getByTestId('screen-in')`. Then `npm run e2e` → PASS: `game.spec.ts` navigates straight into the game by URL, so the only transition it crosses is the one into play, and its keystrokes go to a window listener, not to focus.

- [ ] **Step 6: Commit**

```bash
git add src/ui/ScreenTransition.tsx src/ui/__tests__/ScreenTransition.test.tsx src/App.tsx src/index.css
git commit -m "feat: bleed crossfade between every screen"
```

---

### Task 11: The wave-start beat

**Files:**
- Create: `src/ui/WaveStart.tsx`, `src/ui/__tests__/WaveStart.test.tsx`
- Create: `src/ui/__tests__/GameScreen.waveStart.test.tsx`
- Modify: `src/ui/screens/GameScreen.tsx` (ceremony → beat → resume ordering)
- Modify: `src/ui/hud/Hud.tsx` (`waveLabelHidden` prop)
- Modify: `src/index.css`
- Modify: `docs/superpowers/specs/2026-10-07-visual-identity-second-pass-design.md` §4.5 (ordering amendment)

**Interfaces:**
- Consumes: `MOTION.beatMs`, `visualParams().waveBeat`, `useSettings`.
- Produces: `<WaveStart wave={number} onDone={() => void} />` (calls `onDone` exactly once, after `MOTION.beatMs`, or at once when `waveBeat === 'slot'`); `Hud` accepts `waveLabelHidden?: boolean`.

Spec: §4.5; §6 rows "Wave header" (state), "Wave light sweep" (decoration).

**Amendment to spec §4.5, recorded in this task.** The spec ordered the beat *before* any ceremonies. The keystone e2e (`e2e/game.spec.ts`, `clearCeremony`) waits for `waveIntro`, then loops while a ceremony is visible, then waits for `playing`; a beat that runs first would end that loop before the ceremony has appeared, and the spec also requires the keystone flow to stay untouched. The order is therefore **ceremony first, then the beat, then `resume()`** — learn the new words, then 第N波 announces that they are coming. The e2e's final wait for `playing` absorbs the beat's 1200ms. Amend §4.5's "Ordering inside the pause" sentence accordingly in Step 7.

- [ ] **Step 1: Write the failing overlay test**

`src/ui/__tests__/WaveStart.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSettingsCache, updateSettings } from '../../data/settings';
import { MOTION } from '../../design/motion';
import { WaveStart } from '../WaveStart';

describe('WaveStart (second-pass spec §4.5)', () => {
  beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); resetSettingsCache(); });
  afterEach(() => { vi.useRealTimers(); localStorage.clear(); resetSettingsCache(); });

  it('shows the wave number at centre and calls onDone exactly once after --duration-beat', () => {
    const onDone = vi.fn();
    render(<WaveStart wave={3} onDone={onDone} />);
    expect(screen.getByTestId('wave-start')).toHaveTextContent('第3波');
    expect(screen.getByTestId('wave-start').dataset.beat).toBe('centre');
    act(() => vi.advanceTimersByTime(MOTION.beatMs - 1));
    expect(onDone).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onDone).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(MOTION.beatMs));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('at reduced it fades at centre with no light sweep', () => {
    updateSettings({ effects: 'reduced' });
    render(<WaveStart wave={2} onDone={() => {}} />);
    expect(screen.getByTestId('wave-start').dataset.beat).toBe('fade');
  });

  it('at off the number is state only: nothing renders and onDone fires at once', () => {
    updateSettings({ effects: 'off' });
    const onDone = vi.fn();
    render(<WaveStart wave={2} onDone={onDone} />);
    expect(screen.queryByTestId('wave-start')).toBeNull();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('does not fire after unmount', () => {
    const onDone = vi.fn();
    const { unmount } = render(<WaveStart wave={1} onDone={onDone} />);
    unmount();
    act(() => vi.advanceTimersByTime(MOTION.beatMs * 2));
    expect(onDone).not.toHaveBeenCalled();
  });
});
```

Run → FAIL (module missing).

- [ ] **Step 2: Implement the overlay**

`src/ui/WaveStart.tsx`:

```tsx
import { useEffect, useRef } from 'react';
import { MOTION } from '../design/motion';
import { visualParams } from '../design/visualParams';
import { useSettings } from './useSettings';

interface WaveStartProps {
  wave: number;
  /** Called exactly once when the beat is over (or at once at effects off). */
  onDone: () => void;
}

/** Second-pass spec §4.5: 第N波 bleeds in large at the centre while a band of
 *  light rises from the floor, then drains as the HUD label bleeds in. Owns
 *  the last --duration-beat of the waveIntro pause, after any ceremony
 *  (ordering amendment, plan Task 11). The number itself is state: at
 *  `waveBeat === 'slot'` nothing renders here and the HUD label simply
 *  appears, because onDone fires immediately. */
export function WaveStart({ wave, onDone }: WaveStartProps) {
  const { waveBeat } = visualParams(useSettings().effects);
  const doneRef = useRef(false);
  useEffect(() => {
    const finish = (): void => {
      if (doneRef.current) return;
      doneRef.current = true;
      onDone();
    };
    if (waveBeat === 'slot') {
      finish();
      return;
    }
    const timer = window.setTimeout(finish, MOTION.beatMs);
    return () => window.clearTimeout(timer);
  }, [onDone, waveBeat]);

  if (waveBeat === 'slot') return null;
  return (
    <div className="wave-start" data-testid="wave-start" data-beat={waveBeat} aria-live="polite">
      <p className="wave-start-jp" lang="ja">第{wave}波</p>
      <p className="wave-start-lat">wave {wave}</p>
      <div className="wave-start-sweep" aria-hidden="true" />
    </div>
  );
}
```

Run the overlay test → PASS.

- [ ] **Step 3: Write the failing ordering test**

`src/ui/__tests__/GameScreen.waveStart.test.tsx`:

```tsx
// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSettingsCache } from '../../data/settings';
import { MOTION } from '../../design/motion';
import type { Card, EngineSnapshot } from '../../engine/types';
import { GameScreen } from '../screens/GameScreen';

const base: EngineSnapshot = {
  status: 'waveIntro', mode: 'reading', score: 0, lives: 3, wave: 2, combo: 0, maxCombo: 0,
  kills: 0, wrongSubmits: 0, bufferKana: '', bufferRomaji: '', lockedIds: [], missed: [], timeMs: 0,
};
const neko: Card = { id: 'neko', kanji: '猫', kana: ['ねこ'], gloss: 'cat', pos: 'n', jlpt: 5, source: 'jlpt' };

function renderIntro(introCards: Card[], onIntroComplete: () => void, snapshot = base) {
  return render(
    <GameScreen
      snapshot={snapshot} hostRef={{ current: null }} introCards={introCards} planNotice={null} tierAdvance={null}
      onIntroduced={() => {}} onIntroComplete={onIntroComplete} onRevenge={() => {}} onPlayAgain={() => {}} onTitle={() => {}}
    />,
  );
}

describe('GameScreen: ceremony, then the beat, then resume (second-pass spec §4.5 as amended)', () => {
  beforeEach(() => { vi.useFakeTimers(); localStorage.clear(); resetSettingsCache(); });
  afterEach(() => { vi.useRealTimers(); localStorage.clear(); resetSettingsCache(); });

  it('a wave with no new cards still gets exactly one beat before resume (Review Focus 2)', () => {
    const resume = vi.fn();
    renderIntro([], resume);
    expect(screen.queryByTestId('ceremony')).toBeNull(); // empty ceremony completes on mount
    expect(screen.getByTestId('wave-start')).toHaveTextContent('第2波');
    expect(resume).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(MOTION.beatMs));
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('with new cards, the ceremony shows first and the beat only after it completes', () => {
    const resume = vi.fn();
    renderIntro([neko], resume);
    expect(screen.getByTestId('ceremony')).toBeInTheDocument();
    expect(screen.queryByTestId('wave-start')).toBeNull();
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); // skip counts as introduced
    });
    expect(screen.queryByTestId('ceremony')).toBeNull();
    expect(screen.getByTestId('wave-start')).toBeInTheDocument();
    expect(resume).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(MOTION.beatMs));
    expect(resume).toHaveBeenCalledTimes(1);
  });

  it('hides the HUD wave label during the intro and shows it while playing', () => {
    const { rerender } = renderIntro([], () => {});
    expect(screen.getByTestId('wave').closest('.hud-wave')?.className).toContain('hud-wave-hidden');
    rerender(
      <GameScreen
        snapshot={{ ...base, status: 'playing' }} hostRef={{ current: null }} introCards={[]} planNotice={null} tierAdvance={null}
        onIntroduced={() => {}} onIntroComplete={() => {}} onRevenge={() => {}} onPlayAgain={() => {}} onTitle={() => {}}
      />,
    );
    expect(screen.getByTestId('wave').closest('.hud-wave')?.className).not.toContain('hud-wave-hidden');
    expect(screen.queryByTestId('wave-start')).toBeNull();
  });
});
```

Run → FAIL.

- [ ] **Step 4: Order it in GameScreen**

In `src/ui/screens/GameScreen.tsx`: add `import { useEffect, useState } from 'react';` (merge with the existing `RefObject` import), `import { WaveStart } from '../WaveStart';`, and inside the component:

```tsx
  // Second-pass spec §4.5 (ordering amendment, plan Task 11): the ceremony
  // owns the pause first; when it completes, the beat owns the rest and is
  // what finally calls onIntroComplete (= engine.resume). Reset for every
  // new pause so wave N+1 starts at its own ceremony.
  const [introPhase, setIntroPhase] = useState<'ceremony' | 'beat'>('ceremony');
  useEffect(() => {
    if (snapshot.status !== 'waveIntro') setIntroPhase('ceremony');
  }, [snapshot.status, snapshot.wave]);
```

Replace the `waveIntro` block with:

```tsx
      {snapshot.status === 'waveIntro' && introPhase === 'ceremony' && (
        <AcquisitionCeremony
          cards={introCards}
          onIntroduced={onIntroduced}
          onComplete={() => setIntroPhase('beat')}
        />
      )}
      {snapshot.status === 'waveIntro' && introPhase === 'beat' && (
        <WaveStart wave={snapshot.wave} onDone={onIntroComplete} />
      )}
```

and `<Hud snapshot={snapshot} />` becomes `<Hud snapshot={snapshot} waveLabelHidden={snapshot.status === 'waveIntro'} />`.

`AcquisitionCeremony`'s `onComplete` is called from an effect guarded by `completedRef`, so `setIntroPhase('beat')` fires once per ceremony instance. Because `onComplete` is a new arrow each render, the ceremony's `[done, onComplete]` effect re-runs on re-render, but its `completedRef` guard holds — same as today with `resume`.

In `src/ui/hud/Hud.tsx`: signature `export function Hud({ snapshot, waveLabelHidden = false }: { snapshot: EngineSnapshot; waveLabelHidden?: boolean })` and `<div className="hud-wave">` becomes `<div className={waveLabelHidden ? 'hud-wave hud-wave-hidden' : 'hud-wave'}>`.

- [ ] **Step 5: Style the beat**

Add to `src/index.css` after the transition section:

```css
/* --- Wave-start beat (second-pass spec §4.5) ------------------------ */
.hud-wave { transition: opacity var(--duration-bleed) var(--ease-ink); }
.hud-wave-hidden { opacity: 0; }
.wave-start {
  position: absolute; inset: 0 0 var(--size-machine-band) 0; z-index: 2; pointer-events: none;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-2);
}
.wave-start-jp {
  font-family: var(--font-display); font-size: calc(var(--size-word-play) * 2.6); line-height: 1;
  color: var(--color-ink); letter-spacing: 0.18em;
  animation: wave-bleed var(--duration-bleed) var(--ease-ink) both,
             wave-drain var(--duration-bleed) var(--ease-drain) calc(var(--duration-beat) - var(--duration-bleed)) forwards;
}
.wave-start-lat {
  font-family: var(--font-mono); font-size: var(--text-xs); letter-spacing: var(--tracking-label);
  text-transform: uppercase; color: var(--color-accent); opacity: 0.75;
  animation: wave-bleed var(--duration-bleed) var(--ease-ink) both,
             wave-drain var(--duration-bleed) var(--ease-drain) calc(var(--duration-beat) - var(--duration-bleed)) forwards;
}
.wave-start-sweep {
  position: absolute; left: 0; right: 0; bottom: 0; height: 22%; filter: blur(14px);
  background: linear-gradient(to top, transparent, color-mix(in srgb, var(--color-system) 28%, transparent) 50%, transparent);
  animation: wave-sweep 700ms var(--ease-ink) forwards;
}
.wave-start[data-beat='fade'] .wave-start-sweep { display: none; }
.wave-start[data-beat='fade'] .wave-start-jp, .wave-start[data-beat='fade'] .wave-start-lat {
  animation: wave-fade-in var(--duration-bleed) var(--ease-ink) both,
             wave-fade-out var(--duration-bleed) var(--ease-drain) calc(var(--duration-beat) - var(--duration-bleed)) forwards;
}
@keyframes wave-bleed { from { opacity: 0; filter: blur(10px); } to { opacity: 1; filter: blur(0); } }
@keyframes wave-drain { to { opacity: 0; filter: blur(6px); } }
@keyframes wave-fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes wave-fade-out { to { opacity: 0; } }
@keyframes wave-sweep { from { transform: translateY(0); opacity: 1; } to { transform: translateY(-350%); opacity: 0; } }
```

- [ ] **Step 6: Run everything, including e2e**

`npm run check` → PASS (`waveIntroSeam.test.tsx` and `useEngine.waves.test.tsx` drive the real hook with real timers; the seam test's final `waitFor(ceremony gone)` still holds, and `useEngine.waves` only observes `introCards`). `npm run e2e` → PASS: `clearCeremony`'s wait for `playing` now spans the beat.

- [ ] **Step 7: Amend the spec**

In `docs/superpowers/specs/2026-10-07-visual-identity-second-pass-design.md` §4.5, replace the sentence beginning "Ordering inside the pause:" with:

> **Amended 2026-10-07, during planning (Task 11).** Ordering inside the pause: ceremonies for any new cards first, then the beat, then `resume()` — the beat is what finally resumes. The spec originally put the beat first; the keystone e2e's ceremony loop (`clearCeremony`) exits as soon as no ceremony is visible, so a beat-first order would have ended it before the ceremony appeared, and the flow must stay untouched. Narratively it also reads better: learn the words, then the wave announces itself.

- [ ] **Step 8: Commit**

```bash
git add src/ui/WaveStart.tsx src/ui/__tests__/WaveStart.test.tsx src/ui/__tests__/GameScreen.waveStart.test.tsx src/ui/screens/GameScreen.tsx src/ui/hud/Hud.tsx src/index.css docs/superpowers/specs/2026-10-07-visual-identity-second-pass-design.md
git commit -m "feat: wave-start beat after the ceremony, before resume"
```

---

### Task 12: The title screen

**Files:**
- Create: `src/ui/screens/TitleGhosts.tsx`
- Modify: `src/ui/screens/TitleScreen.tsx` (rewrite)
- Create: `src/ui/__tests__/TitleScreen.test.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `brushStrokeDataUri`, `--brush-frame-sign` (Task 4), `visualParams().atmosphereAlpha/.flicker`, `useSettings`.
- Produces: `TITLE_GHOST_WORDS = ['雨', '勉強', '光', '図書館', '女', '犬'] as const`; `TITLE_GHOST_LANES_PCT = [6, 21, 79, 94, 13, 85] as const`; `<TitleGhosts dim?: boolean />` (Task 13 reuses it with `dim`); `.machine-band` and `.title-floor` styles (Task 13 reuses both). Existing test ids `start-button`, `stats-button`, `settings-button` are kept; new `title`, `title-sign`, `title-ghosts`.

Spec: §5.1, §5.3 (the wordmark), §6 rows "Ghost words falling", "Title sign flicker / stagger". Amends first spec §8: the title is now an arcade screen.

- [ ] **Step 1: Write the failing test**

`src/ui/__tests__/TitleScreen.test.tsx`:

```tsx
// @vitest-environment jsdom
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

  it('at effects off: no ghosts, no flicker, every control still present (Review Focus 5)', () => {
    updateSettings({ effects: 'off' });
    renderTitle();
    expect(screen.queryByTestId('title-ghosts')).toBeNull();
    expect(screen.getByTestId('title').dataset.motion).toBe('0');
    expect(screen.getByTestId('start-button')).toBeInTheDocument();
    expect(screen.getByTestId('title-sign')).toHaveTextContent('漢字落');
  });
});
```

Run → FAIL.

- [ ] **Step 2: The ghosts**

`src/ui/screens/TitleGhosts.tsx`:

```tsx
import type { CSSProperties } from 'react';
import { visualParams } from '../../design/visualParams';
import { useSettings } from '../useSettings';

/** Second-pass spec §5.1: a fixed ambient list, never the live deck. */
export const TITLE_GHOST_WORDS = ['雨', '勉強', '光', '図書館', '女', '犬'] as const;
/** Outer lanes only (percent of width), so a ghost never passes behind the
 *  sign or the controls; spread so no two can overlap at one height. */
export const TITLE_GHOST_LANES_PCT = [6, 21, 79, 94, 13, 85] as const;
const FALL_SECONDS = [14, 17, 15, 19, 16, 18] as const;
const OFFSET_SECONDS = [-3, -11, -7, -14, -9, -1] as const;

/** The game, already happening behind the title. `dim` halves the opacity
 *  for the run chooser (§5.2). Decoration: absent at effects off. */
export function TitleGhosts({ dim = false }: { dim?: boolean }) {
  const { atmosphereAlpha } = visualParams(useSettings().effects);
  if (atmosphereAlpha === 0) return null;
  const style = { '--ghost-alpha': String(atmosphereAlpha * (dim ? 0.5 : 1)) } as CSSProperties;
  return (
    <div className="title-ghosts" data-testid="title-ghosts" aria-hidden="true" style={style}>
      {TITLE_GHOST_WORDS.map((word, i) => (
        <span
          key={word}
          className="title-ghost"
          lang="ja"
          style={{ left: `${TITLE_GHOST_LANES_PCT[i]}%`, animationDuration: `${FALL_SECONDS[i]}s`, animationDelay: `${OFFSET_SECONDS[i]}s` }}
        >
          {word}
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: The sign over the floor**

Replace `src/ui/screens/TitleScreen.tsx` with:

```tsx
import { cssHex, PALETTE } from '../../design/palette';
import { visualParams } from '../../design/visualParams';
import { brushStrokeDataUri } from '../../render/brushStroke';
import { useSettings } from '../useSettings';
import { TitleGhosts } from './TitleGhosts';

// The sign's stroke: seed 7 as before (TitleScreen's own seed), now at the
// sign's full width. The title floor reuses the playfield floor's seed 11
// and defaults so the horizon here is the same stroke the game burns.
const SIGN_RULE_SEED = 7;
const FLOOR_SEED = 11;
const signRuleUrl = brushStrokeDataUri(cssHex(PALETTE.system), SIGN_RULE_SEED, { width: 480, height: 14, displacementScale: 5 });
const floorUrl = brushStrokeDataUri(cssHex(PALETTE.system), FLOOR_SEED);

interface TitleScreenProps {
  onStart: () => void;
  onStats: () => void;
  onSettings: () => void;
}

/** Second-pass spec §5.1: the title is an arcade screen — hazard stripe,
 *  ghost words falling in the outer lanes, a neon sign that flickers on,
 *  the floor raised to a horizon, the controls in the machine band. */
export function TitleScreen({ onStart, onStats, onSettings }: TitleScreenProps) {
  const { effects } = useSettings();
  const { flicker } = visualParams(effects);
  return (
    <div className="title-screen" data-testid="title" data-motion={effects === 'off' ? '0' : '1'}>
      <div className="hud-stripe" />
      <TitleGhosts />
      <div className="title-stage">
        <div className="title-sign" data-testid="title-sign" data-flicker={flicker}>
          <span className="title-corner title-corner-tl" aria-hidden="true" />
          <span className="title-corner title-corner-tr" aria-hidden="true" />
          <span className="title-corner title-corner-bl" aria-hidden="true" />
          <span className="title-corner title-corner-br" aria-hidden="true" />
          <h1 className="title-word">KanjiFall</h1>
          <div className="title-rule" style={{ backgroundImage: `url("${signRuleUrl}")` }} />
          <p className="title-jp" lang="ja">漢字落</p>
        </div>
        <p className="title-tagline">Type the reading. Press Enter. Don&apos;t let words hit the floor.</p>
        <p className="hint">Keyboard: a–z romaji · Enter submit · Backspace edit · Esc clear</p>
      </div>
      <div className="title-floor" style={{ backgroundImage: `url("${floorUrl}")` }} aria-hidden="true" />
      <div className="machine-band title-band">
        <button className="primary" data-testid="start-button" onClick={onStart}>Start — Reading mode (N5)</button>
        <button data-testid="stats-button" onClick={onStats}>Stats</button>
        <button data-testid="settings-button" onClick={onSettings}>Settings</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Style it**

Replace the `/* --- Title screen --- */` section of `src/index.css` (the `.title-mark`, `.title-word`, `.title-rule`, `.title-tagline` rules) with:

```css
/* --- Title screen (second-pass spec §5.1; amends first spec §8: the
   title and chooser are arcade screens now) ----------------------------- */
.title-screen { position: relative; height: 100%; display: flex; flex-direction: column; overflow: hidden; }
.title-stage {
  position: relative; z-index: 1; flex: 1; min-height: 0;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: var(--space-3);
}
.title-sign {
  position: relative; display: flex; flex-direction: column; align-items: center; gap: var(--space-2);
  padding: var(--space-4) var(--space-6) var(--space-3);
  background: color-mix(in srgb, var(--color-system) 3%, transparent);
}
.title-sign::before {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background-color: var(--color-line);
  -webkit-mask: var(--brush-frame-sign) center / 100% 100% no-repeat;
  mask: var(--brush-frame-sign) center / 100% 100% no-repeat;
}
.title-corner { position: absolute; width: 14px; height: 14px; border: 0 solid var(--color-system); }
.title-corner-tl { left: -4px; top: -4px; border-left-width: 2px; border-top-width: 2px; }
.title-corner-tr { right: -4px; top: -4px; border-right-width: 2px; border-top-width: 2px; }
.title-corner-bl { left: -4px; bottom: -4px; border-left-width: 2px; border-bottom-width: 2px; }
.title-corner-br { right: -4px; bottom: -4px; border-right-width: 2px; border-bottom-width: 2px; }
.title-word {
  font-family: var(--font-display); font-size: calc(var(--text-3xl) * 1.3); font-weight: 400; line-height: 1;
  color: var(--color-ink); letter-spacing: 0.1em;
}
.title-rule { width: 100%; height: 14px; background-repeat: no-repeat; background-size: 100% 100%; opacity: 0.9; }
.title-jp { font-family: var(--font-display); font-size: var(--text-lg); letter-spacing: 0.42em; color: var(--color-ink); }
.title-tagline { font-family: var(--font-ui); font-size: var(--text-base); color: var(--color-ink-dim); }
/* The sign flickers on like a tube at full (data-flicker=1), bleeds in at
   reduced; the copy and controls follow, staggered 80ms. Nothing animates
   at off (data-motion=0). A single event per mount (spec §7.7). */
.title-sign[data-flicker='1'] { animation: sign-on 520ms steps(1, end) both; }
.title-sign[data-flicker='0'] { animation: screen-bleed var(--duration-bleed) var(--ease-ink) both; }
.title-tagline, .title-screen .hint, .title-band > button { animation: screen-bleed var(--duration-bleed) var(--ease-ink) both; }
.title-tagline { animation-delay: 520ms; }
.title-screen .hint { animation-delay: 600ms; }
.title-band > button:nth-child(1) { animation-delay: 680ms; }
.title-band > button:nth-child(2) { animation-delay: 760ms; }
.title-band > button:nth-child(3) { animation-delay: 840ms; }
.title-screen[data-motion='0'] * { animation: none !important; }
@keyframes sign-on {
  0% { filter: brightness(0.1); } 15% { filter: brightness(2.2); } 25% { filter: brightness(0.2); }
  35% { filter: brightness(1.9); } 45% { filter: brightness(0.6); } 60% { filter: brightness(1.4); } 80%, 100% { filter: brightness(1); }
}
/* The floor as a horizon at the lower third, with the deadline beneath. */
.title-floor {
  position: absolute; left: 0; right: 0; bottom: 30%; height: 26px; z-index: 1;
  background-repeat: no-repeat; background-size: 100% 100%;
  filter: drop-shadow(0 0 7px color-mix(in srgb, var(--color-system) 75%, transparent)) drop-shadow(0 0 22px color-mix(in srgb, var(--color-system) 32%, transparent));
}
.title-floor::after { content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 1px; background: var(--color-danger); opacity: 0.45; }
.machine-band {
  position: relative; z-index: 1; display: flex; align-items: center; justify-content: center; gap: var(--space-3);
  background: linear-gradient(to top, var(--color-underglow), transparent);
}
.title-band { height: 30%; flex: none; }
/* Ghost words: outer lanes, 16% ink, dissolving into the floor at 70%. */
.title-ghosts { position: absolute; inset: 0; overflow: hidden; pointer-events: none; }
.title-ghost {
  position: absolute; top: -12%; transform: translateX(-50%); white-space: nowrap;
  font-family: var(--font-word); font-weight: 600; font-size: var(--size-word-play); line-height: 1;
  color: color-mix(in srgb, var(--color-ink) calc(16% * var(--ghost-alpha)), transparent);
  filter: blur(0.5px); opacity: 0;
  animation-name: title-fall; animation-timing-function: linear; animation-iteration-count: infinite;
}
@keyframes title-fall {
  0% { top: -12%; opacity: 0; } 6% { opacity: 1; } 84% { opacity: 1; top: 62%; } 92% { opacity: 0; top: 70%; } 100% { opacity: 0; top: 70%; }
}
```

- [ ] **Step 5: Run the tests, then check, then look**

`npx vitest run src/ui/__tests__/TitleScreen.test.tsx` → PASS. `npm run check` → PASS (`App.*` suites still click `start-button`). Dev server: at full the sign flickers on, then the tagline, hint and three buttons bleed in; six ghost words fall in the outer lanes and dissolve at the horizon; nothing passes behind the sign. At reduced the sign bleeds, ghosts at half opacity, no flicker. At off a static title with no ghosts. Keep a screenshot of each.

- [ ] **Step 6: Commit**

```bash
git add src/ui/screens/TitleGhosts.tsx src/ui/screens/TitleScreen.tsx src/ui/__tests__/TitleScreen.test.tsx src/index.css
git commit -m "feat: title as a neon sign over the floor with ghost words falling"
```

---

### Task 13: The run chooser inherits the title

**Files:**
- Modify: `src/ui/screens/SetupScreen.tsx` (markup only; logic untouched)
- Create: `src/ui/__tests__/SetupScreen.frame.test.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `<TitleGhosts dim />`, `.title-screen`/`.title-stage`/`.title-floor`/`.machine-band` (Task 12), `brushStrokeDataUri`.
- Produces: nothing new. Every existing test id (`setup`, `mode-*`, `pool-*`, `pool-list-*`, `list-row`, `import-button`, `tier-progress`, `load-error`, `begin-button`) is kept; `SetupScreen.lists.test.tsx` and `SetupScreen.tiers.test.tsx` must pass unchanged.

Spec: §5.2.

- [ ] **Step 1: Write the failing test**

`src/ui/__tests__/SetupScreen.frame.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetSettingsCache } from '../../data/settings';

vi.mock('../../data/listsClient', () => ({ fetchLists: vi.fn().mockResolvedValue(null) }));
vi.mock('../../data/planClient', () => ({ fetchRunPlan: vi.fn().mockResolvedValue(null) }));

import { SetupScreen } from '../screens/SetupScreen';

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
});
```

Run → FAIL.

- [ ] **Step 2: Reframe the markup**

In `src/ui/screens/SetupScreen.tsx` add imports:

```tsx
import { cssHex, PALETTE } from '../../design/palette';
import { brushStrokeDataUri } from '../../render/brushStroke';
import { useSettings } from '../useSettings';
import { TitleGhosts } from './TitleGhosts';

const FLOOR_SEED = 11; // same stroke as the title and the playfield
const floorUrl = brushStrokeDataUri(cssHex(PALETTE.system), FLOOR_SEED);
```

Inside the component add `const { effects } = useSettings();`, and change the returned JSX's outer shell only. The opening `<div className="screen-center" data-testid="setup">` becomes:

```tsx
    <div className="title-screen setup-screen" data-testid="setup" data-motion={effects === 'off' ? '0' : '1'}>
      <div className="hud-stripe" />
      <TitleGhosts dim />
      <div className="title-stage">
        <h2 className="setup-heading">Choose your run</h2>
```

Everything from the first `.picker-row` through the `load-error` paragraph stays exactly as it is, inside `.title-stage`. Then the final `.picker-row` holding Begin/Back becomes the band, and the stage closes before it:

```tsx
      </div>
      <div className="title-floor" style={{ backgroundImage: `url("${floorUrl}")` }} aria-hidden="true" />
      <div className="machine-band title-band">
        <button className="primary" data-testid="begin-button" disabled={loading} onClick={() => onBegin(mode, pool)}>
          {loading ? 'Loading words…' : 'Begin'}
        </button>
        <button onClick={onBack}>Back</button>
      </div>
    </div>
```

(Delete the old `<h2>Choose your run</h2>` and the old Begin/Back `.picker-row`.)

- [ ] **Step 3: Style the differences**

Add to `src/index.css` after the title section:

```css
/* --- Run chooser (second-pass spec §5.2): the title's frame, no sign. --- */
.setup-screen .title-stage { gap: var(--space-4); overflow-y: auto; padding: var(--space-6) var(--space-4); }
.setup-heading { font-family: var(--font-display); font-size: var(--text-xl); font-weight: 400; letter-spacing: 0.12em; color: var(--color-ink); }
.setup-screen .title-stage > * { animation: screen-bleed var(--duration-bleed) var(--ease-ink) both; }
.setup-screen .title-stage > :nth-child(2) { animation-delay: 80ms; }
.setup-screen .title-stage > :nth-child(3) { animation-delay: 160ms; }
.setup-screen .title-stage > :nth-child(4) { animation-delay: 240ms; }
```

- [ ] **Step 4: Run everything**

`npx vitest run src/ui/__tests__/SetupScreen` → all three suites PASS. `npm run check` → PASS. Dev server: Start → the chooser bleeds in over the same ghosts at half opacity, the pickers are brush-framed, Begin and Back sit in the band under the floor.

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/SetupScreen.tsx src/ui/__tests__/SetupScreen.frame.test.tsx src/index.css
git commit -m "feat: run chooser inherits the title frame"
```

---

### Task 14: The favicon

**Files:**
- Modify: `package.json` (devDependencies `opentype.js`, `@types/opentype.js`; script `build:favicon`)
- Create: `scripts/build-favicon.ts`
- Modify: `public/favicon.svg` (generated, committed)
- Create: `src/design/__tests__/favicon.test.ts`
- Modify: `README.md` (one line under "Rebuilding the card data" about the favicon script)

**Interfaces:**
- Consumes: `node_modules/@fontsource/yuji-syuku/files/*-400-normal.woff`, the hex tokens in `src/ui/tokens.css`.
- Produces: `public/favicon.svg`, 64×64, 落 as a path filled ink with a system-coloured edge on the ground colour.

Spec: §5.3.

- [ ] **Step 1: Install the one dev dependency**

```bash
npm i -D opentype.js @types/opentype.js
```

Add to `package.json` scripts: `"build:favicon": "tsx scripts/build-favicon.ts"`.

- [ ] **Step 2: Write the failing asset test**

`src/design/__tests__/favicon.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function token(name: string): string {
  const css = readFileSync(join(process.cwd(), 'src/ui/tokens.css'), 'utf8');
  const match = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css);
  if (match === null) throw new Error(`no ${name}`);
  return match[1].toLowerCase();
}

// Second-pass spec §5.3: 落 is the mark. The asset is generated once by
// scripts/build-favicon.ts and committed; this pins that it is a glyph
// path in the identity's own colours, read from tokens.css, not retyped.
describe('public/favicon.svg', () => {
  const svg = readFileSync(join(process.cwd(), 'public/favicon.svg'), 'utf8').toLowerCase();

  it('is a vector glyph on the ground colour', () => {
    expect(svg).toContain('<path');
    expect(svg).toContain(`fill="${token('--color-ground')}"`);
  });

  it('is filled ink with a system-coloured edge', () => {
    expect(svg).toContain(`fill="${token('--color-ink')}"`);
    expect(svg).toContain(`stroke="${token('--color-system')}"`);
  });

  it('names the glyph so the file is self-describing', () => {
    expect(svg).toContain('<!-- 落');
  });
});
```

Run → FAIL (the current favicon is the Vite logo).

- [ ] **Step 3: Write the generator**

`scripts/build-favicon.ts`:

```ts
/**
 * Generates public/favicon.svg: the kanji 落 ("fall") from Yuji Syuku, the
 * identity's display face, as an SVG path on the ground colour (second-pass
 * spec §5.3). Deterministic; re-run only if the face or the tokens change.
 * Run: npm run build:favicon
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import opentype from 'opentype.js';

const GLYPH = '落';
const SIZE = 64;
const FONT_DIR = 'node_modules/@fontsource/yuji-syuku/files';
const OUT = 'public/favicon.svg';

function token(name: string): string {
  const css = readFileSync('src/ui/tokens.css', 'utf8');
  const match = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css);
  if (match === null) throw new Error(`tokens.css has no ${name}`);
  return match[1].toLowerCase();
}

/** Fontsource splits Japanese into unicode-range slices; find the one that
 *  carries the glyph. opentype.js reads WOFF (not WOFF2). */
function fontWith(glyph: string): opentype.Font {
  for (const file of readdirSync(FONT_DIR).filter((f) => f.endsWith('-400-normal.woff')).sort()) {
    const font = opentype.loadSync(join(FONT_DIR, file));
    if (font.charToGlyphIndex(glyph) !== 0) return font;
  }
  throw new Error(`no Yuji Syuku slice contains ${glyph}`);
}

const font = fontWith(GLYPH);
const fontSize = SIZE * 0.84;
const glyph = font.charToGlyph(GLYPH);
const advance = (glyph.advanceWidth ?? font.unitsPerEm) * (fontSize / font.unitsPerEm);
const x = (SIZE - advance) / 2;
const y = SIZE * 0.5 + fontSize * 0.36; // optical centre for a square CJK glyph
const d = font.getPath(GLYPH, x, y, fontSize).toPathData(2);

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">\n` +
  `<!-- ${GLYPH} (fall) in Yuji Syuku, generated by scripts/build-favicon.ts; colours from src/ui/tokens.css -->\n` +
  `<rect width="${SIZE}" height="${SIZE}" fill="${token('--color-ground')}"/>\n` +
  `<path d="${d}" fill="${token('--color-ink')}" stroke="${token('--color-system')}" stroke-width="1.2" stroke-linejoin="round"/>\n` +
  `</svg>\n`;
writeFileSync(OUT, svg);
console.log(`wrote ${OUT} (${svg.length} bytes)`);
```

- [ ] **Step 4: Generate, test, look**

```bash
npm run build:favicon
npx vitest run src/design/__tests__/favicon.test.ts
```

Expected: the script prints the byte count; the test PASSES. Open `public/favicon.svg` in the browser: 落 in ink with a thin cyan edge on near-black, centred. If the glyph sits visibly off-centre, adjust the `0.36` baseline factor and re-run; the test does not pin geometry.

- [ ] **Step 5: README line**

Under "Rebuilding the card data (optional)" in `README.md`, add after the `build:data` block:

> The favicon (`public/favicon.svg`, the kanji 落 in the display face) is likewise generated and committed: `npm run build:favicon` regenerates it from the bundled Yuji Syuku font and the colour tokens.

- [ ] **Step 6: Check and commit**

`npm run check` → PASS.

```bash
git add package.json package-lock.json scripts/build-favicon.ts public/favicon.svg src/design/__tests__/favicon.test.ts README.md
git commit -m "feat: favicon is the 落 glyph in the identity's colours"
```

---

### Task 15: Effects matrix, legibility, README, and the spec's status

**Files:**
- Create: `docs/qa/2026-10-07-second-pass-checklist.md`
- Modify: `docs/screenshots/{title,gameplay,ceremony}.png`
- Modify: `README.md` (feature line), the spec (status line), fixes as found

**Interfaces:** none. This task verifies the previous fourteen against spec §6, §7 and §9.

- [ ] **Step 1: Write the checklist skeleton**

`docs/qa/2026-10-07-second-pass-checklist.md`, with the Observed/Result columns filled in during Step 2 (the first pass's checklist is the model):

```markdown
# Visual identity, second pass — QA checklist

Task 15 of `docs/superpowers/plans/2026-10-07-visual-identity-second-pass.md`.
Verifies spec `docs/superpowers/specs/2026-10-07-visual-identity-second-pass-design.md`
§6 (effects contract), §7 (legibility), §9 (testing) against the running app.

Browser: `kanjifall-e2e` (port 5183) only, via Playwright MCP — never the dev
config, which writes to the real study database.

## 1. §6 effects contract — one row per table cell

| Element | Level | Expected | Observed | Result |
|---|---|---|---|---|
| Atmosphere washes, shaft, vignette, sumi | full | On, drifting | | |
| Atmosphere washes, shaft, vignette, sumi | reduced | Half opacity, static | | |
| Atmosphere washes, shaft, vignette, sumi | off | Absent | | |
| Ghost glyphs (game) | full / reduced / off | Drift / static half / absent | | |
| Ghost words falling (title, chooser) | full / reduced / off | Fall / half opacity / absent | | |
| Brush-edged chrome | full / reduced / off | Present at every level; glow only at full | | |
| Spawn bleed + flicker | full / reduced / off | Blur+flicker / alpha only / appear | | |
| Lock reticle + underline | full / reduced / off | Snap+flicker / snap / snap — present at every level | | |
| Slash / splatter / flare | full / reduced / off | All / slash, half, half / none | | |
| Approach tint / swell | full / reduced / off | Both / tint only / none | | |
| Miss splash / impact glow | full / reduced / off | Both / half, half / none | | |
| Deadline flicker / shake (2px) | full / reduced / off | Both / none / none | | |
| Miss reveal text, pip change | full / reduced / off | Present at every level | | |
| Screen transition | full / reduced / off | Bleed+flicker / crossfade / 120ms crossfade — never a cut | | |
| Wave header | full / reduced / off | Centre beat + slot / centre fade + slot / slot only | | |
| Wave light sweep | full / reduced / off | On / off / off | | |
| Title sign flicker / stagger | full / reduced / off | Both / bleed, no stagger / appear | | |
| Existing: bloom, CRT, particle counts | each × crt on/off | As the juice pass | | |

## 2. §7 legibility

| Check | Expected | Observed | Result |
|---|---|---|---|
| 議 職 験 at 52px, atmosphere on, each level | Stroke detail unambiguous; words brightest on screen | | |
| Depth-layer luminance over the ground | ≤ ~8% at the brightest point (sample the shaft's base) | | |
| Any flicker, each level | ≤ 3 steps, ≤ 300ms each, none at reduced/off | | |

## 3. prefers-reduced-motion

| Check | Expected | Observed | Result |
|---|---|---|---|
| First run with the media query on | effects defaults to reduced: no blur, no flicker, no shake | | |

## 4. Late-wave frame time

| Check | Expected | Observed | Result |
|---|---|---|---|
| Wave 10+, effects full, 1280×800 | No sustained drop below 55fps; ≤ 4 concurrent spawn blurs | | |

## 5. Fixes landed during this pass

(one line per fix, with the commit)
```

- [ ] **Step 2: Walk the matrix**

Start `kanjifall-e2e` (port 5183, isolated DB), drive it with Playwright MCP, set each effects level via Settings, and fill every Observed/Result cell with what was seen and a screenshot identifier. Use `?seed=42&mode=reading&pool=n5` for determinism. For the late-wave row, use the browser's performance panel or `requestAnimationFrame` deltas logged from the console for 30 seconds at wave 10 (reach it with a fast config via a temporary URL seed is not available — play it, or temporarily lower `interWaveDelayMs` in a local-only edit that is reverted before commit).

- [ ] **Step 3: Fix what fails**

Each failing cell becomes a `fix:` commit against the owning task's files, and a line in §5 of the checklist. Re-run `npm run check` after each.

- [ ] **Step 4: Refresh the README screenshots and the feature line**

Replace `docs/screenshots/title.png`, `gameplay.png` and `ceremony.png` with 1280×800 captures at effects full (title after the sign has settled; gameplay with a locked word and a word in approach; ceremony as before). In `README.md`'s Features list add:

> - **Brushed ink lit as neon** — a sumi atmosphere behind the playfield, brush-edged chrome, and a motion grammar where forms move like ink and light moves like neon. Everything decorative scales with the effects setting; everything that carries game state renders at every level.

- [ ] **Step 5: Close the spec**

Change the spec's `**Status:**` line to `**Status:** Implemented — see docs/superpowers/plans/2026-10-07-visual-identity-second-pass.md`.

- [ ] **Step 6: Final gates and commit**

```bash
npm run check
npm run e2e
git add docs/qa/2026-10-07-second-pass-checklist.md docs/screenshots README.md docs/superpowers/specs/2026-10-07-visual-identity-second-pass-design.md
git commit -m "docs: second-pass QA matrix, refreshed screenshots, spec marked implemented"
```

---

## Self-Review

**1. Spec coverage.**

| Spec section | Task |
|---|---|
| §3.1 atmosphere, ghost glyphs, brightness ceiling, stacking | 5, 15 |
| §3.2 brush-edged chrome, tab tear, pips | 4 |
| §3.3 scale, chromatic-split floor, lane note | 2 |
| §3.4 machine band | 3 |
| §3.5 tokens | 1, 3 |
| §4.1 grammar, §4.2 motion tokens | 1, 6 |
| §4.3 spawn, lock | 7 |
| §4.3 kill | 8 |
| §4.3 approach, miss | 9 |
| §4.4 transitions | 10 |
| §4.5 wave start (as amended) | 11 |
| §5.1 title, §5.3 wordmark | 12 |
| §5.2 chooser | 13 |
| §5.3 favicon | 14 |
| §6 contract table | 6 (oracle), 15 (verification) |
| §7 legibility additions | 5 (ceiling), 7/9 (flicker rule in code), 15 |
| §8 phases | tasks run in that order |
| §9 testing | each task; e2e at 10, 11, 15 |
| §10 risks | blur cap (7), will-change (5), stacking (5 step 9), flicker rule (6/7/9), focus (10), ghost lanes (12), favicon devDep (14) |

Gap found and closed during this review: the spec's §4.5 ordering conflicted with the untouched keystone e2e; Task 11 amends it and records why.

**2. Placeholder scan.** No "TBD", "TODO", "similar to", or "add validation". Task 15's checklist has empty Observed/Result cells by design: they are the record the task produces, as in the first pass's checklist.

**3. Type consistency.** `MOTION.bleedMs/snapMs/slashMs/flareMs/burstMs/transitionMs/beatMs/fastMs/baseMs/slowMs` (Task 1) are the names used in Tasks 6–11. `playScale → { wordPx, floorPx, hudScale }` (Task 2) is what Tasks 7–9 read via `this.scale`. `WordSprite(word, mode, wordPx)`, `.halfWidth`, `.wordPx`, `.isBleeding`, `.beginSpawn(params, withBlur)`, `.setApproach(progress)` are declared in Tasks 2, 7, 9 and consumed in 7, 8, 9. `visualParams` fields (Task 6) match every consumer: `spawnBlurPx`/`flicker` (7), `slashAlpha`/`flareAlpha` (8), `approachTintAlpha`/`swellAlpha`/`impactAlpha`/`shakePx`/`flicker` (9), `transitionMs`/`transitionBlurPx`/`flicker` (10), `waveBeat` (11), `atmosphereAlpha` (5, 12, 13), `flicker` (12). `spawnBurst(..., options?: BurstOptions)` (Task 8) is used with `{ shape, upwardBias }` in `Particles.splash` (8) and called from `playMiss` (9). `pushFx` (Task 8) is used in Tasks 8 and 9. `flareTexture()` is synchronous (Task 8) and used synchronously in Task 9. `TitleGhosts` and the `.title-*`/`.machine-band` classes (Task 12) are what Task 13 reuses. `Hud`'s `waveLabelHidden` (Task 11) is optional, so Task 3's and the existing tests' `<Hud snapshot />` calls remain valid.

**4. Review Focus.** Each of the five lines has its test in the named task: resize → Task 2 step 8; no-new-cards wave → Task 11 step 3; double change → Task 10 step 1; killed mid-bleed → Task 7 step 1 (pure clean-state) and step 3 (filter destroyed in `destroy()`); title at off → Task 12 step 1.
