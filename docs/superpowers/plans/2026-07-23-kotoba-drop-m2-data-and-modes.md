# kotoba-drop Milestone 2 (Real Data + Both Modes) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 50 hardcoded words with the real JLPT N5–N2 vocabulary (≈4,900 cards built from local raw data), ship recall mode with the grace hint, mode/pool selection, a results screen with revenge rounds, and the pre-wave word introduction (spec §3.6).

**Architecture:** A one-shot build script joins the yomitan-jlpt-vocab term-meta banks (term + reading + level) against jmdict-eng (glosses, readings, POS) and commits cleaned per-level JSON to `public/data/`. A zod-validated loader fetches and caches pools at run start. The engine gains a `waveIntro` paused status (opt-in via config), a recall-mode hint threshold, and kill/wrong-submit counters; the UI gains Setup → Game → Results flow with a session-scoped seen-words set driving the wave-intro overlay.

**Tech Stack:** Existing M1 stack (Vite 8, React 19, TS strict + erasableSyntaxOnly, PixiJS 8, wanakana 5, Vitest 4, Playwright, oxlint) + `zod@^4` (runtime boundary validation) + `tsx@^4` (devDep, runs the build script).

**Spec:** `docs/superpowers/specs/2026-07-22-kotoba-drop-design.md` — this plan implements §9.2 (+§3.6). Base: current `main` (post-M1 + hardening, HEAD ≈ `727a2d2`).

## Global Constraints

- `src/engine/` and `src/data/` MUST NOT import react/pixi/render/ui. No `Math.random`/`Date.now` in `src/engine/` (seeded RNG only).
- TS strict + `erasableSyntaxOnly` (no TS parameter-property shorthand, no enums). `npm run check` = `tsc -b && oxlint && vitest run` and must stay green at every task boundary.
- Coverage ≥ 80% (lines/functions/branches) on `src/engine/**` + `src/data/**` (`npm run coverage`). `scripts/` is outside the coverage include — its output is guarded by the committed-data invariant tests instead.
- Generated data is COMMITTED (`public/data/jlpt-n{5,4,3,2}.json`); raw inputs (`data/raw/`) are gitignored; the build script uses only local files, no network.
- Card shape is spec (§5.1): `{ id, kanji: string|null, kana: string[] (kana[0] canonical), gloss ≤28 chars, pos, jlpt: 5|4|3|2|null, source: 'jlpt'|'custom' }`. Kana-only cards have `kanji: null` and are excluded from reading-mode pools by the engine (already implemented).
- Engine `pauseOnWaveStart` defaults to **false** (M1 behavior unchanged); the UI opts in. Grace hint fires at `hintAtY = 0.6` in recall mode only (spec §3.2).
- Mixed pool = uniform concatenation of N5–N2 in M2; profile-weighted mixing is M3 (spec §3.3 note added in Task 6).
- Wrong submits never cost a life; results accuracy = kills / (kills + misses + wrongSubmits), 0 when no attempts.
- E2E runs on port 5183 `--strictPort` (5173 is permanently occupied by an unrelated dev server — never kill it).
- Conventional commits. No attribution footers. Files ≤800 lines, functions <50 lines.

---

## File Structure (all tasks)

```
kotoba-drop/
  scripts/build-data.ts            # T1: raw banks + jmdict → public/data/jlpt-*.json
  data/raw/                        # T1: gitignored local copies of raw datasets
  public/data/jlpt-n{5,4,3,2}.json # T1: committed generated card files
  src/data/
    schema.ts                      # T1: zod card/level-file schemas (shared: script, tests, loader)
    __tests__/jlptData.test.ts     # T1: invariant tests over the committed files
    loader.ts                      # T2: fetch + validate + cache + pools
    __tests__/loader.test.ts       # T2
    n5words.ts (+ its test)        # T6: DELETED (superseded)
  src/engine/
    types.ts                       # T3: waveIntro status, waveStarting/resumed events, counters, mode
    constants.ts                   # T3: hintAtY, pauseOnWaveStart
    GameEngine.ts                  # T3: intro pause/resume, hint marking, counters
    __tests__/GameEngine.test.ts   # T3: new describes appended
  src/render/
    WordSprite.ts                  # T4: recall prompt + fading kanji hint
    PixiStage.ts                   # T4: sprite update pass on ticker
  src/ui/
    useEngine.ts                   # T5: start(RunOptions), resume, introCards, mode-aware sync
    App.tsx                        # T5: title→setup→game flow, session seen-set, URL auto-start
    screens/SetupScreen.tsx        # T5: mode + pool pickers, loading/error states
    screens/WaveIntroOverlay.tsx   # T5: unseen-words interstitial
    screens/ResultsScreen.tsx      # T5: score/accuracy/missed + revenge round (replaces GameOverOverlay)
    screens/GameScreen.tsx         # T5: overlay wiring
    screens/GameOverOverlay.tsx    # T5: DELETED
    __tests__/ResultsScreen.test.tsx  # T5
    __tests__/WaveIntroOverlay.test.tsx # T5
  e2e/game.spec.ts                 # T5: intro dismissal + reading & recall specs
  README.md, docs/…/specs/…        # T6
```

---

### Task 1: JLPT data pipeline (schema + build script + committed data + invariant tests)

**Files:**
- Create: `src/data/schema.ts`, `scripts/build-data.ts`, `src/data/__tests__/jlptData.test.ts`
- Create (generated, committed): `public/data/jlpt-n5.json`, `jlpt-n4.json`, `jlpt-n3.json`, `jlpt-n2.json`
- Modify: `.gitignore` (add `data/raw/`), `package.json` (deps + `build:data` script)

**Interfaces:**
- Consumes: raw files copied from `~/n2-prep/data/raw/` (term_meta_bank_1..5.json — yomitan meta format `[term, "freq", {reading, frequency:{displayValue:"N1".."N5"}}]`; jmdict-eng-3.6.2.json — jmdict-simplified `{words:[{id, kanji:[{text}], kana:[{text, appliesToKanji}], sense:[{partOfSpeech, appliesToKanji, gloss:[{lang,text}]}]}]}`).
- Produces: `cardSchema`, `levelFileSchema`, `type LevelFile = { listVersion: string; level: 2|3|4|5; cards: Card[] }` (schema.ts, zod); the four committed data files; npm script `build:data`.

- [ ] **Step 1: Install deps, copy raw data, gitignore it**

```bash
cd ~/kotoba-drop
npm install zod@^4
npm install -D tsx@^4 @types/node@^22
mkdir -p data/raw
cp ~/n2-prep/data/raw/term_meta_bank_*.json data/raw/
cp ~/n2-prep/data/raw/jmdict-eng-3.6.2.json data/raw/
```

Append to `.gitignore`:
```
data/raw/
```

Add to `package.json` scripts: `"build:data": "tsx scripts/build-data.ts"`.

So the build script is typechecked by `npm run check` (same policy the M1 final review set for e2e files): in `tsconfig.node.json`, add `"scripts/build-data.ts"` to the `include` array (alongside `vite.config.ts`). If that project lacks `"types": ["node"]` in its compilerOptions, add it.

- [ ] **Step 2: Write `src/data/schema.ts`**

```ts
import { z } from 'zod';
import type { Card } from '../engine/types';

export const cardSchema = z.object({
  id: z.string().min(1),
  kanji: z.string().min(1).nullable(),
  kana: z.array(z.string().min(1)).min(1),
  gloss: z.string().min(1).max(28),
  pos: z.string().min(1),
  jlpt: z.union([z.literal(5), z.literal(4), z.literal(3), z.literal(2), z.null()]),
  source: z.union([z.literal('jlpt'), z.literal('custom')]),
});

export const levelFileSchema = z.object({
  listVersion: z.string().min(1),
  level: z.union([z.literal(5), z.literal(4), z.literal(3), z.literal(2)]),
  cards: z.array(cardSchema).min(1),
});

export type LevelFile = z.infer<typeof levelFileSchema>;

/** Compile-time bridge: a zod card must remain assignable to the engine Card. */
export function toCards(file: LevelFile): Card[] {
  return file.cards;
}
```

- [ ] **Step 3: Write `scripts/build-data.ts`**

```ts
/**
 * Build public/data/jlpt-n{5,4,3,2}.json from local raw datasets:
 *  - data/raw/term_meta_bank_*.json  (yomitan-jlpt-vocab: term, reading, JLPT level)
 *  - data/raw/jmdict-eng-3.6.2.json  (jmdict-simplified: readings, glosses, POS)
 * No network. Fails hard (exit 1) if any level's match rate drops below 85%.
 * Run: npm run build:data   (if it OOMs: set NODE_OPTIONS=--max-old-space-size=4096)
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { isKana } from 'wanakana';
import { levelFileSchema } from '../src/data/schema';
import type { Card } from '../src/engine/types';

const RAW_DIR = 'data/raw';
const OUT_DIR = 'public/data';
const LIST_VERSION = 'jlpt-tanos-jmdict-3.6.2-v1';
const GLOSS_MAX = 28;
const MIN_MATCH_RATE = 0.85;
const LEVEL_BY_TAG: Record<string, 2 | 3 | 4 | 5> = { N5: 5, N4: 4, N3: 3, N2: 2 };

type MetaEntry = [string, string, { reading: string; frequency: { displayValue: string } }];
interface JlptEntry { term: string; reading: string; level: 2 | 3 | 4 | 5 }

interface JmdictKana { text: string; appliesToKanji: string[] }
interface JmdictGloss { lang: string; text: string }
interface JmdictSense { partOfSpeech: string[]; appliesToKanji: string[]; gloss: JmdictGloss[] }
interface JmdictWord { id: string; kanji: { text: string }[]; kana: JmdictKana[]; sense: JmdictSense[] }

function readJlptEntries(): JlptEntry[] {
  const byKey = new Map<string, JlptEntry>();
  const bankFiles = readdirSync(RAW_DIR).filter((f) => /^term_meta_bank_\d+\.json$/.test(f));
  if (bankFiles.length === 0) throw new Error(`no term_meta_bank_*.json in ${RAW_DIR}`);
  for (const file of bankFiles) {
    const entries = JSON.parse(readFileSync(join(RAW_DIR, file), 'utf8')) as MetaEntry[];
    for (const [term, kind, data] of entries) {
      if (kind !== 'freq') continue;
      const level = LEVEL_BY_TAG[data.frequency.displayValue];
      if (level === undefined) continue; // N1 and anything unexpected
      const key = `${term}|${data.reading}`;
      const existing = byKey.get(key);
      // Same word tagged at multiple levels: keep the earliest-learned (highest number).
      if (existing === undefined || level > existing.level) {
        byKey.set(key, { term, reading: data.reading, level });
      }
    }
  }
  return [...byKey.values()];
}

function indexJmdict(): { byKanji: Map<string, JmdictWord[]>; byKana: Map<string, JmdictWord[]> } {
  const parsed = JSON.parse(readFileSync(join(RAW_DIR, 'jmdict-eng-3.6.2.json'), 'utf8')) as {
    words: JmdictWord[];
  };
  const byKanji = new Map<string, JmdictWord[]>();
  const byKana = new Map<string, JmdictWord[]>();
  const push = (map: Map<string, JmdictWord[]>, key: string, word: JmdictWord) => {
    const list = map.get(key);
    if (list) list.push(word);
    else map.set(key, [word]);
  };
  for (const word of parsed.words) {
    for (const k of word.kanji) push(byKanji, k.text, word);
    for (const k of word.kana) push(byKana, k.text, word);
  }
  return { byKanji, byKana };
}

function cleanGloss(raw: string): string {
  return raw.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
}

function truncateAtWord(s: string): string {
  const cut = s.slice(0, GLOSS_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 10 ? cut.slice(0, lastSpace) : cut).replace(/[,;: ]+$/, '');
}

function appliesToTerm(applies: string[], term: string): boolean {
  return applies.includes('*') || applies.includes(term);
}

function pickGlossAndPos(word: JmdictWord, term: string): { gloss: string; pos: string } | null {
  let fallback: { gloss: string; pos: string } | null = null;
  for (const sense of word.sense) {
    if (!appliesToTerm(sense.appliesToKanji, term) && word.kanji.length > 0) continue;
    const pos = sense.partOfSpeech[0] ?? 'unclassified';
    for (const g of sense.gloss) {
      if (g.lang !== 'eng') continue;
      const cleaned = cleanGloss(g.text);
      if (cleaned.length === 0) continue;
      if (cleaned.length <= GLOSS_MAX) return { gloss: cleaned, pos };
      if (fallback === null) fallback = { gloss: truncateAtWord(cleaned), pos };
    }
  }
  return fallback;
}

function toCard(entry: JlptEntry, word: JmdictWord): Card | null {
  const kanaOnly = entry.term === entry.reading || isKana(entry.term);
  const glossPos = pickGlossAndPos(word, entry.term);
  if (glossPos === null || glossPos.gloss.length === 0) return null;
  const applying = kanaOnly
    ? [entry.reading]
    : word.kana.filter((k) => appliesToTerm(k.appliesToKanji, entry.term)).map((k) => k.text);
  const kana = [entry.reading, ...applying.filter((r) => r !== entry.reading)];
  return {
    id: `jm-${word.id}`,
    kanji: kanaOnly ? null : entry.term,
    kana,
    gloss: glossPos.gloss,
    pos: glossPos.pos,
    jlpt: entry.level,
    source: 'jlpt',
  };
}

function main(): void {
  const entries = readJlptEntries();
  console.log(`JLPT entries (N5-N2, deduped): ${entries.length}`);
  const { byKanji, byKana } = indexJmdict();

  const cardsByLevel = new Map<2 | 3 | 4 | 5, Card[]>([[5, []], [4, []], [3, []], [2, []]]);
  const usedIds = new Set<string>();
  const unmatched: JlptEntry[] = [];
  const duplicateIds: string[] = [];

  for (const entry of entries) {
    const kanaOnly = entry.term === entry.reading || isKana(entry.term);
    const candidates = (kanaOnly ? byKana.get(entry.term) : byKanji.get(entry.term)) ?? [];
    const word = candidates.find((w) => w.kana.some((k) => k.text === entry.reading)) ?? null;
    const card = word === null ? null : toCard(entry, word);
    if (card === null) {
      unmatched.push(entry);
      continue;
    }
    if (usedIds.has(card.id)) {
      duplicateIds.push(`${card.id} (${entry.term}/${entry.reading})`);
      continue;
    }
    usedIds.add(card.id);
    cardsByLevel.get(entry.level)!.push(card);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const entryCounts = new Map<number, number>([[5, 0], [4, 0], [3, 0], [2, 0]]);
  for (const e of entries) entryCounts.set(e.level, (entryCounts.get(e.level) ?? 0) + 1);

  for (const [level, cards] of cardsByLevel) {
    const rate = cards.length / (entryCounts.get(level) || 1);
    console.log(`N${level}: ${cards.length}/${entryCounts.get(level)} matched (${(rate * 100).toFixed(1)}%)`);
    if (rate < MIN_MATCH_RATE) {
      console.error(`FAIL: N${level} match rate ${(rate * 100).toFixed(1)}% < ${MIN_MATCH_RATE * 100}%`);
      process.exit(1);
    }
    const file = { listVersion: LIST_VERSION, level, cards };
    levelFileSchema.parse(file); // hard-fail on any schema violation before writing
    writeFileSync(join(OUT_DIR, `jlpt-n${level}.json`), JSON.stringify(file));
  }
  console.log(`Unmatched: ${unmatched.length}`);
  for (const u of unmatched.slice(0, 20)) console.log(`  dropped: ${u.term} / ${u.reading} (N${u.level})`);
  if (duplicateIds.length > 0) {
    console.log(`Duplicate jmdict ids skipped: ${duplicateIds.length}`);
    for (const d of duplicateIds.slice(0, 10)) console.log(`  dup: ${d}`);
  }
}

main();
```

- [ ] **Step 4: Run the pipeline**

Run: `npm run build:data`
Expected: per-level lines like `N5: 6xx/705 matched (9x.x%)`, all four ≥85%, four files written to `public/data/`, unmatched list printed. If it OOMs on the 116MB jmdict parse: `set NODE_OPTIONS=--max-old-space-size=4096` then re-run (PowerShell: `$env:NODE_OPTIONS='--max-old-space-size=4096'`).

- [ ] **Step 5: Write failing invariant tests `src/data/__tests__/jlptData.test.ts`**

(They fail before Step 4 ran; if you ran Step 4 first they pass immediately — acceptable here because the test's RED target is the DATA, not code. Run them and record the result either way.)

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isKana, toHiragana, toKatakana } from 'wanakana';
import { levelFileSchema, type LevelFile } from '../schema';

const LEVELS = [5, 4, 3, 2] as const;
// Floors = 80% of the source bank sizes (705/643/1695/1856); ceilings = bank sizes.
const BOUNDS: Record<number, [number, number]> = {
  5: [564, 705], 4: [514, 643], 3: [1356, 1695], 2: [1484, 1856],
};

function load(level: number): LevelFile {
  const raw = readFileSync(`public/data/jlpt-n${level}.json`, 'utf8');
  return levelFileSchema.parse(JSON.parse(raw));
}

describe('generated JLPT data invariants', () => {
  const files = LEVELS.map((l) => [l, load(l)] as const);

  it('card counts land inside expected bounds per level', () => {
    for (const [level, file] of files) {
      const [lo, hi] = BOUNDS[level];
      expect(file.cards.length, `N${level}`).toBeGreaterThanOrEqual(lo);
      expect(file.cards.length, `N${level}`).toBeLessThanOrEqual(hi);
      expect(file.level).toBe(level);
    }
  });

  it('ids are globally unique across all levels', () => {
    const all = files.flatMap(([, f]) => f.cards.map((c) => c.id));
    expect(new Set(all).size).toBe(all.length);
  });

  it('every reading is pure kana and canonical reading is first', () => {
    for (const [, file] of files) {
      for (const card of file.cards) {
        for (const r of card.kana) expect(isKana(r), `${card.id}:${r}`).toBe(true);
        expect(card.kana[0].length, card.id).toBeGreaterThan(0);
      }
    }
  });

  it('glosses are clean: ≤28 chars, no parentheses, no leading/trailing space', () => {
    for (const [, file] of files) {
      for (const card of file.cards) {
        expect(card.gloss.length, card.id).toBeLessThanOrEqual(28);
        expect(card.gloss, card.id).not.toMatch(/[()]/);
        expect(card.gloss, card.id).toBe(card.gloss.trim());
      }
    }
  });

  it('kanji field is null exactly for kana-only terms', () => {
    for (const [, file] of files) {
      for (const card of file.cards) {
        if (card.kanji !== null) {
          expect(isKana(card.kanji), card.id).toBe(false);
        }
      }
    }
  });

  it('jlpt tag matches the file level and source is jlpt', () => {
    for (const [level, file] of files) {
      for (const card of file.cards) {
        expect(card.jlpt, card.id).toBe(level);
        expect(card.source, card.id).toBe('jlpt');
      }
    }
  });

  it('readings normalize consistently (katakana round-trip safe)', () => {
    for (const [, file] of files) {
      for (const card of file.cards) {
        const n = toHiragana(toKatakana(card.kana[0]));
        expect(n.length, card.id).toBeGreaterThan(0);
      }
    }
  });

  it('reading-mode pools are non-trivial (enough kanji cards per level)', () => {
    for (const [level, file] of files) {
      const withKanji = file.cards.filter((c) => c.kanji !== null).length;
      expect(withKanji, `N${level}`).toBeGreaterThanOrEqual(file.cards.length * 0.5);
    }
  });
});
```

- [ ] **Step 6: Run the invariant tests**

Run: `npx vitest run src/data/__tests__/jlptData.test.ts`
Expected: PASS (8 tests). If a bound fails, inspect the build script's printed match rates — fix the SCRIPT (or, if the real corpus legitimately falls outside a guessed bound, adjust the bound and record the actual number in your report; bounds are estimates, the 85% in-script gate is the hard rule).

- [ ] **Step 7: Full gate + commit**

Run: `npm run check`
Expected: green (existing 51+ tests plus the new 8; n5words tests still present until Task 6).

```bash
git add -A
git commit -m "feat: jlpt data pipeline and committed n5-n2 card files"
```

---

### Task 2: Data loader (fetch, validate, cache, pools)

**Files:**
- Create: `src/data/loader.ts`
- Test: `src/data/__tests__/loader.test.ts`

**Interfaces:**
- Consumes: `levelFileSchema`, `toCards` from `src/data/schema.ts`; `Card` from engine types.
- Produces (Task 5 consumes, exact):
  - `type LevelId = 'n5' | 'n4' | 'n3' | 'n2'`
  - `type PoolId = LevelId | 'mixed'`
  - `const POOL_LABELS: Record<PoolId, string>`
  - `class DataLoadError extends Error { readonly level: string }`
  - `async function loadPool(pool: PoolId): Promise<Card[]>` (mixed = N5+N4+N3+N2 concatenated, uniform in M2)
  - `function clearDataCache(): void` (tests only)

- [ ] **Step 1: Write failing tests `src/data/__tests__/loader.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card } from '../../engine/types';
import { clearDataCache, DataLoadError, loadPool, POOL_LABELS } from '../loader';

const card = (id: string, jlpt: 5 | 4 | 3 | 2): Card => ({
  id, kanji: '字', kana: ['かな'], gloss: 'g', pos: 'n', jlpt, source: 'jlpt',
});

const levelPayload = (level: 5 | 4 | 3 | 2, ids: string[]) => ({
  listVersion: 'test-v1', level, cards: ids.map((id) => card(id, level)),
});

const ok = (body: unknown) =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as Response;
const fail = (status: number) =>
  ({ ok: false, status, json: () => Promise.reject(new Error('no body')) }) as Response;

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  clearDataCache();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('loadPool', () => {
  it('fetches, validates, and returns a single level', async () => {
    fetchMock.mockResolvedValueOnce(ok(levelPayload(5, ['a', 'b'])));
    const cards = await loadPool('n5');
    expect(cards.map((c) => c.id)).toEqual(['a', 'b']);
    expect(fetchMock).toHaveBeenCalledWith('/data/jlpt-n5.json');
  });

  it('caches per level (second load = zero fetches)', async () => {
    fetchMock.mockResolvedValueOnce(ok(levelPayload(4, ['x'])));
    await loadPool('n4');
    await loadPool('n4');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('mixed concatenates all four levels in n5→n2 order', async () => {
    fetchMock.mockImplementation((url: string) => {
      const level = Number(String(url).match(/n(\d)/)?.[1]) as 5 | 4 | 3 | 2;
      return Promise.resolve(ok(levelPayload(level, [`w${level}`])));
    });
    const cards = await loadPool('mixed');
    expect(cards.map((c) => c.id)).toEqual(['w5', 'w4', 'w3', 'w2']);
  });

  it('retries once on network failure, then succeeds', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(ok(levelPayload(3, ['r'])));
    const cards = await loadPool('n3');
    expect(cards).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws DataLoadError after retry exhaustion and on HTTP errors', async () => {
    fetchMock.mockResolvedValue(fail(404));
    await expect(loadPool('n2')).rejects.toBeInstanceOf(DataLoadError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws DataLoadError on schema-invalid payload and does not cache it', async () => {
    fetchMock.mockResolvedValue(ok({ listVersion: 'v', level: 5, cards: [{ bogus: true }] }));
    await expect(loadPool('n5')).rejects.toBeInstanceOf(DataLoadError);
    fetchMock.mockResolvedValue(ok(levelPayload(5, ['a'])));
    await expect(loadPool('n5')).resolves.toHaveLength(1);
  });

  it('exposes a label for every pool', () => {
    for (const pool of ['n5', 'n4', 'n3', 'n2', 'mixed'] as const) {
      expect(POOL_LABELS[pool].length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/data/__tests__/loader.test.ts`
Expected: FAIL — `Cannot find module '../loader'`

- [ ] **Step 3: Implement `src/data/loader.ts`**

```ts
import type { Card } from '../engine/types';
import { levelFileSchema, toCards } from './schema';

export type LevelId = 'n5' | 'n4' | 'n3' | 'n2';
export type PoolId = LevelId | 'mixed';

export const POOL_LABELS: Record<PoolId, string> = {
  n5: 'JLPT N5', n4: 'JLPT N4', n3: 'JLPT N3', n2: 'JLPT N2',
  mixed: 'Mixed (N5–N2)',
};

const MIXED_ORDER: LevelId[] = ['n5', 'n4', 'n3', 'n2'];

export class DataLoadError extends Error {
  readonly level: string;

  constructor(level: string, cause: unknown) {
    super(`failed to load word data for ${level}`, { cause });
    this.name = 'DataLoadError';
    this.level = level;
  }
}

const cache = new Map<LevelId, Card[]>();

/** Tests only: reset module-level cache between cases. */
export function clearDataCache(): void {
  cache.clear();
}

async function fetchLevelOnce(level: LevelId): Promise<Card[]> {
  const response = await fetch(`/data/jlpt-${level}.json`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const parsed = levelFileSchema.parse(await response.json());
  return toCards(parsed);
}

async function loadLevel(level: LevelId): Promise<Card[]> {
  const cached = cache.get(level);
  if (cached) return cached;
  let cards: Card[];
  try {
    cards = await fetchLevelOnce(level);
  } catch {
    try {
      cards = await fetchLevelOnce(level); // one retry (spec §7)
    } catch (error: unknown) {
      throw new DataLoadError(level, error);
    }
  }
  cache.set(level, cards);
  return cards;
}

/** Mixed = uniform concatenation in M2; profile-weighted mixing arrives in M3. */
export async function loadPool(pool: PoolId): Promise<Card[]> {
  if (pool !== 'mixed') return loadLevel(pool);
  const levels = await Promise.all(MIXED_ORDER.map(loadLevel));
  return levels.flat();
}
```

- [ ] **Step 4: Run to green, then full gate**

Run: `npx vitest run src/data/__tests__/loader.test.ts` → PASS (7 tests)
Run: `npm run check` → green

- [ ] **Step 5: Commit**

```bash
git add src/data/loader.ts src/data/__tests__/loader.test.ts
git commit -m "feat: pool loader with validation, caching, and retry"
```

---

### Task 3: Engine — waveIntro pause/resume, recall grace hint, counters

**Files:**
- Modify: `src/engine/types.ts`, `src/engine/constants.ts`, `src/engine/GameEngine.ts`
- Test: `src/engine/__tests__/GameEngine.test.ts` (append a new describe block; existing tests must stay untouched and green)

**Interfaces:**
- Consumes: everything already in the engine.
- Produces (Tasks 4–5 consume, exact):
  - `GameStatus` gains `'waveIntro'`
  - `GameEvent` gains `{ type: 'waveStarting'; wave: number; cards: Card[] }` and `{ type: 'resumed'; wave: number }`
  - `EngineSnapshot` gains `kills: number; wrongSubmits: number; mode: GameMode`
  - `EngineConfig` gains `hintAtY: number; pauseOnWaveStart: boolean` (defaults 0.6 / **false**)
  - `GameEngine.resume(): void` — no-op unless status is `'waveIntro'`
  - `handleKey('Enter')` during `'waveIntro'` calls `resume()`
  - Recall mode: a word crossing `y >= hintAtY` gets `hintShown = true` (never in reading mode)

- [ ] **Step 1: Update `src/engine/types.ts`**

Change these declarations (rest of file unchanged):

```ts
export type GameEvent =
  | { type: 'wordSpawned'; word: AirborneWord }
  | { type: 'wordKilled'; word: AirborneWord; msToKill: number; points: number; combo: number }
  | { type: 'wordMissed'; word: AirborneWord }
  | { type: 'wrongSubmit'; submittedKana: string }
  | { type: 'bufferChanged'; kana: string; romaji: string; lockedIds: number[] }
  | { type: 'waveStarting'; wave: number; cards: Card[] }
  | { type: 'resumed'; wave: number }
  | { type: 'waveCleared'; wave: number }
  | { type: 'gameOver'; score: number; wave: number };

export type GameStatus = 'idle' | 'waveIntro' | 'playing' | 'gameOver';

export interface EngineSnapshot {
  status: GameStatus;
  mode: GameMode;
  score: number;
  lives: number;
  wave: number;
  combo: number;
  kills: number;
  wrongSubmits: number;
  bufferKana: string;
  bufferRomaji: string;
  lockedIds: number[];
  missed: Card[];
  timeMs: number;
}
```

And append to `EngineConfig`:

```ts
  hintAtY: number; // recall mode: kanji grace hint appears when word.y crosses this
  pauseOnWaveStart: boolean; // emit waveStarting and hold in 'waveIntro' until resume()
```

- [ ] **Step 2: Update `src/engine/constants.ts`** — append inside `DEFAULT_CONFIG`:

```ts
  hintAtY: 0.6,
  pauseOnWaveStart: false, // engine default keeps M1 behavior; the UI opts in
```

- [ ] **Step 3: Write failing tests — append this describe block to `src/engine/__tests__/GameEngine.test.ts`** (reuse the file's existing `cards`, `config`, `makeEngine`, `advance`, `typeWord` helpers; do not modify existing tests)

```ts
describe('wave intro, hints, counters (M2)', () => {
  const introConfig = { ...config, pauseOnWaveStart: true };

  function makeIntroEngine(mode: 'reading' | 'recall' = 'reading') {
    const engine = new GameEngine({ cards, mode, seed: 1, config: introConfig });
    const events: GameEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();
    return { engine, events };
  }

  it('start() with pauseOnWaveStart holds in waveIntro and emits waveStarting with the wave cards', () => {
    const { engine, events } = makeIntroEngine();
    expect(engine.getSnapshot().status).toBe('waveIntro');
    const starting = events.find((e) => e.type === 'waveStarting');
    expect(starting && starting.type === 'waveStarting' && starting.cards.length).toBe(2);
    expect(events.some((e) => e.type === 'wordSpawned')).toBe(false);
  });

  it('tick() is inert during waveIntro (no time, no spawns)', () => {
    const { engine, events } = makeIntroEngine();
    advance(engine, 5000);
    expect(engine.getSnapshot().timeMs).toBe(0);
    expect(events.some((e) => e.type === 'wordSpawned')).toBe(false);
  });

  it('resume() starts play; Enter during intro resumes; letters are ignored', () => {
    const { engine, events } = makeIntroEngine();
    engine.handleKey('a');
    expect(engine.getSnapshot().status).toBe('waveIntro');
    engine.handleKey('Enter');
    expect(engine.getSnapshot().status).toBe('playing');
    expect(events.some((e) => e.type === 'resumed')).toBe(true);
    advance(engine, 50);
    expect(events.some((e) => e.type === 'wordSpawned')).toBe(true);
  });

  it('resume() is a no-op while playing', () => {
    const { engine } = makeIntroEngine();
    engine.handleKey('Enter');
    const before = engine.getSnapshot();
    engine.resume();
    expect(engine.getSnapshot().status).toBe('playing');
    expect(engine.getSnapshot().timeMs).toBe(before.timeMs);
  });

  it('the next wave pauses again with its own cards', () => {
    const { engine, events } = makeIntroEngine();
    engine.handleKey('Enter');
    let now = advance(engine, 20);
    for (let i = 0; i < 2; i++) {
      const word = engine.getWords()[0];
      if (word) {
        const romaji = word.card.id === 'neko' ? 'neko' : word.card.id === 'inu' ? 'inu' : 'hon';
        typeWord(engine, romaji);
      }
      now = advance(engine, 1100, now);
    }
    now = advance(engine, 2000, now);
    expect(engine.getSnapshot().status).toBe('waveIntro');
    const startings = events.filter((e) => e.type === 'waveStarting');
    expect(startings).toHaveLength(2);
    expect(engine.getSnapshot().wave).toBe(2);
  });

  it('without pauseOnWaveStart, waveStarting is still emitted but play begins immediately', () => {
    const { engine, events } = makeEngine();
    expect(engine.getSnapshot().status).toBe('playing');
    expect(events.some((e) => e.type === 'waveStarting')).toBe(true);
  });

  it('recall mode marks hintShown when a word crosses hintAtY; reading mode never does', () => {
    const recall = new GameEngine({ cards, mode: 'recall', seed: 1, config: { ...config, hintAtY: 0.3 } });
    recall.start();
    advance(recall, 4000); // 0.1 y/s → y≈0.4 > 0.3
    expect(recall.getWords().some((w) => w.hintShown)).toBe(true);

    const reading = new GameEngine({ cards, mode: 'reading', seed: 1, config: { ...config, hintAtY: 0.3 } });
    reading.start();
    advance(reading, 4000);
    expect(reading.getWords().every((w) => !w.hintShown)).toBe(true);
  });

  it('snapshot carries mode, kills, and wrongSubmits', () => {
    const { engine } = makeEngine();
    advance(engine, 20);
    typeWord(engine, 'zzz'); // wrong submit
    const word = engine.getWords()[0];
    const romaji = word.card.id === 'neko' ? 'neko' : word.card.id === 'inu' ? 'inu' : 'hon';
    typeWord(engine, romaji);
    const snap = engine.getSnapshot();
    expect(snap.mode).toBe('reading');
    expect(snap.kills).toBe(1);
    expect(snap.wrongSubmits).toBe(1);
  });
});
```

Note: `GameEvent` is already imported in this test file; `advance` returns its end time in the existing helper — reuse as shown.

- [ ] **Step 4: Run to verify failures**

Run: `npx vitest run src/engine/__tests__/GameEngine.test.ts`
Expected: existing tests PASS; every new test FAILS (missing `resume`, `waveStarting`, snapshot fields — plus TS errors first; that counts as the RED state for type-level additions).

- [ ] **Step 5: Implement in `src/engine/GameEngine.ts`**

Apply these changes:

1. Add private fields after `private timeMs = 0;`:
```ts
  private readonly mode: GameMode;
  private kills = 0;
  private wrongSubmits = 0;
```

2. In the constructor, after `this.lives = this.config.lives;` add `this.mode = opts.mode;` (the pool filter below it keeps using `opts.mode` or switch it to `this.mode` — either compiles; use `this.mode` for one source of truth).

3. Replace `beginWave` with:
```ts
  private beginWave(wave: number): void {
    this.wave = wave;
    this.wavePlan = this.spawner.planWave(wave);
    this.waveQueue = [...this.wavePlan.cards];
    this.emit({ type: 'waveStarting', wave, cards: [...this.wavePlan.cards] });
    if (this.config.pauseOnWaveStart) {
      this.status = 'waveIntro';
      return;
    }
    this.nextSpawnAt = this.timeMs; // first word spawns on the next step
  }
```

4. Add the public `resume()` after `start()`:
```ts
  /** Leave the waveIntro pause and begin (or continue) the wave. */
  resume(): void {
    if (this.status !== 'waveIntro') return;
    this.status = 'playing';
    this.nextSpawnAt = this.timeMs;
    this.lastNow = null; // clean fixed-timestep bootstrap after the pause
    this.emit({ type: 'resumed', wave: this.wave });
  }
```

5. In `handleKey`, replace the first guard line with:
```ts
    if (this.status === 'waveIntro') {
      if (key === 'Enter') this.resume();
      return;
    }
    if (this.status !== 'playing') return;
```

6. In `step()`, after `this.moveWords();` insert:
```ts
    this.markHints();
```
and add the private method:
```ts
  private markHints(): void {
    if (this.mode !== 'recall') return;
    for (const w of this.words) {
      if (!w.hintShown && w.y >= this.config.hintAtY) w.hintShown = true;
    }
  }
```

7. In `killWord`, after `this.combo += 1;` add `this.kills += 1;`. In `submit`'s wrong-submit branch, after `this.combo = 0;` add `this.wrongSubmits += 1;`.

8. In `getSnapshot()`, add the three fields:
```ts
      mode: this.mode,
      kills: this.kills,
      wrongSubmits: this.wrongSubmits,
```

`start()` needs no change: it flips to `'playing'` then `beginWave(1)` immediately re-parks to `'waveIntro'` when configured.

- [ ] **Step 6: Run engine suite + full gate**

Run: `npx vitest run src/engine` → all green (existing + 8 new).
Run: `npm run check` → green. Note: `src/ui/useEngine.ts`'s `IDLE_SNAPSHOT` will now fail to compile (missing `mode`/`kills`/`wrongSubmits`) — fix it minimally in this task:

In `src/ui/useEngine.ts`, replace the `IDLE_SNAPSHOT` literal with:
```ts
const IDLE_SNAPSHOT: EngineSnapshot = {
  status: 'idle', mode: 'reading', score: 0, lives: 0, wave: 0, combo: 0,
  kills: 0, wrongSubmits: 0,
  bufferKana: '', bufferRomaji: '', lockedIds: [], missed: [], timeMs: 0,
};
```
(This is the only UI change in this task; the behavioral UI work is Task 5.)

- [ ] **Step 7: Coverage checkpoint + commit**

Run: `npm run coverage` → thresholds pass.

```bash
git add src/engine src/ui/useEngine.ts
git commit -m "feat: engine wave-intro pause, recall grace hint, kill counters"
```

---

### Task 4: Render — recall prompts + fading kanji hint

**Files:**
- Modify: `src/render/WordSprite.ts`, `src/render/PixiStage.ts`
- No unit tests (WebGL layer, per plan policy); verified by `tsc -b`, oxlint, Task 5's e2e, and the fun-run.

**Interfaces:**
- Consumes: `AirborneWord.hintShown`, `card.kanji`, `GameMode`.
- Produces (PixiStage consumes): `WordSprite.showHint(kanji: string): void` (idempotent), `WordSprite.update(deltaMS: number): void` (drives hint fade-in).
- Display rules (spec §3.2): recall prompt = gloss; hint = the kanji form fading in below the gloss; readings still never shown during play.

- [ ] **Step 1: Update `src/render/WordSprite.ts`** — replace the file with:

```ts
import { Container, Text, TextStyle } from 'pixi.js';
import type { AirborneWord, GameMode } from '../engine/types';

const FONT_STACK = "'Yu Gothic UI', 'Meiryo', 'Noto Sans JP', sans-serif";

const BASE_STYLE: Partial<TextStyle> = {
  fontFamily: FONT_STACK,
  fontSize: 40,
  fill: 0xe8f0ff,
};

const HINT_STYLE: Partial<TextStyle> = {
  fontFamily: FONT_STACK,
  fontSize: 26,
  fill: 0xbfd4ff,
};

const HINT_FADE_MS = 300;
const HINT_OFFSET_Y = 34;
const LOCKED_TINT = 0x7fdfff;
const UNLOCKED_TINT = 0xffffff;

export class WordSprite {
  readonly view: Container;
  private readonly text: Text;
  private hintText: Text | null = null;

  constructor(word: AirborneWord, mode: GameMode) {
    const display = mode === 'recall'
      ? word.card.gloss
      : word.card.kanji ?? word.card.kana[0];
    this.text = new Text({
      text: display,
      style: new TextStyle({ ...BASE_STYLE }),
      resolution: Math.min(Math.max(window.devicePixelRatio, 1) * 2, 4),
    });
    this.text.anchor.set(0.5);
    this.view = new Container();
    this.view.addChild(this.text);
  }

  /** Recall grace hint: the kanji form fades in below the gloss. Idempotent. */
  showHint(kanji: string): void {
    if (this.hintText !== null) return;
    this.hintText = new Text({
      text: kanji,
      style: new TextStyle({ ...HINT_STYLE }),
      resolution: 2,
    });
    this.hintText.anchor.set(0.5);
    this.hintText.position.set(0, HINT_OFFSET_Y);
    this.hintText.alpha = 0;
    this.view.addChild(this.hintText);
  }

  /** Per-frame: advance the hint fade. */
  update(deltaMS: number): void {
    if (this.hintText !== null && this.hintText.alpha < 1) {
      this.hintText.alpha = Math.min(1, this.hintText.alpha + deltaMS / HINT_FADE_MS);
    }
  }

  setLocked(locked: boolean): void {
    this.text.tint = locked ? LOCKED_TINT : UNLOCKED_TINT;
  }

  setPosition(xPx: number, yPx: number): void {
    this.view.position.set(xPx, yPx);
  }
}
```

- [ ] **Step 2: Update `src/render/PixiStage.ts`** — two changes:

1. The ticker callback in the private constructor becomes:
```ts
    app.ticker.add(() => {
      const delta = app.ticker.deltaMS;
      this.updateFx(delta);
      for (const sprite of this.sprites.values()) sprite.update(delta);
    });
```

2. Inside `sync()`'s per-word loop, after the `sprite.setLocked(...)` line, add:
```ts
      if (word.hintShown && word.card.kanji !== null) sprite.showHint(word.card.kanji);
```

(Everything else — fx, destroy, playKill/playMiss — is untouched. `playMiss` already reveals kanji + reading + gloss, which is correct for both modes.)

- [ ] **Step 3: Verify + commit**

Run: `npm run check` → green (no behavior tests here; tsc + oxlint + untouched suites).

```bash
git add src/render
git commit -m "feat: recall-mode prompts and fading kanji grace hint"
```

---

### Task 5: UI flow — setup, wave-intro overlay, results + revenge, e2e

**Files:**
- Modify: `src/ui/useEngine.ts`, `src/App.tsx`, `src/ui/screens/GameScreen.tsx`, `src/index.css`, `e2e/game.spec.ts` (note: `src/global.d.ts` needs NO edit — its type is derived from `EngineSnapshot`, which Task 3 already widened)
- Create: `src/ui/screens/SetupScreen.tsx`, `src/ui/screens/WaveIntroOverlay.tsx`, `src/ui/screens/ResultsScreen.tsx`
- Delete: `src/ui/screens/GameOverOverlay.tsx`
- Test: `src/ui/__tests__/ResultsScreen.test.tsx`, `src/ui/__tests__/WaveIntroOverlay.test.tsx`

**Interfaces:**
- Consumes: `loadPool`, `POOL_LABELS`, `PoolId`, `DataLoadError` (Task 2); engine `resume`, `waveStarting`, snapshot `mode/kills/wrongSubmits/status='waveIntro'` (Task 3).
- Produces:
  - `useEngine()` returns `{ snapshot, hostRef, start, resume, introCards }` where `start(opts: RunOptions)`, `RunOptions = { mode: GameMode; cards: Card[]; seed?: number; introduceWords?: boolean }`, `resume(): void`, `introCards: Card[]` (latest `waveStarting` payload).
  - App flow: `title → setup → game`; session-scoped `seenIds: Set<string>` survives across runs; URL auto-start via `?mode=reading|recall&pool=n5|n4|n3|n2|mixed` (+ optional `&seed=`).
  - Accuracy formula (Results): `kills / (kills + missed.length + wrongSubmits)`, rendered as a rounded percent, `0%` when denominator is 0.

- [ ] **Step 1: Write failing overlay/results tests**

`src/ui/__tests__/WaveIntroOverlay.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Card } from '../../engine/types';
import { WaveIntroOverlay } from '../screens/WaveIntroOverlay';

const card = (id: string, kanji: string | null, kana: string, gloss: string): Card => ({
  id, kanji, kana: [kana], gloss, pos: 'n', jlpt: 5, source: 'jlpt',
});

describe('WaveIntroOverlay', () => {
  it('renders one row per new word with kanji, reading, and meaning', () => {
    render(
      <WaveIntroOverlay
        cards={[card('a', '猫', 'ねこ', 'cat'), card('b', null, 'それ', 'that')]}
        wave={2}
        onDismiss={() => {}}
      />,
    );
    expect(screen.getByTestId('wave-intro')).toHaveTextContent('猫');
    expect(screen.getByTestId('wave-intro')).toHaveTextContent('ねこ');
    expect(screen.getByTestId('wave-intro')).toHaveTextContent('cat');
    expect(screen.getByTestId('wave-intro')).toHaveTextContent('それ');
    expect(screen.getAllByRole('row')).toHaveLength(2);
  });

  it('auto-dismisses when there are no new words', () => {
    const onDismiss = vi.fn();
    render(<WaveIntroOverlay cards={[]} wave={3} onDismiss={onDismiss} />);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('wave-intro')).toBeNull();
  });
});
```

`src/ui/__tests__/ResultsScreen.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Card, EngineSnapshot } from '../../engine/types';
import { ResultsScreen } from '../screens/ResultsScreen';

const card = (id: string): Card => ({
  id, kanji: '字', kana: ['かな'], gloss: 'g', pos: 'n', jlpt: 5, source: 'jlpt',
});

const base: EngineSnapshot = {
  status: 'gameOver', mode: 'reading', score: 4200, lives: 0, wave: 5, combo: 0,
  kills: 12, wrongSubmits: 2, bufferKana: '', bufferRomaji: '',
  lockedIds: [], missed: [card('m1'), card('m2'), card('m1')], timeMs: 0,
};

describe('ResultsScreen', () => {
  it('shows score, wave, and accuracy = kills/(kills+misses+wrongSubmits)', () => {
    render(<ResultsScreen snapshot={base} onRevenge={() => {}} onPlayAgain={() => {}} onTitle={() => {}} />);
    expect(screen.getByTestId('final-score')).toHaveTextContent('4200');
    // 12 / (12 + 3 + 2) = 70.5… → 71%
    expect(screen.getByTestId('accuracy')).toHaveTextContent('71%');
  });

  it('accuracy is 0% with no attempts', () => {
    render(
      <ResultsScreen
        snapshot={{ ...base, kills: 0, wrongSubmits: 0, missed: [] }}
        onRevenge={() => {}} onPlayAgain={() => {}} onTitle={() => {}}
      />,
    );
    expect(screen.getByTestId('accuracy')).toHaveTextContent('0%');
  });

  it('revenge passes DEDUPED missed cards and is disabled when nothing was missed', async () => {
    const onRevenge = vi.fn();
    const { rerender } = render(
      <ResultsScreen snapshot={base} onRevenge={onRevenge} onPlayAgain={() => {}} onTitle={() => {}} />,
    );
    await userEvent.click(screen.getByTestId('revenge-button'));
    expect(onRevenge).toHaveBeenCalledTimes(1);
    expect(onRevenge.mock.calls[0][0].map((c: Card) => c.id)).toEqual(['m1', 'm2']);

    rerender(
      <ResultsScreen
        snapshot={{ ...base, missed: [] }}
        onRevenge={onRevenge} onPlayAgain={() => {}} onTitle={() => {}}
      />,
    );
    expect(screen.getByTestId('revenge-button')).toBeDisabled();
  });
});
```

Install the missing test util: `npm install -D @testing-library/user-event@^14`

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui`
Expected: the two new files FAIL with module-not-found; existing Hud/isGameKey tests PASS.

- [ ] **Step 3: Implement the two screens**

`src/ui/screens/WaveIntroOverlay.tsx`:
```tsx
import { useEffect } from 'react';
import type { Card } from '../../engine/types';

interface WaveIntroOverlayProps {
  cards: Card[]; // ONLY the not-yet-seen cards; parent filters
  wave: number;
  onDismiss: () => void;
}

/** Pre-wave interstitial (spec §3.6): meaning + spelling before words ever fall. */
export function WaveIntroOverlay({ cards, wave, onDismiss }: WaveIntroOverlayProps) {
  const empty = cards.length === 0;

  useEffect(() => {
    if (empty) onDismiss();
  }, [empty, onDismiss]);

  if (empty) return null;

  return (
    <div className="overlay" data-testid="wave-intro">
      <h2>Wave {wave} — new words</h2>
      <table className="intro-words">
        <tbody>
          {cards.map((card) => (
            <tr key={card.id}>
              <td className="intro-kanji">{card.kanji ?? '—'}</td>
              <td className="intro-kana">{card.kana[0]}</td>
              <td>{card.gloss}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">Press Enter to start the wave</p>
    </div>
  );
}
```

`src/ui/screens/ResultsScreen.tsx`:
```tsx
import type { Card, EngineSnapshot } from '../../engine/types';

interface ResultsScreenProps {
  snapshot: EngineSnapshot;
  onRevenge: (missed: Card[]) => void;
  onPlayAgain: () => void;
  onTitle: () => void;
}

function dedupeById(cards: Card[]): Card[] {
  const seen = new Set<string>();
  const out: Card[] = [];
  for (const card of cards) {
    if (!seen.has(card.id)) {
      seen.add(card.id);
      out.push(card);
    }
  }
  return out;
}

export function ResultsScreen({ snapshot, onRevenge, onPlayAgain, onTitle }: ResultsScreenProps) {
  const missed = dedupeById(snapshot.missed);
  const attempts = snapshot.kills + snapshot.missed.length + snapshot.wrongSubmits;
  const accuracy = attempts === 0 ? 0 : Math.round((snapshot.kills / attempts) * 100);

  return (
    <div className="overlay" data-testid="results">
      <h2>Run over</h2>
      <p>
        <span data-testid="final-score">{snapshot.score}</span> pts · Wave {snapshot.wave} ·{' '}
        <span data-testid="accuracy">{accuracy}%</span> accuracy
      </p>
      {missed.length > 0 && (
        <table className="missed">
          <tbody>
            {missed.map((card) => (
              <tr key={card.id}>
                <td>{card.kanji ?? '—'}</td>
                <td>{card.kana[0]}</td>
                <td>{card.gloss}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="results-buttons">
        <button
          data-testid="revenge-button"
          disabled={missed.length === 0}
          onClick={() => onRevenge(missed)}
        >
          Revenge round ({missed.length})
        </button>
        <button onClick={onPlayAgain}>Play again</button>
        <button onClick={onTitle}>Title</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run screen tests to green**

Run: `npx vitest run src/ui` → PASS (existing + 5 new).

- [ ] **Step 5: Rewire `src/ui/useEngine.ts`**

Replace the `start` callback, the `onKey` guard, the loop's sync line, add `introCards`/`resume`, and drop the `N5_WORDS` import. Full updated file:

```ts
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { GameEngine } from '../engine/GameEngine';
import type { Card, EngineSnapshot, GameEvent, GameMode } from '../engine/types';
import { PixiStage } from '../render/PixiStage';

const IDLE_SNAPSHOT: EngineSnapshot = {
  status: 'idle', mode: 'reading', score: 0, lives: 0, wave: 0, combo: 0,
  kills: 0, wrongSubmits: 0,
  bufferKana: '', bufferRomaji: '', lockedIds: [], missed: [], timeMs: 0,
};

export interface GameKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing: boolean;
}

/** True when the game should consume this keydown (never modifier chords or IME composition). */
export function isGameKey(e: GameKeyEvent): boolean {
  if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return false;
  return e.key === 'Enter' || e.key === 'Escape' || e.key === 'Backspace' || /^[a-zA-Z-]$/.test(e.key);
}

function seedFromUrl(): number | null {
  const raw = new URLSearchParams(window.location.search).get('seed');
  const parsed = raw === null ? NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface RunOptions {
  mode: GameMode;
  cards: Card[];
  seed?: number;
  introduceWords?: boolean; // default true: pause each wave behind the intro overlay
}

export function useEngine() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [runId, setRunId] = useState(0);
  const [introCards, setIntroCards] = useState<Card[]>([]);

  // Snapshot store: replaced on engine events only (words render via Pixi, not React).
  const snapshotRef = useRef<EngineSnapshot>(IDLE_SNAPSHOT);
  const listenersRef = useRef(new Set<() => void>());

  const subscribe = useCallback((cb: () => void) => {
    listenersRef.current.add(cb);
    return () => listenersRef.current.delete(cb);
  }, []);
  const getSnapshot = useCallback(() => snapshotRef.current, []);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);

  const start = useCallback((opts: RunOptions) => {
    engineRef.current = new GameEngine({
      cards: opts.cards,
      mode: opts.mode,
      seed: opts.seed ?? seedFromUrl() ?? Date.now(),
      config: { pauseOnWaveStart: opts.introduceWords ?? true },
    });
    setIntroCards([]);
    setRunId((n) => n + 1);
  }, []);

  const resume = useCallback(() => {
    engineRef.current?.resume();
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
      if (event.type === 'waveStarting') setIntroCards(event.cards);
      publish();
    };

    const onKey = (e: KeyboardEvent) => {
      const status = snapshotRef.current.status;
      if (status !== 'playing' && status !== 'waveIntro') return;
      if (!isGameKey(e)) return;
      e.preventDefault();
      engine.handleKey(e.key);
    };

    // No visibility handler needed: rAF stops in background tabs and the
    // 100ms clamp in tick() absorbs the gap on return.
    const loop = (now: number) => {
      engine.tick(now);
      stage?.sync(engine.getWords(), snapshotRef.current.lockedIds, snapshotRef.current.mode);
      rafId = requestAnimationFrame(loop);
    };

    const unsubscribe = engine.subscribe(onEvent);
    window.addEventListener('keydown', onKey);
    if (import.meta.env.DEV) {
      window.__kotoba = {
        snapshot: () => ({
          ...engine.getSnapshot(),
          firstAirborneReading: engine.getWords()[0]?.card.kana[0] ?? null,
        }),
      };
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

  return { snapshot, hostRef, start, resume, introCards };
}
```

- [ ] **Step 6: Implement `SetupScreen`, rewire `GameScreen` and `App`**

`src/ui/screens/SetupScreen.tsx`:
```tsx
import { useState } from 'react';
import { POOL_LABELS, type PoolId } from '../../data/loader';
import type { GameMode } from '../../engine/types';

interface SetupScreenProps {
  loading: boolean;
  error: string | null;
  onBegin: (mode: GameMode, pool: PoolId) => void;
  onBack: () => void;
}

const MODES: { id: GameMode; label: string; blurb: string }[] = [
  { id: 'reading', label: 'Reading', blurb: 'Kanji falls — type its reading' },
  { id: 'recall', label: 'Recall', blurb: 'English falls — type the Japanese' },
];
const POOLS: PoolId[] = ['n5', 'n4', 'n3', 'n2', 'mixed'];

export function SetupScreen({ loading, error, onBegin, onBack }: SetupScreenProps) {
  const [mode, setMode] = useState<GameMode>('reading');
  const [pool, setPool] = useState<PoolId>('n5');

  return (
    <div className="screen-center" data-testid="setup">
      <h2>Choose your run</h2>
      <div className="picker-row">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={mode === m.id ? 'picker selected' : 'picker'}
            data-testid={`mode-${m.id}`}
            onClick={() => setMode(m.id)}
          >
            <strong>{m.label}</strong>
            <span className="hint">{m.blurb}</span>
          </button>
        ))}
      </div>
      <div className="picker-row">
        {POOLS.map((p) => (
          <button
            key={p}
            className={pool === p ? 'picker selected' : 'picker'}
            data-testid={`pool-${p}`}
            onClick={() => setPool(p)}
          >
            {POOL_LABELS[p]}
          </button>
        ))}
      </div>
      {error !== null && (
        <p className="load-error" data-testid="load-error">
          {error} — is the app serving /data/? Try again.
        </p>
      )}
      <div className="picker-row">
        <button data-testid="begin-button" disabled={loading} onClick={() => onBegin(mode, pool)}>
          {loading ? 'Loading words…' : 'Begin'}
        </button>
        <button onClick={onBack}>Back</button>
      </div>
    </div>
  );
}
```

`src/ui/screens/GameScreen.tsx` (replace file):
```tsx
import type { RefObject } from 'react';
import type { Card, EngineSnapshot } from '../../engine/types';
import { Hud } from '../hud/Hud';
import { ResultsScreen } from './ResultsScreen';
import { WaveIntroOverlay } from './WaveIntroOverlay';

interface GameScreenProps {
  snapshot: EngineSnapshot;
  hostRef: RefObject<HTMLDivElement | null>;
  introCards: Card[]; // already filtered to unseen by App
  onDismissIntro: () => void;
  onRevenge: (missed: Card[]) => void;
  onPlayAgain: () => void;
  onTitle: () => void;
}

export function GameScreen({
  snapshot, hostRef, introCards, onDismissIntro, onRevenge, onPlayAgain, onTitle,
}: GameScreenProps) {
  return (
    <div className="game-screen">
      <div className="pixi-host" ref={hostRef} />
      <Hud snapshot={snapshot} />
      {snapshot.status === 'waveIntro' && (
        <WaveIntroOverlay cards={introCards} wave={snapshot.wave} onDismiss={onDismissIntro} />
      )}
      {snapshot.status === 'gameOver' && (
        <ResultsScreen
          snapshot={snapshot}
          onRevenge={onRevenge}
          onPlayAgain={onPlayAgain}
          onTitle={onTitle}
        />
      )}
    </div>
  );
}
```

`src/App.tsx` (replace file):
```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { DataLoadError, loadPool, type PoolId } from './data/loader';
import type { Card, GameMode } from './engine/types';
import { GameScreen } from './ui/screens/GameScreen';
import { SetupScreen } from './ui/screens/SetupScreen';
import { TitleScreen } from './ui/screens/TitleScreen';
import { useEngine } from './ui/useEngine';

type Screen = 'title' | 'setup' | 'game';

const VALID_MODES: GameMode[] = ['reading', 'recall'];
const VALID_POOLS: PoolId[] = ['n5', 'n4', 'n3', 'n2', 'mixed'];

function runFromUrl(): { mode: GameMode; pool: PoolId } | null {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode') as GameMode | null;
  const pool = params.get('pool') as PoolId | null;
  if (mode !== null && pool !== null && VALID_MODES.includes(mode) && VALID_POOLS.includes(pool)) {
    return { mode, pool };
  }
  return null;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('title');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const lastRunRef = useRef<{ mode: GameMode; cards: Card[] } | null>(null);
  const seenIdsRef = useRef(new Set<string>()); // session-scoped across runs (spec §3.6)
  const { snapshot, hostRef, start, resume, introCards } = useEngine();

  const beginRun = useCallback((mode: GameMode, cards: Card[]) => {
    lastRunRef.current = { mode, cards };
    start({ mode, cards });
    setScreen('game');
  }, [start]);

  const beginFromPool = useCallback(async (mode: GameMode, pool: PoolId) => {
    setLoading(true);
    setLoadError(null);
    try {
      const cards = await loadPool(pool);
      beginRun(mode, cards);
    } catch (error: unknown) {
      setLoadError(error instanceof DataLoadError ? error.message : 'unexpected load failure');
    } finally {
      setLoading(false);
    }
  }, [beginRun]);

  // Dev/e2e determinism: ?mode=&pool= auto-starts a run, skipping title/setup.
  const autoRun = useRef(runFromUrl());
  useEffect(() => {
    if (autoRun.current !== null) {
      const { mode, pool } = autoRun.current;
      autoRun.current = null;
      void beginFromPool(mode, pool);
    }
  }, [beginFromPool]);

  const unseenIntro = introCards.filter((c) => !seenIdsRef.current.has(c.id));

  const dismissIntro = useCallback(() => {
    for (const card of introCards) seenIdsRef.current.add(card.id);
    resume();
  }, [introCards, resume]);

  if (screen === 'game') {
    return (
      <GameScreen
        snapshot={snapshot}
        hostRef={hostRef}
        introCards={unseenIntro}
        onDismissIntro={dismissIntro}
        onRevenge={(missed) => lastRunRef.current && beginRun(lastRunRef.current.mode, missed)}
        onPlayAgain={() =>
          lastRunRef.current && beginRun(lastRunRef.current.mode, lastRunRef.current.cards)}
        onTitle={() => setScreen('title')}
      />
    );
  }
  if (screen === 'setup') {
    return (
      <SetupScreen
        loading={loading}
        error={loadError}
        onBegin={(mode, pool) => void beginFromPool(mode, pool)}
        onBack={() => setScreen('title')}
      />
    );
  }
  return <TitleScreen onStart={() => setScreen('setup')} />;
}
```

Note on `dismissIntro`: it marks ALL of the wave's intro cards seen (not only unseen) — idempotent and correct. The engine's Enter-during-intro path (`resume()` inside `handleKey`) also fires when the player presses Enter with the overlay up; App's overlay dismissal marks seen via `onDismiss` → both paths converge because `WaveIntroOverlay` auto-dismisses (marking seen) once status leaves `waveIntro`… but to keep ONE authority: the overlay's visible "Press Enter" is handled by the engine (status flips to `playing`, overlay unmounts). To guarantee seen-marking on that path too, `App` marks seen whenever the overlay unmounts via dismissal or resume — implement by ALSO adding this effect to `App` right after `dismissIntro`:

```tsx
  const prevStatus = useRef(snapshot.status);
  useEffect(() => {
    if (prevStatus.current === 'waveIntro' && snapshot.status === 'playing') {
      for (const card of introCards) seenIdsRef.current.add(card.id);
    }
    prevStatus.current = snapshot.status;
  }, [snapshot.status, introCards]);
```

Append to `src/index.css`:
```css
.picker-row { display: flex; gap: 0.75rem; flex-wrap: wrap; justify-content: center; }
.picker { display: flex; flex-direction: column; gap: 0.2rem; min-width: 8.5rem; }
.picker.selected { border-color: #7fdfff; background: #14263a; }
.load-error { color: #ff8f8f; }
.intro-words { border-collapse: collapse; }
.intro-words td { padding: 0.3rem 1rem; }
.intro-kanji { font-size: 1.6rem; }
.intro-kana { color: #7fdfff; }
.results-buttons { display: flex; gap: 0.75rem; }
```

Delete `src/ui/screens/GameOverOverlay.tsx` (ResultsScreen supersedes it; verify nothing imports it: `grep -r "GameOverOverlay" src e2e` → no hits).

- [ ] **Step 7: Update the e2e specs — replace `e2e/game.spec.ts`**

```ts
import { expect, test, type Page } from '@playwright/test';
import { toRomaji } from 'wanakana';

async function dismissIntroAndKillFirstWord(page: Page) {
  // Wave intro comes first (spec §3.6): wait for the pause, dismiss with Enter.
  await page.waitForFunction(() => window.__kotoba?.snapshot().status === 'waveIntro');
  await expect(page.getByTestId('wave-intro')).toBeVisible();
  await page.keyboard.press('Enter');

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
}

test('reading mode: intro → dismiss → type reading → kill scores', async ({ page }) => {
  await page.goto('/?seed=42&mode=reading&pool=n5');
  await dismissIntroAndKillFirstWord(page);
});

test('recall mode: gloss prompt still killed by typing the reading', async ({ page }) => {
  await page.goto('/?seed=42&mode=recall&pool=n5');
  await dismissIntroAndKillFirstWord(page);
});
```

Caveat carried from M1: `toRomaji` round-trips safely for hiragana readings. The N5 pool now CAN contain katakana loanwords whose readings include ー; `toRomaji('コーヒー')` yields macron vowels (`kōhī`) that the input buffer can't type. Guard: if this test flakes on a katakana-reading first word under seed 42, change the seed (both tests) to one whose first word has a hiragana reading, and note which seed in the commit message — do NOT special-case the game code for the test.

- [ ] **Step 8: Full verification sweep**

Run: `npm run check` → green (all unit suites).
Run: `npm run e2e` → 2 passed.
Run: `npm run coverage` → thresholds hold.
Manual sanity (optional but encouraged): `npm run dev`, play one recall N5 run — intro overlay lists words, hint kanji fades in past 60% height, results shows accuracy + revenge.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: setup flow, wave word introduction, results screen with revenge rounds"
```

---

### Task 6: Docs + retirement of the hardcoded word set

**Files:**
- Modify: `README.md`, `docs/superpowers/specs/2026-07-22-kotoba-drop-design.md` (§3.3 note)
- Delete: `src/data/n5words.ts`, `src/data/__tests__/n5words.test.ts`

**Interfaces:**
- Consumes: nothing new. Produces: accurate docs; no code depends on `N5_WORDS` after Task 5 (verify).

- [ ] **Step 1: Verify and delete the superseded word set**

Run: `grep -rn "n5words\|N5_WORDS" src e2e scripts`
Expected: hits ONLY in `src/data/n5words.ts` and its test. If any other file still imports it, STOP — Task 5 was incomplete; report instead of deleting. Otherwise:

```bash
git rm src/data/n5words.ts src/data/__tests__/n5words.test.ts
```

- [ ] **Step 2: Update `README.md`** — replace the Status section and extend Run:

Under `## Run`, after the e2e bullet, add:

```markdown
- `npm run build:data` — regenerate `public/data/jlpt-n*.json` from local raw
  datasets (expects `data/raw/` populated with `term_meta_bank_*.json` and
  `jmdict-eng-3.6.2.json`; copies live in the n2-prep repo's `data/raw/`).
  Generated files are committed — you only need this when changing the pipeline.
```

Replace the `## Status` body with:

```markdown
Milestone 2 of the design spec:
`docs/superpowers/specs/2026-07-22-kotoba-drop-design.md`.
Two modes (Reading: kanji → type the reading; Recall: English → type the
Japanese), JLPT N5–N2 pools (~4,900 words) + Mixed, pre-wave word
introductions, results screen with revenge rounds.
Pacing knobs live in `src/engine/constants.ts`.
```

- [ ] **Step 3: Spec amendment** — in `docs/superpowers/specs/2026-07-22-kotoba-drop-design.md` §3.3, replace the sentence:

> Player picks a word pool per run: a single JLPT level (N5, N4, N3, N2), mixed (all levels, weighted toward the profile's target level), or a custom imported list.

with:

> Player picks a word pool per run: a single JLPT level (N5, N4, N3, N2), mixed (uniform across all levels in M2; weighted toward the profile's target level once the M3 profile exists), or a custom imported list.

- [ ] **Step 4: Full gate + commit**

Run: `npm run check && npm run e2e`
Expected: all green (n5words tests gone, everything else passes).

```bash
git add -A
git commit -m "docs: m2 readme and spec sync; chore: retire hardcoded n5 word set"
```

---

## Milestone Exit

Play recall mode and mixed pools for real sessions. Gate questions before planning M3 (backend + analytics):
1. Does the word-introduction flow help or interrupt? (Tune: per-wave vs first-wave-only, auto-timer vs Enter.)
2. Is recall mode's grace hint timed right (`hintAtY` in constants.ts)?
3. Are the generated glosses clean enough in practice? (Note any weird ones — the pipeline's gloss picker can be refined and re-run.)

## Deferred (deliberately absent here)

- M3: Hono + SQLite backend, raw event persistence (engine already tracks per-word `firstKeyAt`/`backspaceCount`/`hintShown`/`wasTargeted` and run counters), profile/goals, Stats screen, profile-weighted mixed pools, player-scoped (cross-session) word introductions with `introduced_at` events.
- M4: particles/bloom/CRT/SFX, custom-list import UI (schema + zod already in place), settings, IME warning banner UI, bundled Noto Sans JP.
