# Visual Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give KanjiFall one deliberate art direction — brushed ink lit as neon — replacing default typography, scattered hex literals, and an empty playfield with a token layer, four self-hosted faces, a real floor, and 2077-style HUD chrome.

**Architecture:** A design-token layer (`tokens.css` as source of truth, mirrored into `palette.ts` for Pixi, kept honest by a parity test) sits under everything. A pure `visualParams(effects)` module turns the existing settings enum into rendering numbers, so no component branches on `effects` ad hoc. CSS owns the backdrop; Pixi owns anything tied to game coordinates. Presentation only — no engine, data, or server changes.

**Tech Stack:** TypeScript, React 19, Pixi.js 8, pixi-filters, Recharts, Vitest (+ jsdom via per-file pragma), Playwright, Fontsource.

**Spec:** `docs/superpowers/specs/2026-08-15-visual-identity-design.md` — read it before Task 1. Sections are cited per task.

## Global Constraints

- **Node 20+.** Unchanged.
- **No engine, data, or server changes.** Nothing under `src/engine/`, `src/data/`, or `server/` changes behaviour. `src/data/settings.ts` is read, never modified — this plan adds no settings.
- **New runtime dependencies are exactly four**, all SIL OFL: `@fontsource/shippori-mincho-b1`, `@fontsource/yuji-syuku`, `@fontsource/chakra-petch`, `@fontsource/ibm-plex-mono`. No others.
- **No raw colour literals outside `src/ui/tokens.css` and `src/design/palette.ts`.** Every `#rrggbb` / `0xrrggbb` elsewhere is a bug after Task 4.
- **Information survives `effects: 'off'`; only decoration scales** (spec §7). The floor, deadline, reticle, lives, score, and buffer render at every level.
- **Legibility rules (spec §9) override aesthetics.** No blur or chromatic split on falling words below 40px; no glow on text below `--text-base`; vermillion is never small text; never signal with colour alone.
- **`npm run check` must pass** (`tsc -b && oxlint && vitest run`) before every commit.
- **TypeScript style:** explicit types on exported functions, `interface` for object shapes, `type` for unions, no `any`, immutable updates. `src/render/particleSim.ts` remains the documented mutation exception — do not "fix" it.
- **Commits are conventional** (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`).

---

## File Structure

**Created:**
- `src/ui/tokens.css` — every design token. Source of truth for colour, type, spacing, radius.
- `src/design/palette.ts` — TS mirror of the colour tokens as `0xRRGGBB` numbers, for Pixi.
- `src/design/visualParams.ts` — pure `effects` → rendering numbers.
- `src/design/__tests__/tokenParity.test.ts` — asserts CSS and TS palettes agree.
- `src/design/__tests__/visualParams.test.ts`
- `src/render/brushStroke.ts` — generates the dry-brush stroke as an SVG data URI.
- `src/render/__tests__/brushStroke.test.ts`
- `src/render/reticle.ts` — pure bracket geometry for the target reticle.
- `src/render/__tests__/reticle.test.ts`
- `src/ui/hud/pips.ts` — pure lives → pip states.
- `src/ui/hud/__tests__/pips.test.ts`
- `docs/qa/2026-08-15-visual-identity-checklist.md` — manual QA matrix.

**Modified:** `src/index.css` (largely rewritten), `src/main.tsx` (font + token imports), `src/render/{PixiStage,WordSprite,Particles,filters}.ts`, `src/ui/hud/{Hud.tsx,charts.tsx}`, every file in `src/ui/screens/`, `src/ui/__tests__/Hud.test.tsx`, `package.json`.

---

### Task 1: Design tokens and the parity test

**Files:**
- Create: `src/design/palette.ts`
- Create: `src/ui/tokens.css`
- Create: `src/design/__tests__/tokenParity.test.ts`
- Modify: `src/main.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `PALETTE` — a `const` object keyed by camelCase colour name with `0xRRGGBB` number values: `ink`, `inkDim`, `inkFaint`, `system`, `danger`, `accent`, `ground`, `groundLift`, `groundDeep`. Also `type PaletteKey = keyof typeof PALETTE`. Every later task reads colours from here, never from a literal.

Spec: §3.1, §3.2, §3.3.

- [ ] **Step 1: Write the failing parity test**

Create `src/design/__tests__/tokenParity.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PALETTE } from '../palette';

/** `--color-ink-dim` → `inkDim`. */
function toCamel(cssName: string): string {
  return cssName
    .replace(/^--color-/, '')
    .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Only hex-valued --color-* tokens participate; rgba() tokens like
 *  --color-surface are CSS-only surfaces Pixi never needs. */
function readCssPalette(): Map<string, number> {
  const css = readFileSync(join(process.cwd(), 'src/ui/tokens.css'), 'utf8');
  const found = new Map<string, number>();
  for (const [, name, hex] of css.matchAll(/(--color-[a-z-]+):\s*#([0-9a-fA-F]{6})\s*;/g)) {
    found.set(toCamel(name), Number.parseInt(hex, 16));
  }
  return found;
}

describe('token parity (visual-identity spec §3.3)', () => {
  it('every hex --color-* token in tokens.css has an equal PALETTE entry', () => {
    for (const [key, value] of readCssPalette()) {
      expect(PALETTE, `tokens.css declares --color-${key} but PALETTE does not`).toHaveProperty(key);
      expect(PALETTE[key as keyof typeof PALETTE]).toBe(value);
    }
  });

  it('every PALETTE entry has a matching token in tokens.css', () => {
    const css = readCssPalette();
    for (const key of Object.keys(PALETTE)) {
      expect(css.has(key), `PALETTE.${key} has no --color-* token in tokens.css`).toBe(true);
    }
  });

  it('declares the five ranked colours of the colour order', () => {
    expect(PALETTE.ink).toBe(0xf6f1e6);
    expect(PALETTE.system).toBe(0x00e5ff);
    expect(PALETTE.danger).toBe(0xff2a3c);
    expect(PALETTE.accent).toBe(0xfcee0a);
    expect(PALETTE.ground).toBe(0x070910);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/design/__tests__/tokenParity.test.ts`
Expected: FAIL — cannot resolve `../palette`.

- [ ] **Step 3: Create the TS palette**

Create `src/design/palette.ts`:

```ts
/** The colour order (visual-identity spec §3.1). Mirrors the hex --color-*
 *  tokens in src/ui/tokens.css; tokenParity.test.ts fails if they diverge.
 *  Pixi cannot read CSS custom properties, which is why this exists. */
export const PALETTE = {
  /** 01 — falling words, score, the kana being typed. Always brightest. */
  ink: 0xf6f1e6,
  inkDim: 0xa8b0c4,
  inkFaint: 0x6c7690,
  /** 02 — system chrome and ambient light: floor, panels, reticle, buffer frame. */
  system: 0x00e5ff,
  /** 03 — now-or-never: target underline, pips, deadline, misses. */
  danger: 0xff2a3c,
  /** 04 — accent only: micro-labels, combo, caret, hazard stripe. Never a surface. */
  accent: 0xfcee0a,
  /** 05 — ground. */
  ground: 0x070910,
  groundLift: 0x0a0d16,
  groundDeep: 0x04060b,
} as const;

export type PaletteKey = keyof typeof PALETTE;
```

- [ ] **Step 4: Create the CSS tokens**

Create `src/ui/tokens.css`:

```css
/* Design tokens — the source of truth for the visual identity
   (visual-identity spec §3). Colours are mirrored in src/design/palette.ts
   for Pixi; src/design/__tests__/tokenParity.test.ts enforces the match.
   Do not introduce a colour literal anywhere else. */
:root {
  /* --- 01 ink ------------------------------------------------------- */
  --color-ink: #f6f1e6;
  --color-ink-dim: #a8b0c4;
  --color-ink-faint: #6c7690;
  /* --- 02 system ---------------------------------------------------- */
  --color-system: #00e5ff;
  /* --- 03 danger ---------------------------------------------------- */
  --color-danger: #ff2a3c;
  /* --- 04 accent (never a surface) ---------------------------------- */
  --color-accent: #fcee0a;
  /* --- 05 ground ---------------------------------------------------- */
  --color-ground: #070910;
  --color-ground-lift: #0a0d16;
  --color-ground-deep: #04060b;

  /* Derived surfaces — CSS-only, excluded from parity by having no hex value */
  --color-surface: rgba(0, 229, 255, 0.06);
  --color-line: rgba(0, 229, 255, 0.32);
  --color-line-soft: rgba(0, 229, 255, 0.16);
  --color-danger-soft: rgba(255, 42, 60, 0.16);
  --color-grid-line: rgba(0, 229, 255, 0.05);
  --color-fibre: rgba(207, 216, 238, 0.03);

  /* --- type --------------------------------------------------------- */
  --font-word: 'Shippori Mincho B1', 'Yu Gothic UI', 'Meiryo', serif;
  --font-display: 'Yuji Syuku', 'Shippori Mincho B1', serif;
  --font-ui: 'Chakra Petch', system-ui, sans-serif;
  --font-mono: 'IBM Plex Mono', ui-monospace, monospace;

  --text-2xs: 0.6875rem;
  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.25rem;
  --text-xl: 1.75rem;
  --text-2xl: 2.5rem;
  --text-3xl: 3.5rem;

  --tracking-label: 0.3em;

  /* --- space (8px ramp) --------------------------------------------- */
  --space-1: 0.25rem;
  --space-2: 0.5rem;
  --space-3: 0.75rem;
  --space-4: 1rem;
  --space-5: 1.5rem;
  --space-6: 2rem;
  --space-8: 3rem;
  --space-10: 5rem;

  /* --- radius (this world is hard-edged) ---------------------------- */
  --radius-sm: 2px;
  --radius-md: 4px;

  /* --- duration ----------------------------------------------------- */
  --duration-fast: 120ms;
  --duration-base: 220ms;
  --duration-slow: 600ms;
}
```

- [ ] **Step 5: Import tokens ahead of everything else**

In `src/main.tsx`, add as the **first** import so tokens are defined before `index.css` consumes them:

```ts
import './ui/tokens.css';
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/design/__tests__/tokenParity.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 7: Verify the whole suite is still green**

Run: `npm run check`
Expected: tsc clean, oxlint clean, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/design/palette.ts src/ui/tokens.css src/design/__tests__/tokenParity.test.ts src/main.tsx
git commit -m "feat: design token layer with CSS/TS parity test"
```

---

### Task 2: Self-hosted typography

**Files:**
- Modify: `package.json`
- Modify: `src/main.tsx`
- Modify: `src/index.css:4-9` (the `body` font stack)

**Interfaces:**
- Consumes: `--font-word`, `--font-display`, `--font-ui`, `--font-mono` from Task 1.
- Produces: those four families actually resolving to loaded webfonts. No new exports.

Spec: §4.

- [ ] **Step 1: Install the four Fontsource packages**

```bash
npm install @fontsource/shippori-mincho-b1 @fontsource/yuji-syuku @fontsource/chakra-petch @fontsource/ibm-plex-mono
```

- [ ] **Step 2: Import only the slices that are used**

In `src/main.tsx`, directly after the `./ui/tokens.css` import. Each package splits by unicode-range, so importing `latin-*` and `japanese-*` separately avoids pulling cyrillic and latin-ext:

```ts
// Word face — needs Japanese; 1.9 MB slice, served locally from our own dist.
import '@fontsource/shippori-mincho-b1/japanese-600.css';
import '@fontsource/shippori-mincho-b1/latin-600.css';
// Display face — brush, headings only.
import '@fontsource/yuji-syuku/japanese-400.css';
import '@fontsource/yuji-syuku/latin-400.css';
// UI + mono — latin only.
import '@fontsource/chakra-petch/latin-500.css';
import '@fontsource/chakra-petch/latin-700.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
```

- [ ] **Step 3: Point the body at the UI token**

In `src/index.css`, replace the hardcoded `font-family` on `body` (currently `'Yu Gothic UI', 'Meiryo', 'Noto Sans JP', system-ui, sans-serif`):

```css
body {
  background: var(--color-ground);
  color: var(--color-ink);
  font-family: var(--font-ui);
  overflow: hidden;
}
```

- [ ] **Step 4: Verify the fonts actually load in the browser**

Start the app with the `run` skill or `npm run dev`, then in the browser console:

```js
document.fonts.check("16px 'Shippori Mincho B1'")   // → true
document.fonts.check("16px 'Yuji Syuku'")           // → true
document.fonts.check("16px 'Chakra Petch'")         // → true
document.fonts.check("16px 'IBM Plex Mono'")        // → true
```

Expected: four `true`. If any is `false`, the import path is wrong — list the package's CSS files with `ls node_modules/@fontsource/<name>/` and correct it.

**This step matters beyond cosmetics:** `PixiStage.create()` awaits `document.fonts.ready` as a JP glyph-measurement gate (main spec §7). Confirm the title screen still reaches interactive promptly — if first paint visibly stalls, the 1.9 MB Japanese slice is blocking and `font-display` needs revisiting.

- [ ] **Step 5: Verify the suite**

Run: `npm run check`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/main.tsx src/index.css
git commit -m "feat: self-hosted Fontsource typography (mincho, brush, tech, mono)"
```

---

### Task 3: The effects contract as a pure function

**Files:**
- Create: `src/design/visualParams.ts`
- Create: `src/design/__tests__/visualParams.test.ts`

**Interfaces:**
- Consumes: `Settings['effects']` from `src/data/settings.ts` (type only).
- Produces:
  ```ts
  interface VisualParams {
    chromaticSplitPx: number;  // 0 disables the split entirely
    haloAlpha: number;         // word glow strength, 0..1
    glowAlpha: number;         // floor/reticle/accent glow, 0..1
    grainAlpha: number;        // backdrop grain+fibre, 0..1
  }
  export function visualParams(effects: Settings['effects']): VisualParams
  ```
  Tasks 5–8 read every effects-dependent number from here. No component branches on `effects` itself.

Spec: §7.

- [ ] **Step 1: Write the failing test**

Create `src/design/__tests__/visualParams.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { visualParams } from '../visualParams';

describe('visualParams (visual-identity spec §7)', () => {
  it('full gets every decoration', () => {
    const p = visualParams('full');
    expect(p.chromaticSplitPx).toBeGreaterThan(0);
    expect(p.haloAlpha).toBe(1);
    expect(p.glowAlpha).toBe(1);
    expect(p.grainAlpha).toBeGreaterThan(0);
  });

  it('reduced drops the chromatic split but keeps glow and grain', () => {
    const p = visualParams('reduced');
    expect(p.chromaticSplitPx).toBe(0);
    expect(p.haloAlpha).toBeLessThan(1);
    expect(p.haloAlpha).toBeGreaterThan(0);
    expect(p.grainAlpha).toBeGreaterThan(0);
  });

  it('off strips all decoration', () => {
    expect(visualParams('off')).toEqual({
      chromaticSplitPx: 0, haloAlpha: 0, glowAlpha: 0, grainAlpha: 0,
    });
  });

  it('never returns a negative or out-of-range alpha', () => {
    for (const level of ['full', 'reduced', 'off'] as const) {
      const p = visualParams(level);
      for (const alpha of [p.haloAlpha, p.glowAlpha, p.grainAlpha]) {
        expect(alpha).toBeGreaterThanOrEqual(0);
        expect(alpha).toBeLessThanOrEqual(1);
      }
      expect(p.chromaticSplitPx).toBeGreaterThanOrEqual(0);
    }
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/design/__tests__/visualParams.test.ts`
Expected: FAIL — cannot resolve `../visualParams`.

- [ ] **Step 3: Implement it**

Create `src/design/visualParams.ts`:

```ts
import type { Settings } from '../data/settings';

/** Rendering numbers derived from the effects level (visual-identity spec §7).
 *  Decoration only — anything that conveys game state (the floor, the
 *  deadline, the reticle, lives, score, the buffer) renders regardless of
 *  these values, at flat intensity when they are 0. */
export interface VisualParams {
  /** Red/cyan offset on falling words, in px. 0 disables the split. */
  chromaticSplitPx: number;
  /** Word halo strength, 0..1. */
  haloAlpha: number;
  /** Floor / reticle / accent glow strength, 0..1. */
  glowAlpha: number;
  /** Backdrop grain + fibre strength, 0..1. */
  grainAlpha: number;
}

const FULL: VisualParams = { chromaticSplitPx: 1.4, haloAlpha: 1, glowAlpha: 1, grainAlpha: 1 };
const REDUCED: VisualParams = { chromaticSplitPx: 0, haloAlpha: 0.5, glowAlpha: 0.5, grainAlpha: 0.5 };
const OFF: VisualParams = { chromaticSplitPx: 0, haloAlpha: 0, glowAlpha: 0, grainAlpha: 0 };

export function visualParams(effects: Settings['effects']): VisualParams {
  if (effects === 'off') return OFF;
  if (effects === 'reduced') return REDUCED;
  return FULL;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/design/__tests__/visualParams.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/design/visualParams.ts src/design/__tests__/visualParams.test.ts
git commit -m "feat: pure visualParams mapping effects level to render numbers"
```

---

### Task 4: Retire every colour literal in the render layer

No new visuals. This task only re-points existing colours at `PALETTE`, so a regression here is obvious and isolated.

**Files:**
- Modify: `src/render/Particles.ts:7-11` (the four colour constants)
- Modify: `src/render/PixiStage.ts:57` (app background), `:91` (kill gloss), `:101` (combo flash), `:114` (miss reveal), `:148` (fx font stack)
- Modify: `src/render/WordSprite.ts:4-21` (font stack, styles, tints)

**Interfaces:**
- Consumes: `PALETTE` (Task 1).
- Produces: no new exports. `WordSprite`'s public API (`showHint`, `update`, `setLocked`, `setPosition`) is unchanged.

Spec: §3.1 ("Retired"), §5.4.

- [ ] **Step 1: Recolour the particle system**

In `src/render/Particles.ts`, replace the colour constants. Green is retired from the identity:

```ts
import { PALETTE } from '../design/palette';

const KILL_COLOR = PALETTE.ink;
const MISS_COLOR = PALETTE.danger;
const MISS_BASE = 8;
const CONFETTI_PALETTE = [PALETTE.ink, PALETTE.system, PALETTE.accent];
const CONFETTI_BASE = 40;
```

The import path is `../design/palette` from `src/render/`. Verify with `tsc`, not by eye.

`confettiSweep` cycles the palette with `i % CONFETTI_PALETTE.length`, so a 3-entry array needs no other change.

- [ ] **Step 2: Recolour the stage**

In `src/render/PixiStage.ts`:

- `app.init({ background: 0x0b0e14, ... })` → `app.init({ backgroundAlpha: 0, ... })`. The backdrop moves to CSS in Task 5 (spec §5.1 amendment); the canvas must be transparent for it to show through.
- Kill gloss `0x9dffb0` → `PALETTE.ink`.
- Combo flash `0xffd166` → `PALETTE.accent`.
- Miss reveal `0xff8f8f` → `PALETTE.ink` (spec §5.4: the reveal is a teaching moment and must be the most readable thing on screen; the vermillion moves to an underline in Task 7).
- The `spawnFx` font stack string → `'Shippori Mincho B1', 'Yu Gothic UI', 'Meiryo', serif`.

- [ ] **Step 3: Recolour word sprites**

In `src/render/WordSprite.ts`:

```ts
import { PALETTE } from '../design/palette';

const FONT_STACK = "'Shippori Mincho B1', 'Yu Gothic UI', 'Meiryo', serif";

const BASE_STYLE: Partial<TextStyle> = {
  fontFamily: FONT_STACK,
  fontSize: 40,
  fill: PALETTE.ink,
};

const HINT_STYLE: Partial<TextStyle> = {
  fontFamily: FONT_STACK,
  fontSize: 26,
  fill: PALETTE.inkDim,
};

const HINT_FADE_MS = 300;
const HINT_OFFSET_Y = 34;
const LOCKED_TINT = 0xffffff; // replaced by the reticle in Task 7
const UNLOCKED_TINT = 0xffffff;
```

Leave `setLocked` in place — Task 7 rewrites its body. Do not delete it now; `PixiStage.sync` calls it every frame.

- [ ] **Step 4: Confirm no literals remain in the render layer**

Run: `grep -rnE "0x[0-9a-fA-F]{6}" src/render/`
Expected: only `0xffffff` in `WordSprite.ts` (the neutral no-op tint). Anything else is a miss — fix it.

- [ ] **Step 5: Run the suite**

Run: `npm run check`
Expected: green. `particleSim.test.ts` and `filters.test.ts` are colour-agnostic and must not need edits — if either fails, a behaviour change slipped in and must be reverted.

- [ ] **Step 6: Verify in the browser**

Play one wave. Expected: kills burst ink-white instead of green, misses puff vermillion, the miss reveal is readable ink text, and the playfield is now **transparent black** (the CSS backdrop lands next task) — a flat `#000` void is the correct intermediate state here.

- [ ] **Step 7: Commit**

```bash
git add src/render/
git commit -m "refactor: source every render colour from the palette token"
```

---

### Task 5: The backdrop

**Files:**
- Modify: `src/index.css` (the `.pixi-host` rule)
- Modify: `src/render/PixiStage.ts` (apply `grainAlpha` to the host element)

**Interfaces:**
- Consumes: tokens (Task 1), `visualParams` (Task 3).
- Produces: a `.pixi-host` element carrying the backdrop, with grain strength driven by the CSS custom property `--grain-alpha` set from `visualParams(...).grainAlpha`.

Spec: §5.1 (as amended).

- [ ] **Step 1: Write the backdrop CSS**

In `src/index.css`, replace `.pixi-host { position: absolute; inset: 0; }` with the rules below — no `mix-blend-mode`, which is the compositor cost worth avoiding.

The split across two rules is deliberate: CSS cannot scale one background layer's alpha independently, and grain must fade with the effects level. So the untextured layers (gradient, grid) live on the element and the two textured layers (grain, fibre) live on a `::before` whose `opacity` is driven by `--grain-alpha`:

```css
.pixi-host {
  position: absolute;
  inset: 0;
  --grain-alpha: 1;
  background-color: var(--color-ground);
  background-image:
    repeating-linear-gradient(to right, var(--color-grid-line) 0 1px, transparent 1px 76px),
    linear-gradient(180deg, var(--color-ground) 0%, var(--color-ground-lift) 58%, var(--color-ground-deep) 100%);
  background-repeat: repeat, no-repeat;
  background-size: auto, 100% 100%;
}
.pixi-host::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  opacity: var(--grain-alpha);
  background-image:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='160' height='160' filter='url(%23n)' opacity='0.06'/%3E%3C/svg%3E"),
    repeating-linear-gradient(102deg, transparent 0 23px, var(--color-fibre) 23px 24px);
  background-size: 160px 160px, auto;
}
```

`.pixi-host` needs the canvas above the pseudo-element; Pixi appends the canvas as a child, and a positioned `::before` with no `z-index` paints below in-flow positioned children, so no `z-index` is required. **Verify this visually in Step 3** — if the grain covers the words, add `.pixi-host canvas { position: relative; z-index: 0; }`.

- [ ] **Step 2: Set the property from settings**

In `src/render/PixiStage.ts`, store the host and apply grain whenever settings change. Add to the constructor (which already subscribes via `applyFilters`):

```ts
private readonly host: HTMLElement;
```

Assign it in the constructor, extend `create()` to pass `host` through, and add:

```ts
/** Backdrop grain is CSS (spec §5.1); its strength still follows the
 *  effects level, so it is driven through a custom property rather than a
 *  class toggle. */
private applyBackdrop(): void {
  this.host.style.setProperty('--grain-alpha', String(visualParams(getSettings().effects).grainAlpha));
}
```

Call `this.applyBackdrop()` next to the existing `this.applyFilters()` call, and again inside the existing `subscribeSettings` callback so both respond to the same notification.

- [ ] **Step 3: Verify in the browser**

Play a wave at `effects: 'full'`, then `reduced`, then `off` via Settings. Expected: gradient and grid always present; grain and fibre visible at full, halved at reduced, gone at off. Words always paint above the backdrop.

- [ ] **Step 4: Run the suite and commit**

```bash
npm run check
git add src/index.css src/render/PixiStage.ts
git commit -m "feat: CSS backdrop with gradient, data grid, grain, and fibre"
```

---

### Task 6: The floor

The single most important addition — "don't let it hit the floor" currently has no floor.

**Files:**
- Create: `src/render/brushStroke.ts`
- Create: `src/render/__tests__/brushStroke.test.ts`
- Modify: `src/render/PixiStage.ts`

**Interfaces:**
- Consumes: `PALETTE` (Task 1), `visualParams` (Task 3).
- Produces:
  ```ts
  export function brushStrokeDataUri(cssColor: string, seed: number): string
  export function loadBrushTexture(cssColor: string, seed: number): Promise<Texture>
  ```
  `cssColor` is a CSS colour string (`'#00e5ff'`); `seed` varies the noise so two strokes never look identical.

Spec: §5.2.

- [ ] **Step 1: Write the failing test**

Create `src/render/__tests__/brushStroke.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { brushStrokeDataUri } from '../brushStroke';

describe('brushStrokeDataUri (visual-identity spec §5.2)', () => {
  it('returns an inline SVG data URI', () => {
    expect(brushStrokeDataUri('#00e5ff', 11)).toMatch(/^data:image\/svg\+xml,/);
  });

  it('encodes the colour, percent-escaping the hash', () => {
    expect(brushStrokeDataUri('#00e5ff', 11)).toContain('%2300e5ff');
    expect(brushStrokeDataUri('#00e5ff', 11)).not.toContain('#00e5ff');
  });

  it('varies with the seed, so two strokes differ', () => {
    expect(brushStrokeDataUri('#00e5ff', 11)).not.toBe(brushStrokeDataUri('#00e5ff', 12));
  });

  it('leaves no raw characters that break an SVG data URI', () => {
    const uri = brushStrokeDataUri('#ff2a3c', 4);
    for (const illegal of ['<', '>', '"', '#']) {
      expect(uri).not.toContain(illegal);
    }
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/render/__tests__/brushStroke.test.ts`
Expected: FAIL — cannot resolve `../brushStroke`.

- [ ] **Step 3: Implement the generator**

Create `src/render/brushStroke.ts`:

```ts
import { Texture } from 'pixi.js';

const WIDTH = 1200;
const HEIGHT = 26;

/** A dry-brush stroke: a tapered bar pushed through fractal-noise
 *  displacement, so bristle gaps and ragged edges are genuinely irregular
 *  rather than a repeating pattern (visual-identity spec §5.2). Returned as
 *  an SVG data URI so it needs no asset file. */
export function brushStrokeDataUri(cssColor: string, seed: number): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${WIDTH}' height='${HEIGHT}' preserveAspectRatio='none'>` +
    `<defs>` +
    `<filter id='r' x='-5%' y='-300%' width='110%' height='700%'>` +
    `<feTurbulence type='fractalNoise' baseFrequency='0.018 0.55' numOctaves='3' seed='${seed}' result='t'/>` +
    `<feDisplacementMap in='SourceGraphic' in2='t' scale='17' xChannelSelector='R' yChannelSelector='G'/>` +
    `</filter>` +
    `<linearGradient id='g' x1='0' x2='1'>` +
    `<stop offset='0' stop-color='${cssColor}' stop-opacity='0'/>` +
    `<stop offset='0.1' stop-color='${cssColor}' stop-opacity='0.88'/>` +
    `<stop offset='0.42' stop-color='${cssColor}' stop-opacity='0.42'/>` +
    `<stop offset='0.68' stop-color='${cssColor}' stop-opacity='0.82'/>` +
    `<stop offset='0.9' stop-color='${cssColor}' stop-opacity='0.3'/>` +
    `<stop offset='1' stop-color='${cssColor}' stop-opacity='0'/>` +
    `</linearGradient>` +
    `</defs>` +
    `<rect x='0' y='11' width='${WIDTH}' height='5' fill='url(#g)' filter='url(#r)'/>` +
    `</svg>`;
  // Percent-encode the characters that are illegal unescaped in a data URI.
  const encoded = svg
    .replaceAll('<', '%3C')
    .replaceAll('>', '%3E')
    .replaceAll('#', '%23')
    .replaceAll('"', '%22');
  return `data:image/svg+xml,${encoded}`;
}

/** Decodes the stroke into a Pixi texture. Kept separate from the pure
 *  generator so the generator stays unit-testable in a node environment. */
export async function loadBrushTexture(cssColor: string, seed: number): Promise<Texture> {
  const image = new Image();
  image.src = brushStrokeDataUri(cssColor, seed);
  await image.decode();
  return Texture.from(image);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/render/__tests__/brushStroke.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Mount the floor in the stage**

In `src/render/PixiStage.ts`:

- Add `import { Sprite } from 'pixi.js';` and the palette/visualParams imports.
- Add fields: `private floor: Sprite | null = null;` and `private deadline: Graphics | null = null;`
- Add a `FLOOR_Y_RATIO = 0.88` constant — the kill line as a fraction of stage height. **Check this against the engine's actual miss threshold**: read `src/engine/constants.ts` and `GameEngine`'s miss condition, and use the value the engine already uses rather than inventing one. A floor drawn somewhere other than where words actually die is worse than no floor.
- After construction, load and add the stroke:

```ts
private async mountFloor(): Promise<void> {
  const texture = await loadBrushTexture(cssHex(PALETTE.system), 11);
  const floor = new Sprite(texture);
  floor.anchor.set(0, 0.5);
  floor.zIndex = FLOOR_Z_INDEX;
  this.floor = floor;
  this.app.stage.addChild(floor);
  this.layoutFloor();
  this.applyFloorGlow();
}

/** Stretches the stroke across the stage at the kill line. Called on mount
 *  and on every resize. */
private layoutFloor(): void {
  if (this.floor === null) return;
  this.floor.width = this.app.screen.width;
  this.floor.position.set(0, this.app.screen.height * FLOOR_Y_RATIO);
}
```

`cssHex` is a small local helper: `` const cssHex = (n: number): string => `#${n.toString(16).padStart(6, '0')}` ``. Put it in `src/design/palette.ts` and export it so Task 7 can reuse it.

- The 1px deadline is a `Graphics` drawn in `PALETTE.danger` at `height * FLOOR_Y_RATIO + 8`, redrawn in `layoutFloor`.
- Glow follows `visualParams(...).glowAlpha`: at `0`, the sprite still renders (it is information) but any `filters`/alpha boost is removed. Implement `applyFloorGlow()` and call it from the settings subscription alongside `applyFilters` and `applyBackdrop`.
- Call `layoutFloor()` from a `Ticker` resize check or `app.renderer.on('resize', ...)`.

- [ ] **Step 6: Verify in the browser**

Play a wave. Expected: a glowing cyan brush stroke across the bottom with a thin red line beneath it, words visibly die **at** the stroke, and the stroke is still present (flat, unglowing) at `effects: 'off'`. Resize the window — the stroke re-stretches without distorting its height.

- [ ] **Step 7: Run the suite and commit**

```bash
npm run check
git add src/render/brushStroke.ts src/render/__tests__/brushStroke.test.ts src/render/PixiStage.ts src/design/palette.ts
git commit -m "feat: dry-brush floor stroke and deadline at the kill line"
```

---

### Task 7: Word styling and the target reticle

**Files:**
- Create: `src/render/reticle.ts`
- Create: `src/render/__tests__/reticle.test.ts`
- Modify: `src/render/WordSprite.ts`

**Interfaces:**
- Consumes: `PALETTE`, `cssHex` (Tasks 1, 6), `visualParams` (Task 3), `loadBrushTexture` (Task 6).
- Produces:
  ```ts
  interface BracketRect { x: number; y: number; w: number; h: number }
  export function reticleBrackets(halfWidth: number, halfHeight: number, pad: number, len: number, thickness: number): BracketRect[]
  ```
  Returns exactly 8 rects — two arms per corner — in centre-origin coordinates.

Spec: §5.3, §9.4.

- [ ] **Step 1: Write the failing test**

Create `src/render/__tests__/reticle.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { reticleBrackets } from '../reticle';

describe('reticleBrackets (visual-identity spec §5.3)', () => {
  it('returns two arms per corner', () => {
    expect(reticleBrackets(40, 25, 10, 18, 2)).toHaveLength(8);
  });

  it('is symmetric about both axes', () => {
    const rects = reticleBrackets(40, 25, 10, 18, 2);
    const sumX = rects.reduce((acc, r) => acc + r.x + r.w / 2, 0);
    const sumY = rects.reduce((acc, r) => acc + r.y + r.h / 2, 0);
    expect(sumX).toBeCloseTo(0);
    expect(sumY).toBeCloseTo(0);
  });

  it('sits outside the word bounds by the padding', () => {
    const rects = reticleBrackets(40, 25, 10, 18, 2);
    const left = Math.min(...rects.map((r) => r.x));
    const top = Math.min(...rects.map((r) => r.y));
    expect(left).toBeCloseTo(-50);
    expect(top).toBeCloseTo(-35);
  });

  it('never returns a zero-area rect', () => {
    for (const r of reticleBrackets(40, 25, 10, 18, 2)) {
      expect(r.w).toBeGreaterThan(0);
      expect(r.h).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/render/__tests__/reticle.test.ts`
Expected: FAIL — cannot resolve `../reticle`.

- [ ] **Step 3: Implement the geometry**

Create `src/render/reticle.ts`:

```ts
export interface BracketRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Eight rects forming four corner brackets around a centre-origin box
 *  (visual-identity spec §5.3). Shape is the second signal alongside
 *  colour, per §9.4 — never signal the target with colour alone. */
export function reticleBrackets(
  halfWidth: number,
  halfHeight: number,
  pad: number,
  len: number,
  thickness: number,
): BracketRect[] {
  const l = -halfWidth - pad;
  const r = halfWidth + pad;
  const t = -halfHeight - pad;
  const b = halfHeight + pad;
  return [
    { x: l, y: t, w: len, h: thickness },
    { x: l, y: t, w: thickness, h: len },
    { x: r - len, y: t, w: len, h: thickness },
    { x: r - thickness, y: t, w: thickness, h: len },
    { x: l, y: b - thickness, w: len, h: thickness },
    { x: l, y: b - len, w: thickness, h: len },
    { x: r - len, y: b - thickness, w: len, h: thickness },
    { x: r - thickness, y: b - len, w: thickness, h: len },
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/render/__tests__/reticle.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Rewrite `setLocked` to draw the reticle and underline**

In `src/render/WordSprite.ts`, replace the tint-only `setLocked`. The sprite gains two lazily-created children — a `Graphics` for the brackets and a `Sprite` for the vermillion brush underline — both `visible = false` until locked:

```ts
setLocked(locked: boolean): void {
  if (locked === this.locked) return;
  this.locked = locked;
  this.ensureTargetArt();
  if (this.brackets !== null) this.brackets.visible = locked;
  if (this.underline !== null) this.underline.visible = locked;
}
```

`ensureTargetArt()` measures `this.text` (`this.text.width / 2`, `this.text.height / 2`), calls `reticleBrackets(halfW, halfH, 14, 18, 2)`, and fills each rect into the `Graphics` with `PALETTE.system`. The underline is a `Sprite` from `loadBrushTexture(cssHex(PALETTE.danger), 4)`, anchored `(0.5, 0.5)`, sized to `text.width * 1.24`, positioned just below the glyph.

Because `loadBrushTexture` is async and `setLocked` is called from the render loop, cache the texture at module scope behind a single promise — never start a decode per lock.

- [ ] **Step 6: Apply halo and chromatic split**

Style `this.text` from `visualParams(getSettings().effects)`:
- `haloAlpha` scales a `dropShadow` on the `TextStyle` (`color: PALETTE.system`, `blur: 18`, `distance: 0`, `alpha: haloAlpha`).
- `chromaticSplitPx > 0` adds two cloned `Text` children behind the main one, offset `±chromaticSplitPx` on x, tinted `PALETTE.danger` and `PALETTE.system` at low alpha.
- **Spec §9.1 gate:** skip the split entirely when `BASE_STYLE.fontSize` is below 40. Assert this in code, not just in review.

- [ ] **Step 7: Verify in the browser**

Type a partial reading so a word locks. Expected: cyan corner brackets snap around it plus a vermillion brush underline beneath; the previous cyan *recolour* of the glyph is gone. Check `effects: 'off'` — brackets and underline still render flat, because they are information.

- [ ] **Step 8: Run the suite and commit**

```bash
npm run check
git add src/render/reticle.ts src/render/__tests__/reticle.test.ts src/render/WordSprite.ts
git commit -m "feat: target reticle and brush underline replace the locked tint"
```

---

### Task 8: HUD chrome

**Files:**
- Create: `src/ui/hud/pips.ts`
- Create: `src/ui/hud/__tests__/pips.test.ts`
- Modify: `src/ui/hud/Hud.tsx`
- Modify: `src/ui/__tests__/Hud.test.tsx:17`
- Modify: `src/index.css` (`.hud`, `.hud-top`, `.hud-buffer` and new chrome rules)

**Interfaces:**
- Consumes: tokens (Task 1).
- Produces:
  ```ts
  export type PipState = 'live' | 'spent';
  export function pipStates(lives: number, max?: number): PipState[]
  ```
  `max` defaults to 3. Clamps negatives to zero live pips and never returns more than `max` entries.

Spec: §6, §9.4.

- [ ] **Step 1: Write the failing pip test**

Create `src/ui/hud/__tests__/pips.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { pipStates } from '../pips';

describe('pipStates (visual-identity spec §6)', () => {
  it('shows spent pips so the total stays readable', () => {
    expect(pipStates(2)).toEqual(['live', 'live', 'spent']);
  });

  it('is all live at full health', () => {
    expect(pipStates(3)).toEqual(['live', 'live', 'live']);
  });

  it('clamps negative lives to none live', () => {
    expect(pipStates(-1)).toEqual(['spent', 'spent', 'spent']);
  });

  it('never exceeds max', () => {
    expect(pipStates(9)).toHaveLength(3);
    expect(pipStates(9, 5)).toHaveLength(5);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `npx vitest run src/ui/hud/__tests__/pips.test.ts`
Expected: FAIL — cannot resolve `../pips`.

- [ ] **Step 3: Implement it**

Create `src/ui/hud/pips.ts`:

```ts
export type PipState = 'live' | 'spent';

const DEFAULT_MAX = 3;

/** Lives as pip states. Spent pips stay rendered at low alpha (visual-identity
 *  spec §6) so the player can always read the total, not just what is left. */
export function pipStates(lives: number, max: number = DEFAULT_MAX): PipState[] {
  const live = Math.max(0, Math.min(lives, max));
  return Array.from({ length: max }, (_, i) => (i < live ? 'live' : 'spent'));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/ui/hud/__tests__/pips.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Rebuild the HUD markup**

Rewrite `src/ui/hud/Hud.tsx`. **Every existing `data-testid` must survive** — other tests and the e2e keystone depend on them:

```tsx
import type { EngineSnapshot } from '../../engine/types';
import { pipStates } from './pips';

export function Hud({ snapshot }: { snapshot: EngineSnapshot }) {
  return (
    <div className="hud">
      <div className="hud-stripe" />
      <div className="hud-top">
        <div className="hud-block">
          <span className="hud-tab">SCORE</span>
          <span className="hud-value hud-value-word" data-testid="score">{snapshot.score}</span>
        </div>
        <div className="hud-wave">
          <span className="hud-wave-jp">第{snapshot.wave}波</span>
          <span className="hud-wave-lat" data-testid="wave">wave {snapshot.wave}</span>
        </div>
        <div className="hud-right">
          <div className="hud-block">
            <span className="hud-tab">COMBO</span>
            <span
              className={`hud-value hud-value-accent${snapshot.combo > 0 ? ' combo-pop' : ''}`}
              key={snapshot.combo}
              data-testid="combo"
            >
              {snapshot.combo > 0 ? `×${snapshot.combo}` : ''}
            </span>
          </div>
          <div className="hud-pips" data-testid="lives">
            {pipStates(snapshot.lives).map((state, i) => (
              <span key={i} className={`hud-pip hud-pip-${state}`} />
            ))}
          </div>
        </div>
      </div>
      <div className="hud-buffer" data-testid="kana-buffer">
        <span className="hud-buffer-tick">IN</span>
        <span className="hud-buffer-kana">{snapshot.bufferKana || ' '}</span>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Fix the presentation-coupled assertion**

`src/ui/__tests__/Hud.test.tsx:17` asserts `toHaveTextContent('♥♥')`, which no longer holds. Replace it with a state assertion — the test should never have depended on the glyph:

```tsx
expect(screen.getByTestId('lives').querySelectorAll('.hud-pip-live')).toHaveLength(2);
```

Leave the other assertions in that file alone. The `combo-pop` test must still pass — the class is preserved above.

- [ ] **Step 7: Style the chrome**

In `src/index.css`, replace `.hud-top` and `.hud-buffer` and add the new rules. Key constraints from the spec: `--color-accent` is **never a surface** except the 3px stripe, and the buffer is the second-brightest thing on screen (§9.5).

```css
.hud-stripe {
  position: absolute; top: 0; left: 0; right: 0; height: 3px; opacity: 0.55;
  background: repeating-linear-gradient(115deg, var(--color-accent) 0 10px, var(--color-ground-lift) 10px 20px);
}
.hud-top {
  display: flex; align-items: flex-start; justify-content: space-between;
  padding: var(--space-4) var(--space-5) 0;
}
.hud-block { display: flex; align-items: stretch; }
.hud-tab {
  background: var(--color-system); color: var(--color-ground-deep);
  font-family: var(--font-ui); font-weight: 700; font-size: var(--text-2xs);
  letter-spacing: 0.18em; padding: var(--space-1) var(--space-2);
  display: flex; align-items: center;
}
.hud-value {
  background: var(--color-surface); border: 1px solid var(--color-line); border-left: none;
  padding: 0 var(--space-3); display: flex; align-items: center; min-width: 4.5rem;
}
.hud-value-word { font-family: var(--font-word); font-size: var(--text-lg); color: var(--color-ink); }
.hud-value-accent { font-family: var(--font-ui); font-weight: 700; font-size: var(--text-lg); color: var(--color-accent); }
.hud-wave { display: flex; flex-direction: column; align-items: center; gap: var(--space-1); }
.hud-wave-jp { font-family: var(--font-display); font-size: var(--text-lg); color: var(--color-ink); }
.hud-wave-lat {
  font-family: var(--font-mono); font-size: var(--text-2xs);
  letter-spacing: var(--tracking-label); text-transform: uppercase; color: var(--color-accent); opacity: 0.6;
}
.hud-right { display: flex; flex-direction: column; align-items: flex-end; gap: var(--space-2); }
.hud-pips { display: flex; gap: var(--space-1); }
.hud-pip { width: 20px; height: 6px; transform: skewX(-22deg); }
.hud-pip-live { background: var(--color-danger); }
.hud-pip-spent { background: var(--color-danger-soft); }
.hud-buffer {
  margin-top: auto; align-self: center; display: flex; align-items: center; gap: var(--space-3);
  border: 1px solid var(--color-line); background: var(--color-surface);
  padding: var(--space-2) var(--space-5); margin-bottom: var(--space-5);
}
.hud-buffer-tick {
  font-family: var(--font-mono); font-size: var(--text-2xs);
  letter-spacing: var(--tracking-label); color: var(--color-system); opacity: 0.7;
}
.hud-buffer-kana { font-family: var(--font-word); font-size: var(--text-2xl); color: var(--color-ink); }
```

`.hud` keeps `pointer-events: none`; add `align-items: center` handling as needed so the buffer centres.

- [ ] **Step 8: Run the full suite**

Run: `npm run check`
Expected: green, including the two `Hud.test.tsx` cases.

- [ ] **Step 9: Verify the e2e keystone still passes**

Run: `npm run e2e`
Expected: green. The HUD markup changed and the keystone reads `data-testid`s — this is the task most likely to break it.

> **Windows note:** a previous run leaked the tsx API server on port 8790, which both breaks later e2e runs and can silently write real play data into `e2e.db`. If e2e hangs or behaves oddly, check for a stray listener on 8790 before debugging the test.

- [ ] **Step 10: Commit**

```bash
git add src/ui/hud/ src/ui/__tests__/Hud.test.tsx src/index.css
git commit -m "feat: HUD chrome with tab blocks, wave header, pips, framed buffer"
```

---

### Task 9: Calm screens — title, setup, results, ceremony

**Files:**
- Modify: `src/ui/screens/TitleScreen.tsx`, `SetupScreen.tsx`, `ResultsScreen.tsx`, `AcquisitionCeremony.tsx`, `SettingsScreen.tsx`, `ImportScreen.tsx`, `ServerErrorScreen.tsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: tokens (Task 1).
- Produces: no new exports. All `data-testid`s preserved.

Spec: §8. **No arcade chrome on these screens** — no hazard stripes, no reticles, no glow, no scanlines.

- [ ] **Step 1: Restyle the shared shell**

In `src/index.css`, rewrite `button`, `.screen-center`, and `.hint` against tokens:

```css
button {
  font-family: var(--font-ui); font-size: var(--text-sm); font-weight: 500;
  color: var(--color-ink); background: var(--color-surface);
  border: 1px solid var(--color-line); border-radius: var(--radius-sm);
  padding: var(--space-2) var(--space-5); cursor: pointer;
  transition: background var(--duration-fast), border-color var(--duration-fast);
}
button:hover { background: var(--color-line-soft); border-color: var(--color-system); }
button:focus-visible { outline: 2px solid var(--color-system); outline-offset: 2px; }
button.primary { background: var(--color-system); color: var(--color-ground-deep); border-color: var(--color-system); font-weight: 700; }
button.primary:hover { background: var(--color-ink); border-color: var(--color-ink); }
.screen-center {
  height: 100%; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: var(--space-4);
  background: linear-gradient(180deg, var(--color-ground) 0%, var(--color-ground-lift) 58%, var(--color-ground-deep) 100%);
}
.hint { color: var(--color-ink-faint); font-size: var(--text-xs); font-family: var(--font-mono); letter-spacing: 0.06em; }
```

One primary action per screen — add `className="primary"` to the Start button only.

- [ ] **Step 2: Give the title screen its wordmark**

In `src/ui/screens/TitleScreen.tsx`, wrap the heading and add a brush rule beneath it. Keep all three `data-testid`s:

```tsx
<div className="screen-center">
  <div className="title-mark">
    <h1 className="title-word">KanjiFall</h1>
    <div className="title-rule" />
  </div>
  <p className="title-tagline">Type the reading. Press Enter. Don&apos;t let words hit the floor.</p>
  <p className="hint">Keyboard: a–z romaji · Enter submit · Backspace edit · Esc clear</p>
  <button className="primary" data-testid="start-button" onClick={onStart}>Start — Reading mode (N5)</button>
  <button data-testid="stats-button" onClick={onStats}>Stats</button>
  <button data-testid="settings-button" onClick={onSettings}>Settings</button>
</div>
```

```css
.title-mark { display: flex; flex-direction: column; align-items: center; gap: var(--space-3); }
.title-word {
  font-family: var(--font-display); font-size: var(--text-3xl); font-weight: 400;
  color: var(--color-ink); letter-spacing: 0.04em;
}
.title-rule {
  width: 12rem; height: 3px;
  background: linear-gradient(90deg, transparent, var(--color-system) 22%, var(--color-system) 78%, transparent);
  opacity: 0.75;
}
.title-tagline { font-family: var(--font-ui); font-size: var(--text-base); color: var(--color-ink-dim); }
```

- [ ] **Step 3: Restyle the ceremony**

`AcquisitionCeremony` is the one calm screen allowed a flourish (spec §8). In `src/index.css`, re-point the existing `.ceremony-*` rules at tokens: `.ceremony-word` → `var(--font-word)` at `var(--text-3xl)`; `.ceremony-label` → `var(--font-display)`, `var(--color-system)`; `.ceremony-reading` → `var(--font-word)`, `var(--color-system)`; `.ceremony-buffer.rejected` → `var(--color-danger)`; `.ceremony-credit` → `var(--color-ink-faint)`. **Keep the existing `ceremony-arrive` and `ceremony-shake` animations and the `prefers-reduced-motion` block exactly as they are.**

- [ ] **Step 4: Restyle results, settings, import, error**

Re-point `.missed td`, `.picker`, `.picker.selected`, `.load-error`, `.results-buttons`, `.plan-notice`, `.tier-advance`, `.ime-warning` at tokens. Rules:
- `.missed td` and `.load-error` → `var(--color-danger)`, but only at `var(--text-base)` or larger (spec §9.3 — vermillion is never small text). If a rule is smaller, use `var(--color-ink)` and mark it with a danger-coloured border instead.
- `.picker.selected` → `border-color: var(--color-system); background: var(--color-surface);`
- `.plan-notice`, `.tier-advance` stay deliberately muted (`var(--color-ink-faint)`, `var(--text-xs)`) — juice-pass §5.4 says these are not celebrations. Do not promote them.
- `.ime-warning` keeps its warning role: `var(--color-accent)` text on `var(--color-ground-lift)` with accent borders.

- [ ] **Step 5: Verify every screen in the browser**

Walk: title → setup → ceremony → play → miss → results → stats → settings → import. Expected: consistent type and palette, no arcade chrome anywhere outside the playfield, focus rings visible on every control when tabbing.

- [ ] **Step 6: Run the suite and commit**

```bash
npm run check
git add src/ui/screens/ src/index.css
git commit -m "feat: calm-screen treatment across title, setup, results, ceremony, settings"
```

---

### Task 10: Stats and charts

**Files:**
- Modify: `src/ui/hud/charts.tsx:52-53`
- Modify: `src/ui/screens/StatsScreen.tsx`
- Modify: `src/index.css` (`.stats-screen`, `.level-bar*`, `.streak-*`, `.leech-table`, `.profile-form`)

**Interfaces:**
- Consumes: tokens (Task 1). Recharts needs CSS colour strings, not tokens — read them from the computed style so there is still one source of truth.

Spec: §8 (charts bullet), §9.

- [ ] **Step 1: Read token values for Recharts**

Recharts props take colour strings. Add a tiny helper in `src/design/palette.ts`:

```ts
/** Recharts and other string-colour APIs need a CSS colour, not a number.
 *  Reads the live custom property so tokens.css stays the source of truth. */
export function tokenColor(name: string, fallback: string): string {
  if (typeof getComputedStyle !== 'function') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === '' ? fallback : value;
}
```

- [ ] **Step 2: Recolour the trend chart**

In `src/ui/hud/charts.tsx`, replace the two literals (`#7fdfff` on the words line, `#ffb0b0` on the accuracy line):

```tsx
<Line yAxisId="words" type="monotone" dataKey="words" stroke={tokenColor('--color-system', '#00e5ff')} dot={false} strokeWidth={2} />
<Line yAxisId="accuracy" type="monotone" dataKey="accuracy" stroke={tokenColor('--color-ink', '#f6f1e6')} dot={false} strokeWidth={2} />
```

Axes, gridlines, and tick labels → `tokenColor('--color-ink-faint', '#6c7690')`.

Per spec §9.4, lines must not be distinguished by colour alone: give the two `Line`s different `strokeDasharray` values, or confirm the existing legend labels them directly.

- [ ] **Step 3: Recolour the level bars and streak grid**

In `src/index.css`, the retired green goes here:

```css
.level-bar-track { background: var(--color-surface); border-radius: var(--radius-sm); }
.level-bar-fill.coverage { background: var(--color-system); }
.level-bar-fill.mastery { background: var(--color-ink); }
.level-bar-label { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--color-ink-dim); }
.streak-cell { background: var(--color-surface); border-radius: var(--radius-sm); }
.streak-cell.active { background: var(--color-system); }
```

- [ ] **Step 4: Give the stats screen a type hierarchy**

This is the screen that most needs the calm treatment. Figures in `var(--font-mono)` so columns align; section headings in `var(--font-ui)`; labels at `var(--text-2xs)` uppercase with `var(--tracking-label)`.

```css
.stats-screen { background: linear-gradient(180deg, var(--color-ground) 0%, var(--color-ground-deep) 100%); }
.stats-screen h2 { font-family: var(--font-ui); font-size: var(--text-lg); font-weight: 700; }
.leech-table td { font-family: var(--font-mono); font-size: var(--text-sm); color: var(--color-ink-dim); padding: var(--space-1) var(--space-3); }
.leech-table td:first-child { font-family: var(--font-word); font-size: var(--text-base); color: var(--color-ink); }
```

- [ ] **Step 5: Confirm no literals survive**

Run: `grep -rnE "#[0-9a-fA-F]{6}|0x[0-9a-fA-F]{6}" src/ --include=*.ts --include=*.tsx --include=*.css | grep -v "tokens.css" | grep -v "design/palette.ts"`
Expected: only the `tokenColor` fallback strings in `charts.tsx`. (`WordSprite.ts`'s `0xffffff` tints from Task 4 are expected to be gone — Task 7 replaced the tint mechanism with the reticle, making them dead. If they survive, delete them.) Anything else is a miss.

- [ ] **Step 6: Verify in the browser**

Open Stats with real play data. Expected: chart lines legible against the ground, level bars cyan/ink with no green, figures aligned in mono, no arcade chrome.

- [ ] **Step 7: Run the suite and commit**

```bash
npm run check
git add src/ui/hud/charts.tsx src/ui/screens/StatsScreen.tsx src/index.css src/design/palette.ts
git commit -m "feat: token-sourced stats screen and chart palette"
```

---

### Task 11: Effects matrix and legibility verification

The gate. Everything before this was built; this proves it holds.

**Files:**
- Create: `docs/qa/2026-08-15-visual-identity-checklist.md`
- Modify: whatever the checks turn up.

**Interfaces:**
- Consumes: everything.
- Produces: a committed QA record.

Spec: §7, §9, §11.

- [ ] **Step 1: Write the checklist**

Create `docs/qa/2026-08-15-visual-identity-checklist.md` with a row per cell of the spec §7 table, run across `effects` full/reduced/off × `crt` on/off, plus a `prefers-reduced-motion` pass. Same shape as the juice-pass checklist. Each row records observed/expected.

- [ ] **Step 2: Walk the effects matrix**

For each of the six combinations, play one wave and confirm against spec §7. **The load-bearing assertion:** at `effects: 'off'` the floor, deadline, reticle, underline, pips, score, and buffer are all still visible — flat, but present. If any disappears, that is a bug in this plan's implementation, not an acceptable simplification.

- [ ] **Step 3: Run the legibility check (spec §9.1)**

Render high-stroke-density kanji — 議, 職, 験, 護, 齢 — at play size and screenshot each effects level. Confirm no stroke merges or ambiguity, especially with bloom **and** the word halo both active at `full`. This is the pairing most likely to wash out detail (spec §12). If it does, reduce `haloAlpha` at `full` in `visualParams.ts` and re-run — do not compensate by disabling bloom.

- [ ] **Step 4: Contrast-check the pairs**

Verify against the ground colour: `--color-ink` (passes comfortably), `--color-system`, `--color-accent`, and `--color-ink-dim` at their smallest used sizes. Confirm `--color-danger` appears only as lines, pips, and underlines — never as text below `--text-base` (spec §9.3). Fix any failure by changing the *token usage*, not the token.

- [ ] **Step 5: Confirm colour is never the only signal (spec §9.4)**

Target = brackets + underline (shape and colour). Lives = position + alpha. Chart series = dash pattern or direct labels. Verify each.

- [ ] **Step 6: Run everything**

```bash
npm run check
npm run e2e
```

Expected: both green.

- [ ] **Step 7: Commit**

```bash
git add docs/qa/2026-08-15-visual-identity-checklist.md
git commit -m "docs: visual identity QA checklist with effects matrix results"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §3.1 colour order, retired colours | 1, 4 |
| §3.2 type scale | 1, 2 |
| §3.3 token location + parity test | 1 |
| §4 fonts (as amended) | 2 |
| §5.1 backdrop (as amended) | 5 |
| §5.2 floor | 6 |
| §5.3 words + reticle | 7 |
| §5.4 recoloured effects | 4 |
| §6 HUD | 8 |
| §7 effects contract | 3, 5, 6, 7, 11 |
| §8 calm screens | 9, 10 |
| §9 legibility rules | 7, 9, 10, 11 |
| §10 phasing | task order |
| §11 testing | 1, 3, 6, 7, 8, 11 |
| §12 risks | 2 (font gate), 11 (bloom+halo, contrast) |

No gaps.

**Known soft spots, stated rather than hidden:**

- **Tasks 5, 6, 7, 9, 10 are verified by browser observation, not assertions.** Backdrops, glows, and type are not meaningfully unit-testable; the pure logic underneath them (`visualParams`, `brushStrokeDataUri`, `reticleBrackets`, `pipStates`) is extracted precisely so that the untestable part is only the drawing. Task 11 is the real gate for those tasks — do not skip it.
- **Task 6 Step 5 deliberately defers `FLOOR_Y_RATIO` to the engine.** The plan does not hardcode it because a floor drawn anywhere other than the actual miss threshold is worse than no floor. Read `src/engine/constants.ts` first.
- **Task 7 Step 5–6 describe the `WordSprite` internals in prose rather than full code**, because the exact `TextStyle` shape depends on the installed Pixi 8 minor version's `dropShadow` API. The geometry and the effects rules — the parts that are decisions rather than API plumbing — are fully specified and tested.
- **Task 8 is the most likely to break e2e**, which is why it runs Playwright before committing rather than deferring to Task 11.
