# Tiered Vocabulary (M4-D) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace uniform-random word selection with frequency-ordered intake tiers behind a mastery gate, and a weakness×staleness-weighted review draw — per `docs/superpowers/specs/2026-07-27-tiered-vocabulary-design.md`.

**Architecture:** The build pipeline ranks each JLPT level by Tatoeba sentence frequency and stamps a static `tier` on every card (committed data + `cards` column). The server derives the active tier and per-card review weights from `attempts`/`introductions` on every plan request — nothing new is stored. The engine stops deriving its seen pool by negation and instead consumes the plan's explicit weighted list; cards in neither list are locked and never spawn. The client gains tier-aware run notices and setup-screen tier progress.

**Tech Stack:** TypeScript, Zod, Hono, Drizzle/better-sqlite3, Vitest, React, Playwright. No new dependencies.

## Global Constraints

- Config values (spec §5.2, verbatim): `tierSize: 10`, `tierMasteryThreshold: 0.8`, `amnestyMinEncounters: 8`, `reviewWeightFloor: 0.1`, `reviewWeaknessWeight: 0.6`, `reviewStalenessWeight: 0.4`, `reviewStalenessCeilingHours: 72` — all in `server/planConfig.ts`, none in `statsConfig.ts`.
- "Solid" reuses the existing learned gate (`evaluateDirection` over the pooled `all` bucket) — no second definition of knowing a word (spec §3.2).
- Active tier, solid, amnestied, and weights are **derived on every request**, never stored. No new tables (spec §4.2).
- Tier ranking key, descending within a level: `(sentenceCount, jmdictCommon, id)` — a total order, so identical inputs build byte-identical tiers (spec §5.1).
- Locked cards (in neither `newCardIds` nor `seenCards`) must never spawn, including in the starved-pool fallback, which may draw only from the active tier (spec §5.3, §7).
- The daily budget computation and the acquisition ceremony ship from M4-A unchanged.
- Plan-unavailable behavior unchanged: every card treated as seen, uniform draw, play proceeds (spec §7).
- Commit format: `<type>: <description>`, no attribution footer (user git config disables it).
- Every task must end green: `npm run check` (tsc + oxlint + vitest) passes before its commit.
- Windows PowerShell environment; all commands below run from the repo root.

## Known accepted edges (implement as spec'd, do not "fix")

- A tier can pass with ≤20% of its cards never met (e.g. 8 solid + 2 unmet = 8/10 = 0.8). Those unmet stragglers leave `newCardIds` and are locked out of intake unless a solid card later regresses and re-opens the tier (solid is a live rolling check, so this self-heals on regression). Spec §3.2/§3.3 accepts this; do not special-case it.
- The budget-exhausted notice keeps the existing copy `"Today's new words are done — this run is review."` — the spec table's "Today's 20 new words" is illustrative; the goal number isn't in the plan response and adding it isn't warranted.
- `mixed` unions all four active tiers (up to 40 eligible) — a deliberately weaker gate (spec §5.5).

---

### Task 1: Build pipeline — tier assignment + data rebuild

The Tatoeba scan already visits every qualifying sentence per key and keeps the shortest; it discards the visit count. Keep the count, rank each level by it, stamp `tier` on every card, require it in the schema, rebuild the committed data.

**Files:**
- Modify: `server/planConfig.ts` (add `tierSize` only — the other knobs arrive with their consumer in Task 4)
- Modify: `scripts/build-data.ts`
- Modify: `src/engine/types.ts` (Card gains optional `tier`)
- Modify: `src/data/schema.ts` (cardSchema requires `tier`)
- Modify: `src/data/__tests__/jlptData.test.ts` (new invariants)
- Modify: `src/data/__tests__/loader.test.ts`, `src/ui/__tests__/App.introFlow.test.tsx`, `src/ui/__tests__/App.replayPlan.test.tsx` (fixtures parsed by `levelFileSchema` need `tier`)
- Regenerate: `public/data/jlpt-n5.json`, `jlpt-n4.json`, `jlpt-n3.json`, `jlpt-n2.json`

**Interfaces:**
- Consumes: existing `buildSentenceIndex`, `attachHooks`, `levelFileSchema`.
- Produces: `PLAN.tierSize: 10`; `Card.tier?: number` (engine type, optional); `cardSchema` with required `tier: z.number().int().positive()`; committed data files where every card has `tier`, `listVersion` bumped to `jlpt-tanos-jmdict-3.6.2-v2`. Tasks 2 and 4 rely on every `source='jlpt'` card having a 1-based contiguous tier.

- [ ] **Step 1: Write the failing invariant tests**

Append to the `describe('generated JLPT data invariants')` block in `src/data/__tests__/jlptData.test.ts`:

```ts
  it('every card carries a contiguous 1-based tier; all tiers full at 10 except each level\'s last', () => {
    for (const [level, file] of files) {
      const byTier = new Map<number, number>();
      for (const card of file.cards) {
        expect(Number.isInteger(card.tier), card.id).toBe(true);
        expect(card.tier, card.id).toBeGreaterThanOrEqual(1);
        byTier.set(card.tier, (byTier.get(card.tier) ?? 0) + 1);
      }
      const totalTiers = Math.max(...byTier.keys());
      expect(byTier.size, `N${level} tiers contiguous from 1`).toBe(totalTiers);
      expect(totalTiers, `N${level}`).toBe(Math.ceil(file.cards.length / 10));
      for (let t = 1; t <= totalTiers; t++) {
        const size = byTier.get(t) ?? 0;
        if (t < totalTiers) expect(size, `N${level} tier ${t}`).toBe(10);
        else {
          expect(size, `N${level} last tier`).toBeGreaterThanOrEqual(1);
          expect(size, `N${level} last tier`).toBeLessThanOrEqual(10);
        }
      }
    }
  });

  it('tier order tracks corpus frequency: no sentence-less card outranks a card with a sentence', () => {
    // A card has a sentence iff its key appeared in >=1 qualifying Tatoeba
    // sentence, i.e. iff its count is nonzero — so every with-sentence card
    // must rank at or above every without-sentence card. The boundary tier
    // may contain both, hence <= rather than <.
    for (const [level, file] of files) {
      const withS = file.cards.filter((c) => c.sentence).map((c) => c.tier);
      const withoutS = file.cards.filter((c) => !c.sentence).map((c) => c.tier);
      if (withS.length === 0 || withoutS.length === 0) continue;
      expect(Math.max(...withS), `N${level}`).toBeLessThanOrEqual(Math.min(...withoutS));
    }
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/data/__tests__/jlptData.test.ts`
Expected: FAIL — the current schema/parse rejects nothing yet, but `card.tier` is `undefined`, so `Number.isInteger(card.tier)` is false. (If the file fails earlier at `levelFileSchema.parse` after Step 3's schema change, that is the same red.)

- [ ] **Step 3: Type + schema changes**

`src/engine/types.ts` — add to `Card` (after `jlpt`):

```ts
  /** Frequency tier within the card's own JLPT level, 1-based (spec §3.1 of
   *  the tiered-vocabulary spec). Stamped by the build pipeline; absent for
   *  custom cards. The engine itself never reads it. */
  tier?: number;
```

`src/data/schema.ts` — add to `cardSchema` (after `jlpt`):

```ts
  // Required, not optional: the pipeline guarantees it, and a missing tier
  // should fail loudly at load rather than silently degrade the gate (§4.1).
  tier: z.number().int().positive(),
```

`server/planConfig.ts` — add to `PLAN`:

```ts
  /** Cards per intake tier (tiered-vocab spec §3.1). Consumed by the build
   *  pipeline; the server gates on each tier's ACTUAL card count, never this. */
  tierSize: 10,
```

- [ ] **Step 4: Pipeline changes in `scripts/build-data.ts`**

(a) Import the tier size (top of file, alongside the existing `../src/...` imports — `tsconfig.node.json` pulls imported files into its program, and `planConfig` has zero imports):

```ts
import { PLAN } from '../server/planConfig.ts';
```

(b) Extend the jmdict interfaces to read the `common` flag (it is present in the raw file — verified: `{"common":false,"text":"ヽ",...}`):

```ts
interface JmdictKana { text: string; appliesToKanji: string[]; common: boolean }
interface JmdictWord { id: string; kanji: { text: string; common: boolean }[]; kana: JmdictKana[]; sense: JmdictSense[] }
```

(c) `SentenceIndex` gains counts:

```ts
interface SentenceIndex {
  standalone: Map<string, Hook>;
  embedded: Map<string, Hook>;
  /** Qualifying sentences containing the key (standalone OR embedded),
   *  counted once per sentence — the corpus frequency the ranking uses. */
  counts: Map<string, number>;
}
```

In `buildSentenceIndex`, declare `const counts = new Map<string, number>();` beside `standalone`/`embedded`, and inside the candidate loop, immediately after `if (already === true) continue;` and **before** `const standaloneHere = ...`, insert:

```ts
        if (already === undefined) counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
```

(Only the first occurrence of a key in a sentence has `already === undefined`, so each sentence counts once per key regardless of the standalone/embedded upgrade dance below it.) Return `{ standalone, embedded, counts }`.

(d) `attachHooks` returns the counts for the tier pass. Change its signature and destructuring:

```ts
/** Attaches sentence + kanjiParts in place. Both fields stay optional.
 *  Returns the per-key sentence counts for tier ranking (§5.1). */
function attachHooks(cardsByLevel: Map<2 | 3 | 4 | 5, Card[]>): Map<string, number> {
```

with `const { standalone, embedded, counts } = buildSentenceIndex(keys);` and `return counts;` at the end.

(e) New function after `attachHooks`:

```ts
/**
 * Ranks each level descending by (sentence count, jmdict common flag, id) —
 * a TOTAL key, so two builds of identical inputs produce byte-identical
 * tiers — and stamps tier = floor(rank / tierSize) + 1 over the 0-based
 * rank. The common tiebreak exists for the tail: N2 leaves ~640 cards tied
 * at zero count, and `common` splits them meaningfully instead of collapsing
 * to arbitrary id order (§5.1).
 */
function assignTiers(
  cardsByLevel: Map<2 | 3 | 4 | 5, Card[]>,
  counts: Map<string, number>,
  commonById: Map<string, boolean>,
): void {
  for (const cards of cardsByLevel.values()) {
    const ranked = [...cards].sort((a, b) => {
      const countDiff =
        (counts.get(b.kanji ?? b.kana[0]) ?? 0) - (counts.get(a.kanji ?? a.kana[0]) ?? 0);
    if (countDiff !== 0) return countDiff;
      const commonDiff =
        Number(commonById.get(b.id) ?? false) - Number(commonById.get(a.id) ?? false);
      if (commonDiff !== 0) return commonDiff;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    ranked.forEach((card, rank) => {
      card.tier = Math.floor(rank / PLAN.tierSize) + 1;
    });
  }
}
```

(The sort key uses `card.kanji ?? card.kana[0]` — the same key `attachHooks` probes, so counts and sentence-presence agree by construction. In-place mutation matches `attachHooks`' established idiom in this file.)

(f) In `main()`: build `commonById` where cards are created — after `cardById.set(card.id, card);` add:

```ts
    commonById.set(card.id, word.kanji.some((k) => k.common) || word.kana.some((k) => k.common));
```

with `const commonById = new Map<string, boolean>();` declared beside `cardById`. Then replace the bare `attachHooks(cardsByLevel);` call with:

```ts
  const counts = attachHooks(cardsByLevel);
  assignTiers(cardsByLevel, counts, commonById);
```

(g) Bump `LIST_VERSION` to `'jlpt-tanos-jmdict-3.6.2-v2'` (the output shape changed).

- [ ] **Step 5: Update fixtures parsed by `levelFileSchema`**

These stubs feed `levelFileSchema.parse` via the loader, which now requires `tier`:

- `src/data/__tests__/loader.test.ts` — the `card` helper becomes:
  ```ts
  const card = (id: string, jlpt: 5 | 4 | 3 | 2): Card => ({
    id, kanji: '字', kana: ['かな'], gloss: 'g', pos: 'n', jlpt, source: 'jlpt', tier: 1,
  });
  ```
- `src/ui/__tests__/App.replayPlan.test.tsx` — same one-field addition to its `card` factory (`tier: 1`).
- `src/ui/__tests__/App.introFlow.test.tsx` — the identical `card` factory at the top of the file (line ~18): add `tier: 1`. (Its `/api/plan` stub needs nothing — that test REJECTS the plan fetch to exercise the server-absent path.)

Sanity grep — every fetch stub returning a level payload must be covered: `grep -rn "'/data/jlpt-" src` (expected hits: loader.ts itself plus the three test files above).

- [ ] **Step 6: Rebuild the data**

Run: `npm run build:data`  (if it OOMs: `$env:NODE_OPTIONS='--max-old-space-size=4096'; npm run build:data`)
Expected: per-level match logs unchanged from the last build, plus no schema failure (the script hard-validates with `levelFileSchema.parse` before writing — required `tier` is verified here).

Determinism check — run it a second time and confirm identical output:

```powershell
Get-FileHash public/data/jlpt-n*.json | Format-Table Hash, Path
npm run build:data
Get-FileHash public/data/jlpt-n*.json | Format-Table Hash, Path
```

Expected: the four hashes match across the two builds.

- [ ] **Step 7: Verify green**

Run: `npm run check`
Expected: PASS — including the two new invariants and every existing data test against the regenerated files.

- [ ] **Step 8: Commit**

```bash
git add scripts/build-data.ts server/planConfig.ts src/engine/types.ts src/data/schema.ts src/data/__tests__/jlptData.test.ts src/data/__tests__/loader.test.ts src/ui/__tests__/App.introFlow.test.tsx src/ui/__tests__/App.replayPlan.test.tsx public/data/
git commit -m "feat: frequency-ranked tier assignment in the data pipeline"
```

---

### Task 2: DB — `cards.tier` column, migration, seeding

**Files:**
- Modify: `server/db/schema.ts`
- Modify: `server/db/connect.ts` (seedCards upsert)
- Create: `drizzle/0002_*.sql` (via `npm run db:generate` — never hand-write)
- Create: `server/__tests__/tierSeed.test.ts`

**Interfaces:**
- Consumes: Task 1's committed data (`card.tier` present in every level file).
- Produces: `cards.tier` integer column (nullable at the DB layer — custom cards have none), populated for every `source='jlpt'` row on every boot by the existing idempotent `INSERT OR REPLACE`. Task 4 reads it with `SELECT id, jlpt, tier FROM cards`.

- [ ] **Step 1: Write the failing test**

Create `server/__tests__/tierSeed.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { makeTestDb } from '../testDb';

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe('cards.tier seeding', () => {
  it('connect() backfills a valid tier on every jlpt card row — no migration script needed', () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const bad = t.handle.sqlite
      .prepare(`SELECT COUNT(*) AS n FROM cards WHERE source = 'jlpt' AND (tier IS NULL OR tier < 1)`)
      .get() as { n: number };
    expect(bad.n).toBe(0);

    // Contiguity per level: distinct tiers are exactly 1..max.
    for (const level of [5, 4, 3, 2]) {
      const rows = t.handle.sqlite
        .prepare(`SELECT DISTINCT tier FROM cards WHERE source = 'jlpt' AND jlpt = ? ORDER BY tier`)
        .all(level) as { tier: number }[];
      expect(rows[0].tier, `N${level}`).toBe(1);
      expect(rows[rows.length - 1].tier, `N${level}`).toBe(rows.length);
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run server/__tests__/tierSeed.test.ts`
Expected: FAIL — `no such column: tier`.

- [ ] **Step 3: Schema + migration + seed**

`server/db/schema.ts` — add to the `cards` table after `jlpt`:

```ts
  // Frequency tier within the card's JLPT level (tiered-vocab spec §4.1).
  // Nullable at the DB layer: custom cards have no tier.
  tier: integer('tier'),
```

Generate the migration:

Run: `npm run db:generate`
Expected: a new `drizzle/0002_*.sql` containing exactly `ALTER TABLE \`cards\` ADD \`tier\` integer;` — inspect it.

`server/db/connect.ts` — `seedCards` upsert gains the column:

```ts
    `INSERT OR REPLACE INTO cards (id, kanji, kana, gloss, pos, jlpt, tier, source, list_version)
     VALUES (@id, @kanji, @kana, @gloss, @pos, @jlpt, @tier, @source, @listVersion)`,
```

and the row object gains, after `jlpt: card.jlpt,`:

```ts
        tier: card.tier ?? null,
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run server/__tests__/tierSeed.test.ts`
Expected: PASS. Then `npm run check` — full suite green (the migration applies inside every `makeTestDb`, and `INSERT OR REPLACE` backfills on connect exactly as spec §4.1 promises).

- [ ] **Step 5: Commit**

```bash
git add server/db/schema.ts server/db/connect.ts drizzle/ server/__tests__/tierSeed.test.ts
git commit -m "feat: cards.tier column seeded from the committed data on boot"
```

---

### Task 3: Extract `server/cardScoring.ts` (pure move, no behavior change)

M4-A separated planning from statistics deliberately; the planner must not import stats internals. The card-knowledge primitives move to their own module; both sides import from it (spec §5.2).

**Files:**
- Create: `server/cardScoring.ts`
- Modify: `server/statsHelpers.ts` (delete moved code, import instead)
- Modify: `server/stats.ts` (import `groupByCard` from `./cardScoring`)
- Create: `server/__tests__/cardScoring.test.ts`
- Modify: `server/__tests__/statsHelpers.test.ts` (the `groupByCard` block moves out)

**Interfaces:**
- Consumes: `STATS` constants (which stay in `statsConfig.ts` — spec §5.2: the thresholds are card-knowledge config and already golden-tested there).
- Produces, all exported from `server/cardScoring.ts` with signatures unchanged from today's `statsHelpers.ts`:
  - `interface CardAttemptGroup { all: AttemptRow[]; reading: AttemptRow[]; recall: AttemptRow[] }`
  - `groupByCard(attemptsAsc: readonly AttemptRow[]): Map<string, CardAttemptGroup>`
  - `interface DirectionState { learned: boolean; learnedAtMs: number | null; encounters: number; accuracy: number }`
  - `evaluateDirection(attemptsAsc: readonly AttemptRow[]): DirectionState`
  - `cardStrength(allAttemptsAsc: readonly AttemptRow[]): number` — **newly exported** (was module-private; the planner's weakness signal needs it)
  - (`outcomeWeight`, `windowedAccuracy`, `clamp01` move along as private helpers)

- [ ] **Step 1: Create `server/cardScoring.ts`**

Move, verbatim (including doc comments), from `server/statsHelpers.ts`: the `AttemptRow` type alias, `CardAttemptGroup`, `groupByCard`, `DirectionState`, `outcomeWeight`, `windowedAccuracy`, `evaluateDirection`, `clamp01`, and `cardStrength` — with `cardStrength` gaining `export`. File header:

```ts
import { STATS } from './statsConfig';
import type { attempts } from './db/schema';

/**
 * What is known about a card, computed from its attempt history: the
 * grouped per-direction buckets, the learned gate, and the strength score.
 * Extracted from statsHelpers so server/plan.ts and server/stats.ts share
 * one definition of card knowledge without the planner importing stats
 * internals (tiered-vocab spec §5.2). Thresholds stay in statsConfig.
 */

type AttemptRow = typeof attempts.$inferSelect;
```

- [ ] **Step 2: Rewire `statsHelpers.ts`**

Delete the moved code. Add at the top:

```ts
import { cardStrength, evaluateDirection, type CardAttemptGroup, type DirectionState } from './cardScoring';
```

Everything else in the file (`toLevel`, `Level`, `computeCardStats`, `computeLevelRows`, `computeEstimatedLevel`, `computePace`, `computeTrendAndStreak`, `computeLeeches` and their interfaces) stays put. Note `CardComputed.reading/recall` still reference `DirectionState` — hence the type import. Re-export nothing: each consumer imports from the module that owns the code.

- [ ] **Step 3: Rewire `server/stats.ts`**

Its import block currently pulls `groupByCard` from `./statsHelpers`; split it:

```ts
import { groupByCard } from './cardScoring';
import {
  computeCardStats, computeEstimatedLevel, computeLeeches, computeLevelRows, computePace,
  computeTrendAndStreak, toLevel, type Level,
} from './statsHelpers';
```

- [ ] **Step 4: Move the `groupByCard` test**

Create `server/__tests__/cardScoring.test.ts` holding the `describe('groupByCard')` block cut from `statsHelpers.test.ts`, plus a copy of the small `fakeAttempt` helper:

```ts
import { describe, expect, it } from 'vitest';
import { attempts } from '../db/schema';
import { groupByCard } from '../cardScoring';

type AttemptRow = typeof attempts.$inferSelect;

let nextId = 1;
function fakeAttempt(overrides: Partial<AttemptRow> = {}): AttemptRow {
  return {
    id: nextId++,
    runId: 'run-x',
    cardId: 'card-x',
    mode: 'reading',
    outcome: 'kill',
    msToFirstKey: 100,
    msToKill: 900,
    backspaceCount: 0,
    hintShown: false,
    wasTargeted: true,
    airborneCount: 1,
    speedLevel: 1,
    createdAt: 1_000_000,
    ...overrides,
  };
}

describe('groupByCard', () => {
  it('buckets a recognized mode into its direction array; an unrecognized mode lands only in "all"', () => {
    // `mode` is a plain `string` column (no DB-level CHECK constraint) — this exercises the fallthrough
    // when neither 'reading' nor 'recall' matches, rather than assuming the zod-validated ingest path
    // is the only way a row can ever get created.
    const known = fakeAttempt({ cardId: 'c1', mode: 'reading' });
    const corrupt = fakeAttempt({ cardId: 'c1', mode: 'listening' });
    const grouped = groupByCard([known, corrupt]);
    const group = grouped.get('c1')!;
    expect(group.all).toHaveLength(2);
    expect(group.reading).toEqual([known]);
    expect(group.recall).toHaveLength(0);
  });
});
```

Remove that block (and the now-unused `groupByCard` import) from `statsHelpers.test.ts`.

- [ ] **Step 5: Verify the move is behavior-neutral**

Run: `npm run check`
Expected: PASS — in particular `server/__tests__/stats.test.ts` (the golden fixtures) passes untouched, which is the proof this task changed nothing observable.

- [ ] **Step 6: Commit**

```bash
git add server/cardScoring.ts server/statsHelpers.ts server/stats.ts server/__tests__/cardScoring.test.ts server/__tests__/statsHelpers.test.ts
git commit -m "refactor: extract card-knowledge scoring into server/cardScoring"
```

---

### Task 4: Server — tier gate, weighted seen list, extended plan response

`computeRunPlan` derives per-level active tiers and per-card weights. The response gains `seenCards` and `tiers`; **`seenCardIds` stays temporarily** so the client keeps compiling until Tasks 5–6 migrate it (Task 7 removes it).

**Files:**
- Modify: `server/planConfig.ts` (the six remaining knobs)
- Modify: `server/plan.ts` (full rewrite of `computeRunPlan`)
- Modify: `src/shared/api.ts` (`runPlanSchema` + `tierProgressSchema`)
- Modify: `server/__tests__/plan.test.ts` (golden tests)
- Modify: `server/__tests__/planRoutes.test.ts` (fresh-DB expectation changes: 633 new → 10)
- Modify: `src/data/__tests__/planClient.test.ts`, `src/ui/__tests__/App.replayPlan.test.tsx` (stubbed plan responses must satisfy the stricter shared schema; `App.introFlow.test.tsx` needs nothing — it rejects its plan fetch)

**Interfaces:**
- Consumes: `cards.tier` (Task 2), `groupByCard`/`evaluateDirection`/`cardStrength` (Task 3).
- Produces (Tasks 5–7 rely on these exact names):
  - `PLAN` gains: `tierMasteryThreshold: 0.8`, `amnestyMinEncounters: 8`, `reviewWeightFloor: 0.1`, `reviewWeaknessWeight: 0.6`, `reviewStalenessWeight: 0.4`, `reviewStalenessCeilingHours: 72`.
  - `src/shared/api.ts` exports `tierProgressSchema` and `type TierProgress = z.infer<typeof tierProgressSchema>` with fields `{ level: 5|4|3|2; index: number | null; totalTiers: number; size: number; solid: number; amnestied: number }`.
  - `runPlanSchema` = `{ newCardIds: string[]; seenCardIds: string[]; seenCards: { id: string; weight: number }[]; runBudget: number; tiers: TierProgress[] }` (all required).
  - `computeRunPlan(handle, pool, nowMs): RunPlan` where: `newCardIds` ⊆ active tiers ∩ never met; `seenCards` = every pool card with an attempt or introduction, weighted per §3.4; cards in neither are locked; `runBudget` unchanged from M4-A.

- [ ] **Step 1: Add the knobs**

`server/planConfig.ts` — append inside `PLAN` (after `tierSize`):

```ts
  /** A tier passes when solid/(size − amnestied) reaches this (§3.2). */
  tierMasteryThreshold: 0.8,
  /** Pooled encounters after which a still-unsolid card is amnestied out of
   *  the gate's denominator. Duplicates STATS.leechWindow's value ON PURPOSE:
   *  amnesty is a planning decision, and retuning the stats leech window must
   *  not silently move the tier gate (§5.2). */
  amnestyMinEncounters: 8,
  /** Review-draw weight = floor + weakness·w + staleness·w (§3.4). The floor
   *  keeps a perfect card rare but never unreachable. */
  reviewWeightFloor: 0.1,
  reviewWeaknessWeight: 0.6,
  reviewStalenessWeight: 0.4,
  reviewStalenessCeilingHours: 72,
```

- [ ] **Step 2: Extend the shared schema**

`src/shared/api.ts` — replace the `runPlanSchema` block with:

```ts
export const tierProgressSchema = z.object({
  level: z.union([z.literal(5), z.literal(4), z.literal(3), z.literal(2)]),
  /** Active tier for the level, or null when every tier passes. */
  index: z.number().int().positive().nullable(),
  totalTiers: z.number().int().nonnegative(),
  /** size/solid/amnestied describe the ACTIVE tier; all 0 when index is null. */
  size: z.number().int().nonnegative(),
  solid: z.number().int().nonnegative(),
  amnestied: z.number().int().nonnegative(),
});
export type TierProgress = z.infer<typeof tierProgressSchema>;

export const runPlanSchema = z.object({
  newCardIds: z.array(z.string()),
  /** Transitional (M4-D rollout): superseded by seenCards, removed once the
   *  client and e2e read the weighted list. */
  seenCardIds: z.array(z.string()),
  seenCards: z.array(z.object({ id: z.string(), weight: z.number().positive() })),
  runBudget: z.number().int().nonnegative(),
  tiers: z.array(tierProgressSchema),
});
export type RunPlan = z.infer<typeof runPlanSchema>;
```

- [ ] **Step 3: Write the failing golden tests**

Rewrite `server/__tests__/plan.test.ts`. Keep the file header (NOW/HOUR constants, cleanup pattern) and extend `setup()`; then keep the five M4-A budget/membership tests with mechanical field updates, and add the tier/weight suite:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { startOfLocalDay } from '../dates';
import { computeRunPlan } from '../plan';
import { PLAN } from '../planConfig';
import { makeTestDb } from '../testDb';

const NOW = new Date(2026, 7, 1, 12, 0, 0).getTime(); // local noon, Aug 1 2026
const HOUR = 3_600_000;

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function setup() {
  const t = makeTestDb();
  cleanup = t.cleanup;
  const n5Ids = t.handle.sqlite
    .prepare(`SELECT id FROM cards WHERE jlpt = 5 ORDER BY id LIMIT 20`)
    .all() as { id: string }[];
  const tierIds = (level: number, tier: number): string[] =>
    (t.handle.sqlite
      .prepare(`SELECT id FROM cards WHERE source = 'jlpt' AND jlpt = ? AND tier = ? ORDER BY id`)
      .all(level, tier) as { id: string }[]).map((r) => r.id);
  const insertRun = t.handle.sqlite.prepare(
    `INSERT OR IGNORE INTO runs (id, started_at, mode, pool, app_version, list_version)
     VALUES (?, ?, 'reading', 'n5', 'test', 'test')`,
  );
  insertRun.run('run-1', NOW - 30 * 24 * HOUR);
  const attempt = (cardId: string, at: number, outcome: 'kill' | 'miss' = 'kill') =>
    t.handle.sqlite
      .prepare(
        `INSERT INTO attempts (run_id, card_id, mode, outcome, ms_to_first_key, ms_to_kill,
           backspace_count, hint_shown, was_targeted, airborne_count, speed_level, created_at)
         VALUES ('run-1', ?, 'reading', ?, 100, ?, 0, 0, 1, 1, 1, ?)`,
      )
      .run(cardId, outcome, outcome === 'kill' ? 400 : null, at);
  const introduce = (cardId: string, at: number) =>
    t.handle.sqlite
      .prepare(`INSERT OR IGNORE INTO introductions (card_id, run_id, introduced_at) VALUES (?, 'run-1', ?)`)
      .run(cardId, at);
  // 3 recent kills: clears the learned gate (3 encounters, windowed accuracy 1).
  const makeSolid = (cardId: string) => {
    for (let i = 0; i < 3; i++) attempt(cardId, NOW - 2 * HOUR + i * 60_000);
  };
  // 8 misses: >= amnestyMinEncounters pooled encounters, nowhere near solid.
  const makeAmnestied = (cardId: string) => {
    for (let i = 0; i < 8; i++) attempt(cardId, NOW - 2 * HOUR + i * 60_000, 'miss');
  };
  const weightOf = (plan: ReturnType<typeof computeRunPlan>, cardId: string): number => {
    const entry = plan.seenCards.find((s) => s.id === cardId);
    expect(entry, cardId).toBeDefined();
    return entry!.weight;
  };
  return { t, ids: n5Ids.map((r) => r.id), tierIds, attempt, introduce, makeSolid, makeAmnestied, weightOf };
}

describe('computeRunPlan — M4-A budget (unchanged)', () => {
  it("today's introductions spend the daily goal; yesterday's do not", () => {
    const { t, ids, introduce } = setup();
    for (let i = 0; i < 18; i++) introduce(ids[i], NOW - HOUR);
    expect(computeRunPlan(t.handle, 'n5', NOW).runBudget).toBe(2);

    const { t: t2, ids: ids2, introduce: introduce2 } = setup();
    for (let i = 0; i < 18; i++) introduce2(ids2[i], startOfLocalDay(NOW) - 1000);
    expect(computeRunPlan(t2.handle, 'n5', NOW).runBudget).toBe(PLAN.perRunNewCap);
  });

  it('budget floors at zero once the daily goal is exhausted', () => {
    const { t, ids, introduce } = setup();
    for (let i = 0; i < 20; i++) introduce(ids[i], NOW - HOUR);
    expect(computeRunPlan(t.handle, 'n5', NOW).runBudget).toBe(0);
  });

  it('floors at zero when the goal is lowered below what was already introduced today', () => {
    const { t, ids, introduce } = setup();
    for (let i = 0; i < 12; i++) introduce(ids[i], NOW - HOUR);
    t.handle.sqlite.prepare('UPDATE profile SET daily_word_goal = 5 WHERE id = 1').run();
    expect(computeRunPlan(t.handle, 'n5', NOW).runBudget).toBe(0);
  });
});

describe('computeRunPlan — tier gate', () => {
  it('empty history: tier 1 is active and newCardIds is exactly its unmet cards', () => {
    const { t, tierIds } = setup();
    const plan = computeRunPlan(t.handle, 'n5', NOW);
    expect(plan.seenCards).toHaveLength(0);
    expect(plan.seenCardIds).toHaveLength(0);
    expect([...plan.newCardIds].sort()).toEqual([...tierIds(5, 1)].sort());
    expect(plan.newCardIds).toHaveLength(10);
    expect(plan.tiers).toHaveLength(1);
    expect(plan.tiers[0]).toMatchObject({ level: 5, index: 1, size: 10, solid: 0, amnestied: 0 });
    expect(plan.tiers[0].totalTiers).toBeGreaterThan(50); // 633 cards / 10
    expect(plan.runBudget).toBe(PLAN.perRunNewCap);
  });

  it('8/10 solid passes the gate (active moves to tier 2); 7/10 does not', () => {
    const { t, tierIds, makeSolid } = setup();
    const tier1 = tierIds(5, 1);
    for (const id of tier1.slice(0, 7)) makeSolid(id);
    expect(computeRunPlan(t.handle, 'n5', NOW).tiers[0]).toMatchObject({ index: 1, solid: 7 });

    const { t: t2, tierIds: tierIds2, makeSolid: makeSolid2 } = setup();
    for (const id of tierIds2(5, 1).slice(0, 8)) makeSolid2(id);
    const plan = computeRunPlan(t2.handle, 'n5', NOW);
    expect(plan.tiers[0].index).toBe(2);
    expect([...plan.newCardIds].sort()).toEqual([...tierIds2(5, 2)].sort());
  });

  it('an amnestied card leaves the denominator: 7 solid + 2 amnestied + 1 unmet passes (7/8)', () => {
    const { t, tierIds, makeSolid, makeAmnestied } = setup();
    const tier1 = tierIds(5, 1);
    for (const id of tier1.slice(0, 7)) makeSolid(id);
    for (const id of tier1.slice(7, 9)) makeAmnestied(id);
    expect(computeRunPlan(t.handle, 'n5', NOW).tiers[0].index).toBe(2);
  });

  it('an amnestied card never enters the numerator: 6 solid + 2 amnestied + 2 unmet holds (6/8)', () => {
    const { t, tierIds, makeSolid, makeAmnestied } = setup();
    const tier1 = tierIds(5, 1);
    for (const id of tier1.slice(0, 6)) makeSolid(id);
    for (const id of tier1.slice(6, 8)) makeAmnestied(id);
    const plan = computeRunPlan(t.handle, 'n5', NOW);
    expect(plan.tiers[0]).toMatchObject({ index: 1, solid: 6, amnestied: 2 });
  });

  it('a fully amnestied tier passes (denominator 0 — a permanent stall is rejected by design)', () => {
    const { t, tierIds, makeAmnestied } = setup();
    for (const id of tierIds(5, 1)) makeAmnestied(id);
    expect(computeRunPlan(t.handle, 'n5', NOW).tiers[0].index).toBe(2);
  });

  it('newCardIds never contains a card outside the active tier; a far-tier seen card still appears in seenCards', () => {
    const { t, tierIds, attempt } = setup();
    const farId = tierIds(5, 3)[0];
    attempt(farId, NOW - HOUR); // absorbed history: scattered across the ranking (§3.3)
    const plan = computeRunPlan(t.handle, 'n5', NOW);
    const tier1 = new Set(tierIds(5, 1));
    for (const id of plan.newCardIds) expect(tier1.has(id), id).toBe(true);
    expect(plan.newCardIds).not.toContain(farId);
    expect(plan.seenCards.map((s) => s.id)).toContain(farId);
  });

  it('mixed returns one tiers entry per level and unions the four active tiers', () => {
    const { t } = setup();
    const plan = computeRunPlan(t.handle, 'mixed', NOW);
    expect(plan.tiers.map((x) => x.level)).toEqual([5, 4, 3, 2]);
    for (const entry of plan.tiers) expect(entry.index).toBe(1);
    expect(plan.newCardIds).toHaveLength(40); // 10 per level on a fresh DB
  });

  it('an unknown pool yields the empty plan', () => {
    const { t } = setup();
    const unknown = computeRunPlan(t.handle, 'nope', NOW);
    expect(unknown).toEqual({ newCardIds: [], seenCardIds: [], seenCards: [], runBudget: 0, tiers: [] });
  });
});

describe('computeRunPlan — review weights', () => {
  it('an introduced-but-never-attempted card gets the maximum weight (§3.4)', () => {
    const { t, ids, introduce, weightOf } = setup();
    introduce(ids[0], NOW - HOUR);
    const plan = computeRunPlan(t.handle, 'n5', NOW);
    expect(weightOf(plan, ids[0])).toBeCloseTo(
      PLAN.reviewWeightFloor + PLAN.reviewWeaknessWeight + PLAN.reviewStalenessWeight, // 1.1
      10,
    );
  });

  it('an introduced card outweighs a strong, fully stale card', () => {
    const { t, ids, attempt, introduce, weightOf } = setup();
    introduce(ids[0], NOW - HOUR);
    // 5 fast kills, 73h ago: strength ~99 (weakness ~0), staleness capped at 1
    // → weight ~0.1 + 0 + 0.4 = ~0.5.
    for (let i = 0; i < 5; i++) attempt(ids[1], NOW - 73 * HOUR + i * 60_000);
    const plan = computeRunPlan(t.handle, 'n5', NOW);
    expect(weightOf(plan, ids[0])).toBeGreaterThan(weightOf(plan, ids[1]));
    // Pins BOTH weighted terms: floor(0.1) + 0.6·weakness(0.01) + 0.4·staleness(1) = 0.506.
    // Dropping either term moves this to 0.500 / 0.106 and fails.
    expect(weightOf(plan, ids[1])).toBeCloseTo(0.506, 3);
  });

  it('a weak fresh card is weighted by the weakness term (not only the floor)', () => {
    const { t, ids, makeAmnestied, weightOf } = setup();
    makeAmnestied(ids[3]); // 8 misses ending ~2h ago: strength 0 → weakness 1
    const plan = computeRunPlan(t.handle, 'n5', NOW);
    // floor + 0.6·1 + 0.4·staleness(≈0.026) ≈ 0.71 — dominated by the weakness term.
    expect(weightOf(plan, ids[3])).toBeGreaterThan(PLAN.reviewWeightFloor + PLAN.reviewWeaknessWeight);
    expect(weightOf(plan, ids[3])).toBeLessThan(0.8);
  });

  it('the weight floor keeps a strong fresh card strictly positive but rare', () => {
    const { t, ids, attempt, weightOf } = setup();
    for (let i = 0; i < 3; i++) attempt(ids[2], NOW - HOUR + i * 60_000); // strong and fresh
    const plan = computeRunPlan(t.handle, 'n5', NOW);
    expect(weightOf(plan, ids[2])).toBeGreaterThanOrEqual(PLAN.reviewWeightFloor);
    expect(weightOf(plan, ids[2])).toBeLessThan(0.2);
  });

  it('a card with an attempt or an introduction is seen, not new (M4-A, preserved)', () => {
    const { t, tierIds, attempt, introduce } = setup();
    const [a, b] = tierIds(5, 1);
    attempt(a, NOW - HOUR);
    introduce(b, NOW - HOUR);
    const plan = computeRunPlan(t.handle, 'n5', NOW);
    expect(plan.newCardIds).not.toContain(a);
    expect(plan.newCardIds).not.toContain(b);
    expect(plan.seenCardIds).toEqual(expect.arrayContaining([a, b]));
    expect(plan.seenCards.map((s) => s.id)).toEqual(expect.arrayContaining([a, b]));
  });
});
```

Note the `attempt` helper change: it gains an `outcome` parameter (miss rows carry `ms_to_kill NULL`) and the run is inserted 30 days back so attempt timestamps up to 73h ago stay after `started_at`.

- [ ] **Step 4: Run to verify failure**

Run: `npx vitest run server/__tests__/plan.test.ts`
Expected: FAIL — `plan.seenCards`/`plan.tiers` are undefined; type errors on the new fields until Step 5.

- [ ] **Step 5: Rewrite `server/plan.ts`**

Full replacement:

```ts
import { asc, sql } from 'drizzle-orm';
import type { RunPlan, TierProgress } from '../src/shared/api';
import { cardStrength, evaluateDirection, groupByCard, type CardAttemptGroup } from './cardScoring';
import { startOfLocalDay } from './dates';
import { attempts } from './db/schema';
import type { DbHandle } from './db/connect';
import { PLAN } from './planConfig';

type Level = 5 | 4 | 3 | 2;

const POOL_LEVELS: Record<string, Level[]> = {
  n5: [5],
  n4: [4],
  n3: [3],
  n2: [2],
  mixed: [5, 4, 3, 2],
};

/** Pools the planner knows. The route rejects anything else; computeRunPlan
 *  itself stays total, returning an empty plan for an unknown pool. */
export function isKnownPool(pool: string): boolean {
  return Object.hasOwn(POOL_LEVELS, pool);
}

interface PoolCardRow {
  id: string;
  jlpt: number;
  /** Non-null for every source='jlpt' row: seedCards backfills the column
   *  from the committed data on every boot, before any route exists. */
  tier: number;
}

const HOUR_MS = 3_600_000;

/** Card-level knowledge over POOLED attempts (§3.2): one learned-gate pass
 *  over the combined bucket — deliberately the same rule the Stats screen
 *  uses, so the gate and Stats can never disagree about knowing a word. */
function classifyCard(group: CardAttemptGroup | undefined): 'solid' | 'amnestied' | 'neither' {
  if (group === undefined) return 'neither';
  if (evaluateDirection(group.all).learned) return 'solid';
  if (group.all.length >= PLAN.amnestyMinEncounters) return 'amnestied';
  return 'neither';
}

/** §3.4: weight = floor + weakness·w₁ + staleness·w₂, range [0.1, 1.1]. A
 *  card introduced but never attempted has no group and gets the maximum —
 *  it just arrived and has not been tested once. */
function cardWeight(group: CardAttemptGroup | undefined, nowMs: number): number {
  if (group === undefined) {
    return PLAN.reviewWeightFloor + PLAN.reviewWeaknessWeight + PLAN.reviewStalenessWeight;
  }
  const weakness = 1 - cardStrength(group.all) / 100;
  const lastAttemptAt = group.all[group.all.length - 1].createdAt;
  const hoursSince = Math.max(0, (nowMs - lastAttemptAt) / HOUR_MS);
  const staleness = Math.min(1, hoursSince / PLAN.reviewStalenessCeilingHours);
  return (
    PLAN.reviewWeightFloor +
    PLAN.reviewWeaknessWeight * weakness +
    PLAN.reviewStalenessWeight * staleness
  );
}

/** The active tier is DERIVED on every request (§3.3): the lowest tier that
 *  fails the mastery gate. Amnestied cards leave the denominator and never
 *  enter the numerator; a fully amnestied tier (denominator 0) passes. */
function resolveActiveTier(
  levelCards: readonly PoolCardRow[],
  grouped: ReadonlyMap<string, CardAttemptGroup>,
  level: Level,
): { progress: TierProgress; activeCardIds: string[] } {
  const byTier = new Map<number, PoolCardRow[]>();
  for (const card of levelCards) {
    const list = byTier.get(card.tier);
    if (list) list.push(card);
    else byTier.set(card.tier, [card]);
  }
  const tierNumbers = [...byTier.keys()].sort((a, b) => a - b);
  const totalTiers = tierNumbers.length > 0 ? tierNumbers[tierNumbers.length - 1] : 0;

  for (const t of tierNumbers) {
    const cards = byTier.get(t)!;
    let solid = 0;
    let amnestied = 0;
    for (const card of cards) {
      const kind = classifyCard(grouped.get(card.id));
      if (kind === 'solid') solid += 1;
      else if (kind === 'amnestied') amnestied += 1;
    }
    // Gate uses the tier's ACTUAL size (the last tier runs short), never the
    // tierSize constant (§7).
    const denominator = cards.length - amnestied;
    const passes = denominator === 0 || solid / denominator >= PLAN.tierMasteryThreshold;
    if (!passes) {
      return {
        progress: { level, index: t, totalTiers, size: cards.length, solid, amnestied },
        activeCardIds: cards.map((c) => c.id),
      };
    }
  }
  // Every tier passes: the level is complete and produces no new cards.
  // size/solid/amnestied describe the active tier, and there isn't one (§4.3).
  return {
    progress: { level, index: null, totalTiers, size: 0, solid: 0, amnestied: 0 },
    activeCardIds: [],
  };
}

/**
 * What this run may introduce and review. "New" means in an active tier AND
 * never attempted AND never introduced. Every met card returns in seenCards
 * with a review weight; cards in neither list are locked and must not spawn
 * (§5.3). The daily budget is unchanged from M4-A.
 */
export function computeRunPlan(handle: DbHandle, pool: string, nowMs: number): RunPlan {
  const levels = POOL_LEVELS[pool];
  if (!levels) return { newCardIds: [], seenCardIds: [], seenCards: [], runBudget: 0, tiers: [] };

  const placeholders = levels.map(() => '?').join(',');
  const poolCards = handle.sqlite
    .prepare(
      `SELECT id, jlpt, tier FROM cards WHERE source = 'jlpt' AND jlpt IN (${placeholders}) ORDER BY id`,
    )
    .all(...levels) as PoolCardRow[];

  // Full rows ascending — the shape stats.ts loads, with the same defensive
  // <= nowMs filter: a future-dated row would give negative staleness and
  // corrupt the learned window.
  const attemptRows = handle.db
    .select()
    .from(attempts)
    .orderBy(asc(attempts.createdAt))
    .all()
    .filter((a) => a.createdAt <= nowMs);
  const grouped = groupByCard(attemptRows);

  const introduced = new Set<string>();
  for (const row of handle.sqlite.prepare('SELECT card_id AS id FROM introductions').all() as {
    id: string;
  }[]) {
    introduced.add(row.id);
  }

  const tiers: TierProgress[] = [];
  const activeTierIds = new Set<string>();
  for (const level of levels) {
    const levelCards = poolCards.filter((c) => c.jlpt === level);
    const { progress, activeCardIds } = resolveActiveTier(levelCards, grouped, level);
    tiers.push(progress);
    for (const id of activeCardIds) activeTierIds.add(id);
  }

  const newCardIds: string[] = [];
  const seenCardIds: string[] = [];
  const seenCards: { id: string; weight: number }[] = [];
  for (const { id } of poolCards) {
    const group = grouped.get(id);
    if (group !== undefined || introduced.has(id)) {
      seenCardIds.push(id);
      seenCards.push({ id, weight: cardWeight(group, nowMs) });
    } else if (activeTierIds.has(id)) {
      newCardIds.push(id);
    }
    // Neither met nor in an active tier: locked (§5.3) — in no list at all.
  }

  const goal =
    handle.db.get<{ goal: number }>(sql`SELECT daily_word_goal AS goal FROM profile WHERE id = 1`)
      ?.goal ?? 0;
  const introducedToday =
    handle.db.get<{ n: number }>(
      sql`SELECT COUNT(*) AS n FROM introductions WHERE introduced_at >= ${startOfLocalDay(nowMs)}`,
    )?.n ?? 0;

  const runBudget = Math.max(0, Math.min(goal - introducedToday, PLAN.perRunNewCap));
  return { newCardIds, seenCardIds, seenCards, runBudget, tiers };
}
```

- [ ] **Step 6: Update the route test and client stubs to the stricter schema**

`server/__tests__/planRoutes.test.ts` — the happy-path expectation changes (fresh DB now gates intake to tier 1):

```ts
    const parsed = runPlanSchema.parse(await res.json());
    expect(parsed.newCardIds).toHaveLength(10); // tier 1 of N5 — the gate is on
    expect(parsed.tiers).toHaveLength(1);
    expect(parsed.tiers[0].index).toBe(1);
    expect(parsed.runBudget).toBeGreaterThan(0);
```

Client-side stubbed plan responses now flow through the stricter `runPlanSchema` in `fetchRunPlan`, so each stub body gains the two required fields (values mirroring what the real server would say for that fixture):

- `src/data/__tests__/planClient.test.ts` — every stubbed response body, e.g.:
  ```ts
  ok({
    newCardIds: ['a', 'b'], seenCardIds: ['c'],
    seenCards: [{ id: 'c', weight: 1 }],
    tiers: [{ level: 5, index: 1, totalTiers: 64, size: 10, solid: 0, amnestied: 0 }],
    runBudget: 4,
  })
  ```
- `src/ui/__tests__/App.replayPlan.test.tsx` — `stubFetch`'s `plan` parameter type widens and both call sites gain matching fields; give each seen id weight 1:
  ```ts
  stubFetch(pool, {
    newCardIds: ['never-c'], seenCardIds: ['seen-a', 'seen-b'],
    seenCards: [{ id: 'seen-a', weight: 1 }, { id: 'seen-b', weight: 1 }],
    tiers: [{ level: 5, index: 1, totalTiers: 1, size: 1, solid: 0, amnestied: 0 }],
    runBudget: 1,
  });
  ```
  (second call site: same shape with `seenCardIds: ['seen-x']`, `seenCards: [{ id: 'seen-x', weight: 1 }]`.)

- [ ] **Step 7: Run to verify pass**

Run: `npx vitest run server/__tests__/plan.test.ts server/__tests__/planRoutes.test.ts src/data/__tests__/planClient.test.ts`
Expected: PASS. Then `npm run check` — the whole repo compiles and passes (client still reads `seenCardIds`, untouched behavior).

- [ ] **Step 8: Commit**

```bash
git add server/planConfig.ts server/plan.ts src/shared/api.ts server/__tests__/plan.test.ts server/__tests__/planRoutes.test.ts src/data/__tests__/planClient.test.ts src/ui/__tests__/App.replayPlan.test.tsx
git commit -m "feat: plan derives active tiers and weighted review list per request"
```

---

### Task 5: Engine — seen pool from the plan, weighted draw, locked cards

The one correctness change (spec §5.3): `Spawner` stops deriving "seen" by negation. `EnginePlan` carries the weighted list; `drawSeen` becomes a cumulative-weight walk; the starved fallback can only reach the active tier.

**Files:**
- Modify: `src/engine/types.ts` (`EnginePlan` + `SeenCardRef`)
- Modify: `src/engine/Spawner.ts`
- Modify: `src/engine/GameEngine.ts` (no-plan default = all-seen uniform)
- Modify: `src/data/planClient.ts` (`FetchedPlan` carries `seenCards` + `tiers`, drops `seenCardIds`)
- Modify: `src/App.tsx` (`replayPlan`, `noticeFor` call site)
- Modify: `src/engine/__tests__/Spawner.test.ts` (planOf + new tests)
- Modify (mechanical fixture updates): `src/engine/__tests__/GameEngine.test.ts`, `src/ui/__tests__/useEngine.waves.test.tsx`, `src/ui/__tests__/waveIntroSeam.test.tsx`, `src/planNotice.test.ts`, `src/data/__tests__/planClient.test.ts`, `src/ui/__tests__/App.replayPlan.test.tsx`

**Interfaces:**
- Consumes: `runPlanSchema.seenCards` / `.tiers` (Task 4), `TierProgress` from `src/shared/api`.
- Produces (Task 6 relies on these):
  - `src/engine/types.ts`: `export interface SeenCardRef { id: string; weight: number }` and `EnginePlan` = `{ newCardIds: readonly string[]; seenCards: readonly SeenCardRef[]; runBudget: number; perWaveNewCap: number }`.
  - `src/data/planClient.ts`: `FetchedPlan` = `{ newCardIds: readonly string[]; seenCards: readonly SeenCardRef[]; tiers: readonly TierProgress[]; runBudget: number; perWaveNewCap: number }`; `toEnginePlan` drops `tiers`.
  - Spawner invariant: a card in neither `newCardIds` nor `seenCards` never spawns, in any wave, including the starved fallback.

- [ ] **Step 1: Write the failing Spawner tests**

In `src/engine/__tests__/Spawner.test.ts`, update the fixture helpers so every EXISTING test keeps its old meaning — the default `seen` reproduces the negation the old code did, so review-run tests behave identically:

```ts
import type { Card, EnginePlan, SeenCardRef } from '../types';

const planOf = (
  newIds: string[],
  runBudget: number,
  perWaveNewCap = 2,
  // Default preserves M4-A semantics for existing tests: everything not new
  // is seen at uniform weight. New tests pass explicit subsets to create
  // locked cards.
  seen: SeenCardRef[] = pool
    .filter((c) => !newIds.includes(c.id))
    .map((c) => ({ id: c.id, weight: 1 })),
): EnginePlan => ({
  newCardIds: newIds,
  seenCards: seen,
  runBudget,
  perWaveNewCap,
});
```

Then append a new describe block:

```ts
describe('Spawner tier-gate composition (M4-D)', () => {
  it('cards in neither newCardIds nor seenCards are locked and never spawn', () => {
    const s = makeWithPlan(
      planOf(['c0', 'c1'], 6, 2, [{ id: 'c2', weight: 1 }, { id: 'c3', weight: 1 }]),
    );
    const allowed = new Set(['c0', 'c1', 'c2', 'c3']);
    for (let w = 1; w <= 20; w++) {
      for (const card of s.planWave(w).cards) {
        expect(allowed.has(card.id), card.id).toBe(true);
      }
    }
  });

  it('the starved fallback draws only from the active tier, never from locked cards', () => {
    // Zero budget, nothing seen, and 18 locked cards: the fallback may only
    // surface the plan's new (active-tier) cards (spec §7).
    const s = makeWithPlan(planOf(['c0', 'c1'], 0, 2, []));
    const wave = s.planWave(1);
    expect(wave.newCards).toHaveLength(0);
    expect(wave.cards.length).toBeGreaterThan(0);
    for (const card of wave.cards) expect(['c0', 'c1']).toContain(card.id);
  });

  it('the weighted draw favors a heavy card over any light card across many seeded waves', () => {
    const seen = pool.map((c, i) => ({ id: c.id, weight: i === 0 ? 1.1 : 0.1 }));
    const s = makeWithPlan(planOf([], 0, 2, seen), 7);
    let heavyWaves = 0;
    const lightWaves = new Map<string, number>();
    const ROUNDS = 200;
    for (let i = 0; i < ROUNDS; i++) {
      const ids = new Set(s.planWave(1).cards.map((c) => c.id)); // wave 1: 5 draws from 20
      if (ids.has('c0')) heavyWaves += 1;
      for (const id of ids) {
        if (id !== 'c0') lightWaves.set(id, (lightWaves.get(id) ?? 0) + 1);
      }
    }
    // 11x weight → inclusion should dominate every uniform-light competitor.
    for (const [id, count] of lightWaves) {
      expect(heavyWaves, `c0 vs ${id}`).toBeGreaterThan(2 * count);
    }
    expect(heavyWaves).toBeGreaterThan(ROUNDS / 2);
  });

  it('weighted determinism: same seed and same weighted plan produce identical waves', () => {
    const seen = pool.map((c, i) => ({ id: c.id, weight: 0.1 + (i % 5) * 0.25 }));
    const a = makeWithPlan(planOf(['c0'], 1, 1, seen), 11);
    const b = makeWithPlan(planOf(['c0'], 1, 1, seen), 11);
    for (let w = 1; w <= 3; w++) {
      expect(a.planWave(w).cards.map((c) => c.id)).toEqual(b.planWave(w).cards.map((c) => c.id));
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/engine/__tests__/Spawner.test.ts`
Expected: FAIL — compile error (`seenCards` not in `EnginePlan`), which is the red state for a type-driven change.

- [ ] **Step 3: Engine types**

`src/engine/types.ts` — add above `EnginePlan` and extend it:

```ts
/** A reviewable card and its draw weight, computed by the server (§3.4).
 *  Weights are relative odds; the engine never interprets their scale. */
export interface SeenCardRef {
  id: string;
  weight: number;
}

/** What this run may introduce and review. Injected — the engine never derives it. */
export interface EnginePlan {
  newCardIds: readonly string[];
  /** The complete reviewable set. Pool cards in NEITHER list are locked and
   *  must never spawn (§5.3): with a tier gate, "not new" no longer implies
   *  "met". */
  seenCards: readonly SeenCardRef[];
  runBudget: number;
  perWaveNewCap: number;
}
```

- [ ] **Step 4: Rewrite `Spawner`'s pools and draw**

`src/engine/Spawner.ts` — replace the class internals (planWave's size/speed/interval math, `pickLane`, and `shuffled` stay as they are):

```ts
import { LANES } from './constants';
import type { Card, EngineConfig, EnginePlan } from './types';

export interface WavePlan {
  cards: Card[];
  /** Subset of `cards` being introduced this wave; they lead `cards`. */
  newCards: Card[];
  fallSpeed: number;
  spawnIntervalMs: number;
}

interface WeightedCard {
  card: Card;
  weight: number;
}

/**
 * Mirrors the server's maximum review weight — reviewWeightFloor +
 * reviewWeaknessWeight + reviewStalenessWeight in server/planConfig.ts,
 * which is the source of truth (same deliberate duplication as
 * PER_WAVE_NEW_CAP in src/data/planClient.ts). A card introduced mid-run
 * has no server-computed weight yet; §3.4 gives just-arrived cards the
 * maximum so the introduce → reuse gap stays short.
 */
const JUST_INTRODUCED_WEIGHT = 1.1;

export class Spawner {
  private readonly rng: () => number;
  private readonly config: EngineConfig;
  private newPool: Card[];
  private seenPool: WeightedCard[];
  private budgetRemaining: number;
  private readonly perWaveNewCap: number;

  constructor(pool: Card[], rng: () => number, config: EngineConfig, plan: EnginePlan) {
    this.rng = rng;
    this.config = config;
    const newIds = new Set(plan.newCardIds);
    this.newPool = pool.filter((c) => newIds.has(c.id));
    // Seen comes from the plan's explicit list, never by negation: with the
    // tier gate, "not new" no longer implies "met", and cards in neither
    // list are locked out of every draw below (§5.3).
    const weightById = new Map(plan.seenCards.map((s) => [s.id, s.weight]));
    this.seenPool = pool.flatMap((c) => {
      const weight = weightById.get(c.id);
      return weight === undefined ? [] : [{ card: c, weight }];
    });
    this.budgetRemaining = Math.max(0, plan.runBudget);
    this.perWaveNewCap = Math.max(0, plan.perWaveNewCap);
  }

  planWave(wave: number): WavePlan {
    const c = this.config;
    const size = Math.min(c.baseWaveSize + c.waveSizeGrowth * (wave - 1), c.maxWaveSize);

    const introduceCount = Math.min(this.budgetRemaining, this.perWaveNewCap, this.newPool.length, size);
    const newCards = this.shuffled(this.newPool).slice(0, introduceCount);
    const introducedIds = new Set(newCards.map((card) => card.id));
    this.newPool = this.newPool.filter((card) => !introducedIds.has(card.id));
    this.budgetRemaining -= newCards.length;

    // Introduced cards join the seen pool immediately - before this wave's
    // own remainder is drawn, not just for later waves. Otherwise, on a
    // fresh run's wave 1, the seen pool is still empty at the moment the
    // remainder is chosen and drawSeen falls back to still-un-introduced
    // cards to fill it, letting them fall with no acquisition ceremony and
    // (once an attempt is recorded) no way back (spec §3.1/§3.2). They
    // carry the just-introduced maximum weight (§3.4).
    this.seenPool = [
      ...this.seenPool,
      ...newCards.map((card) => ({ card, weight: JUST_INTRODUCED_WEIGHT })),
    ];

    const cards = [...newCards, ...this.drawSeen(size - newCards.length)];

    return {
      cards,
      newCards,
      fallSpeed: Math.min(c.baseFallSpeed * (1 + c.fallSpeedGrowth * (wave - 1)), c.maxFallSpeed),
      spawnIntervalMs: Math.max(
        Math.round(c.baseSpawnIntervalMs * c.spawnIntervalDecay ** (wave - 1)),
        c.minSpawnIntervalMs,
      ),
    };
  }

  /**
   * Fills the rest of a wave from the weighted seen pool: sampling without
   * replacement while the pool covers the remainder, refilling (repeats)
   * when it does not — M4-A's behavior, preserved (§5.3).
   *
   * Falls back to still-un-introduced cards only in the genuine starved
   * case: seenPool is empty and this wave introduced nothing either. The
   * fallback draws from newPool ONLY — which the plan restricts to the
   * active tier — at uniform weight (none of them has ever been attempted).
   * Locked cards are in neither pool and can never reach this draw (§7).
   * The fallback does not remove those cards from newPool or mark them
   * introduced, so a later run with real budget can still give them a
   * proper acquisition moment.
   */
  private drawSeen(count: number): Card[] {
    if (count <= 0) return [];
    const source: readonly WeightedCard[] =
      this.seenPool.length > 0
        ? this.seenPool
        : this.newPool.map((card) => ({ card, weight: 1 }));
    if (source.length === 0) return [];
    const drawn: Card[] = [];
    let candidates: readonly WeightedCard[] = source;
    while (drawn.length < count) {
      if (candidates.length === 0) candidates = source; // repeats once exhausted
      const picked = this.pickWeighted(candidates);
      drawn.push(candidates[picked].card);
      candidates = candidates.filter((_, i) => i !== picked);
    }
    return drawn;
  }

  /** Cumulative-weight walk over the injected seeded RNG (§5.3). */
  private pickWeighted(candidates: readonly WeightedCard[]): number {
    let total = 0;
    for (const c of candidates) total += c.weight;
    let roll = this.rng() * total;
    for (let i = 0; i < candidates.length; i++) {
      roll -= candidates[i].weight;
      if (roll < 0) return i;
    }
    return candidates.length - 1; // float-edge fallback
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

- [ ] **Step 5: GameEngine's no-plan default**

`src/engine/GameEngine.ts` — the default plan becomes "everything seen at uniform weight" (spec §7: server down ⇒ no gate, uniform draw, play proceeds). Replace the `const plan` line (note it must come AFTER `pool` is computed, which it already does):

```ts
    // No plan (server unavailable) means nothing counts as new AND nothing is
    // locked: every card is review-eligible at uniform weight — no ceremonies,
    // no budget, no gate, ordinary play. Gameplay never depends on the API (§7).
    const plan: EnginePlan = opts.plan ?? {
      newCardIds: [],
      seenCards: pool.map((c) => ({ id: c.id, weight: 1 })),
      runBudget: 0,
      perWaveNewCap: 0,
    };
```

- [ ] **Step 6: planClient carries the weighted list and tiers**

`src/data/planClient.ts` — full replacement:

```ts
import type { EnginePlan, SeenCardRef } from '../engine/types';
import { runPlanSchema, type TierProgress } from '../shared/api';

/**
 * Mirrors `PLAN.perWaveNewCap` in server/planConfig.ts, which is the source of
 * truth. The client cannot import from server/, and the plan endpoint returns
 * budget rather than pacing, so this one number is duplicated deliberately.
 */
const PER_WAVE_NEW_CAP = 2;

/**
 * Everything the plan endpoint gives the client: the engine's plan shape
 * (`newCardIds`/`seenCards`/`runBudget`/`perWaveNewCap`) plus `tiers`, which
 * the engine has no use for but the UI needs for the setup screen's tier
 * progress and the run notice (tiered-vocab spec §5.4). Kept separate from
 * `EnginePlan` so the engine's contract stays exactly what Spawner needs and
 * nothing more.
 */
export interface FetchedPlan {
  newCardIds: readonly string[];
  seenCards: readonly SeenCardRef[];
  tiers: readonly TierProgress[];
  runBudget: number;
  perWaveNewCap: number;
}

/**
 * The run plan, or null when it can't be had. Never throws and never blocks
 * play: a null plan means "nothing is new", i.e. no ceremonies and ordinary
 * gameplay (spec §7).
 */
export async function fetchRunPlan(pool: string): Promise<FetchedPlan | null> {
  try {
    const response = await fetch(`/api/plan?pool=${pool}`);
    if (!response.ok) return null;
    const plan = runPlanSchema.parse(await response.json());
    return {
      newCardIds: plan.newCardIds,
      seenCards: plan.seenCards,
      tiers: plan.tiers,
      runBudget: plan.runBudget,
      perWaveNewCap: PER_WAVE_NEW_CAP,
    };
  } catch {
    return null;
  }
}

/** Narrows a `FetchedPlan` down to exactly what the engine is allowed to see. */
export function toEnginePlan(fetched: FetchedPlan): EnginePlan {
  return {
    newCardIds: fetched.newCardIds,
    seenCards: fetched.seenCards,
    runBudget: fetched.runBudget,
    perWaveNewCap: fetched.perWaveNewCap,
  };
}
```

`src/data/__tests__/planClient.test.ts` — expectations update: `plan!.seenCards` passthrough equals the stub's list; the narrowing test becomes "toEnginePlan narrows away tiers":

```ts
  it('toEnginePlan narrows away tiers', () => {
    const engine = toEnginePlan({
      newCardIds: ['a'],
      seenCards: [{ id: 'b', weight: 0.5 }],
      tiers: [{ level: 5, index: 1, totalTiers: 64, size: 10, solid: 0, amnestied: 0 }],
      runBudget: 1,
      perWaveNewCap: 2,
    });
    expect(engine).toEqual({
      newCardIds: ['a'], seenCards: [{ id: 'b', weight: 0.5 }], runBudget: 1, perWaveNewCap: 2,
    });
    expect(engine).not.toHaveProperty('tiers');
  });
```

- [ ] **Step 7: App replay wiring**

`src/App.tsx` — `replayPlan` now needs the seen list; the original plan supplies it, unioned with the cards introduced DURING the run (App tracks them via the existing `onIntroduced` callback in an `introducedIdsRef`, cleared only in `beginFromPool` so repeated replays keep seeing them). Without the union, a first-ever run's replay has an empty seen pool and the starved fallback burns the ceremonies of the cards it never reached. A null original (server was down) reproduces the engine's own all-seen default. Replace the function and its two call sites:

```ts
/**
 * A zero-budget plan preserving the ORIGINAL run's newCardIds AND weighted
 * seenCards. newCardIds parks genuinely-unmet cards out of reach (the
 * CRITICAL replay bug M4-A fixed), and seenCards is now the ONLY source of
 * the review pool — cards in neither list are locked (tiered-vocab spec
 * §5.3), so a replay must restate the original seen list or nothing could
 * spawn at all.
 *
 * A null original means the original run itself had no plan (server down):
 * every pool card was review-eligible at uniform weight, and the replay
 * keeps exactly that.
 */
function replayPlan(
  original: EnginePlan | null,
  pool: readonly Card[],
  introducedThisRun: ReadonlySet<string>,
): EnginePlan {
  if (original === null) {
    return {
      newCardIds: [],
      seenCards: pool.map((c) => ({ id: c.id, weight: 1 })),
      runBudget: 0,
      perWaveNewCap: 0,
    };
  }
  // Cards introduced DURING the run are genuinely met — the run-start
  // snapshot predates them, and without this union a first-ever run's
  // replay has an empty seen pool and the starved fallback burns the
  // ceremonies of the cards it never reached. Weight 1: a fresh plan
  // reweights them properly server-side; here they just need to be
  // ordinarily drawable.
  const alreadySeen = new Set(original.seenCards.map((s) => s.id));
  const introduced = [...introducedThisRun]
    .filter((id) => !alreadySeen.has(id))
    .map((id) => ({ id, weight: 1 }));
  return {
    newCardIds: original.newCardIds,
    seenCards: [...original.seenCards, ...introduced],
    runBudget: 0,
    perWaveNewCap: 0,
  };
}
```

Call sites (the long explanatory comments above each stay as they are):
- `onRevenge`: `replayPlan(lastPlanRef.current, missed, introducedIdsRef.current)`
- `onPlayAgain`: `replayPlan(lastPlanRef.current, lastRunRef.current.cards, introducedIdsRef.current)`

And the notice call in `beginFromPool` switches its emptiness source (same semantics — the ids and the weighted list cover the same cards):

```ts
      const notice = noticeFor(plan, fetched !== null && fetched.seenCards.length === 0);
```

- [ ] **Step 8: Mechanical fixture updates**

Every remaining `EnginePlan` literal gains `seenCards` (grep: `perWaveNewCap` across `src/`):
- `src/ui/__tests__/useEngine.waves.test.tsx` and `src/ui/__tests__/waveIntroSeam.test.tsx`: `const PLAN: EnginePlan = { newCardIds: ['neko', 'inu'], seenCards: [], runBudget: 2, perWaveNewCap: 2 };` (their card arrays contain ONLY the two new cards, so an empty seen list preserves behavior exactly).
- `src/engine/__tests__/GameEngine.test.ts` line ~460: `plan: { newCardIds: cards.map((c) => c.id), seenCards: [], runBudget: 1, perWaveNewCap: 1 }`.
- `src/planNotice.test.ts` `planOf`: add `seenCards: []` (signature otherwise untouched — noticeFor is rewritten in Task 6).
- `src/ui/__tests__/App.replayPlan.test.tsx`: the two inline fallback objects `{ newCardIds: [], runBudget: 0, perWaveNewCap: 0 }` gain `seenCards: []`.

- [ ] **Step 9: Run to verify pass**

Run: `npx vitest run src/engine/__tests__/Spawner.test.ts`
Expected: PASS — all four new tests and every M4-A composition test.

Then: `npm run check`
Expected: PASS. Pay attention to `App.replayPlan.test.tsx` — it drives the REAL Spawner through the replay path and is the regression proof that the negation removal didn't break replays.

- [ ] **Step 10: Commit**

```bash
git add src/engine/types.ts src/engine/Spawner.ts src/engine/GameEngine.ts src/data/planClient.ts src/App.tsx src/engine/__tests__/Spawner.test.ts src/engine/__tests__/GameEngine.test.ts src/ui/__tests__/useEngine.waves.test.tsx src/ui/__tests__/waveIntroSeam.test.tsx src/planNotice.test.ts src/data/__tests__/planClient.test.ts src/ui/__tests__/App.replayPlan.test.tsx
git commit -m "feat: engine consumes the weighted seen list; locked cards never spawn"
```

---

### Task 6: Client — tier-aware notices + setup-screen tier progress

**Files:**
- Modify: `src/planNotice.ts` (new signature over `FetchedPlan`)
- Modify: `src/planNotice.test.ts` (rewrite)
- Modify: `src/App.tsx` (call site)
- Modify: `src/ui/screens/SetupScreen.tsx`
- Create: `src/ui/__tests__/SetupScreen.tiers.test.tsx`

**Interfaces:**
- Consumes: `FetchedPlan` (Task 5), `fetchRunPlan`, `TierProgress`.
- Produces: `noticeFor(fetched: FetchedPlan | null): string | null` implementing spec §5.4's five cases with precedence plan-unavailable → starved → level-complete → tier-gated → budget-exhausted; SetupScreen renders per-level tier progress under `data-testid="tier-progress"`.

- [ ] **Step 1: Rewrite the notice tests (failing)**

`src/planNotice.test.ts` — full replacement:

```ts
import { describe, expect, it } from 'vitest';
import type { FetchedPlan } from './data/planClient';
import type { TierProgress } from './shared/api';
import { noticeFor } from './planNotice';

const tier = (over: Partial<TierProgress> = {}): TierProgress => ({
  level: 5, index: 1, totalTiers: 64, size: 10, solid: 0, amnestied: 0, ...over,
});

const fetchedOf = (over: Partial<FetchedPlan> = {}): FetchedPlan => ({
  newCardIds: [], seenCards: [], runBudget: 0, perWaveNewCap: 2, tiers: [tier()], ...over,
});

describe('noticeFor (spec §5.4)', () => {
  it('no plan: server-absent notice', () => {
    expect(noticeFor(null)).toBe('Word introductions need the server — playing without them.');
  });

  it('budget remaining with eligible new cards: no notice', () => {
    expect(noticeFor(fetchedOf({ newCardIds: ['a'], runBudget: 3 }))).toBeNull();
    expect(
      noticeFor(fetchedOf({ newCardIds: ['a'], runBudget: 3, seenCards: [{ id: 'b', weight: 1 }] })),
    ).toBeNull();
  });

  it('starved pool: budget spent, new cards exist, nothing ever met (§3.2)', () => {
    expect(noticeFor(fetchedOf({ newCardIds: ['a'], runBudget: 0 }))).toBe(
      "Today's new words are done, and you haven't met anything in this pool yet — playing without introductions.",
    );
  });

  it('budget exhausted with history: ordinary review notice', () => {
    expect(
      noticeFor(fetchedOf({ newCardIds: ['a'], runBudget: 0, seenCards: [{ id: 'b', weight: 1 }] })),
    ).toBe("Today's new words are done — this run is review.");
  });

  it('level complete (single-level pool): every tier cleared', () => {
    const plan = fetchedOf({
      runBudget: 3,
      seenCards: [{ id: 'b', weight: 1 }],
      tiers: [tier({ index: null, size: 0 })],
    });
    expect(noticeFor(plan)).toBe("You've cleared every N5 tier — this run is review.");
  });

  it('level complete (mixed): generic copy once ALL levels are done', () => {
    const plan = fetchedOf({
      seenCards: [{ id: 'b', weight: 1 }],
      tiers: [
        tier({ level: 5, index: null, size: 0 }),
        tier({ level: 4, index: null, size: 0 }),
        tier({ level: 3, index: null, size: 0 }),
        tier({ level: 2, index: null, size: 0 }),
      ],
    });
    expect(noticeFor(plan)).toBe("You've cleared every tier in this pool — this run is review.");
  });

  it('tier gated beats budget exhausted: structural reasons outrank temporal ones', () => {
    // Active tier fully introduced (no eligible new), gate not passed, AND
    // budget spent: the gate message is the honest one — "more tomorrow"
    // would be false (§5.4 precedence).
    const plan = fetchedOf({
      runBudget: 0,
      seenCards: [{ id: 'b', weight: 1 }],
      tiers: [tier({ index: 4, solid: 6 })],
    });
    expect(noticeFor(plan)).toBe("Tier 4 isn't solid yet — this run is review.");
    // Same structural state with budget remaining: same message.
    expect(noticeFor(fetchedOf({
      runBudget: 3,
      seenCards: [{ id: 'b', weight: 1 }],
      tiers: [tier({ index: 4, solid: 6 })],
    }))).toBe("Tier 4 isn't solid yet — this run is review.");
  });

  it('tier gated in mixed names the first gated level', () => {
    const plan = fetchedOf({
      seenCards: [{ id: 'b', weight: 1 }],
      tiers: [
        tier({ level: 5, index: null, size: 0 }),
        tier({ level: 4, index: 2 }),
        tier({ level: 3, index: 1 }),
        tier({ level: 2, index: 1 }),
      ],
    });
    expect(noticeFor(plan)).toBe("N4 tier 2 isn't solid yet — this run is review.");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/planNotice.test.ts`
Expected: FAIL — signature mismatch.

- [ ] **Step 3: Rewrite `src/planNotice.ts`**

```ts
import type { FetchedPlan } from './data/planClient';

/**
 * What to tell the player about this run's new-word situation (tiered-vocab
 * spec §5.4). The gate makes "no new words" far more common than under
 * M4-A, and the REASON matters — so the structural cases (level complete,
 * tier gated) outrank the temporal ones (budget spent today): "today's new
 * words are done" implies tomorrow brings more, and when the gate is also
 * shut that is false.
 *
 * Precedence: plan-unavailable → starved → level-complete → tier-gated →
 * budget-exhausted. Starved requires eligible new cards while the two
 * structural cases require none, so the branches below are disjoint and
 * order-safe.
 */
export function noticeFor(fetched: FetchedPlan | null): string | null {
  if (fetched === null) return 'Word introductions need the server — playing without them.';

  const hasNew = fetched.newCardIds.length > 0;
  const seenIsEmpty = fetched.seenCards.length === 0;

  // Starved pool (§3.2): budget spent, unmet cards exist, but NOTHING in the
  // pool has ever been met — brand-new cards are about to fall with no
  // ceremony, a materially different situation from ordinary review.
  if (fetched.runBudget === 0 && hasNew && seenIsEmpty) {
    return "Today's new words are done, and you haven't met anything in this pool yet — playing without introductions.";
  }

  if (!hasNew) {
    if (fetched.tiers.length === 0) return null; // defensive: no tier info at all
    // The server emits tiers in pool order, but that is an implementation
    // detail — sort by level so "first gated" means the earliest-learned
    // level (N5 before N2) whatever order the array arrived in.
    const byLevel = [...fetched.tiers].sort((a, b) => b.level - a.level);
    const gated = byLevel.find((t) => t.index !== null);
    if (gated === undefined) {
      // Every level in the pool has cleared every tier.
      const label =
        byLevel.length === 1 ? `every N${byLevel[0].level} tier` : 'every tier in this pool';
      return `You've cleared ${label} — this run is review.`;
    }
    // Active tier fully introduced but not yet solid.
    const where =
      byLevel.length === 1 ? `Tier ${gated.index}` : `N${gated.level} tier ${gated.index}`;
    return `${where} isn't solid yet — this run is review.`;
  }

  if (fetched.runBudget === 0) return "Today's new words are done — this run is review.";
  return null;
}
```

- [ ] **Step 4: Update the App call site**

`src/App.tsx` in `beginFromPool`:

```ts
      const notice = noticeFor(fetched);
```

(The `seenIsEmpty` second argument is gone; replay paths keep using `REPLAY_NOTICE` directly, unchanged.)

- [ ] **Step 5: Run notice tests to verify pass**

Run: `npx vitest run src/planNotice.test.ts`
Expected: PASS.

- [ ] **Step 6: Setup-screen tier progress (failing test first)**

(Amended after review: `stubPlanFetch` must be POOL-AWARE — keyed by the `pool` query param, rejecting unstubbed pools — and the mixed test must assert a line only the mixed payload produces AFTER clicking `pool-mixed`, so a broken `[pool]` effect dependency fails the test. The notice tests additionally include a shuffled-tier-order case pinning noticeFor's level sort.)

Create `src/ui/__tests__/SetupScreen.tiers.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SetupScreen } from '../screens/SetupScreen';

const noop = () => {};

function stubPlanFetch(tiers: unknown[]) {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (String(url).includes('/api/plan')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ newCardIds: [], seenCardIds: [], seenCards: [], runBudget: 0, tiers }),
      } as Response);
    }
    return Promise.reject(new Error(`unhandled fetch: ${url}`));
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('SetupScreen tier progress (spec §5.4)', () => {
  it('renders the selected pool\'s active-tier line', async () => {
    stubPlanFetch([{ level: 5, index: 4, totalTiers: 64, size: 10, solid: 6, amnestied: 0 }]);
    render(<SetupScreen loading={false} error={null} onBegin={noop} onBack={noop} />);
    await waitFor(() =>
      expect(screen.getByTestId('tier-progress')).toHaveTextContent('N5 · Tier 4 of 64 — 6/10 solid'),
    );
  });

  it('renders the cleared form when a level has no active tier', async () => {
    stubPlanFetch([{ level: 5, index: null, totalTiers: 64, size: 0, solid: 0, amnestied: 0 }]);
    render(<SetupScreen loading={false} error={null} onBegin={noop} onBack={noop} />);
    await waitFor(() =>
      expect(screen.getByTestId('tier-progress')).toHaveTextContent('N5 · All 64 tiers cleared'),
    );
  });

  it('renders one line per level for the mixed pool', async () => {
    stubPlanFetch([
      { level: 5, index: 2, totalTiers: 64, size: 10, solid: 3, amnestied: 1 },
      { level: 4, index: 1, totalTiers: 62, size: 10, solid: 0, amnestied: 0 },
      { level: 3, index: 1, totalTiers: 145, size: 10, solid: 0, amnestied: 0 },
      { level: 2, index: 1, totalTiers: 168, size: 10, solid: 0, amnestied: 0 },
    ]);
    const { getByTestId } = render(
      <SetupScreen loading={false} error={null} onBegin={noop} onBack={noop} />,
    );
    getByTestId('pool-mixed').click();
    await waitFor(() => {
      const text = getByTestId('tier-progress').textContent ?? '';
      expect(text).toContain('N5 · Tier 2 of 64 — 3/10 solid');
      expect(text).toContain('N2 · Tier 1 of 168');
    });
  });

  it('shows nothing when the plan cannot be fetched (server down never blocks setup)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    render(<SetupScreen loading={false} error={null} onBegin={noop} onBack={noop} />);
    await waitFor(() => expect(screen.queryByTestId('tier-progress')).toBeNull());
  });
});
```

Run: `npx vitest run src/ui/__tests__/SetupScreen.tiers.test.tsx` — expected FAIL (no such testid).

- [ ] **Step 7: Implement the SetupScreen addition**

`src/ui/screens/SetupScreen.tsx` — add imports and state; the fetch is display-only (the authoritative plan is re-fetched at Begin by `beginFromPool`):

```tsx
import { useEffect, useState } from 'react';
import { POOL_LABELS, type PoolId } from '../../data/loader';
import { fetchRunPlan } from '../../data/planClient';
import type { GameMode } from '../../engine/types';
import type { TierProgress } from '../../shared/api';
```

Inside the component, after the existing `pool` state:

```tsx
  // Display-only tier progress for the highlighted pool (spec §5.4). Begin
  // re-fetches the authoritative plan; server-down simply shows nothing.
  const [tiers, setTiers] = useState<readonly TierProgress[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    setTiers(null);
    void fetchRunPlan(pool).then((fetched) => {
      if (!cancelled) setTiers(fetched?.tiers ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [pool]);
```

Between the pool picker row and the error paragraph, render:

```tsx
      {tiers !== null && tiers.length > 0 && (
        <div className="tier-progress" data-testid="tier-progress">
          {tiers.map((t) => (
            <p key={t.level} className="hint">
              {t.index === null
                ? `N${t.level} · All ${t.totalTiers} tiers cleared`
                : `N${t.level} · Tier ${t.index} of ${t.totalTiers} — ${t.solid}/${t.size} solid`}
            </p>
          ))}
        </div>
      )}
```

- [ ] **Step 8: Run to verify pass, then the whole suite**

Run: `npx vitest run src/ui/__tests__/SetupScreen.tiers.test.tsx` — PASS.
Run: `npm run check` — PASS.

- [ ] **Step 9: Commit**

```bash
git add src/planNotice.ts src/planNotice.test.ts src/App.tsx src/ui/screens/SetupScreen.tsx src/ui/__tests__/SetupScreen.tiers.test.tsx
git commit -m "feat: tier-aware run notices and setup-screen tier progress"
```

---

### Task 7: Cleanup — drop `seenCardIds`, e2e through the gate, doc amendment

**Files:**
- Modify: `src/shared/api.ts` (remove transitional `seenCardIds`)
- Modify: `server/plan.ts` (stop emitting it)
- Modify: `server/__tests__/plan.test.ts` (remove its assertions)
- Modify: `e2e/game.spec.ts` (`PlanResponse` reads `seenCards`)
- Modify: `src/ui/__tests__/SetupScreen.tiers.test.tsx`, and any other stub still sending `seenCardIds` (grep)
- Modify: `docs/superpowers/specs/2026-07-22-kotoba-drop-design.md` (§1 amendment per tiered spec §9)
- Modify: `docs/superpowers/specs/2026-07-27-tiered-vocabulary-design.md` (status line)

**Interfaces:**
- Consumes: everything above.
- Produces: final `runPlanSchema` = `{ newCardIds, seenCards, runBudget, tiers }`; e2e keystone test passing against the gated server.

- [ ] **Step 1: Remove the transitional field**

Grep first — every reader and writer must go in this one commit: `grep -rn "seenCardIds" src server e2e`

- `src/shared/api.ts`: delete the `seenCardIds` line and its comment from `runPlanSchema`.
- `server/plan.ts`: delete the `seenCardIds` array, its pushes, and its two appearances in return values (unknown-pool early return and the final return).
- `server/__tests__/plan.test.ts`: delete the `seenCardIds` expectations (`toHaveLength(0)` in the empty-history test; the `arrayContaining` line in the seen-not-new test; the field in the unknown-pool `toEqual`).
- Test stubs still carrying the field (at minimum `SetupScreen.tiers.test.tsx`, `planClient.test.ts`, `App.replayPlan.test.tsx`): remove it. (`App.introFlow.test.tsx` never sends a plan body — it rejects the fetch.)

- [ ] **Step 2: e2e reads the weighted list**

`e2e/game.spec.ts`:

```ts
/** Shape of GET /api/plan?pool=... that matters to these specs (server/plan.ts). */
interface PlanResponse {
  newCardIds: string[];
  seenCards: { id: string; weight: number }[];
}
```

- Line ~115: `expect(before.seenCards).toHaveLength(0); // globalSetup wiped the e2e DB`
- The introduction-persistence poll: `return plan.seenCards.length;` (and its comment's `seenCardIds` mention becomes `seenCards`).

The rest of the keystone test is untouched on purpose — spec §8: a wiped database means tier 1 is active and every ceremony/attempt assertion behaves exactly as before.

- [ ] **Step 3: Full verification**

Run: `npm run check`
Expected: PASS, zero `seenCardIds` matches left (`grep -rn "seenCardIds" src server e2e` → nothing).

Run the e2e (builds nothing; uses the dev servers):
```powershell
npm run e2e
```
Expected: both specs PASS. If `dismissIntroAndKillFirstWord` stalls, check that the ceremony still appears (fresh DB → 10 tier-1 cards new → wave 1 introduces up to 2) before debugging deeper.

- [ ] **Step 4: Doc amendments (tiered spec §9)**

`docs/superpowers/specs/2026-07-22-kotoba-drop-design.md`:

1. In §1, replace the sentence `This app deliberately does not implement its own SRS.` with:

> The game does not schedule reviews — no due dates, intervals, or ease factors, and no card-level scheduling state. It does *prioritize* them: intake is gated to a frequency-ordered tier, and the review draw is weighted by how weak and how stale each card is (see `2026-07-27-tiered-vocabulary-design.md`). Scheduling proper remains n2-prep's job.

2. In the §1 non-goals list, replace `- Any spaced-repetition scheduling. Analytics are descriptive, not prescriptive.` with:

```
- Any spaced-repetition *scheduling* — no due dates, intervals, or ease factors. Review is prioritized (weakness × staleness), never scheduled; see the tiered-vocabulary spec.
```

`docs/superpowers/specs/2026-07-27-tiered-vocabulary-design.md`: change the status line to `**Status:** Implemented — see docs/superpowers/plans/2026-08-07-tiered-vocabulary.md`.

- [ ] **Step 5: Commit**

```bash
git add src/shared/api.ts server/plan.ts server/__tests__/plan.test.ts e2e/game.spec.ts src/ui/__tests__/SetupScreen.tiers.test.tsx src/data/__tests__/planClient.test.ts src/ui/__tests__/App.replayPlan.test.tsx docs/superpowers/specs/2026-07-22-kotoba-drop-design.md docs/superpowers/specs/2026-07-27-tiered-vocabulary-design.md
git commit -m "chore: drop transitional seenCardIds; e2e through the gate; spec SRS amendment"
```

---

## Spec coverage map (self-review)

| Spec section | Where |
|---|---|
| §3.1 static tiers, §5.1 ranking key + tiebreak + determinism | Task 1 |
| §4.1 `tier` in data + schema + `cards` column, no backfill script | Tasks 1–2 |
| §4.2 no new tables | Task 4 (derivation only) |
| §3.2 solid/amnestied/gate, §3.3 derived active tier + absorbed history | Task 4 |
| §3.4 weights incl. introduced-never-attempted max | Task 4 |
| §4.3 plan response shape | Tasks 4, 7 |
| §5.2 cardScoring extraction + planConfig knobs | Tasks 3, 1, 4 |
| §5.3 negation fix, weighted draw, locked cards, EnginePlan | Task 5 |
| §5.4 notices + precedence + setup screen | Task 6 |
| §5.5 mixed union / revenge bypass | Task 4 (union emerges per-level); revenge untouched (App passes `replayPlan`, no fetch) |
| §6 data flow | Tasks 4–5 wiring |
| §7 error table | Task 1 (schema loud-fail), Task 4 (complete level, short last tier, amnestied tier, ties), Task 5 (no-plan default, starved fallback active-tier-only) |
| §8 test matrix | Tasks 1 (pipeline), 4 (server golden), 5 (engine), 6 (client), 7 (e2e unchanged) |
| §9 doc amendment | Task 7 |
