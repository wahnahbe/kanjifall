# kotoba-drop Milestone 1 (Core Loop Fun-Check) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A playable falling-words Japanese typing game (reading mode, ~50 hardcoded N5 words, Enter-to-submit, 3 lives, waves) proving the core loop is fun before any data pipeline, backend, or visual juice is built.

**Architecture:** A pure-TypeScript game engine (`src/engine/` — zero React/Pixi imports, fixed-timestep, seeded RNG, event-emitting) consumed by two passive layers: a PixiJS v8 stage that renders falling word sprites, and a React shell that renders screens + DOM HUD via `useSyncExternalStore`. Typed romaji converts live to kana with wanakana IME mode; Enter submits against accepted readings; closest-to-floor wins ties.

**Tech Stack:** Vite 7, React 19, TypeScript (strict), PixiJS 8, wanakana 5, Vitest 3 (+ @vitest/coverage-v8), React Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-07-22-kotoba-drop-design.md` (this plan implements Milestone 1 only; §9.1)

## Global Constraints

- Node ≥ 20.19 (Vite 7 floor). npm as package manager.
- TypeScript `strict: true`; no `any` unless a third-party type forces it.
- `src/engine/` and `src/data/` MUST NOT import from `react`, `pixi.js`, or `src/render`/`src/ui` (spec §4.2 load-bearing boundary).
- Engine internals are encapsulated; everything returned by `getSnapshot()` is a defensive copy — external consumers never receive references they could mutate into engine state. (`getWords()` is the one documented render-only exception, consumed solely by the Pixi sync loop.)
- Submit rule (spec §3.1): Enter submits; exact reading match kills; multiple matches → word with the largest `y` (closest to floor) dies; wrong submit clears buffer + resets combo, never costs a life; dangling `n` commits to ん on Enter.
- Reading normalization: `toHiragana(toKatakana(s.trim()))` on BOTH sides of every comparison (handles katakana words and ー deterministically).
- Reading mode excludes kana-only cards (`kanji === null`).
- Lives = 3. Seeded RNG (`mulberry32`) everywhere randomness exists — no `Math.random` in `src/engine/`.
- Coverage ≥ 80% (lines) on `src/engine/**` + `src/data/**`. `src/render/**` is a thin dumb layer verified visually in this milestone.
- Files ≤ 800 lines, functions < 50 lines, no deep nesting (user global rules).
- Conventional commits (`feat:`, `test:`, `chore:`, `docs:`). No attribution footers.
- Tuning constants (fall speed, spawn interval, wave size) live ONLY in `src/engine/constants.ts` — the fun-check gate tunes this one file.

---

## File Structure (all tasks)

```
kotoba-drop/
  package.json  vite.config.ts  tsconfig*.json  playwright.config.ts  .gitignore  index.html
  src/
    main.tsx  App.tsx  index.css
    engine/
      types.ts        # Card, AirborneWord, GameMode, GameEvent, EngineSnapshot, EngineConfig
      constants.ts    # DEFAULT_CONFIG, STEP_MS, LANES — the tuning surface
      rng.ts          # mulberry32
      InputBuffer.ts  # romaji→kana buffer (wanakana IME mode)
      matcher.ts      # normalizeReading, findExactMatches, findPrefixMatches, selectTarget
      scoring.ts      # pointsFor
      Spawner.ts      # wave plans + lane picking (seeded)
      GameEngine.ts   # fixed-timestep loop, submit/kill/miss/wave/game-over, events
    data/
      n5words.ts      # 50 hardcoded N5 cards (replaced by pipeline in M2)
    render/
      PixiStage.ts    # Pixi app init, word sprite sync, kill/miss tweens, resize
      WordSprite.ts   # per-word Text container, lock-on tint
    ui/
      useEngine.ts    # engine lifecycle + rAF driver + keyboard + useSyncExternalStore
      screens/TitleScreen.tsx
      screens/GameScreen.tsx
      screens/GameOverOverlay.tsx
      hud/Hud.tsx     # score, lives, wave, combo, kana buffer (DOM overlay)
  e2e/game.spec.ts
  tests mirror source: src/engine/__tests__/*.test.ts, src/data/__tests__/*.test.ts, src/ui/__tests__/*.test.tsx
```

---

### Task 1: Project scaffold + tooling

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`/`tsconfig.app.json`/`tsconfig.node.json` (template), `.gitignore`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/index.css`
- Create: `src/engine/.gitkeep`, `src/data/.gitkeep`, `src/render/.gitkeep`, `src/ui/.gitkeep` (delete as folders fill)

**Interfaces:**
- Consumes: nothing (first task)
- Produces: working `npm run dev`, `npm run check` (tsc + vitest), folder skeleton every later task writes into

- [ ] **Step 1: Scaffold Vite React-TS app in the repo root**

```bash
cd ~/kotoba-drop
npm create vite@latest . -- --template react-ts
npm install
npm install pixi.js@^8 wanakana@^5
npm install -D vitest@^3 @vitest/coverage-v8@^3 jsdom@^26 @testing-library/react@^16 @testing-library/jest-dom@^6 @types/wanakana@^5 @playwright/test@^1
```

Note: the scaffolder may warn the directory is non-empty (docs/, .git) — choose "Ignore files and continue". If `@types/wanakana` does not exist on the registry, skip it; wanakana ships its own types.

- [ ] **Step 2: Replace `vite.config.ts` with vitest-aware config**

```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'node', // ui tests opt into jsdom via per-file pragma
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/engine/**', 'src/data/**'],
      thresholds: { lines: 80, functions: 80, branches: 80 },
    },
  },
});
```

- [ ] **Step 3: Set scripts in `package.json`** (merge into scaffolded file)

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "coverage": "vitest run --coverage",
    "e2e": "playwright test",
    "check": "tsc -b && vitest run"
  }
}
```

- [ ] **Step 4: Minimal app shell + folders**

`src/App.tsx`:
```tsx
export default function App() {
  return <div data-testid="app-root">kotoba-drop</div>;
}
```

`src/index.css` (replace template css entirely):
```css
:root { color-scheme: dark; }
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body, #root { height: 100%; }
body {
  background: #0b0e14;
  color: #e8f0ff;
  font-family: 'Yu Gothic UI', 'Meiryo', 'Noto Sans JP', system-ui, sans-serif;
  overflow: hidden;
}
button {
  font: inherit; color: inherit; background: #1a2233;
  border: 1px solid #33415c; border-radius: 6px;
  padding: 0.6rem 1.4rem; cursor: pointer;
}
button:hover { background: #24304a; }
```

Delete `src/App.css` and template assets (`src/assets/react.svg`, `public/vite.svg`); remove their imports. Create the four `src/*/.gitkeep` files. Append to `.gitignore`:

```
coverage
playwright-report
test-results
data/*.db
```

- [ ] **Step 5: Verify toolchain**

Run: `npm run check`
Expected: `tsc -b` exits 0; vitest reports "No test files found" and exits 0 (if vitest exits non-zero on empty, add `--passWithNoTests` to the `test`/`check` scripts).

Run: `npm run dev` → open http://localhost:5173 → page shows "kotoba-drop". Stop the server.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: scaffold vite react-ts app with pixi, wanakana, vitest, playwright"
```

---

### Task 2: Engine types + hardcoded N5 word data

**Files:**
- Create: `src/engine/types.ts`
- Create: `src/data/n5words.ts`
- Test: `src/data/__tests__/n5words.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `Card`, `GameMode`, `AirborneWord`, `GameEvent`, `EngineSnapshot`, `EngineConfig` types; `N5_WORDS: Card[]` (50 cards, all with kanji)

- [ ] **Step 1: Write `src/engine/types.ts`**

```ts
export interface Card {
  id: string;
  kanji: string | null; // null = kana-only word (excluded from reading mode)
  kana: string[]; // accepted readings; kana[0] is canonical
  gloss: string;
  pos: string;
  jlpt: 5 | 4 | 3 | 2 | null; // null for custom cards (M2+)
  source: 'jlpt' | 'custom';
}

export type GameMode = 'reading' | 'recall';

export interface AirborneWord {
  instanceId: number;
  card: Card;
  lane: number; // index into LANES
  x: number; // 0..1 horizontal center
  y: number; // 0 = top, 1 = floor
  speed: number; // y-units per second
  spawnedAt: number; // engine clock ms
  firstKeyAt: number | null; // engine clock ms of first lock-on keystroke
  backspaceCount: number;
  hintShown: boolean; // recall-mode grace hint (always false in M1)
  wasTargeted: boolean;
}

export type GameEvent =
  | { type: 'wordSpawned'; word: AirborneWord }
  | { type: 'wordKilled'; word: AirborneWord; msToKill: number; points: number; combo: number }
  | { type: 'wordMissed'; word: AirborneWord }
  | { type: 'wrongSubmit'; submittedKana: string }
  | { type: 'bufferChanged'; kana: string; romaji: string; lockedIds: number[] }
  | { type: 'waveCleared'; wave: number }
  | { type: 'gameOver'; score: number; wave: number };

export type GameStatus = 'idle' | 'playing' | 'gameOver';

export interface EngineSnapshot {
  status: GameStatus;
  score: number;
  lives: number;
  wave: number;
  combo: number;
  bufferKana: string;
  bufferRomaji: string;
  lockedIds: number[];
  missed: Card[];
  timeMs: number;
}

export interface EngineConfig {
  lives: number;
  baseWaveSize: number; // words in wave 1
  waveSizeGrowth: number; // +words per wave
  maxWaveSize: number;
  maxAirborne: number;
  baseFallSpeed: number; // y-units/sec at wave 1
  fallSpeedGrowth: number; // multiplier increment per wave
  maxFallSpeed: number;
  baseSpawnIntervalMs: number;
  spawnIntervalDecay: number; // multiplier per wave
  minSpawnIntervalMs: number;
  interWaveDelayMs: number;
}
```

- [ ] **Step 2: Write failing data-invariant test `src/data/__tests__/n5words.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { isKana } from 'wanakana';
import { N5_WORDS } from '../n5words';

describe('N5_WORDS data invariants', () => {
  it('has 50 cards', () => {
    expect(N5_WORDS).toHaveLength(50);
  });

  it('every card has kanji, at least one pure-kana reading, and a short gloss', () => {
    for (const card of N5_WORDS) {
      expect(card.kanji, card.id).toBeTruthy();
      expect(card.kana.length, card.id).toBeGreaterThan(0);
      for (const reading of card.kana) expect(isKana(reading), `${card.id}:${reading}`).toBe(true);
      expect(card.gloss.length, card.id).toBeLessThanOrEqual(28);
      expect(card.jlpt, card.id).toBe(5);
      expect(card.source, card.id).toBe('jlpt');
    }
  });

  it('ids and kanji are unique', () => {
    expect(new Set(N5_WORDS.map((c) => c.id)).size).toBe(50);
    expect(new Set(N5_WORDS.map((c) => c.kanji)).size).toBe(50);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/data`
Expected: FAIL — `Cannot find module '../n5words'`

- [ ] **Step 4: Write `src/data/n5words.ts`**

```ts
import type { Card } from '../engine/types';

const w = (id: string, kanji: string, kana: string, gloss: string, pos = 'noun'): Card => ({
  id, kanji, kana: [kana], gloss, pos, jlpt: 5, source: 'jlpt',
});

export const N5_WORDS: Card[] = [
  w('n5-001', '学生', 'がくせい', 'student'),
  w('n5-002', '先生', 'せんせい', 'teacher'),
  w('n5-003', '学校', 'がっこう', 'school'),
  w('n5-004', '時間', 'じかん', 'time; hour'),
  w('n5-005', '電車', 'でんしゃ', 'train'),
  w('n5-006', '天気', 'てんき', 'weather'),
  w('n5-007', '元気', 'げんき', 'healthy; lively', 'adj-na'),
  w('n5-008', '友達', 'ともだち', 'friend'),
  w('n5-009', '名前', 'なまえ', 'name'),
  w('n5-010', '毎日', 'まいにち', 'every day'),
  w('n5-011', '今日', 'きょう', 'today'),
  w('n5-012', '明日', 'あした', 'tomorrow'),
  w('n5-013', '昨日', 'きのう', 'yesterday'),
  w('n5-014', '今週', 'こんしゅう', 'this week'),
  w('n5-015', '来週', 'らいしゅう', 'next week'),
  w('n5-016', '去年', 'きょねん', 'last year'),
  w('n5-017', '今年', 'ことし', 'this year'),
  w('n5-018', '水', 'みず', 'water'),
  w('n5-019', '火', 'ひ', 'fire'),
  w('n5-020', '山', 'やま', 'mountain'),
  w('n5-021', '川', 'かわ', 'river'),
  w('n5-022', '空', 'そら', 'sky'),
  w('n5-023', '海', 'うみ', 'sea'),
  w('n5-024', '雨', 'あめ', 'rain'),
  w('n5-025', '雪', 'ゆき', 'snow'),
  w('n5-026', '花', 'はな', 'flower'),
  w('n5-027', '犬', 'いぬ', 'dog'),
  w('n5-028', '猫', 'ねこ', 'cat'),
  w('n5-029', '鳥', 'とり', 'bird'),
  w('n5-030', '魚', 'さかな', 'fish'),
  w('n5-031', '本', 'ほん', 'book'),
  w('n5-032', '車', 'くるま', 'car'),
  w('n5-033', '家', 'いえ', 'house'),
  w('n5-034', '部屋', 'へや', 'room'),
  w('n5-035', '椅子','いす', 'chair'),
  w('n5-036', '机', 'つくえ', 'desk'),
  w('n5-037', '電話', 'でんわ', 'telephone'),
  w('n5-038', '時計', 'とけい', 'clock; watch'),
  w('n5-039', '眼鏡', 'めがね', 'glasses'),
  w('n5-040', '財布', 'さいふ', 'wallet'),
  w('n5-041', '服', 'ふく', 'clothes'),
  w('n5-042', '靴', 'くつ', 'shoes'),
  w('n5-043', '帽子', 'ぼうし', 'hat'),
  w('n5-044', '傘', 'かさ', 'umbrella'),
  w('n5-045', '食べ物', 'たべもの', 'food'),
  w('n5-046', '飲み物', 'のみもの', 'drink'),
  w('n5-047', '朝ご飯', 'あさごはん', 'breakfast'),
  w('n5-048', '昼ご飯', 'ひるごはん', 'lunch'),
  w('n5-049', '晩ご飯', 'ばんごはん', 'dinner'),
  w('n5-050', '料理', 'りょうり', 'cooking; dish'),
];
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/data`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add src/engine/types.ts src/data/n5words.ts src/data/__tests__/n5words.test.ts
git commit -m "feat: engine domain types and hardcoded N5 word set"
```

---

### Task 3: InputBuffer (romaji → kana, IME-style)

**Files:**
- Create: `src/engine/InputBuffer.ts`
- Test: `src/engine/__tests__/InputBuffer.test.ts`

**Interfaces:**
- Consumes: `wanakana.toKana`
- Produces: `class InputBuffer { pushKey(ch: string): boolean; backspace(): boolean; clear(): void; commitKana(): string; get kana(): string; get romaji(): string; get isEmpty(): boolean }`

- [ ] **Step 1: Write failing tests `src/engine/__tests__/InputBuffer.test.ts`**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { InputBuffer } from '../InputBuffer';

let buf: InputBuffer;
beforeEach(() => { buf = new InputBuffer(); });

const type = (s: string) => { for (const ch of s) buf.pushKey(ch); };

describe('InputBuffer', () => {
  it('converts romaji to kana progressively (IME mode)', () => {
    type('benkyou');
    expect(buf.kana).toBe('べんきょう');
    expect(buf.romaji).toBe('benkyou');
  });

  it('shows unconverted partial romaji tail', () => {
    type('benk');
    expect(buf.kana).toBe('べんk');
  });

  it('keeps trailing n ambiguous until committed', () => {
    type('hon');
    expect(buf.kana).toBe('ほn');
    expect(buf.commitKana()).toBe('ほん');
  });

  it('handles double consonants and long-vowel hyphen', () => {
    type('kitte');
    expect(buf.kana).toBe('きって');
    buf.clear();
    type('ko-hi-');
    expect(buf.kana).toBe('こーひー');
  });

  it('accepts alternate romanizations', () => {
    type('si');
    expect(buf.kana).toBe('し');
    buf.clear();
    type('zya');
    expect(buf.kana).toBe('じゃ');
  });

  it('rejects non-input keys and reports consumption', () => {
    expect(buf.pushKey('a')).toBe(true);
    expect(buf.pushKey('1')).toBe(false);
    expect(buf.pushKey('!')).toBe(false);
    expect(buf.kana).toBe('あ');
  });

  it('backspace removes one raw char; clear empties', () => {
    type('ka');
    expect(buf.kana).toBe('か');
    expect(buf.backspace()).toBe(true);
    expect(buf.kana).toBe('k');
    buf.clear();
    expect(buf.isEmpty).toBe(true);
    expect(buf.backspace()).toBe(false);
  });

  it('uppercase input is lowered', () => {
    type('NEKO');
    expect(buf.kana).toBe('ねこ');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/__tests__/InputBuffer.test.ts`
Expected: FAIL — `Cannot find module '../InputBuffer'`

- [ ] **Step 3: Implement `src/engine/InputBuffer.ts`**

```ts
import { toKana } from 'wanakana';

const INPUT_KEY = /^[a-z-]$/;

/** Romaji accumulator that renders as kana the way an IME would. */
export class InputBuffer {
  private raw = '';

  get romaji(): string {
    return this.raw;
  }

  get kana(): string {
    return toKana(this.raw, { IMEMode: true });
  }

  get isEmpty(): boolean {
    return this.raw.length === 0;
  }

  /** Returns true if the key was consumed as input. */
  pushKey(ch: string): boolean {
    const key = ch.toLowerCase();
    if (!INPUT_KEY.test(key)) return false;
    this.raw += key;
    return true;
  }

  /** Returns true if a character was removed. */
  backspace(): boolean {
    if (this.raw.length === 0) return false;
    this.raw = this.raw.slice(0, -1);
    return true;
  }

  clear(): void {
    this.raw = '';
  }

  /** Finalize for submission: a dangling 'n' becomes ん. Does not clear. */
  commitKana(): string {
    const finalized = this.raw.endsWith('n') && !this.raw.endsWith('nn')
      ? `${this.raw}n`
      : this.raw;
    return toKana(finalized, { IMEMode: true });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/engine/__tests__/InputBuffer.test.ts`
Expected: PASS (8 tests). If the `ko-hi-` expectation fails because wanakana renders the hyphen differently in IME mode, the fix belongs in the TEST expectation only if actual output still equals what `normalizeReading` (Task 4) maps to こおひい — verify by logging; do not change InputBuffer.

- [ ] **Step 5: Commit**

```bash
git add src/engine/InputBuffer.ts src/engine/__tests__/InputBuffer.test.ts
git commit -m "feat: romaji-to-kana input buffer with IME-style conversion"
```

---

### Task 4: Matcher (normalization, matching, target selection)

**Files:**
- Create: `src/engine/matcher.ts`
- Test: `src/engine/__tests__/matcher.test.ts`

**Interfaces:**
- Consumes: `AirborneWord`, `Card` from `types.ts`; `wanakana.toHiragana/toKatakana`
- Produces:
  - `normalizeReading(s: string): string`
  - `findExactMatches(kanaBuffer: string, words: readonly AirborneWord[]): AirborneWord[]`
  - `findPrefixMatches(kanaBuffer: string, words: readonly AirborneWord[]): AirborneWord[]`
  - `selectTarget(matches: readonly AirborneWord[]): AirborneWord | null`

- [ ] **Step 1: Write failing tests `src/engine/__tests__/matcher.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import type { AirborneWord, Card } from '../types';
import { findExactMatches, findPrefixMatches, normalizeReading, selectTarget } from '../matcher';

const card = (id: string, readings: string[], kanji: string | null = '字'): Card => ({
  id, kanji, kana: readings, gloss: 'x', pos: 'noun', jlpt: 5, source: 'jlpt',
});

const airborne = (id: number, c: Card, y: number): AirborneWord => ({
  instanceId: id, card: c, lane: 0, x: 0.5, y, speed: 0.1,
  spawnedAt: 0, firstKeyAt: null, backspaceCount: 0, hintShown: false, wasTargeted: false,
});

describe('normalizeReading', () => {
  it('equates hiragana and katakana forms', () => {
    expect(normalizeReading('ネコ')).toBe(normalizeReading('ねこ'));
  });
  it('equates long-vowel-mark forms regardless of source script', () => {
    expect(normalizeReading('コーヒー')).toBe(normalizeReading('こーひー'));
  });
});

describe('findExactMatches', () => {
  const neko = airborne(1, card('a', ['ねこ']), 0.3);
  const koohii = airborne(2, card('b', ['コーヒー']), 0.5);

  it('matches any accepted reading', () => {
    const multi = airborne(3, card('c', ['いく', 'ゆく']), 0.2);
    expect(findExactMatches('ゆく', [multi])).toHaveLength(1);
    expect(findExactMatches('いく', [multi])).toHaveLength(1);
  });

  it('matches katakana words typed as hiragana with hyphen long vowels', () => {
    expect(findExactMatches('こーひー', [neko, koohii]).map((w) => w.instanceId)).toEqual([2]);
  });

  it('returns empty on no match', () => {
    expect(findExactMatches('いぬ', [neko])).toHaveLength(0);
  });
});

describe('findPrefixMatches', () => {
  const benkyou = airborne(1, card('a', ['べんきょう']), 0.3);
  const bengoshi = airborne(2, card('b', ['べんごし']), 0.4);

  it('locks all words sharing the typed kana prefix', () => {
    expect(findPrefixMatches('べん', [benkyou, bengoshi])).toHaveLength(2);
  });

  it('ignores an unconverted romaji tail', () => {
    expect(findPrefixMatches('べんk', [benkyou, bengoshi])).toHaveLength(2);
  });

  it('empty converted prefix locks nothing', () => {
    expect(findPrefixMatches('k', [benkyou])).toHaveLength(0);
    expect(findPrefixMatches('', [benkyou])).toHaveLength(0);
  });
});

describe('selectTarget', () => {
  it('picks the word closest to the floor (max y)', () => {
    const c = card('a', ['こうえん']);
    const high = airborne(1, c, 0.2);
    const low = airborne(2, c, 0.8);
    expect(selectTarget([high, low])?.instanceId).toBe(2);
  });
  it('returns null for empty input', () => {
    expect(selectTarget([])).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/__tests__/matcher.test.ts`
Expected: FAIL — `Cannot find module '../matcher'`

- [ ] **Step 3: Implement `src/engine/matcher.ts`**

```ts
import { toHiragana, toKatakana } from 'wanakana';
import type { AirborneWord } from './types';

/**
 * Canonical comparison form for readings. The katakana round-trip makes
 * long-vowel marks (ー) resolve identically whether the source was
 * hiragana, katakana, or an IME buffer (spec §3.5 katakana mitigation).
 */
export function normalizeReading(s: string): string {
  return toHiragana(toKatakana(s.trim()));
}

/** Kana-only prefix of a buffer that may end in unconverted romaji. */
function convertedPrefix(kanaBuffer: string): string {
  return kanaBuffer.replace(/[a-z-]+$/i, '');
}

export function findExactMatches(
  kanaBuffer: string,
  words: readonly AirborneWord[],
): AirborneWord[] {
  const target = normalizeReading(kanaBuffer);
  if (target.length === 0) return [];
  return words.filter((w) => w.card.kana.some((r) => normalizeReading(r) === target));
}

export function findPrefixMatches(
  kanaBuffer: string,
  words: readonly AirborneWord[],
): AirborneWord[] {
  const prefix = normalizeReading(convertedPrefix(kanaBuffer));
  if (prefix.length === 0) return [];
  return words.filter((w) =>
    w.card.kana.some((r) => normalizeReading(r).startsWith(prefix)),
  );
}

/** Homophone rule (spec §3.1): the word closest to the floor dies. */
export function selectTarget(matches: readonly AirborneWord[]): AirborneWord | null {
  if (matches.length === 0) return null;
  return matches.reduce((lowest, w) => (w.y > lowest.y ? w : lowest));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/engine/__tests__/matcher.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: Commit**

```bash
git add src/engine/matcher.ts src/engine/__tests__/matcher.test.ts
git commit -m "feat: reading normalization, exact/prefix matching, closest-to-floor targeting"
```

---

### Task 5: Constants + scoring

**Files:**
- Create: `src/engine/constants.ts`
- Create: `src/engine/scoring.ts`
- Test: `src/engine/__tests__/scoring.test.ts`

**Interfaces:**
- Consumes: `Card`, `EngineConfig` from `types.ts`
- Produces: `DEFAULT_CONFIG: EngineConfig`, `STEP_MS = 1000 / 60`, `LANES: number[]`, `pointsFor(card: Card, wave: number, combo: number): number`, `comboMultiplier(combo: number): number`

- [ ] **Step 1: Write `src/engine/constants.ts`** (no test — pure data; exercised by Spawner/GameEngine tests)

```ts
import type { EngineConfig } from './types';

/** Fixed simulation step (ms). */
export const STEP_MS = 1000 / 60;

/** Horizontal spawn lanes (normalized x centers). */
export const LANES = [0.15, 0.32, 0.5, 0.68, 0.85];

/**
 * THE tuning surface for the Milestone-1 fun-check gate.
 * Change values here; nothing else should hardcode pacing.
 */
export const DEFAULT_CONFIG: EngineConfig = {
  lives: 3,
  baseWaveSize: 5,
  waveSizeGrowth: 1,
  maxWaveSize: 10,
  maxAirborne: 6,
  baseFallSpeed: 0.07, // ~14s top-to-floor in wave 1
  fallSpeedGrowth: 0.12, // +12% per wave
  maxFallSpeed: 0.28,
  baseSpawnIntervalMs: 3200,
  spawnIntervalDecay: 0.94,
  minSpawnIntervalMs: 1200,
  interWaveDelayMs: 1500,
};
```

- [ ] **Step 2: Write failing tests `src/engine/__tests__/scoring.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import type { Card } from '../types';
import { comboMultiplier, pointsFor } from '../scoring';

const card = (reading: string): Card => ({
  id: 'x', kanji: '字', kana: [reading], gloss: 'g', pos: 'noun', jlpt: 5, source: 'jlpt',
});

describe('scoring', () => {
  it('longer readings score more', () => {
    expect(pointsFor(card('がっこう'), 1, 0)).toBeGreaterThan(pointsFor(card('ひ'), 1, 0));
  });

  it('later waves score more', () => {
    expect(pointsFor(card('ねこ'), 5, 0)).toBeGreaterThan(pointsFor(card('ねこ'), 1, 0));
  });

  it('combo multiplies and caps at 20 stacks', () => {
    expect(comboMultiplier(0)).toBe(1);
    expect(comboMultiplier(5)).toBe(1.5);
    expect(comboMultiplier(20)).toBe(3);
    expect(comboMultiplier(99)).toBe(3);
    expect(pointsFor(card('ねこ'), 1, 5)).toBe(Math.round(pointsFor(card('ねこ'), 1, 0) * 1.5));
  });

  it('returns integers', () => {
    expect(Number.isInteger(pointsFor(card('りょうり'), 3, 7))).toBe(true);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/engine/__tests__/scoring.test.ts`
Expected: FAIL — `Cannot find module '../scoring'`

- [ ] **Step 4: Implement `src/engine/scoring.ts`**

```ts
import type { Card } from './types';

const BASE_POINTS = 100;
const POINTS_PER_KANA = 20;
const WAVE_BONUS_RATE = 0.1;
const COMBO_STEP = 0.1;
const COMBO_CAP = 20;

export function comboMultiplier(combo: number): number {
  return 1 + Math.min(combo, COMBO_CAP) * COMBO_STEP;
}

/** Points for killing `card` during `wave` with `combo` prior consecutive kills. */
export function pointsFor(card: Card, wave: number, combo: number): number {
  const base = BASE_POINTS + POINTS_PER_KANA * card.kana[0].length;
  const waveBonus = base * WAVE_BONUS_RATE * (wave - 1);
  return Math.round((base + waveBonus) * comboMultiplier(combo));
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/engine/__tests__/scoring.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Commit**

```bash
git add src/engine/constants.ts src/engine/scoring.ts src/engine/__tests__/scoring.test.ts
git commit -m "feat: tuning constants and combo-scaled scoring"
```

---

### Task 6: Seeded RNG + Spawner

**Files:**
- Create: `src/engine/rng.ts`
- Create: `src/engine/Spawner.ts`
- Test: `src/engine/__tests__/Spawner.test.ts`

**Interfaces:**
- Consumes: `Card`, `EngineConfig`; `LANES` from `constants.ts`
- Produces:
  - `mulberry32(seed: number): () => number` (returns floats in [0,1))
  - `interface WavePlan { cards: Card[]; fallSpeed: number; spawnIntervalMs: number }`
  - `class Spawner { constructor(pool: Card[], rng: () => number, config: EngineConfig); planWave(wave: number): WavePlan; pickLane(occupiedLanes: readonly number[]): number }`

- [ ] **Step 1: Write failing tests `src/engine/__tests__/Spawner.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, LANES } from '../constants';
import { mulberry32 } from '../rng';
import { Spawner } from '../Spawner';
import type { Card } from '../types';

const pool: Card[] = Array.from({ length: 20 }, (_, i) => ({
  id: `c${i}`, kanji: `字${i}`, kana: [`かな${i}`], gloss: 'g', pos: 'noun',
  jlpt: 5, source: 'jlpt',
}));

const make = (seed = 42) => new Spawner(pool, mulberry32(seed), DEFAULT_CONFIG);

describe('mulberry32', () => {
  it('is deterministic per seed and in [0,1)', () => {
    const a = mulberry32(7);
    const b = mulberry32(7);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(mulberry32(8)()).not.toBe(mulberry32(7)());
  });
});

describe('Spawner.planWave', () => {
  it('grows wave size and caps it', () => {
    const s = make();
    expect(s.planWave(1).cards).toHaveLength(DEFAULT_CONFIG.baseWaveSize);
    expect(s.planWave(2).cards).toHaveLength(DEFAULT_CONFIG.baseWaveSize + 1);
    expect(s.planWave(50).cards).toHaveLength(DEFAULT_CONFIG.maxWaveSize);
  });

  it('never repeats a card within a wave', () => {
    const cards = make().planWave(5).cards;
    expect(new Set(cards.map((c) => c.id)).size).toBe(cards.length);
  });

  it('ramps speed and spawn rate monotonically with caps', () => {
    const s = make();
    const w1 = s.planWave(1);
    const w5 = s.planWave(5);
    expect(w5.fallSpeed).toBeGreaterThan(w1.fallSpeed);
    expect(w5.spawnIntervalMs).toBeLessThan(w1.spawnIntervalMs);
    expect(s.planWave(200).fallSpeed).toBe(DEFAULT_CONFIG.maxFallSpeed);
    expect(s.planWave(200).spawnIntervalMs).toBe(DEFAULT_CONFIG.minSpawnIntervalMs);
  });

  it('same seed → same wave composition', () => {
    expect(make(9).planWave(1).cards.map((c) => c.id))
      .toEqual(make(9).planWave(1).cards.map((c) => c.id));
  });
});

describe('Spawner.pickLane', () => {
  it('avoids occupied lanes when any lane is free', () => {
    const s = make();
    for (let i = 0; i < 30; i++) {
      expect(s.pickLane([0, 1, 2, 3])).toBe(4);
    }
  });

  it('returns a valid lane even when all are occupied', () => {
    const lane = make().pickLane([0, 1, 2, 3, 4]);
    expect(lane).toBeGreaterThanOrEqual(0);
    expect(lane).toBeLessThan(LANES.length);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/engine/__tests__/Spawner.test.ts`
Expected: FAIL — `Cannot find module '../rng'`

- [ ] **Step 3: Implement `src/engine/rng.ts`**

```ts
/** Tiny deterministic PRNG (public-domain mulberry32). Floats in [0,1). */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
```

- [ ] **Step 4: Implement `src/engine/Spawner.ts`**

```ts
import { LANES } from './constants';
import type { Card, EngineConfig } from './types';

export interface WavePlan {
  cards: Card[];
  fallSpeed: number;
  spawnIntervalMs: number;
}

export class Spawner {
  constructor(
    private readonly pool: Card[],
    private readonly rng: () => number,
    private readonly config: EngineConfig,
  ) {}

  planWave(wave: number): WavePlan {
    const c = this.config;
    const size = Math.min(
      c.baseWaveSize + c.waveSizeGrowth * (wave - 1),
      c.maxWaveSize,
      this.pool.length,
    );
    return {
      cards: this.shuffled(this.pool).slice(0, size),
      fallSpeed: Math.min(c.baseFallSpeed * (1 + c.fallSpeedGrowth * (wave - 1)), c.maxFallSpeed),
      spawnIntervalMs: Math.max(
        Math.round(c.baseSpawnIntervalMs * c.spawnIntervalDecay ** (wave - 1)),
        c.minSpawnIntervalMs,
      ),
    };
  }

  /** Prefer a free lane; fall back to any lane when all are occupied. */
  pickLane(occupiedLanes: readonly number[]): number {
    const free = LANES.map((_, i) => i).filter((i) => !occupiedLanes.includes(i));
    const candidates = free.length > 0 ? free : LANES.map((_, i) => i);
    return candidates[Math.floor(this.rng() * candidates.length)];
  }

  private shuffled(cards: readonly Card[]): Card[] {
    const copy = [...cards];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/engine/__tests__/Spawner.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 6: Commit**

```bash
git add src/engine/rng.ts src/engine/Spawner.ts src/engine/__tests__/Spawner.test.ts
git commit -m "feat: seeded rng and deterministic wave spawner"
```

---

### Task 7: GameEngine (fixed-timestep core loop)

**Files:**
- Create: `src/engine/GameEngine.ts`
- Test: `src/engine/__tests__/GameEngine.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–6 (`InputBuffer`, matcher functions, `Spawner`, `mulberry32`, `pointsFor`, `DEFAULT_CONFIG`, `STEP_MS`, `LANES`, all types)
- Produces:
  - `class GameEngine { constructor(opts: { cards: Card[]; mode: GameMode; seed: number; config?: Partial<EngineConfig> }); start(): void; tick(nowMs: number): void; handleKey(key: string): void; subscribe(listener: (e: GameEvent) => void): () => void; getSnapshot(): EngineSnapshot; getWords(): readonly AirborneWord[] }`
  - `handleKey` accepts: single chars (romaji), `'Backspace'`, `'Escape'`, `'Enter'`
  - Consumers: Task 8 renders `getWords()`; Task 9 drives `tick`/`handleKey` and renders `getSnapshot()`

Test helper used throughout: drive time manually with `advance(engine, ms)` calling `tick` in 16ms increments — no real timers anywhere.

- [ ] **Step 1: Write failing tests (part 1: spawning, falling, snapshot) `src/engine/__tests__/GameEngine.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { GameEngine } from '../GameEngine';
import type { Card, GameEvent } from '../types';

const cards: Card[] = [
  { id: 'neko', kanji: '猫', kana: ['ねこ'], gloss: 'cat', pos: 'noun', jlpt: 5, source: 'jlpt' },
  { id: 'inu', kanji: '犬', kana: ['いぬ'], gloss: 'dog', pos: 'noun', jlpt: 5, source: 'jlpt' },
  { id: 'hon', kanji: '本', kana: ['ほん'], gloss: 'book', pos: 'noun', jlpt: 5, source: 'jlpt' },
  { id: 'kana-only', kanji: null, kana: ['それ'], gloss: 'that', pos: 'pron', jlpt: 5, source: 'jlpt' },
];

// 2-word waves, slow spawn, fast fall for test brevity
const config = {
  baseWaveSize: 2, waveSizeGrowth: 0, maxWaveSize: 2, maxAirborne: 6,
  baseFallSpeed: 0.1, baseSpawnIntervalMs: 1000, interWaveDelayMs: 500,
};

function makeEngine(seed = 1) {
  const engine = new GameEngine({ cards, mode: 'reading', seed, config });
  const events: GameEvent[] = [];
  engine.subscribe((e) => events.push(e));
  engine.start();
  return { engine, events };
}

/** Advance wall-clock; engine steps at its own fixed timestep. */
function advance(engine: GameEngine, ms: number, from = 0): number {
  let now = from;
  const end = from + ms;
  while (now < end) {
    now = Math.min(now + 16, end);
    engine.tick(now);
  }
  return end;
}

const typeWord = (engine: GameEngine, romaji: string) => {
  for (const ch of romaji) engine.handleKey(ch);
  engine.handleKey('Enter');
};

describe('spawning and falling', () => {
  it('excludes kana-only cards in reading mode', () => {
    const { engine } = makeEngine();
    advance(engine, 20_000);
    const seen = new Set(engine.getWords().map((w) => w.card.id));
    expect(seen.has('kana-only')).toBe(false);
  });

  it('spawns the first word immediately and respects spawn interval', () => {
    const { engine, events } = makeEngine();
    advance(engine, 20);
    expect(events.filter((e) => e.type === 'wordSpawned')).toHaveLength(1);
    advance(engine, 1000, 20);
    expect(events.filter((e) => e.type === 'wordSpawned')).toHaveLength(2);
  });

  it('words fall at wave speed', () => {
    const { engine } = makeEngine();
    advance(engine, 1000);
    const word = engine.getWords()[0];
    expect(word.y).toBeCloseTo(0.1, 1);
  });

  it('snapshot is a defensive copy', () => {
    const { engine } = makeEngine();
    advance(engine, 100);
    const snap = engine.getSnapshot();
    snap.missed.push(cards[0]);
    snap.lockedIds.push(999);
    expect(engine.getSnapshot().missed).toHaveLength(0);
    expect(engine.getSnapshot().lockedIds).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/__tests__/GameEngine.test.ts`
Expected: FAIL — `Cannot find module '../GameEngine'`

- [ ] **Step 3: Implement `src/engine/GameEngine.ts`**

```ts
import { DEFAULT_CONFIG, LANES, STEP_MS } from './constants';
import { InputBuffer } from './InputBuffer';
import { findExactMatches, findPrefixMatches, selectTarget } from './matcher';
import { mulberry32 } from './rng';
import { pointsFor } from './scoring';
import { Spawner, type WavePlan } from './Spawner';
import type {
  AirborneWord, Card, EngineConfig, EngineSnapshot, GameEvent, GameMode, GameStatus,
} from './types';

export interface EngineOptions {
  cards: Card[];
  mode: GameMode;
  seed: number;
  config?: Partial<EngineConfig>;
}

export class GameEngine {
  private readonly config: EngineConfig;
  private readonly mode: GameMode;
  private readonly spawner: Spawner;
  private readonly buffer = new InputBuffer();
  private readonly listeners = new Set<(e: GameEvent) => void>();

  private status: GameStatus = 'idle';
  private words: AirborneWord[] = [];
  private missed: Card[] = [];
  private lockedIds: number[] = [];
  private score = 0;
  private lives: number;
  private wave = 0;
  private combo = 0;
  private timeMs = 0;

  private wavePlan: WavePlan | null = null;
  private waveQueue: Card[] = [];
  private nextSpawnAt = 0;
  private nextWaveAt = 0;
  private nextInstanceId = 1;
  private lastNow: number | null = null;
  private accumulator = 0;

  constructor(opts: EngineOptions) {
    this.config = { ...DEFAULT_CONFIG, ...opts.config };
    this.mode = opts.mode;
    this.lives = this.config.lives;
    const pool = opts.mode === 'reading'
      ? opts.cards.filter((c) => c.kanji !== null)
      : opts.cards;
    this.spawner = new Spawner(pool, mulberry32(opts.seed), this.config);
  }

  subscribe(listener: (e: GameEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.status !== 'idle') return;
    this.status = 'playing';
    this.beginWave(1);
  }

  /** rAF driver entry point. Fixed-timestep with tab-restore clamp. */
  tick(nowMs: number): void {
    if (this.status !== 'playing') return;
    if (this.lastNow === null) this.lastNow = nowMs;
    const dt = Math.min(nowMs - this.lastNow, 100);
    this.lastNow = nowMs;
    this.accumulator += dt;
    while (this.accumulator >= STEP_MS) {
      this.step();
      this.accumulator -= STEP_MS;
      if (this.status !== 'playing') return;
    }
  }

  handleKey(key: string): void {
    if (this.status !== 'playing') return;
    if (key === 'Enter') return this.submit();
    if (key === 'Escape') {
      this.buffer.clear();
      return this.refreshLocks();
    }
    if (key === 'Backspace') {
      if (this.buffer.backspace()) {
        for (const w of this.words) {
          if (this.lockedIds.includes(w.instanceId)) w.backspaceCount += 1;
        }
        this.refreshLocks();
      }
      return;
    }
    if (this.buffer.pushKey(key)) this.refreshLocks();
  }

  getWords(): readonly AirborneWord[] {
    return this.words; // render-only; consumers must not mutate
  }

  getSnapshot(): EngineSnapshot {
    return {
      status: this.status,
      score: this.score,
      lives: this.lives,
      wave: this.wave,
      combo: this.combo,
      bufferKana: this.buffer.kana,
      bufferRomaji: this.buffer.romaji,
      lockedIds: [...this.lockedIds],
      missed: [...this.missed],
      timeMs: this.timeMs,
    };
  }

  // ---- internals ----

  private emit(event: GameEvent): void {
    for (const l of this.listeners) l(event);
  }

  private beginWave(wave: number): void {
    this.wave = wave;
    this.wavePlan = this.spawner.planWave(wave);
    this.waveQueue = [...this.wavePlan.cards];
    this.nextSpawnAt = this.timeMs; // first word spawns on the next step
  }

  private step(): void {
    this.timeMs += STEP_MS;
    this.trySpawn();
    this.moveWords();
    this.tryAdvanceWave();
  }

  private trySpawn(): void {
    if (!this.wavePlan || this.waveQueue.length === 0) return;
    if (this.timeMs < this.nextSpawnAt) return;
    if (this.words.length >= this.config.maxAirborne) return;
    const card = this.waveQueue.shift()!;
    const lane = this.spawner.pickLane(this.words.filter((w) => w.y < 0.25).map((w) => w.lane));
    const word: AirborneWord = {
      instanceId: this.nextInstanceId++,
      card,
      lane,
      x: LANES[lane],
      y: 0,
      speed: this.wavePlan.fallSpeed,
      spawnedAt: this.timeMs,
      firstKeyAt: null,
      backspaceCount: 0,
      hintShown: false,
      wasTargeted: false,
    };
    this.words.push(word);
    this.nextSpawnAt = this.timeMs + this.wavePlan.spawnIntervalMs;
    this.emit({ type: 'wordSpawned', word });
  }

  private moveWords(): void {
    const landed: AirborneWord[] = [];
    for (const w of this.words) {
      w.y += (w.speed * STEP_MS) / 1000;
      if (w.y >= 1) landed.push(w);
    }
    for (const w of landed) this.missWord(w);
  }

  private missWord(word: AirborneWord): void {
    this.words = this.words.filter((w) => w.instanceId !== word.instanceId);
    this.missed.push(word.card);
    this.lives -= 1;
    this.combo = 0;
    this.refreshLocks();
    this.emit({ type: 'wordMissed', word });
    if (this.lives <= 0) {
      this.status = 'gameOver';
      this.emit({ type: 'gameOver', score: this.score, wave: this.wave });
    }
  }

  private tryAdvanceWave(): void {
    if (!this.wavePlan) return;
    if (this.waveQueue.length > 0 || this.words.length > 0) return;
    if (this.nextWaveAt === 0) {
      this.nextWaveAt = this.timeMs + this.config.interWaveDelayMs;
      this.emit({ type: 'waveCleared', wave: this.wave });
      return;
    }
    if (this.timeMs >= this.nextWaveAt) {
      this.nextWaveAt = 0;
      this.beginWave(this.wave + 1);
    }
  }

  private submit(): void {
    const kana = this.buffer.commitKana();
    if (kana.length === 0) return;
    const target = selectTarget(findExactMatches(kana, this.words));
    if (target === null) {
      this.combo = 0;
      this.buffer.clear();
      this.refreshLocks();
      this.emit({ type: 'wrongSubmit', submittedKana: kana });
      return;
    }
    this.killWord(target);
  }

  private killWord(word: AirborneWord): void {
    this.words = this.words.filter((w) => w.instanceId !== word.instanceId);
    const msToKill = this.timeMs - word.spawnedAt;
    const points = pointsFor(word.card, this.wave, this.combo);
    this.combo += 1;
    this.score += points;
    this.buffer.clear();
    this.refreshLocks();
    this.emit({ type: 'wordKilled', word, msToKill, points, combo: this.combo });
  }

  private refreshLocks(): void {
    const locks = findPrefixMatches(this.buffer.kana, this.words);
    this.lockedIds = locks.map((w) => w.instanceId);
    for (const w of locks) {
      if (w.firstKeyAt === null) {
        w.firstKeyAt = this.timeMs;
        w.wasTargeted = true;
      }
    }
    this.emit({
      type: 'bufferChanged',
      kana: this.buffer.kana,
      romaji: this.buffer.romaji,
      lockedIds: [...this.lockedIds],
    });
  }
}
```

- [ ] **Step 4: Run part-1 tests**

Run: `npx vitest run src/engine/__tests__/GameEngine.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Append part 2 tests (submit/kill/miss/lives/waves/determinism) to the same file**

```ts
describe('submit flow', () => {
  it('kills a word on exact reading + Enter, scores, and increments combo', () => {
    const { engine, events } = makeEngine();
    advance(engine, 20);
    const word = engine.getWords()[0];
    const romaji = word.card.id === 'neko' ? 'neko' : word.card.id === 'inu' ? 'inu' : 'hon';
    typeWord(engine, romaji);
    const killed = events.find((e) => e.type === 'wordKilled');
    expect(killed).toBeDefined();
    expect(engine.getSnapshot().score).toBeGreaterThan(0);
    expect(engine.getSnapshot().combo).toBe(1);
    expect(engine.getWords()).toHaveLength(0);
  });

  it('dangling n commits (hon + Enter kills ほん)', () => {
    const hon = cards.filter((c) => c.id === 'hon');
    const engine = new GameEngine({ cards: hon, mode: 'reading', seed: 1, config });
    const events: GameEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();
    advance(engine, 20);
    typeWord(engine, 'hon');
    expect(events.some((e) => e.type === 'wordKilled')).toBe(true);
  });

  it('wrong submit clears buffer, resets combo, costs no life', () => {
    const { engine, events } = makeEngine();
    advance(engine, 20);
    typeWord(engine, 'zzz');
    expect(events.some((e) => e.type === 'wrongSubmit')).toBe(true);
    const snap = engine.getSnapshot();
    expect(snap.lives).toBe(3);
    expect(snap.combo).toBe(0);
    expect(snap.bufferKana).toBe('');
  });

  it('homophones: closest to floor dies', () => {
    const kouen: Card[] = [
      { id: 'park', kanji: '公園', kana: ['こうえん'], gloss: 'park', pos: 'noun', jlpt: 5, source: 'jlpt' },
      { id: 'lecture', kanji: '講演', kana: ['こうえん'], gloss: 'lecture', pos: 'noun', jlpt: 2, source: 'jlpt' },
    ];
    const engine = new GameEngine({
      cards: kouen, mode: 'reading', seed: 1,
      config: { ...config, baseSpawnIntervalMs: 500 },
    });
    const events: GameEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();
    advance(engine, 600); // both airborne; first spawn fell further
    expect(engine.getWords()).toHaveLength(2);
    const lowest = [...engine.getWords()].sort((a, b) => b.y - a.y)[0];
    typeWord(engine, 'kouen');
    const killed = events.find((e) => e.type === 'wordKilled');
    expect(killed && killed.type === 'wordKilled' && killed.word.instanceId).toBe(lowest.instanceId);
  });
});

describe('misses, lives, waves', () => {
  it('a landed word costs a life and is recorded; 3 misses end the game', () => {
    const { engine, events } = makeEngine();
    advance(engine, 60_000); // type nothing; words rain to the floor
    const snap = engine.getSnapshot();
    expect(snap.status).toBe('gameOver');
    expect(snap.lives).toBe(0);
    expect(snap.missed.length).toBeGreaterThanOrEqual(3);
    expect(events.some((e) => e.type === 'gameOver')).toBe(true);
  });

  it('clearing all wave words advances to the next wave after the delay', () => {
    const { engine, events } = makeEngine();
    let now = advance(engine, 20);
    // kill both wave-1 words as they spawn
    for (let i = 0; i < 2; i++) {
      const word = engine.getWords()[0];
      if (!word) { now = advance(engine, 1000, now); continue; }
      const romaji = word.card.id === 'neko' ? 'neko' : word.card.id === 'inu' ? 'inu' : 'hon';
      typeWord(engine, romaji);
      now = advance(engine, 1000, now);
    }
    now = advance(engine, 2000, now);
    expect(events.some((e) => e.type === 'waveCleared' && e.wave === 1)).toBe(true);
    expect(engine.getSnapshot().wave).toBe(2);
  });

  it('lock-on marks wasTargeted and firstKeyAt', () => {
    const { engine } = makeEngine();
    advance(engine, 20);
    const word = engine.getWords()[0];
    const first = word.card.kana[0][0]; // type enough romaji for first kana
    const romajiByKana: Record<string, string> = { ね: 'ne', い: 'i', ほ: 'ho' };
    for (const ch of romajiByKana[first]) engine.handleKey(ch);
    expect(word.wasTargeted).toBe(true);
    expect(word.firstKeyAt).not.toBeNull();
  });
});

describe('determinism', () => {
  it('same seed + same inputs → identical snapshots', () => {
    const run = () => {
      const engine = new GameEngine({ cards, mode: 'reading', seed: 99, config });
      engine.start();
      let now = advance(engine, 500);
      for (const ch of 'neko') engine.handleKey(ch);
      engine.handleKey('Enter');
      now = advance(engine, 3000, now);
      return engine.getSnapshot();
    };
    expect(run()).toEqual(run());
  });
});
```

- [ ] **Step 6: Run the full engine suite**

Run: `npx vitest run src/engine`
Expected: PASS (all tests, both parts). Debug engine (not tests) if part 2 fails — the behaviors are spec rules.

- [ ] **Step 7: Coverage checkpoint**

Run: `npm run coverage`
Expected: PASS with `src/engine/**` + `src/data/**` ≥ 80% lines/functions/branches.

- [ ] **Step 8: Commit**

```bash
git add src/engine/GameEngine.ts src/engine/__tests__/GameEngine.test.ts
git commit -m "feat: fixed-timestep game engine with submit/kill/miss/wave loop"
```

---

### Task 8: Pixi render layer (stage + word sprites)

**Files:**
- Create: `src/render/WordSprite.ts`
- Create: `src/render/PixiStage.ts`

**Interfaces:**
- Consumes: `AirborneWord`, `GameEvent` from `src/engine/types`; `pixi.js` (`Application`, `Container`, `Text`, `TextStyle`)
- Produces:
  - `class WordSprite { readonly view: Container; constructor(word: AirborneWord, mode: GameMode); setLocked(locked: boolean): void; setPosition(xPx: number, yPx: number): void }`
  - `class PixiStage { static create(host: HTMLElement): Promise<PixiStage>; sync(words: readonly AirborneWord[], lockedIds: readonly number[], mode: GameMode): void; playKill(word: AirborneWord): void; playMiss(word: AirborneWord): void; destroy(): void }`
- NOTE: No WebGL in jsdom — this task is verified by `tsc` and by Task 9's manual run + Task 10's E2E. Keep this layer dumb: zero game rules here.

- [ ] **Step 1: Implement `src/render/WordSprite.ts`**

```ts
import { Container, Text, TextStyle } from 'pixi.js';
import type { AirborneWord, GameMode } from '../engine/types';

const BASE_STYLE: Partial<TextStyle> = {
  fontFamily: "'Yu Gothic UI', 'Meiryo', 'Noto Sans JP', sans-serif",
  fontSize: 40,
  fill: 0xe8f0ff,
};

const LOCKED_TINT = 0x7fdfff;
const UNLOCKED_TINT = 0xffffff;

export class WordSprite {
  readonly view: Container;
  private readonly text: Text;

  constructor(word: AirborneWord, mode: GameMode) {
    const display = mode === 'reading'
      ? word.card.kanji ?? word.card.kana[0]
      : word.card.gloss;
    this.text = new Text({
      text: display,
      style: new TextStyle({ ...BASE_STYLE }),
      resolution: Math.min(Math.max(window.devicePixelRatio, 1) * 2, 4),
    });
    this.text.anchor.set(0.5);
    this.view = new Container();
    this.view.addChild(this.text);
  }

  setLocked(locked: boolean): void {
    this.text.tint = locked ? LOCKED_TINT : UNLOCKED_TINT;
  }

  setPosition(xPx: number, yPx: number): void {
    this.view.position.set(xPx, yPx);
  }
}
```

- [ ] **Step 2: Implement `src/render/PixiStage.ts`**

```ts
import { Application, Container, Text, TextStyle } from 'pixi.js';
import type { AirborneWord, GameMode } from '../engine/types';
import { WordSprite } from './WordSprite';

interface Fx {
  view: Container;
  ageMs: number;
  lifeMs: number;
  update: (view: Container, t: number) => void; // t in [0,1]
}

/** Dumb render layer: mirrors engine words, plays kill/miss effects. */
export class PixiStage {
  private sprites = new Map<number, WordSprite>();
  private fx: Fx[] = [];

  private constructor(private readonly app: Application) {
    app.ticker.add(() => this.updateFx(app.ticker.deltaMS));
  }

  static async create(host: HTMLElement): Promise<PixiStage> {
    await document.fonts.ready; // JP glyph measurement gate (spec §7)
    const app = new Application();
    await app.init({
      background: 0x0b0e14,
      resizeTo: host,
      antialias: true,
    });
    host.appendChild(app.canvas);
    return new PixiStage(app);
  }

  /** Mirror engine word list into sprites; reposition everything. */
  sync(words: readonly AirborneWord[], lockedIds: readonly number[], mode: GameMode): void {
    const alive = new Set<number>();
    for (const word of words) {
      alive.add(word.instanceId);
      let sprite = this.sprites.get(word.instanceId);
      if (!sprite) {
        sprite = new WordSprite(word, mode);
        this.sprites.set(word.instanceId, sprite);
        this.app.stage.addChild(sprite.view);
      }
      sprite.setLocked(lockedIds.includes(word.instanceId));
      sprite.setPosition(word.x * this.app.screen.width, word.y * this.app.screen.height);
    }
    for (const [id, sprite] of this.sprites) {
      if (!alive.has(id)) {
        sprite.view.destroy({ children: true });
        this.sprites.delete(id);
      }
    }
  }

  /** Scale-up + fade-out at the word's last position. */
  playKill(word: AirborneWord): void {
    this.spawnFx(word, word.card.kana[0], 0x9dffb0, 350, (view, t) => {
      view.scale.set(1 + t * 0.8);
      view.alpha = 1 - t;
    });
  }

  /** Reveal the answer where the word landed (spec §3.1: miss is a learning moment). */
  playMiss(word: AirborneWord): void {
    const reveal = `${word.card.kanji ?? ''} ${word.card.kana[0]} — ${word.card.gloss}`.trim();
    this.spawnFx(word, reveal, 0xff8f8f, 1600, (view, t) => {
      view.alpha = t < 0.15 ? 1 : 1 - (t - 0.15) / 0.85;
    });
  }

  destroy(): void {
    this.app.destroy(true, { children: true });
    this.sprites.clear();
    this.fx = [];
  }

  private spawnFx(
    word: AirborneWord,
    label: string,
    color: number,
    lifeMs: number,
    update: Fx['update'],
  ): void {
    const text = new Text({
      text: label,
      style: new TextStyle({
        fontFamily: "'Yu Gothic UI', 'Meiryo', 'Noto Sans JP', sans-serif",
        fontSize: 30,
        fill: color,
      }),
      resolution: 2,
    });
    text.anchor.set(0.5);
    const view = new Container();
    view.addChild(text);
    const yPx = Math.min(word.y, 0.95) * this.app.screen.height;
    view.position.set(word.x * this.app.screen.width, yPx);
    this.app.stage.addChild(view);
    this.fx.push({ view, ageMs: 0, lifeMs, update });
  }

  private updateFx(deltaMs: number): void {
    for (const fx of this.fx) {
      fx.ageMs += deltaMs;
      fx.update(fx.view, Math.min(fx.ageMs / fx.lifeMs, 1));
    }
    this.fx = this.fx.filter((fx) => {
      if (fx.ageMs >= fx.lifeMs) {
        fx.view.destroy({ children: true });
        return false;
      }
      return true;
    });
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc -b`
Expected: exit 0, no errors.

- [ ] **Step 4: Commit**

```bash
git add src/render/WordSprite.ts src/render/PixiStage.ts
git commit -m "feat: pixi stage with word sprites, lock tint, kill/miss effects"
```

---

### Task 9: React shell — screens, HUD, engine driver (first playable)

**Files:**
- Create: `src/ui/useEngine.ts`, `src/ui/hud/Hud.tsx`, `src/ui/screens/TitleScreen.tsx`, `src/ui/screens/GameScreen.tsx`, `src/ui/screens/GameOverOverlay.tsx`
- Modify: `src/App.tsx`, `src/index.css`
- Test: `src/ui/__tests__/Hud.test.tsx`
- Delete: all `src/*/.gitkeep`

**Interfaces:**
- Consumes: `GameEngine`, `EngineSnapshot`, `GameEvent`, `N5_WORDS`, `PixiStage`
- Produces: `useEngine(): { snapshot: EngineSnapshot; hostRef: RefObject<HTMLDivElement | null>; start(seed?: number): void }`; screens wired in `App.tsx`; dev/E2E hook `window.__kotoba`

- [ ] **Step 1: Write failing HUD test `src/ui/__tests__/Hud.test.tsx`**

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { EngineSnapshot } from '../../engine/types';
import { Hud } from '../hud/Hud';

const snapshot: EngineSnapshot = {
  status: 'playing', score: 1230, lives: 2, wave: 3, combo: 4,
  bufferKana: 'べんk', bufferRomaji: 'benk', lockedIds: [1], missed: [], timeMs: 0,
};

describe('Hud', () => {
  it('renders score, lives, wave, combo, and the kana buffer', () => {
    render(<Hud snapshot={snapshot} />);
    expect(screen.getByTestId('score')).toHaveTextContent('1230');
    expect(screen.getByTestId('lives')).toHaveTextContent('♥♥');
    expect(screen.getByTestId('wave')).toHaveTextContent('3');
    expect(screen.getByTestId('combo')).toHaveTextContent('4');
    expect(screen.getByTestId('kana-buffer')).toHaveTextContent('べんk');
  });
});
```

Add jest-dom to vitest: create `src/test-setup.ts` with `import '@testing-library/jest-dom/vitest';` and add `setupFiles: ['src/test-setup.ts']` to the `test` block of `vite.config.ts`.

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui`
Expected: FAIL — `Cannot find module '../hud/Hud'`

- [ ] **Step 3: Implement `src/ui/hud/Hud.tsx`**

```tsx
import type { EngineSnapshot } from '../../engine/types';

export function Hud({ snapshot }: { snapshot: EngineSnapshot }) {
  return (
    <div className="hud">
      <div className="hud-top">
        <span data-testid="score">{snapshot.score}</span>
        <span data-testid="wave">wave {snapshot.wave}</span>
        <span data-testid="combo">{snapshot.combo > 0 ? `×${snapshot.combo}` : ''}</span>
        <span data-testid="lives">{'♥'.repeat(Math.max(snapshot.lives, 0))}</span>
      </div>
      <div className="hud-buffer" data-testid="kana-buffer">
        {snapshot.bufferKana || ' '}
      </div>
    </div>
  );
}
```

(The combo test asserts `toHaveTextContent('4')`; the rendered `×4` satisfies it.)

- [ ] **Step 4: Run HUD test to verify it passes**

Run: `npx vitest run src/ui`
Expected: PASS

- [ ] **Step 5: Implement `src/ui/useEngine.ts`**

```ts
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { N5_WORDS } from '../data/n5words';
import { GameEngine } from '../engine/GameEngine';
import type { EngineSnapshot, GameEvent } from '../engine/types';
import { PixiStage } from '../render/PixiStage';

const IDLE_SNAPSHOT: EngineSnapshot = {
  status: 'idle', score: 0, lives: 0, wave: 0, combo: 0,
  bufferKana: '', bufferRomaji: '', lockedIds: [], missed: [], timeMs: 0,
};

declare global {
  interface Window {
    __kotoba?: { snapshot(): EngineSnapshot };
  }
}

function seedFromUrl(): number | null {
  const raw = new URLSearchParams(window.location.search).get('seed');
  const parsed = raw === null ? NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function useEngine() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [runId, setRunId] = useState(0);

  // Snapshot store: replaced on engine events only (words render via Pixi, not React).
  const snapshotRef = useRef<EngineSnapshot>(IDLE_SNAPSHOT);
  const listenersRef = useRef(new Set<() => void>());

  const subscribe = useCallback((cb: () => void) => {
    listenersRef.current.add(cb);
    return () => listenersRef.current.delete(cb);
  }, []);
  const getSnapshot = useCallback(() => snapshotRef.current, []);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);

  const start = useCallback((seed?: number) => {
    engineRef.current = new GameEngine({
      cards: N5_WORDS,
      mode: 'reading',
      seed: seed ?? seedFromUrl() ?? Date.now(),
    });
    setRunId((n) => n + 1);
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    const host = hostRef.current;
    if (!engine || !host) return;

    let stage: PixiStage | null = null;
    let rafId = 0;
    let disposed = false;

    const publish = () => {
      snapshotRef.current = engine.getSnapshot(); // new object → useSyncExternalStore re-renders
      for (const cb of listenersRef.current) cb();
    };

    const onEvent = (event: GameEvent) => {
      if (event.type === 'wordKilled') stage?.playKill(event.word);
      if (event.type === 'wordMissed') stage?.playMiss(event.word);
      publish();
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing) return; // IME guard (spec §3.5); banner UI lands in M4
      if (e.key === 'Enter' || e.key === 'Escape' || e.key === 'Backspace' || /^[a-zA-Z-]$/.test(e.key)) {
        e.preventDefault();
        engine.handleKey(e.key);
      }
    };

    // No visibility handler needed: rAF stops in background tabs and the
    // 100ms clamp in tick() absorbs the gap on return.
    const loop = (now: number) => {
      engine.tick(now);
      stage?.sync(engine.getWords(), snapshotRef.current.lockedIds, 'reading');
      rafId = requestAnimationFrame(loop);
    };

    const unsubscribe = engine.subscribe(onEvent);
    window.addEventListener('keydown', onKey);
    if (import.meta.env.DEV) {
      window.__kotoba = { snapshot: () => engine.getSnapshot() };
    }

    PixiStage.create(host).then((created) => {
      if (disposed) return created.destroy();
      stage = created;
      engine.start();
      publish();
      rafId = requestAnimationFrame(loop);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      unsubscribe();
      window.removeEventListener('keydown', onKey);
      stage?.destroy();
    };
  }, [runId]);

  return { snapshot, hostRef, start };
}
```

- [ ] **Step 6: Implement screens and wire `App.tsx`**

`src/ui/screens/TitleScreen.tsx`:
```tsx
export function TitleScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="screen-center">
      <h1>kotoba-drop</h1>
      <p>Type the reading. Press Enter. Don&apos;t let words hit the floor.</p>
      <p className="hint">Keyboard: a–z romaji · Enter submit · Backspace edit · Esc clear</p>
      <button data-testid="start-button" onClick={onStart}>Start — Reading mode (N5)</button>
    </div>
  );
}
```

`src/ui/screens/GameOverOverlay.tsx`:
```tsx
import type { EngineSnapshot } from '../../engine/types';

export function GameOverOverlay({ snapshot, onRestart }: {
  snapshot: EngineSnapshot;
  onRestart: () => void;
}) {
  return (
    <div className="overlay" data-testid="game-over">
      <h2>Game Over</h2>
      <p>Score {snapshot.score} · Wave {snapshot.wave}</p>
      {snapshot.missed.length > 0 && (
        <table className="missed">
          <tbody>
            {snapshot.missed.map((card, i) => (
              <tr key={`${card.id}-${i}`}>
                <td>{card.kanji}</td>
                <td>{card.kana[0]}</td>
                <td>{card.gloss}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button onClick={onRestart}>Play again</button>
    </div>
  );
}
```

`src/ui/screens/GameScreen.tsx`:
```tsx
import type { RefObject } from 'react';
import type { EngineSnapshot } from '../../engine/types';
import { Hud } from '../hud/Hud';
import { GameOverOverlay } from './GameOverOverlay';

export function GameScreen({ snapshot, hostRef, onRestart }: {
  snapshot: EngineSnapshot;
  hostRef: RefObject<HTMLDivElement | null>;
  onRestart: () => void;
}) {
  return (
    <div className="game-screen">
      <div className="pixi-host" ref={hostRef} />
      <Hud snapshot={snapshot} />
      {snapshot.status === 'gameOver' && (
        <GameOverOverlay snapshot={snapshot} onRestart={onRestart} />
      )}
    </div>
  );
}
```

`src/App.tsx` (replace):
```tsx
import { useState } from 'react';
import { useEngine } from './ui/useEngine';
import { GameScreen } from './ui/screens/GameScreen';
import { TitleScreen } from './ui/screens/TitleScreen';

export default function App() {
  const [started, setStarted] = useState(false);
  const { snapshot, hostRef, start } = useEngine();

  const begin = () => {
    start();
    setStarted(true);
  };

  return started
    ? <GameScreen snapshot={snapshot} hostRef={hostRef} onRestart={begin} />
    : <TitleScreen onStart={begin} />;
}
```

Append to `src/index.css`:
```css
.screen-center {
  height: 100%; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 1rem;
}
.hint { color: #8b98b8; font-size: 0.85rem; }
.game-screen { position: relative; height: 100%; }
.pixi-host { position: absolute; inset: 0; }
.hud { position: absolute; inset: 0; pointer-events: none; display: flex; flex-direction: column; }
.hud-top {
  display: flex; gap: 1.5rem; justify-content: space-between;
  padding: 0.75rem 1.25rem; font-size: 1.1rem; color: #aab8d8;
}
.hud-buffer {
  margin-top: auto; text-align: center; font-size: 2.2rem;
  padding: 0.5rem 0 1.25rem; color: #7fdfff; min-height: 4.5rem;
}
.overlay {
  position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 1rem;
  background: rgba(11, 14, 20, 0.88); pointer-events: auto;
}
.missed { border-collapse: collapse; }
.missed td { padding: 0.2rem 0.9rem; color: #ffb0b0; }
```

Delete the four `src/*/.gitkeep` files.

- [ ] **Step 7: Verify — full check + MANUAL PLAY (fun-check gate opens here)**

Run: `npm run check`
Expected: tsc clean, all vitest suites pass.

Run: `npm run dev` → play 3+ full runs. Verify with your own hands: romaji converts live in the buffer; locked words tint cyan; Enter kills; wrong Enter shakes nothing but clears buffer and combo; misses reveal the answer at the floor; 3 misses end the game; missed table + restart work; waves visibly speed up. Tune `src/engine/constants.ts` values if pacing feels wrong (that file only).

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: react shell with hud, screens, raf driver — first playable build"
```

---

### Task 10: Playwright E2E keystone + README

**Files:**
- Create: `playwright.config.ts`, `e2e/game.spec.ts`, `README.md`

**Interfaces:**
- Consumes: dev server, `data-testid` attributes (`start-button`, `score`, `kana-buffer`, `game-over`), `window.__kotoba.snapshot()` (DEV-only, from Task 9)
- Produces: `npm run e2e` proving keyboard → kana → Enter → kill → score end to end (M3 extends this test with a DB assertion per spec §8)

- [ ] **Step 1: Write `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  use: { baseURL: 'http://localhost:5173' },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
  },
});
```

- [ ] **Step 2: Write `e2e/game.spec.ts`**

```ts
import { expect, test } from '@playwright/test';
import { toRomaji } from 'wanakana';

test('typing a falling word’s reading and pressing Enter scores a kill', async ({ page }) => {
  await page.goto('/?seed=42');
  await page.getByTestId('start-button').click();

  // Wait until the game is running AND the first word has actually spawned.
  await page.waitForFunction(() => {
    const snap = window.__kotoba?.snapshot();
    return !!snap && snap.status === 'playing' && !!snap.firstAirborneReading;
  });
  const reading: string = await page.evaluate(
    () => window.__kotoba!.snapshot().firstAirborneReading!,
  );

  await page.keyboard.type(toRomaji(reading), { delay: 30 });
  await page.keyboard.press('Enter');

  await expect(page.getByTestId('score')).not.toHaveText('0');
});
```

Supporting change in `src/ui/useEngine.ts` — extend the DEV hook so the test can read the first airborne reading (add alongside the existing `__kotoba` assignment):

```ts
// in the DEV block, replace the assignment with:
window.__kotoba = {
  snapshot: () => ({
    ...engine.getSnapshot(),
    firstAirborneReading: engine.getWords()[0]?.card.kana[0] ?? null,
  }),
};
```

And widen the global declaration in the same file:

```ts
declare global {
  interface Window {
    __kotoba?: { snapshot(): EngineSnapshot & { firstAirborneReading?: string | null } };
  }
}
```

Caveat: `toRomaji` yields hiragana-compatible romaji for these N5 readings (no katakana ー words in the M1 set), so the round-trip is safe here.

- [ ] **Step 3: Install browsers and run**

```bash
npx playwright install chromium
npm run e2e
```
Expected: 1 passed. If the first word lands before typing completes on a slow machine, add `baseFallSpeed` override via a `?slow=1` param — do NOT loosen the assertion. (Not expected at 14s fall time.)

- [ ] **Step 4: Write `README.md`**

```markdown
# kotoba-drop

Falling-words Japanese vocab typing game. Words fall; type the reading in
romaji (auto-converts to kana) and press Enter before they hit the floor.

## Run

- `npm install`
- `npm run dev` — play at http://localhost:5173
- `npm run check` — typecheck + unit tests
- `npm run e2e` — Playwright keystone test (first run: `npx playwright install chromium`)

## Status

Milestone 1 (core loop fun-check) of the design spec:
`docs/superpowers/specs/2026-07-22-kotoba-drop-design.md`.
Pacing knobs live in `src/engine/constants.ts`.

Turn OFF the Windows Japanese IME (Win+Space) while playing — the game reads
plain keystrokes.
```

- [ ] **Step 5: Full verification sweep**

Run: `npm run check && npm run coverage && npm run e2e`
Expected: everything green, coverage ≥ 80% on engine+data.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test: playwright keystone e2e; docs: readme quickstart"
```

---

## Milestone Exit: The Fun-Check Gate

Play for a few sessions (spec §9.1). Questions to answer before planning M2:
1. Is the Enter-submit rhythm satisfying, or does it need feel changes?
2. Are wave pacing / fall speeds right after tuning `constants.ts`?
3. Any input annoyances (backspace feel, lock-on visibility, buffer size)?

Tuning commits: `git commit -m "feat: tune wave pacing after fun-check"`. When the loop feels good, request the Milestone 2 plan (data pipeline + both modes + results screen).

## Deferred to later milestones (deliberately absent here)

- M2: yomitan-jlpt-vocab build pipeline, level/pool select, recall mode + grace hint, results screen + revenge round
- M3: Hono/SQLite backend, full raw event capture (the engine already tracks `firstKeyAt`, `backspaceCount`, `wasTargeted`, `hintShown` per word — M3 persists them), profile/goals, Stats screen
- M4: particles, bloom, CRT, SFX, import UI, settings, IME warning banner UI, bundled Noto Sans JP font
