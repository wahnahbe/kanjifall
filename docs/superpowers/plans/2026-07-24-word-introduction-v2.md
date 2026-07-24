# Word Introduction v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the session-scoped word-intro table with a player-scoped acquisition ceremony — one new word at a time, carrying an example sentence and kanji-part meanings, typed once without pressure — governed by a daily new-word budget whose side effect is guaranteed re-encounter.

**Architecture:** The server derives the run plan (never-met cards, already-met cards, remaining budget) from the attempts + introductions tables and the profile, and hands it to the client at run start. The engine's `Spawner` consumes that plan as a pure injected input, composing each wave as *new cards up to budget, ordered first, remainder from seen cards* — and moving introduced cards into the seen pool so later waves recycle them. The client renders the ceremony during the existing `waveIntro` pause and records introductions through the existing events batch.

**Tech Stack:** Existing only — Hono + better-sqlite3 + Drizzle (server), React 19 + TS strict (client), Vitest + RTL + Playwright, zod 4, wanakana. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-24-word-introduction-v2-design.md`. Base: current `main` (post-M3, 182 unit + 2 e2e green).

## Global Constraints

- `src/engine/` stays pure: no React/Pixi/server imports, no `Math.random`, no `Date.now()`. The run plan is an injected input like the card pool.
- **`PER_RUN_NEW_CAP = 6`**, **`PER_WAVE_NEW_CAP = 2`**, both in `server/planConfig.ts`. (The spec fixes the per-run cap at 6; the per-wave cap is a pacing addition — without it, wave 1 of a fresh run would stack 5 ceremonies before any gameplay.)
- Daily budget = `max(0, min(profile.dailyWordGoal − introducedToday, PER_RUN_NEW_CAP))`, where `introducedToday` counts `introductions` rows at or after the **local** start of day.
- A card is **new** iff it has no `attempts` row (any direction) **and** no `introductions` row.
- `introductions.card_id` is the PRIMARY KEY — introduced once ever, ingest idempotent via `INSERT OR IGNORE`.
- Introductions ride `POST /api/runs/:id/events` in the same transaction and `batchId` as attempts and wrong-submits. No new ingest route.
- Wave composition: new cards first, then seen; a card may repeat **within** a wave only when the seen pool cannot fill it; introduced cards join the seen pool for subsequent waves (this is the re-encounter mechanism).
- **Starved-pool rule:** budget 0 **and** seen pool empty → compose from new cards **without** ceremonies and **without** marking them introduced; the setup screen says so.
- Server unavailable → plan absent → every card treated as seen → no ceremonies, one-line notice, play proceeds. Gameplay never blocks on the API.
- Ceremony: **Enter** advances only on a correct reading; **Escape** always skips; a skip still counts as introduced. Input uses the real `InputBuffer` + matcher so romaji→kana behaves exactly as in gameplay.
- Hooks (`sentence`, `kanjiParts`) are **optional** fields in the client JSON only. The server's `cards` table is unchanged.
- Tatoeba is CC-BY 2.0 (France): credit in `README.md` **and** in the ceremony footer.
- Sentence Japanese side ≤ **50 characters**; shortest qualifying match wins.
- Date bucketing is **local** everywhere (`server/dates.ts`), including the stats trend/streak which switch from UTC in Task 1.
- TS strict + `erasableSyntaxOnly` (no parameter properties, no enums). `npm run check` green at every task boundary. Conventional commits, no attribution footers. Files ≤800 lines, functions <50 lines.
- Ports: API 8790, e2e client 5183 `--strictPort`. **Never touch the process on 5173.** Stop `npm run dev`/`npm start` before running e2e (they share 8790).

---

## File Structure (all tasks)

```
kotoba-drop/
  server/
    dates.ts                     # T1: localDateKey, startOfLocalDay (shared by stats + plan)
    planConfig.ts                # T2: PER_RUN_NEW_CAP, PER_WAVE_NEW_CAP
    plan.ts                      # T2: computeRunPlan (pure over DbHandle)
    routes/plan.ts               # T2: GET /api/plan
    statsHelpers.ts              # T1: trend/streak → local dates
    db/schema.ts                 # T2: introductions table
    routes/runs.ts               # T3: ingest introductions in the events transaction
    app.ts                       # T2: mount plan routes
  drizzle/                       # T2: generated migration (committed)
  scripts/build-data.ts          # T4: sentence + kanjiParts enrichment
  public/data/jlpt-n*.json       # T4: regenerated with hooks (committed)
  src/
    shared/api.ts                # T2/T3: runPlanSchema, introductionSchema, batch extension
    data/schema.ts               # T4: optional sentence/kanjiParts on cardSchema
    data/planClient.ts           # T7: fetchRunPlan with graceful absence
    data/recorder.ts             # T7: buffer introductions
    engine/types.ts              # T5: EnginePlan, waveStarting.newCards
    engine/Spawner.ts            # T5: budget-aware composition
    engine/GameEngine.ts         # T5: pass plan through
    engine/matcher.ts            # T5: matchesReading helper for the ceremony
    ui/screens/AcquisitionCeremony.tsx   # T6: the ceremony (replaces WaveIntroOverlay)
    ui/screens/WaveIntroOverlay.tsx      # T7: DELETED
    ui/screens/GameScreen.tsx            # T7: render ceremony
    ui/screens/SetupScreen.tsx           # T7: budget notices
    App.tsx, ui/useEngine.ts             # T7: plan wiring
  e2e/game.spec.ts               # T8: ceremony + introductions assertion
  README.md, docs/…/specs/…      # T8
```

Task order: T1 dates → T2 plan endpoint → T3 ingest → T4 hooks → T5 engine → T6 ceremony → T7 wiring → T8 e2e/docs.

---

### Task 1: Local date helper + stats trend/streak switch

**Files:**
- Create: `server/dates.ts`
- Modify: `server/statsHelpers.ts` (`computeTrendAndStreak`, ~lines 260-285)
- Test: `server/__tests__/dates.test.ts`; adjust `server/__tests__/stats.test.ts` if any date expectation shifts

**Interfaces:**
- Consumes: nothing.
- Produces: `localDateKey(ms: number): string` (YYYY-MM-DD in the process's local timezone), `startOfLocalDay(ms: number): number` (epoch ms of local midnight). Task 2 uses `startOfLocalDay`; `computeTrendAndStreak` uses `localDateKey`.

- [ ] **Step 1: Write the failing test `server/__tests__/dates.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { localDateKey, startOfLocalDay } from '../dates';

describe('local date helpers', () => {
  it('formats a local calendar date as YYYY-MM-DD', () => {
    const noonLocal = new Date(2026, 7, 1, 12, 0, 0).getTime(); // Aug 1 2026, local noon
    expect(localDateKey(noonLocal)).toBe('2026-08-01');
  });

  it('agrees with the local calendar at both ends of a local day', () => {
    const startOfDay = new Date(2026, 7, 1, 0, 0, 0).getTime();
    const endOfDay = new Date(2026, 7, 1, 23, 59, 59).getTime();
    expect(localDateKey(startOfDay)).toBe('2026-08-01');
    expect(localDateKey(endOfDay)).toBe('2026-08-01');
    // One millisecond later is the next local day.
    expect(localDateKey(endOfDay + 1000)).toBe('2026-08-02');
  });

  it('startOfLocalDay returns local midnight and is idempotent', () => {
    const evening = new Date(2026, 7, 1, 22, 30, 0).getTime();
    const midnight = startOfLocalDay(evening);
    expect(new Date(midnight).getHours()).toBe(0);
    expect(new Date(midnight).getMinutes()).toBe(0);
    expect(localDateKey(midnight)).toBe('2026-08-01');
    expect(startOfLocalDay(midnight)).toBe(midnight);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run server/__tests__/dates.test.ts`
Expected: FAIL — `Cannot find module '../dates'`

- [ ] **Step 3: Implement `server/dates.ts`**

```ts
/**
 * Date bucketing is LOCAL, not UTC: a daily word goal that rolls over at
 * 17:00 local time (UTC midnight in the Pacific timezone) is wrong for the
 * player, and the trend chart must agree with it about what "today" means.
 */

/** Local calendar date as YYYY-MM-DD. */
export function localDateKey(ms: number): string {
  const d = new Date(ms);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${month}-${day}`;
}

/** Epoch ms of local midnight starting the day that contains `ms`. */
export function startOfLocalDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run server/__tests__/dates.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Switch `computeTrendAndStreak` to local dates**

In `server/statsHelpers.ts`, add `import { localDateKey } from './dates';` and replace the function's doc comment and its two date computations. The day list must walk **calendar days**, not fixed 24-hour offsets — subtracting `DAY_MS` repeatedly duplicates or skips a local date across a daylight-saving transition.

Replace the comment above `computeTrendAndStreak` with:

```ts
/** Last `trendDays` calendar days ending today, bucketed by LOCAL date (see `./dates`) so the
 *  trend agrees with the daily new-word budget about what "today" means. Days are walked with
 *  setDate() rather than fixed 24h offsets, which would duplicate or skip a date across a
 *  daylight-saving transition. `trend` has one entry per day in the window (including
 *  zero-activity days); `streakDates` is the subset that actually saw an attempt. */
```

Replace the `dates` construction loop body so it reads:

```ts
  const dates: string[] = [];
  const cursor = new Date(nowMs);
  cursor.setHours(0, 0, 0, 0);
  for (let i = STATS.trendDays - 1; i >= 0; i--) {
    const day = new Date(cursor);
    day.setDate(cursor.getDate() - i);
    dates.push(localDateKey(day.getTime()));
  }
```

and replace the per-attempt bucket key with:

```ts
    const dateKey = localDateKey(a.createdAt);
```

(Keep everything else in the function unchanged. If `STATS.trendDays` is referenced under a different local alias in this file, use whatever the existing loop used.)

- [ ] **Step 6: Run the stats suite and reconcile**

Run: `npx vitest run server`
Expected: PASS. The M3 golden fixture places its timestamps at 12:00 UTC, which is mid-day in this machine's timezone, so bucket membership should not move. **If a date expectation does shift, do not hardcode a new literal** — express the expectation with `localDateKey(...)` over the same fixture timestamp so the test is timezone-independent, and note the change in your report.

- [ ] **Step 7: Full gate and commit**

Run: `npm run check`
Expected: green (182 + 3 new).

```bash
git add -A
git commit -m "feat: local date bucketing shared by stats and the coming budget"
```

---

### Task 2: `introductions` table, run-plan computation, and `GET /api/plan`

**Files:**
- Create: `server/planConfig.ts`, `server/plan.ts`, `server/routes/plan.ts`
- Create (generated, committed): the next `drizzle/000N_*.sql` + updated `drizzle/meta/*`
- Modify: `server/db/schema.ts`, `server/app.ts`, `src/shared/api.ts`
- Test: `server/__tests__/plan.test.ts`, `server/__tests__/planRoutes.test.ts`

**Interfaces:**
- Consumes: `DbHandle`, `makeTestDb()` (returns `{ handle, dbPath, cleanup }`), `startOfLocalDay` (Task 1).
- Produces:
  - `server/planConfig.ts`: `export const PLAN = { perRunNewCap: 6, perWaveNewCap: 2 } as const;`
  - `server/plan.ts`: `export function computeRunPlan(handle: DbHandle, pool: string, nowMs: number): RunPlan` — throws nothing; an unknown pool yields empty arrays and budget 0.
  - `src/shared/api.ts`: `runPlanSchema` / `RunPlan` = `{ newCardIds: string[]; seenCardIds: string[]; runBudget: number }`.
  - Route `GET /api/plan?pool=<n5|n4|n3|n2|mixed>` → 200 `RunPlan`; missing/unknown `pool` → 400 `{ error }`.
  - Drizzle table `introductions` with columns `card_id` (PK), `run_id`, `introduced_at`. Task 3 inserts into it.

- [ ] **Step 1: Add the schema table**

Append to `server/db/schema.ts`:

```ts
export const introductions = sqliteTable('introductions', {
  // PRIMARY KEY: a card is introduced once, ever. Makes outbox replays
  // idempotent and stops the daily budget being spent twice on one card.
  cardId: text('card_id').primaryKey(),
  runId: text('run_id').notNull(),
  introducedAt: integer('introduced_at').notNull(),
});
```

- [ ] **Step 2: Generate and commit the migration**

```bash
npm run db:generate
```
Expected: a new `drizzle/000N_*.sql` containing `CREATE TABLE \`introductions\``. Commit the whole `drizzle/` change with this task.

- [ ] **Step 3: Add the shared schema**

Append to `src/shared/api.ts`:

```ts
export const runPlanSchema = z.object({
  newCardIds: z.array(z.string()),
  seenCardIds: z.array(z.string()),
  runBudget: z.number().int().nonnegative(),
});
export type RunPlan = z.infer<typeof runPlanSchema>;
```

- [ ] **Step 4: Write the failing tests `server/__tests__/plan.test.ts`**

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
  const insertRun = t.handle.sqlite.prepare(
    `INSERT OR IGNORE INTO runs (id, started_at, mode, pool, app_version, list_version)
     VALUES (?, ?, 'reading', 'n5', 'test', 'test')`,
  );
  insertRun.run('run-1', NOW - HOUR);
  const attempt = (cardId: string, at: number) =>
    t.handle.sqlite
      .prepare(
        `INSERT INTO attempts (run_id, card_id, mode, outcome, ms_to_first_key, ms_to_kill,
           backspace_count, hint_shown, was_targeted, airborne_count, speed_level, created_at)
         VALUES ('run-1', ?, 'reading', 'kill', 100, 400, 0, 0, 1, 1, 1, ?)`,
      )
      .run(cardId, at);
  const introduce = (cardId: string, at: number) =>
    t.handle.sqlite
      .prepare(`INSERT OR IGNORE INTO introductions (card_id, run_id, introduced_at) VALUES (?, 'run-1', ?)`)
      .run(cardId, at);
  return { t, ids: n5Ids.map((r) => r.id), attempt, introduce };
}

describe('computeRunPlan', () => {
  it('with no history, every pool card is new and the budget is the per-run cap', () => {
    const { t } = setup();
    const plan = computeRunPlan(t.handle, 'n5', NOW);
    expect(plan.seenCardIds).toHaveLength(0);
    expect(plan.newCardIds.length).toBeGreaterThan(600); // n5 has 633 cards
    expect(plan.runBudget).toBe(PLAN.perRunNewCap); // dailyWordGoal 20 > cap 6
  });

  it('a card with an attempt is seen, not new', () => {
    const { t, ids, attempt } = setup();
    attempt(ids[0], NOW - HOUR);
    const plan = computeRunPlan(t.handle, 'n5', NOW);
    expect(plan.seenCardIds).toContain(ids[0]);
    expect(plan.newCardIds).not.toContain(ids[0]);
  });

  it('a card that was introduced but never attempted is also seen, not new', () => {
    const { t, ids, introduce } = setup();
    introduce(ids[1], NOW - HOUR);
    const plan = computeRunPlan(t.handle, 'n5', NOW);
    expect(plan.seenCardIds).toContain(ids[1]);
    expect(plan.newCardIds).not.toContain(ids[1]);
  });

  it("today's introductions spend the daily goal; yesterday's do not", () => {
    const { t, ids, introduce } = setup();
    // 18 introduced today leaves 2 of the 20-word goal, below the per-run cap of 6.
    for (let i = 0; i < 18; i++) introduce(ids[i], NOW - HOUR);
    expect(computeRunPlan(t.handle, 'n5', NOW).runBudget).toBe(2);

    // One second before local midnight today is still "yesterday" for a run at NOW.
    const { t: t2, ids: ids2, introduce: introduce2 } = setup();
    for (let i = 0; i < 18; i++) introduce2(ids2[i], startOfLocalDay(NOW) - 1000);
    expect(computeRunPlan(t2.handle, 'n5', NOW).runBudget).toBe(PLAN.perRunNewCap);
  });

  it('budget floors at zero once the daily goal is exhausted', () => {
    const { t, ids, introduce } = setup();
    for (let i = 0; i < 20; i++) introduce(ids[i], NOW - HOUR);
    expect(computeRunPlan(t.handle, 'n5', NOW).runBudget).toBe(0);
  });

  it('mixed spans every level; an unknown pool is empty with no budget', () => {
    const { t } = setup();
    const mixed = computeRunPlan(t.handle, 'mixed', NOW);
    expect(mixed.newCardIds.length).toBeGreaterThan(4000);
    const unknown = computeRunPlan(t.handle, 'nope', NOW);
    expect(unknown.newCardIds).toHaveLength(0);
    expect(unknown.seenCardIds).toHaveLength(0);
    expect(unknown.runBudget).toBe(0);
  });
});
```

- [ ] **Step 5: Run to verify failure**

Run: `npx vitest run server/__tests__/plan.test.ts`
Expected: FAIL — `Cannot find module '../plan'`

- [ ] **Step 6: Implement `server/planConfig.ts` and `server/plan.ts`**

`server/planConfig.ts`:
```ts
/** Run-planning knobs. Kept out of statsConfig.ts: planning is not statistics. */
export const PLAN = {
  /** Most new words one run may introduce (spec §3.2). */
  perRunNewCap: 6,
  /** Most ceremonies before any single wave — pacing, so wave 1 isn't a wall of intros. */
  perWaveNewCap: 2,
} as const;
```

`server/plan.ts`:
```ts
import { sql } from 'drizzle-orm';
import type { RunPlan } from '../src/shared/api';
import { startOfLocalDay } from './dates';
import type { DbHandle } from './db/connect';
import { PLAN } from './planConfig';

const POOL_LEVELS: Record<string, number[]> = {
  n5: [5],
  n4: [4],
  n3: [3],
  n2: [2],
  mixed: [5, 4, 3, 2],
};

/**
 * What this run may introduce. "New" means never attempted AND never
 * introduced, so quitting before a word falls doesn't burn its introduction,
 * and the daily budget can't be spent twice on one card.
 */
export function computeRunPlan(handle: DbHandle, pool: string, nowMs: number): RunPlan {
  const levels = POOL_LEVELS[pool];
  if (!levels) return { newCardIds: [], seenCardIds: [], runBudget: 0 };

  const placeholders = levels.map(() => '?').join(',');
  const poolIds = handle.sqlite
    .prepare(`SELECT id FROM cards WHERE source = 'jlpt' AND jlpt IN (${placeholders}) ORDER BY id`)
    .all(...levels) as { id: string }[];

  const seen = new Set<string>();
  for (const row of handle.sqlite.prepare('SELECT DISTINCT card_id AS id FROM attempts').all() as {
    id: string;
  }[]) {
    seen.add(row.id);
  }
  for (const row of handle.sqlite.prepare('SELECT card_id AS id FROM introductions').all() as {
    id: string;
  }[]) {
    seen.add(row.id);
  }

  const newCardIds: string[] = [];
  const seenCardIds: string[] = [];
  for (const { id } of poolIds) {
    if (seen.has(id)) seenCardIds.push(id);
    else newCardIds.push(id);
  }

  const goal =
    handle.db.get<{ goal: number }>(sql`SELECT daily_word_goal AS goal FROM profile WHERE id = 1`)
      ?.goal ?? 0;
  const introducedToday =
    handle.db.get<{ n: number }>(
      sql`SELECT COUNT(*) AS n FROM introductions WHERE introduced_at >= ${startOfLocalDay(nowMs)}`,
    )?.n ?? 0;

  const runBudget = Math.max(0, Math.min(goal - introducedToday, PLAN.perRunNewCap));
  return { newCardIds, seenCardIds, runBudget };
}
```

- [ ] **Step 7: Run to green**

Run: `npx vitest run server/__tests__/plan.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 8: Add the route and mount it**

`server/routes/plan.ts`:
```ts
import { Hono } from 'hono';
import type { DbHandle } from '../db/connect';
import { computeRunPlan } from '../plan';

export function planRoutes(handle: DbHandle): Hono {
  const app = new Hono();

  app.get('/', (c) => {
    const pool = c.req.query('pool');
    if (pool === undefined || pool.length === 0) {
      return c.json({ error: 'pool query parameter is required' }, 400);
    }
    return c.json(computeRunPlan(handle, pool, Date.now()));
  });

  return app;
}
```

In `server/app.ts`, import `planRoutes` and mount it beside the existing routes:
```ts
  app.route('/api/plan', planRoutes(handle));
```

- [ ] **Step 9: Write and run the route test `server/__tests__/planRoutes.test.ts`**

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { runPlanSchema } from '../../src/shared/api';
import { buildApp } from '../app';
import { makeTestDb } from '../testDb';

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe('GET /api/plan', () => {
  it('returns a schema-valid plan for a known pool', async () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const res = await buildApp(t.handle).request('/api/plan?pool=n5');
    expect(res.status).toBe(200);
    const parsed = runPlanSchema.parse(await res.json());
    expect(parsed.newCardIds.length).toBeGreaterThan(600);
    expect(parsed.runBudget).toBeGreaterThan(0);
  });

  it('rejects a missing pool parameter', async () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const res = await buildApp(t.handle).request('/api/plan');
    expect(res.status).toBe(400);
  });
});
```

Run: `npx vitest run server` → all green.

- [ ] **Step 10: Full gate and commit**

Run: `npm run check`

```bash
git add -A
git commit -m "feat: introductions table and run-plan endpoint"
```

---

### Task 3: Ingest introductions through the events batch

**Files:**
- Modify: `src/shared/api.ts`, `server/routes/runs.ts`
- Test: `server/__tests__/runsRoutes.test.ts` (append cases)

**Interfaces:**
- Consumes: `introductions` table (Task 2), existing `eventsBatchSchema`.
- Produces: `introductionSchema` = `{ cardId: string; introducedAt: number }`; `eventsBatchSchema` gains `introductions: IntroductionEvent[]`; the events transaction writes them with `INSERT OR IGNORE`. Task 7's recorder sends them.

- [ ] **Step 1: Extend the shared schema**

In `src/shared/api.ts`, add above `eventsBatchSchema`:

```ts
export const introductionSchema = z.object({
  cardId: z.string().min(1),
  introducedAt: z.number().int().positive(),
});
export type IntroductionEvent = z.infer<typeof introductionSchema>;
```

and add the field to `eventsBatchSchema`:

```ts
  introductions: z.array(introductionSchema),
```

Note: this makes `introductions` **required** in the batch body. Task 7's recorder always sends the key (possibly empty). Any outbox payload persisted by an older build would now fail validation — acceptable, since the outbox drains at launch and this is a single-user local app; a rejected legacy payload is dropped with a 400 rather than corrupting anything.

- [ ] **Step 2: Write the failing tests (append to `server/__tests__/runsRoutes.test.ts`)**

Use the file's existing helpers exactly as they are defined there: `jsonRequest(body, method?)`, `makeCreateRunBody()`, `makeAttempt()`, and **`countRows(sqlite, table)` — which takes `handle.sqlite`, not the handle**. Add:

```ts
describe('introduction ingest', () => {
  it('stores introductions in the same batch as attempts', async () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const app = buildApp(t.handle);
    const run = makeCreateRunBody();
    await app.request('/api/runs', jsonRequest(run));

    const res = await app.request(
      `/api/runs/${run.id}/events`,
      jsonRequest({
        batchId: crypto.randomUUID(),
        attempts: [makeAttempt()],
        wrongSubmits: [],
        introductions: [{ cardId: 'jm-1000000', introducedAt: Date.now() }],
      }),
    );

    expect(res.status).toBe(201);
    expect(countRows(t.handle.sqlite, 'introductions')).toBe(1);
  });

  it('re-introducing a card is ignored rather than duplicated or erroring', async () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const app = buildApp(t.handle);
    const run = makeCreateRunBody();
    await app.request('/api/runs', jsonRequest(run));

    const send = (batchId: string) =>
      app.request(
        `/api/runs/${run.id}/events`,
        jsonRequest({
          batchId,
          attempts: [],
          wrongSubmits: [],
          introductions: [{ cardId: 'jm-1000000', introducedAt: Date.now() }],
        }),
      );

    expect((await send(crypto.randomUUID())).status).toBe(201);
    // A DIFFERENT batch carrying the same card: the batch is new, the card is not.
    expect((await send(crypto.randomUUID())).status).toBe(201);
    expect(countRows(t.handle.sqlite, 'introductions')).toBe(1);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run server/__tests__/runsRoutes.test.ts`
Expected: FAIL — introductions are not persisted (count 0), and pre-existing batch tests fail validation because they omit the now-required `introductions` key.

- [ ] **Step 4: Fix the pre-existing batch fixtures**

Every existing events-batch body in `runsRoutes.test.ts` gains `introductions: []`. Do not change any assertion.

- [ ] **Step 5: Implement the ingest**

In `server/routes/runs.ts`, import `introductions` from `../db/schema`, and inside the existing `insertAll` transaction — after the wrong-submits loop — add:

```ts
      for (const intro of batch.introductions) {
        // INSERT OR IGNORE: card_id is the primary key, so a re-introduction
        // (outbox replay, or a card met again on a later day) is a no-op.
        handle.sqlite
          .prepare(
            `INSERT OR IGNORE INTO introductions (card_id, run_id, introduced_at) VALUES (?, ?, ?)`,
          )
          .run(intro.cardId, runId, intro.introducedAt);
      }
```

Include the count in the response payload:
```ts
    return c.json(
      {
        inserted: {
          attempts: batch.attempts.length,
          wrongSubmits: batch.wrongSubmits.length,
          introductions: batch.introductions.length,
        },
      },
      201,
    );
```

- [ ] **Step 6: Green and commit**

Run: `npx vitest run server` then `npm run check` → green.

```bash
git add -A
git commit -m "feat: ingest introductions in the events batch transaction"
```

---

### Task 4: Hook data pipeline — example sentences and kanji parts

**Files:**
- Modify: `scripts/build-data.ts`, `src/data/schema.ts`, `README.md`
- Modify (regenerated, committed): `public/data/jlpt-n{5,4,3,2}.json`
- Test: `src/data/__tests__/jlptData.test.ts` (append hook invariants)

**Interfaces:**
- Consumes: `data/raw/tatoeba-jpn-eng.tsv` (columns: `english \t japanese \t attribution`), `data/raw/kanjidic2-en-3.6.2.json` (`characters[].literal`, `characters[].readingMeaning.groups[].meanings[] = { lang, value }`). Both are already copied there by the Task-1-of-M2 setup; if absent, copy them from `~/n2-prep/data/raw/` (read-only source — never modify anything in n2-prep).
- Produces: two optional card fields, consumed by Task 6's ceremony:
  ```ts
  sentence?: { ja: string; en: string }
  kanjiParts?: { char: string; meaning: string }[]
  ```

- [ ] **Step 1: Extend the card schema**

In `src/data/schema.ts`, add to `cardSchema`:

```ts
  sentence: z.object({ ja: z.string().min(1), en: z.string().min(1) }).optional(),
  kanjiParts: z.array(z.object({ char: z.string().min(1), meaning: z.string().min(1) })).optional(),
```

- [ ] **Step 2: Write the failing invariant tests (append to `src/data/__tests__/jlptData.test.ts`)**

```ts
  it('every emitted sentence contains its word and stays within the length cap', () => {
    for (const [, file] of files) {
      for (const card of file.cards) {
        if (!card.sentence) continue;
        expect(card.sentence.ja.length, card.id).toBeLessThanOrEqual(50);
        const needle = card.kanji ?? card.kana[0];
        expect(card.sentence.ja.includes(needle), `${card.id} (${needle})`).toBe(true);
        expect(card.sentence.en.length, card.id).toBeGreaterThan(0);
      }
    }
  });

  it('kanji cards carry a part meaning for each character kanjidic knows', () => {
    for (const [, file] of files) {
      for (const card of file.cards) {
        if (!card.kanjiParts) continue;
        expect(card.kanji, card.id).not.toBeNull();
        for (const part of card.kanjiParts) {
          expect(part.char.length, card.id).toBe(1);
          expect(card.kanji!.includes(part.char), `${card.id}:${part.char}`).toBe(true);
          expect(part.meaning.trim().length, `${card.id}:${part.char}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('kana-only cards never carry kanji parts', () => {
    for (const [, file] of files) {
      for (const card of file.cards) {
        if (card.kanji === null) expect(card.kanjiParts, card.id).toBeUndefined();
      }
    }
  });

  it('hook coverage is meaningful, not accidental', () => {
    const all = files.flatMap(([, f]) => f.cards);
    const withSentence = all.filter((c) => c.sentence).length;
    const kanjiCards = all.filter((c) => c.kanji !== null);
    const withParts = kanjiCards.filter((c) => c.kanjiParts).length;
    // Tatoeba coverage is partial by nature, especially at N2 — this is a floor,
    // not a target. Record the real number in your report.
    expect(withSentence / all.length).toBeGreaterThan(0.25);
    expect(withParts / kanjiCards.length).toBeGreaterThan(0.9);
  });
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/data/__tests__/jlptData.test.ts`
Expected: FAIL on the coverage test (no card has hooks yet). The other three pass vacuously — that is expected and fine; they are regression guards for the data about to be generated.

- [ ] **Step 4: Implement the enrichment in `scripts/build-data.ts`**

Add these imports and functions, then call them in `main()` before writing files. The sentence index inverts the search: rather than scanning 117k sentences per card (≈550M comparisons), it walks each sentence once and looks up every substring it contains against a card-key map.

```ts
const SENTENCE_MAX_JA = 50;

interface Hook {
  ja: string;
  en: string;
}

/**
 * Shortest qualifying Tatoeba sentence per search key.
 * Inverted index: for each sentence, probe every substring up to the longest
 * card key against the key set — O(sentences × length × maxKeyLen) rather than
 * O(cards × sentences).
 */
function buildSentenceIndex(keys: Set<string>): Map<string, Hook> {
  let maxKeyLen = 1;
  for (const key of keys) maxKeyLen = Math.max(maxKeyLen, key.length);

  const best = new Map<string, Hook>();
  const raw = readFileSync(join(RAW_DIR, 'tatoeba-jpn-eng.tsv'), 'utf8');
  for (const line of raw.split('\n')) {
    const parts = line.split('\t');
    if (parts.length < 2) continue;
    const en = parts[0].trim();
    const ja = parts[1].trim();
    if (ja.length === 0 || ja.length > SENTENCE_MAX_JA || en.length === 0) continue;

    const seenHere = new Set<string>();
    for (let i = 0; i < ja.length; i++) {
      for (let len = 1; len <= maxKeyLen && i + len <= ja.length; len++) {
        const candidate = ja.slice(i, i + len);
        if (!keys.has(candidate) || seenHere.has(candidate)) continue;
        seenHere.add(candidate);
        const current = best.get(candidate);
        if (current === undefined || ja.length < current.ja.length) {
          best.set(candidate, { ja, en });
        }
      }
    }
  }
  return best;
}

/** Primary English meaning per kanji, only for characters the corpus uses. */
function buildKanjiMeanings(used: Set<string>): Map<string, string> {
  interface KMeaning { lang: string; value: string }
  interface KGroup { meanings?: KMeaning[] }
  interface KChar {
    literal: string;
    readingMeaning?: { groups?: KGroup[] } | null;
  }
  const parsed = JSON.parse(
    readFileSync(join(RAW_DIR, 'kanjidic2-en-3.6.2.json'), 'utf8'),
  ) as { characters: KChar[] };

  const meanings = new Map<string, string>();
  for (const char of parsed.characters) {
    if (!used.has(char.literal)) continue;
    const first = (char.readingMeaning?.groups ?? [])
      .flatMap((g) => g.meanings ?? [])
      .find((m) => m.lang === 'en');
    if (first && first.value.trim().length > 0) meanings.set(char.literal, first.value.trim());
  }
  return meanings;
}

const KANJI_RANGE = /[\u4e00-\u9fff\u3400-\u4dbf]/;

/** Attaches sentence + kanjiParts in place. Both fields stay optional. */
function attachHooks(cardsByLevel: Map<2 | 3 | 4 | 5, Card[]>): void {
  const all = [...cardsByLevel.values()].flat();

  const keys = new Set<string>();
  const usedKanji = new Set<string>();
  for (const card of all) {
    keys.add(card.kanji ?? card.kana[0]);
    for (const ch of card.kanji ?? '') if (KANJI_RANGE.test(ch)) usedKanji.add(ch);
  }

  const sentences = buildSentenceIndex(keys);
  const meanings = buildKanjiMeanings(usedKanji);

  let withSentence = 0;
  let withParts = 0;
  for (const card of all) {
    const hook = sentences.get(card.kanji ?? card.kana[0]);
    if (hook) {
      card.sentence = hook;
      withSentence += 1;
    }
    if (card.kanji !== null) {
      const parts = [...card.kanji]
        .filter((ch) => KANJI_RANGE.test(ch))
        .map((ch) => ({ char: ch, meaning: meanings.get(ch) ?? '' }))
        .filter((p) => p.meaning.length > 0);
      if (parts.length > 0) {
        card.kanjiParts = parts;
        withParts += 1;
      }
    }
  }
  console.log(`hooks: ${withSentence}/${all.length} sentences, ${withParts} cards with kanji parts`);
}
```

Add the two optional fields to the script's `Card` usage by importing the shared type (the script already imports `Card` from `../src/engine/types`) — extend `src/engine/types.ts`'s `Card` interface with the same two optional fields so the script and the client agree:

```ts
  sentence?: { ja: string; en: string };
  kanjiParts?: { char: string; meaning: string }[];
```

In `main()`, call `attachHooks(cardsByLevel);` immediately before the per-level write loop.

- [ ] **Step 5: Regenerate the data**

Run: `npm run build:data`
Expected: the existing per-level match-rate lines, plus the new `hooks: …` line. Record the real coverage numbers in your report. If Node runs out of memory parsing both large sources, set `NODE_OPTIONS=--max-old-space-size=4096` and note it.

- [ ] **Step 6: Run the invariants**

Run: `npx vitest run src/data/__tests__/jlptData.test.ts`
Expected: PASS. If sentence coverage lands below the 25% floor, **do not lower the floor** — first check that the search key for kana-only cards is `kana[0]` and that the length cap isn't excluding almost everything; report the real figure if it is genuinely that sparse.

- [ ] **Step 7: Attribution in the README**

Add to `README.md` under `## Data`:

```markdown
Example sentences come from the [Tatoeba Project](https://tatoeba.org), used
under CC-BY 2.0 (France). Kanji meanings come from KANJIDIC2 (Electronic
Dictionary Research and Development Group), used under CC-BY-SA 4.0.
```

- [ ] **Step 8: Full gate and commit**

Run: `npm run check` → green.

```bash
git add -A
git commit -m "feat: example sentences and kanji part meanings on every card"
```

---

### Task 5: Engine — budget-aware wave composition

**Files:**
- Modify: `src/engine/types.ts`, `src/engine/Spawner.ts`, `src/engine/GameEngine.ts`, `src/engine/matcher.ts`
- Test: `src/engine/__tests__/Spawner.test.ts` (append), `src/engine/__tests__/GameEngine.test.ts` (append), `src/engine/__tests__/matcher.test.ts` (append)

**Interfaces:**
- Consumes: existing `Card`, `EngineConfig`, seeded `rng`.
- Produces:
  - `src/engine/types.ts`: `export interface EnginePlan { newCardIds: readonly string[]; runBudget: number; perWaveNewCap: number }`; `WavePlan` gains `newCards: Card[]`; the `waveStarting` event gains `newCards: Card[]`.
  - `Spawner` constructor becomes `(pool: Card[], rng: () => number, config: EngineConfig, plan: EnginePlan)`.
  - `EngineOptions` gains `plan?: EnginePlan` — **absent means nothing is new** (`{ newCardIds: [], runBudget: 0, perWaveNewCap: 0 }`), which is exactly the server-unavailable degradation.
  - `src/engine/matcher.ts`: `export function matchesReading(kanaBuffer: string, card: Card): boolean` — Task 6's ceremony uses it.

- [ ] **Step 1: Add `matchesReading` and its failing test**

Append to `src/engine/__tests__/matcher.test.ts`:

```ts
describe('matchesReading (ceremony input)', () => {
  const neko = card('neko', ['ねこ'], '猫');
  const koohii = card('koohii', ['コーヒー'], null);

  it('accepts the canonical reading', () => {
    expect(matchesReading('ねこ', neko)).toBe(true);
  });

  it('accepts the same naive typings gameplay accepts', () => {
    expect(matchesReading('こおひい', koohii)).toBe(true);
    expect(matchesReading('こーひー', koohii)).toBe(true);
  });

  it('rejects a wrong or empty reading', () => {
    expect(matchesReading('いぬ', neko)).toBe(false);
    expect(matchesReading('', neko)).toBe(false);
  });
});
```

Add `matchesReading` to that file's import list. Then implement in `src/engine/matcher.ts`:

```ts
/**
 * Does this typed buffer match this one card's reading, with exactly the
 * leniency gameplay allows? Used by the acquisition ceremony, where there is
 * no competition between cards, so the two-tier exact-beats-variant rule in
 * findExactMatches collapses to "any accepted form of this card".
 */
export function matchesReading(kanaBuffer: string, card: Card): boolean {
  const target = canonical(kanaBuffer);
  if (target.length === 0) return false;
  return card.kana.some((reading) => readingForms(reading).includes(target));
}
```

`Card` is already imported as a type in that file; if only `AirborneWord` is imported, add `Card` to the same `import type` line.

Run: `npx vitest run src/engine/__tests__/matcher.test.ts` → PASS.

- [ ] **Step 2: Write the failing Spawner tests**

Append to `src/engine/__tests__/Spawner.test.ts`, reusing its existing `pool` fixture (20 cards `c0`–`c19`) and `mulberry32`:

```ts
import type { EnginePlan } from '../types';

const planOf = (newIds: string[], runBudget: number, perWaveNewCap = 2): EnginePlan => ({
  newCardIds: newIds,
  runBudget,
  perWaveNewCap,
});

const makeWithPlan = (plan: EnginePlan, seed = 42) =>
  new Spawner(pool, mulberry32(seed), DEFAULT_CONFIG, plan);

describe('Spawner run-plan composition', () => {
  const allNew = pool.map((c) => c.id);

  it('introduces at most the per-wave cap, ordered first in the wave', () => {
    const s = makeWithPlan(planOf(allNew, 6, 2));
    const wave = s.planWave(1);
    expect(wave.newCards).toHaveLength(2);
    // New cards lead the wave so they spawn before anything else.
    expect(wave.cards.slice(0, 2).map((c) => c.id)).toEqual(wave.newCards.map((c) => c.id));
  });

  it('spends the run budget across waves and then stops introducing', () => {
    const s = makeWithPlan(planOf(allNew, 3, 2));
    expect(s.planWave(1).newCards).toHaveLength(2); // 2 of 3
    expect(s.planWave(2).newCards).toHaveLength(1); // budget exhausted
    expect(s.planWave(3).newCards).toHaveLength(0);
  });

  it('recycles introduced cards into later waves — the promise of return', () => {
    const s = makeWithPlan(planOf(allNew, 2, 2));
    const first = s.planWave(1);
    const introduced = first.newCards.map((c) => c.id);
    expect(introduced).toHaveLength(2);
    const second = s.planWave(2);
    expect(second.newCards).toHaveLength(0);
    // Wave 2 can only draw from what has been met, so it must reuse them.
    for (const id of second.cards.map((c) => c.id)) expect(introduced).toContain(id);
  });

  it('repeats seen cards within a wave when the seen pool is too small', () => {
    const s = makeWithPlan(planOf(allNew, 1, 1));
    s.planWave(1); // introduces exactly 1 card; seen pool is now that 1 card
    const wave = s.planWave(2);
    expect(wave.cards.length).toBeGreaterThan(1);
    expect(new Set(wave.cards.map((c) => c.id)).size).toBe(1); // the same card, repeated
  });

  it('starved pool: zero budget and nothing seen still yields a playable wave, introducing nothing', () => {
    const s = makeWithPlan(planOf(allNew, 0, 2));
    const wave = s.planWave(1);
    expect(wave.newCards).toHaveLength(0);
    expect(wave.cards.length).toBeGreaterThan(0);
  });

  it('with no plan-eligible new cards, behaves like a pure review run', () => {
    const s = makeWithPlan(planOf([], 6, 2));
    const wave = s.planWave(1);
    expect(wave.newCards).toHaveLength(0);
    expect(wave.cards.length).toBeGreaterThan(0);
  });

  it('same seed and plan produce identical waves', () => {
    const a = makeWithPlan(planOf(allNew, 4, 2), 7);
    const b = makeWithPlan(planOf(allNew, 4, 2), 7);
    expect(a.planWave(1).cards.map((c) => c.id)).toEqual(b.planWave(1).cards.map((c) => c.id));
    expect(a.planWave(2).cards.map((c) => c.id)).toEqual(b.planWave(2).cards.map((c) => c.id));
  });
});
```

Existing Spawner tests construct `new Spawner(pool, rng, DEFAULT_CONFIG)` with three arguments — update each to pass a fourth argument `planOf([], 0)` (a review-only plan reproduces today's behaviour: draw from the whole pool, introduce nothing). Do not change their assertions.

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run src/engine/__tests__/Spawner.test.ts`
Expected: FAIL — `EnginePlan` doesn't exist and the constructor takes three arguments.

- [ ] **Step 4: Add the types**

In `src/engine/types.ts`:

```ts
/** What this run may introduce. Injected — the engine never derives it. */
export interface EnginePlan {
  newCardIds: readonly string[];
  runBudget: number;
  perWaveNewCap: number;
}
```

Change the `waveStarting` variant of `GameEvent` to:

```ts
  | { type: 'waveStarting'; wave: number; cards: Card[]; newCards: Card[] }
```

- [ ] **Step 5: Rewrite `Spawner`**

In `src/engine/Spawner.ts`, replace the `WavePlan` interface, the class's fields/constructor, and `planWave`, and add the new `drawSeen` method. **`pickLane` and `shuffled` stay exactly as they are** — the block below stops before them, so paste it above the existing `pickLane` and leave the class's closing brace intact:

```ts
export interface WavePlan {
  cards: Card[];
  /** Subset of `cards` being introduced this wave; they lead `cards`. */
  newCards: Card[];
  fallSpeed: number;
  spawnIntervalMs: number;
}

export class Spawner {
  private readonly rng: () => number;
  private readonly config: EngineConfig;
  private newPool: Card[];
  private seenPool: Card[];
  private budgetRemaining: number;
  private readonly perWaveNewCap: number;

  constructor(pool: Card[], rng: () => number, config: EngineConfig, plan: EnginePlan) {
    this.rng = rng;
    this.config = config;
    const newIds = new Set(plan.newCardIds);
    this.newPool = pool.filter((c) => newIds.has(c.id));
    this.seenPool = pool.filter((c) => !newIds.has(c.id));
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

    const cards = [...newCards, ...this.drawSeen(size - newCards.length)];

    // Introduced cards join the seen pool: later waves must draw from it once
    // the budget is gone, which is what guarantees the re-encounter.
    this.seenPool = [...this.seenPool, ...newCards];

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
   * Fills the rest of a wave from cards already met, repeating them when the
   * seen pool is smaller than the wave. Starved pool (nothing met and no
   * budget): fall back to un-introduced cards so the run stays playable —
   * they keep their acquisition moment for a later day (spec §3.2).
   */
  private drawSeen(count: number): Card[] {
    if (count <= 0) return [];
    const source = this.seenPool.length > 0 ? this.seenPool : this.newPool;
    if (source.length === 0) return [];
    const drawn: Card[] = [];
    while (drawn.length < count) {
      for (const card of this.shuffled(source)) {
        if (drawn.length === count) break;
        drawn.push(card);
      }
    }
    return drawn;
  }
```

Add `EnginePlan` to the file's `import type` line from `./types`.

- [ ] **Step 6: Thread the plan through `GameEngine`**

In `src/engine/GameEngine.ts`:

1. Add `plan?: EnginePlan;` to `EngineOptions` and import the type.
2. In the constructor, replace the `Spawner` construction with:
```ts
    // No plan (server unavailable) means nothing counts as new: no ceremonies,
    // no budget, ordinary play. Gameplay never depends on the API.
    const plan: EnginePlan = opts.plan ?? { newCardIds: [], runBudget: 0, perWaveNewCap: 0 };
    this.spawner = new Spawner(pool, mulberry32(opts.seed), this.config, plan);
```
3. In `beginWave`, carry the new cards on the event:
```ts
    this.emit({ type: 'waveStarting', wave, cards: [...this.wavePlan.cards], newCards: [...this.wavePlan.newCards] });
```

- [ ] **Step 7: Add the GameEngine test**

Append to the M2 describe block in `src/engine/__tests__/GameEngine.test.ts`:

```ts
  it('waveStarting carries the wave’s newly introduced cards', () => {
    const engine = new GameEngine({
      cards,
      mode: 'reading',
      seed: 1,
      config: introConfig,
      plan: { newCardIds: cards.map((c) => c.id), runBudget: 1, perWaveNewCap: 1 },
    });
    const starts: { wave: number; newCards: number }[] = [];
    engine.subscribe((e) => {
      if (e.type === 'waveStarting') starts.push({ wave: e.wave, newCards: e.newCards.length });
    });
    engine.start();
    expect(starts[0]).toEqual({ wave: 1, newCards: 1 });
  });

  it('without a plan nothing is ever introduced', () => {
    const { events } = makeIntroEngine();
    const starting = events.find((e) => e.type === 'waveStarting');
    expect(starting && starting.type === 'waveStarting' && starting.newCards).toEqual([]);
  });
```

- [ ] **Step 8: Green, coverage, commit**

Run: `npx vitest run src/engine` → all green (existing suites unchanged).
Run: `npm run check` and `npm run coverage` → green, thresholds hold.

```bash
git add -A
git commit -m "feat: budget-aware wave composition with introduced-card recycling"
```

---

### Task 6: The acquisition ceremony component

**Files:**
- Create: `src/ui/screens/AcquisitionCeremony.tsx`
- Modify: `src/index.css`
- Test: `src/ui/__tests__/AcquisitionCeremony.test.tsx`

**Interfaces:**
- Consumes: `Card` (now carrying optional `sentence` / `kanjiParts`), `InputBuffer` from `src/engine/InputBuffer`, `matchesReading` from `src/engine/matcher` (Task 5).
- Produces:
  ```ts
  interface AcquisitionCeremonyProps {
    cards: Card[];                        // this wave's new cards, in order
    onIntroduced: (cardId: string) => void; // fired once per card, on advance OR skip
    onComplete: () => void;               // every card done (or the list was empty)
  }
  ```
  Task 7 renders it and wires both callbacks. It owns its own keyboard handling while mounted.

- [ ] **Step 1: Write the failing tests `src/ui/__tests__/AcquisitionCeremony.test.tsx`**

```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Card } from '../../engine/types';
import { AcquisitionCeremony } from '../screens/AcquisitionCeremony';

const neko: Card = {
  id: 'neko', kanji: '猫', kana: ['ねこ'], gloss: 'cat', pos: 'n', jlpt: 5, source: 'jlpt',
  sentence: { ja: '猫が好きです。', en: 'I like cats.' },
  kanjiParts: [{ char: '猫', meaning: 'cat' }],
};
const sore: Card = {
  id: 'sore', kanji: null, kana: ['それ'], gloss: 'that', pos: 'pron', jlpt: 5, source: 'jlpt',
};

describe('AcquisitionCeremony', () => {
  it('renders the word with all of its hooks', () => {
    render(<AcquisitionCeremony cards={[neko]} onIntroduced={vi.fn()} onComplete={vi.fn()} />);
    const view = screen.getByTestId('ceremony');
    expect(view).toHaveTextContent('猫');
    expect(view).toHaveTextContent('ねこ');
    expect(view).toHaveTextContent('cat');
    expect(view).toHaveTextContent('猫が好きです。');
    expect(view).toHaveTextContent('I like cats.');
  });

  it('renders a card with no hooks without breaking', () => {
    render(<AcquisitionCeremony cards={[sore]} onIntroduced={vi.fn()} onComplete={vi.fn()} />);
    expect(screen.getByTestId('ceremony')).toHaveTextContent('それ');
    expect(screen.queryByTestId('ceremony-sentence')).toBeNull();
    expect(screen.queryByTestId('ceremony-parts')).toBeNull();
  });

  it('converts romaji to kana as you type', async () => {
    render(<AcquisitionCeremony cards={[neko]} onIntroduced={vi.fn()} onComplete={vi.fn()} />);
    await userEvent.keyboard('neko');
    expect(screen.getByTestId('ceremony-buffer')).toHaveTextContent('ねこ');
  });

  it('Enter advances only once the reading is correct', async () => {
    const onIntroduced = vi.fn();
    const onComplete = vi.fn();
    render(<AcquisitionCeremony cards={[neko]} onIntroduced={onIntroduced} onComplete={onComplete} />);

    await userEvent.keyboard('inu{Enter}');
    expect(onIntroduced).not.toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();

    await userEvent.keyboard('{Escape}neko{Enter}');
    expect(onIntroduced).toHaveBeenCalledWith('neko');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('Escape skips the word, which still counts as introduced', async () => {
    const onIntroduced = vi.fn();
    const onComplete = vi.fn();
    render(<AcquisitionCeremony cards={[neko]} onIntroduced={onIntroduced} onComplete={onComplete} />);
    // Escape on an empty buffer skips the card entirely.
    await userEvent.keyboard('{Escape}');
    expect(onIntroduced).toHaveBeenCalledWith('neko');
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('walks through several cards in order', async () => {
    const onIntroduced = vi.fn();
    const onComplete = vi.fn();
    render(
      <AcquisitionCeremony cards={[neko, sore]} onIntroduced={onIntroduced} onComplete={onComplete} />,
    );
    await userEvent.keyboard('neko{Enter}');
    expect(onComplete).not.toHaveBeenCalled();
    expect(screen.getByTestId('ceremony')).toHaveTextContent('それ');
    await userEvent.keyboard('sore{Enter}');
    expect(onIntroduced.mock.calls.map((c) => c[0])).toEqual(['neko', 'sore']);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it('completes immediately when there is nothing new', () => {
    const onComplete = vi.fn();
    render(<AcquisitionCeremony cards={[]} onIntroduced={vi.fn()} onComplete={onComplete} />);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('ceremony')).toBeNull();
  });

  it('shows the required Tatoeba credit when a sentence is displayed', () => {
    render(<AcquisitionCeremony cards={[neko]} onIntroduced={vi.fn()} onComplete={vi.fn()} />);
    expect(screen.getByTestId('ceremony')).toHaveTextContent(/tatoeba/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/ui/__tests__/AcquisitionCeremony.test.tsx`
Expected: FAIL — `Cannot find module '../screens/AcquisitionCeremony'`

- [ ] **Step 3: Implement `src/ui/screens/AcquisitionCeremony.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { InputBuffer } from '../../engine/InputBuffer';
import { matchesReading } from '../../engine/matcher';
import type { Card } from '../../engine/types';

interface AcquisitionCeremonyProps {
  cards: Card[];
  onIntroduced: (cardId: string) => void;
  onComplete: () => void;
}

/**
 * The moment a word becomes yours (spec §3.1): one new word at a time, with
 * its meaning, an example sentence and its kanji parts, typed once with no
 * timer and nothing falling. Enter advances only on a correct reading;
 * Escape always skips — a word you can't type must never trap you, and a
 * skip still counts as introduced because you did see it.
 */
export function AcquisitionCeremony({ cards, onIntroduced, onComplete }: AcquisitionCeremonyProps) {
  const [index, setIndex] = useState(0);
  const [buffer] = useState(() => new InputBuffer());
  const [kana, setKana] = useState('');
  const [rejected, setRejected] = useState(false);
  const card = cards[index];

  const done = cards.length === 0 || index >= cards.length;
  const completedRef = useRef(false);
  useEffect(() => {
    if (done && !completedRef.current) {
      completedRef.current = true;
      onComplete();
    }
  }, [done, onComplete]);

  const advance = useCallback(
    (cardId: string) => {
      onIntroduced(cardId);
      buffer.clear();
      setKana('');
      setRejected(false);
      setIndex((i) => i + 1);
    },
    [buffer, onIntroduced],
  );

  useEffect(() => {
    if (card === undefined) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        advance(card.id);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (matchesReading(buffer.commitKana(), card)) advance(card.id);
        else {
          setRejected(true);
          buffer.clear();
          setKana('');
        }
        return;
      }
      if (e.key === 'Backspace') {
        e.preventDefault();
        buffer.backspace();
        setKana(buffer.kana);
        return;
      }
      if (/^[a-zA-Z-]$/.test(e.key)) {
        e.preventDefault();
        buffer.pushKey(e.key);
        setKana(buffer.kana);
        setRejected(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [advance, buffer, card]);

  if (card === undefined) return null;

  return (
    <div className="overlay ceremony" data-testid="ceremony">
      <p className="ceremony-label">New word</p>
      <p className="ceremony-word">{card.kanji ?? card.kana[0]}</p>
      <p className="ceremony-reading">{card.kana[0]}</p>
      <p className="ceremony-gloss">{card.gloss}</p>

      {card.kanjiParts && (
        <p className="ceremony-parts" data-testid="ceremony-parts">
          {card.kanjiParts.map((part) => `${part.char} = ${part.meaning}`).join('　·　')}
        </p>
      )}

      {card.sentence && (
        <div className="ceremony-sentence" data-testid="ceremony-sentence">
          <p className="ceremony-sentence-ja">{card.sentence.ja}</p>
          <p className="ceremony-sentence-en">{card.sentence.en}</p>
        </div>
      )}

      <p className={rejected ? 'ceremony-buffer rejected' : 'ceremony-buffer'} data-testid="ceremony-buffer">
        {kana || ' '}
      </p>
      <p className="hint">
        Type it once, then Enter{cards.length > 1 ? ` · ${index + 1} of ${cards.length}` : ''} · Esc to skip
      </p>
      {card.sentence && <p className="ceremony-credit">Sentence: Tatoeba (CC-BY 2.0 FR)</p>}
    </div>
  );
}
```

- [ ] **Step 4: Add the styles**

Append to `src/index.css`:

```css
.ceremony { gap: 0.35rem; }
.ceremony-label { color: #7fdfff; letter-spacing: 0.25em; text-transform: uppercase; font-size: 0.75rem; }
.ceremony-word { font-size: 4rem; line-height: 1.1; animation: ceremony-arrive 320ms ease-out; }
.ceremony-reading { font-size: 1.5rem; color: #7fdfff; }
.ceremony-gloss { font-size: 1.15rem; }
.ceremony-parts { color: #bfd4ff; font-size: 0.95rem; }
.ceremony-sentence { margin-top: 0.5rem; text-align: center; max-width: 32rem; }
.ceremony-sentence-ja { font-size: 1.2rem; }
.ceremony-sentence-en { color: #8b98b8; font-size: 0.95rem; }
.ceremony-buffer { font-size: 2rem; color: #7fdfff; min-height: 2.6rem; }
.ceremony-buffer.rejected { color: #ff8f8f; animation: ceremony-shake 220ms ease-in-out; }
.ceremony-credit { color: #55617d; font-size: 0.7rem; margin-top: 0.75rem; }

@keyframes ceremony-arrive {
  from { transform: scale(0.82); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}
@keyframes ceremony-shake {
  0%, 100% { transform: translateX(0); }
  25% { transform: translateX(-6px); }
  75% { transform: translateX(6px); }
}
```

- [ ] **Step 5: Green and commit**

Run: `npx vitest run src/ui/__tests__/AcquisitionCeremony.test.tsx` → PASS (8 tests).
Run: `npm run check` → green.

```bash
git add -A
git commit -m "feat: acquisition ceremony for newly introduced words"
```

---

### Task 7: Wiring — plan fetch, ceremony in the game, introductions recorded

**Files:**
- Create: `src/data/planClient.ts`
- Modify: `src/App.tsx`, `src/ui/useEngine.ts`, `src/ui/screens/GameScreen.tsx`, `src/ui/screens/SetupScreen.tsx`, `src/data/recorder.ts`
- Delete: `src/ui/screens/WaveIntroOverlay.tsx`, `src/ui/__tests__/WaveIntroOverlay.test.tsx`
- Test: `src/data/__tests__/planClient.test.ts`; update `src/ui/__tests__/App.introFlow.test.tsx`; append to `src/data/__tests__/recorder.test.ts`

**Interfaces:**
- Consumes: `runPlanSchema`/`RunPlan` (Task 2), `EnginePlan` + `waveStarting.newCards` (Task 5), `AcquisitionCeremony` (Task 6), `PLAN.perWaveNewCap` — **the client must not import from `server/`**; mirror the per-wave cap as a client constant in `planClient.ts` with a comment naming `server/planConfig.ts` as the source of truth.
- Produces:
  - `fetchRunPlan(pool: string): Promise<EnginePlan | null>` — `null` when the server is unreachable or the response is invalid (never throws).
  - `useEngine`'s `RunOptions` gains `plan?: EnginePlan`; the hook exposes `introCards` sourced from `waveStarting.newCards`.
  - `RunRecorder.recordIntroduction(cardId: string): void`, buffered and flushed with the existing batch.

- [ ] **Step 1: Write the failing plan-client tests `src/data/__tests__/planClient.test.ts`**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRunPlan } from '../planClient';

const ok = (body: unknown) =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as Response;
const fail = (status: number) =>
  ({ ok: false, status, json: () => Promise.reject(new Error('no body')) }) as Response;

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('fetchRunPlan', () => {
  it('maps a valid plan onto the engine shape', async () => {
    fetchMock.mockResolvedValueOnce(
      ok({ newCardIds: ['a', 'b'], seenCardIds: ['c'], runBudget: 4 }),
    );
    const plan = await fetchRunPlan('n5');
    expect(plan).not.toBeNull();
    expect(plan!.newCardIds).toEqual(['a', 'b']);
    expect(plan!.runBudget).toBe(4);
    expect(plan!.perWaveNewCap).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith('/api/plan?pool=n5');
  });

  it('returns null when the server is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(fetchRunPlan('n5')).resolves.toBeNull();
  });

  it('returns null on an error status or an invalid payload', async () => {
    fetchMock.mockResolvedValueOnce(fail(503));
    await expect(fetchRunPlan('n5')).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce(ok({ nope: true }));
    await expect(fetchRunPlan('n5')).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: RED, then implement `src/data/planClient.ts`**

Run: `npx vitest run src/data/__tests__/planClient.test.ts` → FAIL (module not found).

```ts
import type { EnginePlan } from '../engine/types';
import { runPlanSchema } from '../shared/api';

/**
 * Mirrors `PLAN.perWaveNewCap` in server/planConfig.ts, which is the source of
 * truth. The client cannot import from server/, and the plan endpoint returns
 * budget rather than pacing, so this one number is duplicated deliberately.
 */
const PER_WAVE_NEW_CAP = 2;

/**
 * The run plan, or null when it can't be had. Never throws and never blocks
 * play: a null plan means "nothing is new", i.e. no ceremonies and ordinary
 * gameplay (spec §7).
 */
export async function fetchRunPlan(pool: string): Promise<EnginePlan | null> {
  try {
    const response = await fetch(`/api/plan?pool=${pool}`);
    if (!response.ok) return null;
    const plan = runPlanSchema.parse(await response.json());
    return {
      newCardIds: plan.newCardIds,
      runBudget: plan.runBudget,
      perWaveNewCap: PER_WAVE_NEW_CAP,
    };
  } catch {
    return null;
  }
}
```

Run again → PASS (3 tests).

- [ ] **Step 3: Recorder — buffer introductions**

In `src/data/recorder.ts`: import `IntroductionEvent`, add a buffer field `private introductions: IntroductionEvent[] = [];`, add the public method, and include the buffer in `flush()`.

```ts
  /** Called by the ceremony when a word has been introduced (typed or skipped). */
  recordIntroduction(cardId: string): void {
    this.introductions.push({ cardId, introducedAt: Date.now() });
  }
```

In `flush()`, change the early return and the batch to include introductions:

```ts
  private flush(): void {
    if (
      this.attempts.length === 0 &&
      this.wrongSubmits.length === 0 &&
      this.introductions.length === 0
    ) {
      return;
    }
    const batch: EventsBatch = {
      batchId: crypto.randomUUID(),
      attempts: this.attempts,
      wrongSubmits: this.wrongSubmits,
      introductions: this.introductions,
    };
    this.attempts = [];
    this.wrongSubmits = [];
    this.introductions = [];
    this.pipeline = this.pipeline.then(() => this.sendEvents(batch));
  }
```

Append a recorder test, using that file's real helpers (`ctx`, `ok`, `fetchMock`, `makeSnapshot`, `flush`, `eventsBodyOf`) exactly as the existing tests do:

```ts
describe('introductions (ceremony)', () => {
  it('flushes recorded introductions with the wave batch', async () => {
    fetchMock.mockResolvedValue(ok());
    const recorder = new RunRecorder(ctx);
    await flush();

    const view = { words: [], snapshot: makeSnapshot({ wave: 1 }) };
    recorder.recordIntroduction('neko');
    recorder.onEvent({ type: 'waveCleared', wave: 1 }, view);
    await flush();

    expect(eventsBodyOf().introductions).toEqual([
      { cardId: 'neko', introducedAt: expect.any(Number) },
    ]);
  });

  it('a wave with only introductions still flushes', async () => {
    fetchMock.mockResolvedValue(ok());
    const recorder = new RunRecorder(ctx);
    await flush();

    const view = { words: [], snapshot: makeSnapshot({ wave: 1 }) };
    recorder.recordIntroduction('neko');
    recorder.onEvent({ type: 'waveCleared', wave: 1 }, view);
    await flush();

    expect(eventsBodyOf().attempts).toEqual([]);
    expect(eventsBodyOf().introductions).toHaveLength(1);
  });
});
```

Widen `eventsBodyOf`'s return type in that file so the new field is typed:

```ts
function eventsBodyOf(): {
  attempts: unknown[];
  wrongSubmits: unknown[];
  introductions: unknown[];
  batchId: string;
} {
```

Existing recorder tests read individual fields (`eventsBodyOf().attempts`) rather than comparing whole bodies, so they need no other change — verify that holds before editing anything else.

- [ ] **Step 4: `useEngine` — accept and forward the plan**

In `src/ui/useEngine.ts`:
1. Add `plan?: EnginePlan;` to `RunOptions` (import the type).
2. Pass it into the engine in `start()`:
```ts
      config: { pauseOnWaveStart: opts.introduceWords ?? true },
      plan: opts.plan,
```
3. The `waveStarting` handler currently does `setIntroCards(event.cards)`. Change it to the newly introduced cards only:
```ts
      if (event.type === 'waveStarting') setIntroCards(event.newCards);
```

- [ ] **Step 5: `App.tsx` — fetch the plan, run the ceremony, drop the session seen-set**

Replace the session-scoped machinery with plan-driven state. Concretely:

1. Delete `seenIdsRef`, `unseenIntro`, `dismissIntro`, and the `prevStatus` effect that marked cards seen.
2. Hold the recorder so the ceremony can record into it, and hold plan-derived notices:
```ts
  const recorderRef = useRef<RunRecorder | null>(null);
  const [planNotice, setPlanNotice] = useState<string | null>(null);
```
3. `beginRun` gains a `plan` parameter and stores the recorder:
```ts
  const beginRun = useCallback(
    (mode: GameMode, cards: Card[], listVersion: string, pool: string, plan: EnginePlan | null) => {
      lastRunRef.current = { mode, cards, listVersion, pool };
      const recorder = new RunRecorder({ runId: crypto.randomUUID(), mode, pool, cards, listVersion });
      recorderRef.current = recorder;
      start({ mode, cards, plan: plan ?? undefined, onEvent: (event, view) => recorder.onEvent(event, view) });
      setScreen('game');
    },
    [start],
  );
```
4. `beginFromPool` fetches cards and plan together, and sets the notice:
```ts
  const beginFromPool = useCallback(async (mode: GameMode, pool: PoolId) => {
    setLoading(true);
    setLoadError(null);
    try {
      const [{ cards, listVersion }, plan] = await Promise.all([loadPool(pool), fetchRunPlan(pool)]);
      setPlanNotice(noticeFor(plan));
      beginRun(mode, cards, listVersion, pool, plan);
    } catch (error: unknown) {
      setLoadError(error instanceof DataLoadError ? error.message : 'unexpected load failure');
    } finally {
      setLoading(false);
    }
  }, [beginRun]);
```
5. Add the notice helper above the component:
```ts
/** What to tell the player about this run's new-word situation (spec §3.2, §7). */
function noticeFor(plan: EnginePlan | null): string | null {
  if (plan === null) return 'Word introductions need the server — playing without them.';
  if (plan.runBudget > 0) return null;
  if (plan.newCardIds.length === 0) return null;
  return "Today's new words are done — this run is review.";
}
```
6. Revenge and play-again pass `null` for the plan (revenge cards are all previously missed, so nothing is new):
```ts
        onRevenge={(missed) => lastRunRef.current
          && beginRun(lastRunRef.current.mode, missed, lastRunRef.current.listVersion, 'revenge', null)}
        onPlayAgain={() => lastRunRef.current
          && beginRun(
            lastRunRef.current.mode,
            lastRunRef.current.cards,
            lastRunRef.current.listVersion,
            lastRunRef.current.pool,
            null,
          )}
```
7. Pass the ceremony's wiring into `GameScreen`:
```ts
        introCards={introCards}
        planNotice={planNotice}
        onIntroduced={(cardId) => recorderRef.current?.recordIntroduction(cardId)}
        onIntroComplete={resume}
```

- [ ] **Step 6: `GameScreen` — render the ceremony**

Replace the `WaveIntroOverlay` import and usage in `src/ui/screens/GameScreen.tsx`:

```tsx
      {snapshot.status === 'waveIntro' && (
        <AcquisitionCeremony
          cards={introCards}
          onIntroduced={onIntroduced}
          onComplete={onIntroComplete}
        />
      )}
```

Its props interface gains `onIntroduced: (cardId: string) => void`, `onIntroComplete: () => void`, and `planNotice: string | null`; drop `onDismissIntro`. Render the notice in the HUD area while playing:

```tsx
      {planNotice !== null && <p className="plan-notice" data-testid="plan-notice">{planNotice}</p>}
```

Add to `src/index.css`:
```css
.plan-notice {
  position: absolute; top: 3rem; width: 100%; text-align: center;
  color: #8b98b8; font-size: 0.8rem; pointer-events: none;
}
```

- [ ] **Step 7: Delete the old overlay and update the App flow test**

```bash
git rm src/ui/screens/WaveIntroOverlay.tsx src/ui/__tests__/WaveIntroOverlay.test.tsx
```

`src/ui/__tests__/App.introFlow.test.tsx` tested the session seen-set that no longer exists. Rewrite it to the new contract, keeping the same file:

```tsx
// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Card, EngineSnapshot } from '../../engine/types';

const start = vi.fn();
const resume = vi.fn();
let mockSnapshot: EngineSnapshot;
let mockIntroCards: Card[];

vi.mock('../useEngine', () => ({
  useEngine: () => ({ snapshot: mockSnapshot, hostRef: { current: null }, start, resume, introCards: mockIntroCards }),
  isGameKey: () => false,
}));

import App from '../../App';

const card = (id: string): Card => ({
  id, kanji: '字', kana: ['かな'], gloss: 'g', pos: 'n', jlpt: 5, source: 'jlpt',
});

const snap = (over: Partial<EngineSnapshot>): EngineSnapshot => ({
  status: 'waveIntro', mode: 'reading', score: 0, lives: 3, wave: 1, combo: 0,
  kills: 0, wrongSubmits: 0, maxCombo: 0, bufferKana: '', bufferRomaji: '',
  lockedIds: [], missed: [], timeMs: 0, ...over,
});

describe('App plan wiring', () => {
  it('shows the ceremony for the wave’s new cards, and the notice when the server is absent', async () => {
    window.history.pushState({}, '', '/?mode=reading&pool=n5');
    mockIntroCards = [card('a')];
    mockSnapshot = snap({});
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        String(url).includes('/api/plan')
          ? Promise.reject(new Error('offline'))
          : Promise.resolve({
              ok: true, status: 200,
              json: () => Promise.resolve({ listVersion: 'v', level: 5, cards: [card('a')] }),
            } as Response),
      ),
    );

    render(<App />);
    await screen.findByTestId('ceremony');
    await waitFor(() => expect(screen.getByTestId('plan-notice')).toHaveTextContent(/need the server/i));
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 8: Full verification and commit**

Run: `npm run check` → green (every suite, including the rewritten App test).

```bash
git add -A
git commit -m "feat: plan-driven ceremonies replace the session-scoped word intro"
```

---

### Task 8: E2E proof and documentation

**Files:**
- Modify: `e2e/game.spec.ts`, `README.md`, `docs/superpowers/specs/2026-07-22-kotoba-drop-design.md`
- Test: the e2e itself

**Interfaces:**
- Consumes: everything above. Produces: no new code interfaces.

- [ ] **Step 1: Extend the reading spec**

The e2e database is wiped per run, so every card is new and the ceremony must appear. In `e2e/game.spec.ts`, the shared helper currently waits for `waveIntro` and presses Enter to dismiss a table. Replace that dismissal with typing through the ceremony:

```ts
async function clearCeremony(page: Page) {
  await page.waitForFunction(() => window.__kotoba?.snapshot().status === 'waveIntro');
  // Fresh e2e DB: every word is new, so the ceremony is showing.
  while (await page.getByTestId('ceremony').isVisible().catch(() => false)) {
    const reading = await page.getByTestId('ceremony-reading').textContent();
    if (reading === null) break;
    await page.keyboard.type(toRomaji(reading), { delay: 20 });
    await page.keyboard.press('Enter');
    await page.waitForTimeout(50);
  }
  await page.waitForFunction(() => window.__kotoba?.snapshot().status === 'playing');
}
```

Add `data-testid="ceremony-reading"` to the reading paragraph in `AcquisitionCeremony.tsx` if it isn't already addressable, and call `clearCeremony(page)` where the old Enter-dismissal was.

The reading spec already polls `/api/stats/overview` to prove attempts persist — leave that assertion exactly as it is. Add the **introduction** proof after it. There is no introductions endpoint, but `/api/plan` observes the same table: a card that has been introduced must move out of `newCardIds`.

Capture the plan before playing (at the very start of the reading spec, right after `page.goto`):

```ts
  const before = await (await page.request.get('/api/plan?pool=n5')).json() as {
    newCardIds: string[];
    seenCardIds: string[];
  };
  expect(before.seenCardIds).toHaveLength(0); // globalSetup wiped the e2e DB
```

and after the existing score/overview assertions:

```ts
  await expect
    .poll(async () => {
      const res = await page.request.get('/api/plan?pool=n5');
      if (!res.ok()) return 0;
      const plan = (await res.json()) as { seenCardIds: string[] };
      return plan.seenCardIds.length;
    }, { timeout: 15_000 })
    .toBeGreaterThan(0);
```

That passes only if an `introductions` (or `attempts`) row actually reached SQLite through the ceremony and the batch flush.

- [ ] **Step 2: Run the e2e**

Stop any `npm run dev` / `npm start` first — they hold port 8790.

Run: `npm run e2e`
Expected: 2 passed. If typing through the ceremony flakes because a reading round-trips to macron romaji (a katakana word with ー), press `Escape` to skip that card instead of typing it — the skip path is equally valid for this test and still records an introduction. Note the change in your report if you take it.

- [ ] **Step 3: Documentation**

In `README.md`, under `## Status`, replace the milestone line with:

```markdown
Milestone 4 (sub-project A) of the design spec: word introductions are now
player-scoped — a word is "new" only if you have never met it, each new word
gets an acquisition moment with an example sentence and kanji-part meanings,
and your profile's daily word goal caps how many you meet per day. See
`docs/superpowers/specs/2026-07-24-word-introduction-v2-design.md`.
```

In `docs/superpowers/specs/2026-07-22-kotoba-drop-design.md` §3.6, mark the phased plan as delivered by appending:

```markdown
**Status:** both phases delivered. The M3 (player-scoped) phase shipped in M4
sub-project A — see `2026-07-24-word-introduction-v2-design.md`, which also
replaced the M2 table with an acquisition ceremony and added the daily
new-word budget.
```

- [ ] **Step 4: Final sweep and commit**

Run: `npm run check && npm run coverage` → green, thresholds hold.

```bash
git add -A
git commit -m "test: e2e types through the ceremony; docs: word introduction v2"
```

---

## Milestone Exit

Play several sessions across more than one day — the budget's day boundary only shows up over time. Questions to answer before planning M4's next sub-project:

1. Does the acquisition moment feel like *gaining* something now, or is it still a speed bump?
2. Are 6 new words per run and 2 per wave the right pacing? (Both live in `server/planConfig.ts`; the daily 20 is in your profile.)
3. Do the example sentences earn their space — are they short enough to read at a glance, and useful when they appear?
4. Does the forced recycling feel like helpful rehearsal, or like the game repeating itself?

## Deferred (deliberately absent)

Personal association notes; audio pronunciation; the related-words hook; cross-session review scheduling; ceremony sound (waits for sub-project C, which builds the audio system). Sub-project B (custom list import) and C (the juice pass) remain separate. The M3.1 hygiene queue and the leech-vs-hint-dependence product question are untouched by this plan.
