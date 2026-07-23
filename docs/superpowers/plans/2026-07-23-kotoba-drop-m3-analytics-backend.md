# kotoba-drop Milestone 3 (Analytics Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every attempt lands in a local SQLite database and a Stats screen renders the five v1 analytics views (words learned per direction, vocab level estimate, pace vs the December exam, 30-day trend + streak, leech list), with a profile (target level / exam date / daily goal) driving the pace math.

**Architecture:** A local Hono server (`server/`) with better-sqlite3 + Drizzle owns `data/kotoba.db` (WAL, drizzle-kit migrations, cards seeded from `public/data` at boot). The client gains a `RunRecorder` that buffers engine events per run and flushes idempotent batches at wave/run end, with a `localStorage` outbox drained at launch so gameplay never blocks and history is never lost. Stats math lives server-side in pure functions with injectable `now`, golden-tested against hand-computed fixtures. Vite proxies `/api` in dev; `npm start` serves the built client and the API from one process.

**Tech Stack:** Existing (Vite 8, React 19, TS strict + erasableSyntaxOnly, Vitest 4, Playwright, zod 4) + `hono@^4`, `@hono/node-server@^1`, `better-sqlite3@^12`, `drizzle-orm@^0.45`, `drizzle-kit` (devDep), `recharts@^3`, `concurrently@^9` + `cross-env@^7` (devDeps).

**Spec:** `docs/superpowers/specs/2026-07-22-kotoba-drop-design.md` §4 (architecture), §5 (data model + v1 five), §6 (API — `/api/lists` deliberately deferred to M4 with the import UI), §7 (error handling), §8 (testing), §9.3 (scope). Base: current `main` (post input-acceptance fix, 104 unit tests, HEAD ≈ `acf9757`).

## Global Constraints

- `src/engine/` stays pure (no react/pixi/server imports; no Math.random/Date.now). Client non-engine code MAY use `Date.now()`/`crypto.randomUUID()`.
- DB file: `data/kotoba.db` (already gitignored via `data/*.db`); override with env `KOTOBA_DB`; server port env `KOTOBA_PORT`, default **8790**. WAL mode. drizzle-kit migrations COMMITTED under `drizzle/`. The server never deletes or recreates an incompatible DB — it serves 503 with the DB path and recovery guidance, and the client shows a DB error screen (spec §7).
- Ingest is idempotent: run creation keyed by client-generated UUID (`INSERT OR IGNORE`), event batches keyed by `batchId` recorded in `ingested_batches` — replaying an outbox payload can never double-count (spec §6).
- Gameplay NEVER blocks on the API: buffer in memory → flush at `waveCleared` + `gameOver` → one retry → `localStorage` outbox (`kd.outbox.v1`, FIFO, cap 50 payloads) drained at next app launch (spec §4.3, §7).
- Raw capture fields per attempt are spec §5.2 verbatim: `cardId, mode, outcome(kill|miss), msToFirstKey (null if never targeted), msToKill (null on miss), backspaceCount, hintShown, wasTargeted, airborneCount, speedLevel(=wave), createdAt`. Wrong submits: `submittedKana, airborneCardIds, matchedOtherCardId (a DIFFERENT pool card whose reading the submission matches, else null), createdAt`. Runs: `startedAt, endedAt, mode, pool, score, wavesCleared, durationMs (= engine timeMs: pause-free by construction), pausedMs (= wall elapsed − timeMs, floored at 0), maxCombo, accuracy, appVersion, listVersion`.
- Stats definitions are spec §5.3 verbatim; every threshold lives ONLY in `server/statsConfig.ts`: learned = ≥3 encounters in that direction AND weighted accuracy ≥0.8 over the last 5 encounters (kill=1, hinted kill=0.5, miss=0); level estimate = the most advanced level (lowest N-number) with coverage ≥0.6 AND mastery ≥0.7, where coverage = encountered/total (any direction) and mastery = learned-in-≥1-direction/encountered — labeled "vocab-only estimate" in the UI; pace = learned-in-last-14-days ÷ 14 vs remaining-unlearned-target-level-words ÷ days-to-exam; leech strength = round(100 × (0.7 × recency-weighted accuracy + 0.3 × speed factor)) over the last 8 attempts, weights 0.85^age, speed factor = clamp01(1 − avgKillMs/15000), listed ascending, encounters ≥3, top 15.
- Stats functions take `nowMs` as a parameter (tests inject; routes pass `Date.now()`).
- Coverage gate extends to the server: vite.config `coverage.include` gains `'server/**'` (exclude `server/index.ts` bootstrap and `drizzle/`), thresholds stay 80.
- Ports: 5173 belongs to the user's OTHER project — never touch it. Client dev 5174+ (vite default drift is fine), e2e client pinned 5183 `--strictPort`, API 8790. E2E uses `KOTOBA_DB=data/e2e.db`, wiped by a Playwright globalSetup.
- TS strict + erasableSyntaxOnly; `npm run check` (tsc -b, oxlint, vitest) green at every task boundary; conventional commits; no attribution footers; files ≤800 lines, functions <50 lines.

---

## File Structure (all tasks)

```
kotoba-drop/
  server/
    db/schema.ts            # T1: Drizzle tables: cards, runs, attempts, wrong_submits, profile, ingested_batches
    db/connect.ts           # T1: open DB (WAL), run migrations, seed cards, DbUnavailable state
    statsConfig.ts          # T5: every stats threshold constant
    stats.ts                # T5: pure stats functions (nowMs injected)
    routes/runs.ts          # T2: POST /runs, POST /runs/:id/events, PATCH /runs/:id
    routes/profile.ts       # T2: GET/PUT /profile (defaults row)
    routes/stats.ts         # T5: GET /stats/overview, GET /stats/words
    app.ts                  # T1: buildApp(db) — Hono app factory (testable)
    index.ts                # T1(+T7): entry: connect, listen; --dist --open flags in T7
    testDb.ts               # T1: temp-file DB factory for route/stats tests
  drizzle/                  # T1: committed generated migrations
  drizzle.config.ts         # T1
  tsconfig.server.json      # T1 (referenced from root tsconfig)
  src/shared/api.ts         # T2: zod request/response schemas shared client<->server
  src/data/recorder.ts      # T4: RunRecorder (buffer, batch, flush, retry)
  src/data/outbox.ts        # T4: localStorage FIFO outbox
  src/data/apiClient.ts     # T4: tiny typed fetch wrapper (client side)
  src/engine/{GameEngine,types,__tests__}  # T3: maxCombo
  src/data/loader.ts        # T3: loadPool returns { cards, listVersion }
  src/ui/screens/StatsScreen.tsx           # T6
  src/ui/screens/ServerErrorScreen.tsx     # T6 (server down / DB error, shows path + recovery)
  src/App.tsx, TitleScreen, useEngine      # T4/T6 wiring
  e2e/global-setup.ts, e2e/game.spec.ts    # T7
  vite.config.ts, playwright.config.ts, package.json, README  # T1/T7
```

Task order: T1 server foundation → T2 ingest+profile routes → T3 engine/loader smalls → T4 recorder+wiring → T5 stats engine → T6 stats UI → T7 e2e + npm start + docs.

---

### Task 1: Server foundation — schema, migrations, boot seed, app factory, scripts

**Files:**
- Create: `server/db/schema.ts`, `server/db/connect.ts`, `server/app.ts`, `server/index.ts`, `server/testDb.ts`, `drizzle.config.ts`, `tsconfig.server.json`
- Create (generated, committed): `drizzle/0000_*.sql` + `drizzle/meta/*`
- Modify: `package.json` (deps + scripts), `vite.config.ts` (proxy + test include + coverage include), `tsconfig.json` (reference), `.gitignore` (nothing new needed — `data/*.db` already covers)
- Test: `server/__tests__/foundation.test.ts`

**Interfaces:**
- Consumes: `public/data/jlpt-n*.json` (committed card data), `levelFileSchema` from `src/data/schema.ts`.
- Produces (later tasks rely on, exact):
  - `connect(dbPath: string): DbHandle` where `DbHandle = { db: BetterSQLite3Database<typeof schema>; sqlite: Database.Database }` — runs migrations + seeds cards; THROWS `DbOpenError` (carries `dbPath`) on migration failure, never deletes.
  - `buildApp(handle: DbHandle | DbOpenError): Hono` — when given the error, every `/api/*` route returns 503 `{ dbError: { path, message, recovery } }`; `GET /api/health` → `{ ok: true, cards: number }`.
  - `makeTestDb(): { handle: DbHandle; cleanup(): void }` (temp file under scratch, WAL off is fine for tests).
  - npm scripts: `dev:client`, `dev:server`, `dev` (concurrently both), `dev:e2e` (client 5183 + server on e2e DB), `db:generate` (drizzle-kit).

- [ ] **Step 1: Install deps**

```bash
cd ~/kotoba-drop
npm install hono@^4 @hono/node-server@^1 better-sqlite3@^12 drizzle-orm@^0.45 recharts@^3
npm install -D drizzle-kit @types/better-sqlite3 concurrently@^9 cross-env@^7
```

Record installed versions in your report. better-sqlite3 compiles/prebuilds for Node 22 on Windows (proven on this machine by the n2-prep project).

- [ ] **Step 2: Write `server/db/schema.ts`**

```ts
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const cards = sqliteTable('cards', {
  id: text('id').primaryKey(),
  kanji: text('kanji'),
  kana: text('kana', { mode: 'json' }).$type<string[]>().notNull(),
  gloss: text('gloss').notNull(),
  pos: text('pos').notNull(),
  jlpt: integer('jlpt'),
  source: text('source').notNull(),
  listVersion: text('list_version').notNull(),
});

export const runs = sqliteTable('runs', {
  id: text('id').primaryKey(), // client-generated UUID (idempotent create)
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at'),
  mode: text('mode').notNull(),
  pool: text('pool').notNull(),
  score: integer('score'),
  wavesCleared: integer('waves_cleared'),
  durationMs: integer('duration_ms'),
  pausedMs: integer('paused_ms'),
  maxCombo: integer('max_combo'),
  accuracy: real('accuracy'),
  appVersion: text('app_version').notNull(),
  listVersion: text('list_version').notNull(),
});

export const attempts = sqliteTable('attempts', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id').notNull().references(() => runs.id),
  cardId: text('card_id').notNull(),
  mode: text('mode').notNull(),
  outcome: text('outcome').notNull(), // 'kill' | 'miss'
  msToFirstKey: integer('ms_to_first_key'),
  msToKill: integer('ms_to_kill'),
  backspaceCount: integer('backspace_count').notNull(),
  hintShown: integer('hint_shown', { mode: 'boolean' }).notNull(),
  wasTargeted: integer('was_targeted', { mode: 'boolean' }).notNull(),
  airborneCount: integer('airborne_count').notNull(),
  speedLevel: integer('speed_level').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const wrongSubmits = sqliteTable('wrong_submits', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  runId: text('run_id').notNull().references(() => runs.id),
  submittedKana: text('submitted_kana').notNull(),
  airborneCardIds: text('airborne_card_ids', { mode: 'json' }).$type<string[]>().notNull(),
  matchedOtherCardId: text('matched_other_card_id'),
  createdAt: integer('created_at').notNull(),
});

export const profile = sqliteTable('profile', {
  id: integer('id').primaryKey(), // single row, id = 1
  targetLevel: integer('target_level').notNull(),
  examDate: text('exam_date').notNull(), // ISO yyyy-mm-dd
  dailyWordGoal: integer('daily_word_goal').notNull(),
});

export const ingestedBatches = sqliteTable('ingested_batches', {
  batchId: text('batch_id').primaryKey(),
  runId: text('run_id').notNull(),
  receivedAt: integer('received_at').notNull(),
});
```

- [ ] **Step 3: Write `drizzle.config.ts`, generate + commit the migration**

```ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'sqlite',
  schema: './server/db/schema.ts',
  out: './drizzle',
});
```

Add script `"db:generate": "drizzle-kit generate"` and run `npm run db:generate` — commit the emitted `drizzle/` directory. (If drizzle-kit's CLI flags differ in the installed version, follow its error output and record the change.)

- [ ] **Step 4: Write `server/db/connect.ts`**

```ts
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
import { levelFileSchema } from '../../src/data/schema';
import * as schema from './schema';

export type DbHandle = { db: BetterSQLite3Database<typeof schema>; sqlite: Database.Database };

export class DbOpenError extends Error {
  readonly dbPath: string;

  constructor(dbPath: string, cause: unknown) {
    super(`could not open or migrate the database at ${dbPath}`, { cause });
    this.name = 'DbOpenError';
    this.dbPath = dbPath;
  }
}

const LEVELS = [5, 4, 3, 2] as const;

/** Idempotent: INSERT OR REPLACE all committed cards (4,678 rows, one transaction). */
function seedCards(handle: DbHandle): void {
  const upsert = handle.sqlite.prepare(
    `INSERT OR REPLACE INTO cards (id, kanji, kana, gloss, pos, jlpt, source, list_version)
     VALUES (@id, @kanji, @kana, @gloss, @pos, @jlpt, @source, @listVersion)`,
  );
  const tx = handle.sqlite.transaction((rows: Record<string, unknown>[]) => {
    for (const row of rows) upsert.run(row);
  });
  const rows: Record<string, unknown>[] = [];
  for (const level of LEVELS) {
    const file = levelFileSchema.parse(
      JSON.parse(readFileSync(`public/data/jlpt-n${level}.json`, 'utf8')),
    );
    for (const card of file.cards) {
      rows.push({
        id: card.id,
        kanji: card.kanji,
        kana: JSON.stringify(card.kana),
        gloss: card.gloss,
        pos: card.pos,
        jlpt: card.jlpt,
        source: card.source,
        listVersion: file.listVersion,
      });
    }
  }
  tx(rows);
}

function ensureProfileRow(handle: DbHandle): void {
  handle.sqlite
    .prepare(
      `INSERT OR IGNORE INTO profile (id, target_level, exam_date, daily_word_goal)
       VALUES (1, 2, '2026-12-06', 20)`,
    )
    .run();
}

/** Opens + migrates + seeds. Never deletes: a failed migration throws DbOpenError. */
export function connect(dbPath: string): DbHandle {
  try {
    mkdirSync(dirname(dbPath), { recursive: true });
    const sqlite = new Database(dbPath);
    sqlite.pragma('journal_mode = WAL');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: 'drizzle' });
    const handle = { db, sqlite };
    seedCards(handle);
    ensureProfileRow(handle);
    return handle;
  } catch (error: unknown) {
    throw new DbOpenError(dbPath, error);
  }
}
```

- [ ] **Step 5: Write `server/app.ts` (factory; routes mount in T2/T5) and `server/index.ts`**

`server/app.ts`:
```ts
import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { DbOpenError, type DbHandle } from './db/connect';

export const RECOVERY =
  'The app never deletes your history. Back up the file, then either restore a copy or move it aside and restart to begin a fresh database.';

export function buildApp(handle: DbHandle | DbOpenError): Hono {
  const app = new Hono();

  if (handle instanceof DbOpenError) {
    app.all('/api/*', (c) =>
      c.json({ dbError: { path: handle.dbPath, message: handle.message, recovery: RECOVERY } }, 503),
    );
    return app;
  }

  app.get('/api/health', (c) => {
    const row = handle.db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM cards`);
    return c.json({ ok: true, cards: row?.n ?? 0 });
  });

  return app;
}
```

`server/index.ts`:
```ts
import { serve } from '@hono/node-server';
import { buildApp } from './app';
import { connect, DbOpenError } from './db/connect';

const dbPath = process.env.KOTOBA_DB ?? 'data/kotoba.db';
const port = Number(process.env.KOTOBA_PORT ?? 8790);

let handle;
try {
  handle = connect(dbPath);
  console.log(`kotoba-drop api: db ready at ${dbPath}`);
} catch (error: unknown) {
  if (!(error instanceof DbOpenError)) throw error;
  handle = error;
  console.error(`DB UNAVAILABLE: ${error.message}`);
}

serve({ fetch: buildApp(handle).fetch, port }, () => {
  console.log(`kotoba-drop api listening on http://localhost:${port}`);
});
```

`server/testDb.ts`:
```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connect, type DbHandle } from './db/connect';

export function makeTestDb(): { handle: DbHandle; cleanup(): void } {
  const dir = mkdtempSync(join(tmpdir(), 'kotoba-test-'));
  const handle = connect(join(dir, 'test.db'));
  return {
    handle,
    cleanup(): void {
      handle.sqlite.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
```

- [ ] **Step 6: tsconfigs, scripts, vite proxy + test config**

`tsconfig.server.json`:
```json
{
  "extends": "./tsconfig.node.json",
  "compilerOptions": { "composite": true, "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.server.tsbuildinfo" },
  "include": ["server/**/*.ts", "src/data/schema.ts", "src/shared/**/*.ts", "src/engine/types.ts"]
}
```
Add `{ "path": "./tsconfig.server.json" }` to the root `tsconfig.json` references. If `tsconfig.node.json`'s existing options conflict with `composite` reuse, mirror its compilerOptions instead of extending — record what you did.

`package.json` scripts (replace `dev`, add the rest):
```json
    "dev:client": "vite",
    "dev:server": "tsx watch server/index.ts",
    "dev": "concurrently -k npm:dev:client npm:dev:server",
    "dev:e2e": "concurrently -k \"vite --port 5183 --strictPort\" \"cross-env KOTOBA_DB=data/e2e.db tsx server/index.ts\"",
    "db:generate": "drizzle-kit generate",
```

`vite.config.ts` — add inside `defineConfig({...})`:
```ts
  server: {
    proxy: { '/api': 'http://localhost:8790' },
  },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
  },
```
and in the `test` block: `include: ['src/**/*.test.{ts,tsx}', 'server/**/*.test.ts']`, and coverage `include: ['src/engine/**', 'src/data/**', 'server/**']` with `exclude: ['server/index.ts', 'server/testDb.ts']` added alongside. Declare the global in `src/global.d.ts`: `declare const __APP_VERSION__: string;`

- [ ] **Step 7: Write failing foundation tests `server/__tests__/foundation.test.ts`**

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { buildApp, RECOVERY } from '../app';
import { DbOpenError } from '../db/connect';
import { makeTestDb } from '../testDb';

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe('server foundation', () => {
  it('connect() migrates and seeds all committed cards, idempotently', () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const count = () =>
      t.handle.db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM cards`)?.n ?? 0;
    const first = count();
    expect(first).toBeGreaterThan(4000);
    // seeding again (fresh connect on same file) must not duplicate
    expect(count()).toBe(first);
  });

  it('creates the default profile row (N2, 2026-12-06, 20/day)', () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const row = t.handle.sqlite.prepare('SELECT * FROM profile WHERE id = 1').get() as {
      target_level: number; exam_date: string; daily_word_goal: number;
    };
    expect(row.target_level).toBe(2);
    expect(row.exam_date).toBe('2026-12-06');
    expect(row.daily_word_goal).toBe(20);
  });

  it('GET /api/health reports card count', async () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const res = await buildApp(t.handle).request('/api/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; cards: number };
    expect(body.ok).toBe(true);
    expect(body.cards).toBeGreaterThan(4000);
  });

  it('a DbOpenError app answers every /api route with 503 + path + recovery', async () => {
    const app = buildApp(new DbOpenError('C:/somewhere/kotoba.db', new Error('locked')));
    const res = await app.request('/api/health');
    expect(res.status).toBe(503);
    const body = (await res.json()) as { dbError: { path: string; recovery: string } };
    expect(body.dbError.path).toBe('C:/somewhere/kotoba.db');
    expect(body.dbError.recovery).toBe(RECOVERY);
  });
});
```

- [ ] **Step 8: RED → implement (Steps 2-6 files) → GREEN**

Run: `npx vitest run server` — first without the implementation files present (module-not-found RED), then green after. Note: card seeding reads `public/data` relative to CWD — vitest runs from the repo root, which matches.

- [ ] **Step 9: Full gate + smoke + commit**

Run: `npm run check` (all suites + the 4 new ones green; tsc must pass with the new project reference).
Smoke: `npx tsx server/index.ts` briefly — expect the two boot lines, then Ctrl-C (or kill the process); `data/kotoba.db` appears. Do not leave it running.

```bash
git add -A
git commit -m "feat: hono server foundation with drizzle schema, migrations, and card seeding"
```

---

### Task 2: Ingest + profile routes (idempotent runs/events, finalize, profile)

**Files:**
- Create: `src/shared/api.ts`, `server/routes/runs.ts`, `server/routes/profile.ts`
- Modify: `server/app.ts` (mount routes)
- Test: `server/__tests__/runsRoutes.test.ts`, `server/__tests__/profileRoutes.test.ts`

**Interfaces:**
- Consumes: `DbHandle`, `makeTestDb`, drizzle tables from T1.
- Produces (T4/T5/T6 rely on, exact — all in `src/shared/api.ts`):

```ts
import { z } from 'zod';

export const gameModeSchema = z.union([z.literal('reading'), z.literal('recall')]);

export const createRunSchema = z.object({
  id: z.uuid(),
  startedAt: z.number().int().positive(),
  mode: gameModeSchema,
  pool: z.string().min(1), // n5|n4|n3|n2|mixed|revenge
  appVersion: z.string().min(1),
  listVersion: z.string().min(1),
});

export const attemptSchema = z.object({
  cardId: z.string().min(1),
  mode: gameModeSchema,
  outcome: z.union([z.literal('kill'), z.literal('miss')]),
  msToFirstKey: z.number().int().nonnegative().nullable(),
  msToKill: z.number().int().nonnegative().nullable(),
  backspaceCount: z.number().int().nonnegative(),
  hintShown: z.boolean(),
  wasTargeted: z.boolean(),
  airborneCount: z.number().int().nonnegative(),
  speedLevel: z.number().int().positive(),
  createdAt: z.number().int().positive(),
});

export const wrongSubmitSchema = z.object({
  submittedKana: z.string().min(1),
  airborneCardIds: z.array(z.string()),
  matchedOtherCardId: z.string().nullable(),
  createdAt: z.number().int().positive(),
});

export const eventsBatchSchema = z.object({
  batchId: z.uuid(),
  attempts: z.array(attemptSchema),
  wrongSubmits: z.array(wrongSubmitSchema),
});

export const finalizeRunSchema = z.object({
  endedAt: z.number().int().positive(),
  score: z.number().int().nonnegative(),
  wavesCleared: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  pausedMs: z.number().int().nonnegative(),
  maxCombo: z.number().int().nonnegative(),
  accuracy: z.number().min(0).max(1),
});

export const profileSchema = z.object({
  targetLevel: z.union([z.literal(5), z.literal(4), z.literal(3), z.literal(2)]),
  examDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dailyWordGoal: z.number().int().positive().max(500),
});

export type CreateRun = z.infer<typeof createRunSchema>;
export type AttemptEvent = z.infer<typeof attemptSchema>;
export type WrongSubmitEvent = z.infer<typeof wrongSubmitSchema>;
export type EventsBatch = z.infer<typeof eventsBatchSchema>;
export type FinalizeRun = z.infer<typeof finalizeRunSchema>;
export type Profile = z.infer<typeof profileSchema>;
```

- Route behavior: `POST /api/runs` (createRunSchema) → 201 on insert, 200 if the id already exists (idempotent replay), body `{ id }`. `POST /api/runs/:id/events` (eventsBatchSchema) → 404 unknown run; if `batchId` already ingested → 200 `{ duplicate: true }` inserting NOTHING; else insert all rows + the batch marker in ONE transaction → 201 `{ inserted: { attempts, wrongSubmits } }`. `PATCH /api/runs/:id` (finalizeRunSchema) → 404 unknown, else 200; finalizing twice overwrites with identical values (idempotent). `GET /api/profile` → the row; `PUT /api/profile` (profileSchema) → upsert row id 1 → 200 with the new row. All zod failures → 400 `{ error: <zod message> }`.

- [ ] **Step 1: Write failing route tests** — `server/__tests__/runsRoutes.test.ts` covers: create 201 then replay 200; events happy path inserts and returns counts; batch replay `{duplicate:true}` with row counts unchanged; unknown run 404; malformed attempt 400 and NOTHING inserted (transaction atomicity: send a batch whose 2nd attempt violates schema → zod rejects pre-insert; then send a batch with a valid schema but nonexistent run → 404, zero rows); finalize roundtrip persists all fields. `profileRoutes.test.ts`: GET returns defaults; PUT updates and GET reflects. Use `buildApp(makeTestDb().handle).request(...)` with JSON bodies (Hono's `app.request('/api/runs', { method: 'POST', body: JSON.stringify(x), headers: { 'content-type': 'application/json' } })`). Write exact assertions; count rows via `handle.sqlite.prepare('SELECT COUNT(*) AS n FROM attempts').get()`.

- [ ] **Step 2: RED** — `npx vitest run server` → new files fail (module not found).

- [ ] **Step 3: Implement `server/routes/runs.ts`**

```ts
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { createRunSchema, eventsBatchSchema, finalizeRunSchema } from '../../src/shared/api';
import type { DbHandle } from '../db/connect';
import { attempts, ingestedBatches, runs, wrongSubmits } from '../db/schema';

export function runsRoutes(handle: DbHandle): Hono {
  const app = new Hono();

  app.post('/', async (c) => {
    const parsed = createRunSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    const run = parsed.data;
    const existing = handle.db.select().from(runs).where(eq(runs.id, run.id)).get();
    if (existing) return c.json({ id: run.id }, 200);
    handle.db.insert(runs).values({
      id: run.id,
      startedAt: run.startedAt,
      mode: run.mode,
      pool: run.pool,
      appVersion: run.appVersion,
      listVersion: run.listVersion,
    }).run();
    return c.json({ id: run.id }, 201);
  });

  app.post('/:id/events', async (c) => {
    const runId = c.req.param('id');
    const parsed = eventsBatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    const run = handle.db.select().from(runs).where(eq(runs.id, runId)).get();
    if (!run) return c.json({ error: 'unknown run' }, 404);
    const batch = parsed.data;
    const already = handle.db
      .select().from(ingestedBatches).where(eq(ingestedBatches.batchId, batch.batchId)).get();
    if (already) return c.json({ duplicate: true }, 200);

    const insertAll = handle.sqlite.transaction(() => {
      handle.db.insert(ingestedBatches)
        .values({ batchId: batch.batchId, runId, receivedAt: Date.now() }).run();
      for (const a of batch.attempts) {
        handle.db.insert(attempts).values({ runId, ...a }).run();
      }
      for (const w of batch.wrongSubmits) {
        handle.db.insert(wrongSubmits).values({ runId, ...w }).run();
      }
    });
    insertAll();
    return c.json(
      { inserted: { attempts: batch.attempts.length, wrongSubmits: batch.wrongSubmits.length } },
      201,
    );
  });

  app.patch('/:id', async (c) => {
    const runId = c.req.param('id');
    const parsed = finalizeRunSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    const run = handle.db.select().from(runs).where(eq(runs.id, runId)).get();
    if (!run) return c.json({ error: 'unknown run' }, 404);
    handle.db.update(runs).set(parsed.data).where(eq(runs.id, runId)).run();
    return c.json({ ok: true }, 200);
  });

  return app;
}
```

`server/routes/profile.ts`:
```ts
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { profileSchema } from '../../src/shared/api';
import type { DbHandle } from '../db/connect';
import { profile } from '../db/schema';

export function profileRoutes(handle: DbHandle): Hono {
  const app = new Hono();

  app.get('/', (c) => {
    const row = handle.db.select().from(profile).where(eq(profile.id, 1)).get();
    return c.json(row);
  });

  app.put('/', async (c) => {
    const parsed = profileSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    handle.db.update(profile).set(parsed.data).where(eq(profile.id, 1)).run();
    return c.json(handle.db.select().from(profile).where(eq(profile.id, 1)).get());
  });

  return app;
}
```

Mount in `server/app.ts` (inside the non-error branch): `app.route('/api/runs', runsRoutes(handle)); app.route('/api/profile', profileRoutes(handle));`

- [ ] **Step 4: GREEN + full gate + commit**

Run: `npx vitest run server` → all pass. `npm run check` green.

```bash
git add -A
git commit -m "feat: idempotent run and event ingest routes plus profile api"
```

---

### Task 3: Engine maxCombo + loader listVersion

**Files:**
- Modify: `src/engine/types.ts` (snapshot `maxCombo: number`), `src/engine/GameEngine.ts`, `src/data/loader.ts`
- Test: append to `src/engine/__tests__/GameEngine.test.ts`, adjust `src/data/__tests__/loader.test.ts`, fix `IDLE_SNAPSHOT` in `src/ui/useEngine.ts` and the fixtures in `src/ui/__tests__/Hud.test.tsx` + `src/ui/__tests__/ResultsScreen.test.tsx` + `src/ui/__tests__/App.introFlow.test.tsx` (additive `maxCombo: 0` — same pattern as M2's snapshot widening)

**Interfaces:**
- Produces: `EngineSnapshot.maxCombo` (peak combo of the run); `loadPool(pool): Promise<{ cards: Card[]; listVersion: string }>` — **breaking signature change**; `POOL_LABELS`/`PoolId`/`DataLoadError`/`clearDataCache` unchanged. Callers to update NOW: `src/App.tsx` (`beginFromPool` destructures `{ cards, listVersion }`, stores listVersion in `lastRunRef`), loader tests. For `mixed`, `listVersion` = the n5 file's version (all four files share one pipeline version).

- [ ] **Step 1: Failing engine test** (append to the M2 describe): kill two words with a wrong submit between → snapshot `maxCombo` is 1 if combo reset between kills, or assert a simpler deterministic sequence: kill, kill (combo 2), wrong submit (combo 0), kill (combo 1) → `maxCombo === 2`, `combo === 1`. Use the 3-kanji-card fixture and `typeWord`; follow the file's existing kill-loop idiom.
- [ ] **Step 2: Failing loader test edits**: update existing tests to destructure `{ cards }` and add one asserting `listVersion` equals the payload's `listVersion` (and for `mixed`, the n5 one).
- [ ] **Step 3: Implement**: GameEngine — `private maxCombo = 0;` bump in `killWord` (`if (this.combo > this.maxCombo) this.maxCombo = this.combo;` after the increment), expose in snapshot. Loader — `loadLevel` keeps returning `Card[]` internally but also caches the parsed file's `listVersion` in a module map; `loadPool` returns the object. Update `App.tsx` call sites minimally.
- [ ] **Step 4: GREEN + gate + commit**: `npm run check` all green (fix any snapshot-literal compile errors additively).

```bash
git add -A && git commit -m "feat: track max combo and surface list version from the loader"
```

---

### Task 4: Client recorder, outbox, and wiring

**Files:**
- Create: `src/data/apiClient.ts`, `src/data/recorder.ts`, `src/data/outbox.ts`
- Modify: `src/ui/useEngine.ts` (RunOptions gains `onEvent`), `src/App.tsx` (create/attach recorder per run, drain outbox on boot)
- Test: `src/data/__tests__/recorder.test.ts`, `src/data/__tests__/outbox.test.ts`

**Interfaces:**
- Consumes: shared api types (T2), `EngineSnapshot.maxCombo` + `loadPool` shape (T3), engine events, `normalizeReading` from `src/engine/matcher`.
- Produces:

```ts
// src/data/apiClient.ts — thin fetch wrapper; every method throws ApiError(status) on !ok
export class ApiError extends Error { readonly status: number }
export const api = {
  createRun(run: CreateRun): Promise<void>,
  postEvents(runId: string, batch: EventsBatch): Promise<void>,
  finalizeRun(runId: string, body: FinalizeRun): Promise<void>,
};

// src/data/outbox.ts — localStorage FIFO, key 'kd.outbox.v1', cap 50 (drop oldest, console.warn)
export interface OutboxEntry {
  kind: 'createRun' | 'events' | 'finalize';
  runId: string;
  payload: unknown;
}
export function pushOutbox(entry: OutboxEntry): void;
export function drainOutbox(): Promise<{ drained: number; remaining: number }>; // replays via api in order; stops at first failure, keeping the rest

// src/data/recorder.ts
export interface RecorderContext {
  runId: string;        // crypto.randomUUID() from App
  mode: GameMode;
  pool: string;
  cards: Card[];        // the run's pool (for matchedOtherCardId)
  listVersion: string;
}
export class RunRecorder {
  constructor(ctx: RecorderContext);
  /** Wire into useEngine's onEvent. Reads words/snapshot at event time. */
  onEvent(event: GameEvent, view: { words: readonly AirborneWord[]; snapshot: EngineSnapshot }): void;
}
```

- Recorder behavior (each rule is a test):
  1. On construction: `api.createRun` fired immediately (startedAt = Date.now(), appVersion = `__APP_VERSION__`); on failure the createRun payload goes to the outbox and the recorder keeps buffering (later flushes also route to outbox — order preserved).
  2. `wordKilled` → attempt row: `outcome:'kill'`, `msToKill` from the event, `msToFirstKey = word.firstKeyAt === null ? null : Math.round(word.firstKeyAt - word.spawnedAt)`, `backspaceCount/hintShown/wasTargeted` from the word, `airborneCount = view.words.length`, `speedLevel = view.snapshot.wave`, `createdAt = Date.now()`.
  3. `wordMissed` → same but `outcome:'miss'`, `msToKill: null`.
  4. `wrongSubmit` → wrong-submit row: `airborneCardIds` from `view.words`, `matchedOtherCardId` = id of a DIFFERENT pool card with `normalizeReading(reading) === normalizeReading(submittedKana)` (first hit, excluding cards currently airborne-and-matching — an airborne exact would have been a kill, so any hit is by definition a confusion), else null.
  5. `waveCleared` → flush buffered rows as one batch (`batchId = crypto.randomUUID()`); on failure retry ONCE after 500ms; on second failure push `{kind:'events'}` to outbox. Buffer clears optimistically either way (rows live in the batch object).
  6. `gameOver` → final flush (same path) + `api.finalizeRun` with `endedAt=Date.now()`, `score/wavesCleared=wave/maxCombo` from snapshot, `durationMs = Math.round(snapshot.timeMs)`, `pausedMs = max(0, (Date.now() - startedWallMs) - snapshot.timeMs)`, `accuracy = kills/(kills+missed.length+wrongSubmits)` (0 when denominator 0); finalize failure → outbox.
- `useEngine` change: `RunOptions` gains `onEvent?: (event: GameEvent, view: { words: readonly AirborneWord[]; snapshot: EngineSnapshot }) => void`; the hook's internal `onEvent` invokes it AFTER `publish()` with `{ words: engine.getWords(), snapshot: engine.getSnapshot() }`. App builds the recorder in `beginRun` and passes `recorder.onEvent` bound; App's boot effect calls `drainOutbox()` once (fire-and-forget with console.warn on failure).
- Tests: vitest with `vi.stubGlobal('fetch', ...)` (node env for recorder — no DOM needed except localStorage for outbox: use jsdom pragma for outbox tests). Scripted engine-event sequences (constructed literals, not a live engine) asserting exact batch payload shapes, the retry-once-then-outbox path (vi.useFakeTimers for the 500ms), createRun-failure ordering (outbox holds createRun BEFORE events), and outbox FIFO drain stopping at first failure.

- [ ] Steps: failing tests → RED → implement the three modules + wiring → GREEN → `npm run check` → commit:

```bash
git add -A && git commit -m "feat: run recorder with idempotent batching and offline outbox"
```

---

### Task 5: Stats engine + routes (golden-tested)

**Files:**
- Create: `server/statsConfig.ts`, `server/stats.ts`, `server/routes/stats.ts`
- Modify: `server/app.ts` (mount), `src/shared/api.ts` (append response schemas below)
- Test: `server/__tests__/stats.test.ts` (golden), `server/__tests__/statsRoutes.test.ts` (thin)

**Interfaces:**
- `server/statsConfig.ts` (exact values; the ONLY place thresholds live):

```ts
export const STATS = {
  learnedMinEncounters: 3,
  learnedWindow: 5,
  learnedMinAccuracy: 0.8,
  hintedKillWeight: 0.5,
  coverageThreshold: 0.6,
  masteryThreshold: 0.7,
  paceWindowDays: 14,
  trendDays: 30,
  leechWindow: 8,
  leechRecencyDecay: 0.85,
  leechAccuracyWeight: 0.7,
  leechSpeedWeight: 0.3,
  leechSpeedCeilingMs: 15_000,
  leechMinEncounters: 3,
  leechLimit: 15,
} as const;
```

- Append to `src/shared/api.ts`:

```ts
export const levelStatSchema = z.object({
  level: z.union([z.literal(5), z.literal(4), z.literal(3), z.literal(2)]),
  total: z.number().int(),
  encountered: z.number().int(),
  learned: z.number().int(),
  coverage: z.number(),
  mastery: z.number(),
});

export const statsOverviewSchema = z.object({
  learned: z.object({ reading: z.number().int(), recall: z.number().int() }),
  levels: z.array(levelStatSchema),
  estimatedLevel: z.union([z.literal(5), z.literal(4), z.literal(3), z.literal(2), z.null()]),
  pace: z.object({
    learnRatePerDay: z.number(),
    requiredRatePerDay: z.number(),
    remainingTargetWords: z.number().int(),
    daysToExam: z.number().int(),
    onPace: z.boolean(),
  }),
  trend: z.array(z.object({ date: z.string(), words: z.number().int(), accuracy: z.number() })),
  streakDates: z.array(z.string()),
  leeches: z.array(z.object({
    cardId: z.string(), kanji: z.string().nullable(), kana: z.string(), gloss: z.string(),
    strength: z.number().int(), encounters: z.number().int(),
  })),
});
export type StatsOverview = z.infer<typeof statsOverviewSchema>;
```

- `server/stats.ts` — pure functions over rows loaded via the handle; signature contract:

```ts
export function computeOverview(handle: DbHandle, nowMs: number): StatsOverview;
export function computeWordStats(handle: DbHandle, nowMs: number): WordStat[]; // cardId, per-direction encounters/accuracy, strength, lastSeenAt — powers /stats/words
```

Implementation notes (binding): load all attempts ordered by `createdAt`; group by `(cardId, mode)`; a direction is **learned** when `encounters >= learnedMinEncounters` AND the weighted accuracy over the last `learnedWindow` attempts `>= learnedMinAccuracy` (kill weight 1, hinted kill `hintedKillWeight`, miss 0; divide by window count actually present). A card's **learnedAt** (for pace) = `createdAt` of the first attempt at which its FIRST direction crossed the rule (walk the per-direction sequences forward). Level rows count `source='jlpt'` cards only. `estimatedLevel` = the lowest N-number among levels passing BOTH thresholds, else null (literal spec rule; document with a comment). Pace: `learnRatePerDay` = cards with `learnedAt` in `[now − 14d, now]` ÷ 14; `remainingTargetWords` = target-level total − target-level learned; `daysToExam` = `max(1, ceil((examDate − now)/86_400_000))`; `requiredRatePerDay` = remaining ÷ daysToExam; `onPace = learnRatePerDay >= requiredRatePerDay`. Trend: last 30 calendar days (local date strings via `new Date(ms).toISOString().slice(0,10)` — document UTC bucketing as the deliberate choice), `words` = distinct cards attempted that day, `accuracy` = kills ÷ (kills + misses) that day (0 if none). `streakDates` = distinct dates with ≥1 attempt within the trend window. Leech strength per the config formula over the last `leechWindow` attempts across both directions; speed factor only over kills (if no kills, factor 0).

- `server/routes/stats.ts`: `GET /api/stats/overview` → `computeOverview(handle, Date.now())`; `GET /api/stats/words?sort=strength&limit=50` → sorted `WordStat[]`. Thin: no logic beyond param parsing.

- [ ] **Step 1: The golden test is the heart of this task** — `server/__tests__/stats.test.ts` seeds a temp DB via direct inserts (NOT the API — unit-test the math in isolation) with a hand-computed fixture, then asserts EXACT numbers. Fixture (use `const NOW = Date.parse('2026-08-01T12:00:00Z')` and a helper `days(n) = NOW - n*86_400_000`):
  - Profile: defaults (N2 target, exam 2026-12-06 → daysToExam from NOW = 127 (compute: 2026-12-06T00:00Z − NOW = 126.5d → ceil = 127)).
  - Card A (n5): reading-direction attempts: kill(days(10)), kill(days(9)), kill(days(8)) → 3 encounters, last-5 acc 1.0 → learned, learnedAt = days(8).
  - Card B (n5): reading: kill(days(4), hinted), kill(days(3), hinted), kill(days(2), hinted) → weighted acc = 0.5 → NOT learned.
  - Card C (n5): reading: kill(days(6)), miss(days(5)), kill(days(4)), kill(days(3)) → 4 encounters, last-5 = [1,0,1,1] → 0.75 → NOT learned; leech candidate.
  - Card D (n2): recall: kill(days(1)) ×3 at days(3),(2),(1) → learned in recall, learnedAt days(1).
  - Expected assertions: `learned = { reading: 1, recall: 1 }`; n5 row `{ encountered: 3, learned: 1 }` with coverage 3/633 and mastery 1/3 (assert with `toBeCloseTo`); n2 row `{ encountered: 1, learned: 1 }`; `estimatedLevel: null` (no level clears 60% coverage); pace: learnedAt days(8) and days(1) both within 14d → `learnRatePerDay = 2/14` (`toBeCloseTo(0.142857, 5)`), `remainingTargetWords = 1776 - 1` = 1775, `requiredRatePerDay ≈ 1775/127` (`toBeCloseTo(13.976, 2)`), `onPace: false`; trend entry for the `days(1)` date has `words: 1, accuracy: 1` (only Card D attempted that day) — hand-verify EVERY expected number while writing the test and correct any arithmetic slip in the FIXTURE COMMENTS, not by loosening assertions; streakDates contains exactly the distinct dates used; leeches[0] is Card C (only card with ≥3 encounters and imperfect record; hand-compute its strength with the 0.85 weights and assert exactly, showing the arithmetic in a comment).
  - Also: one test that `computeOverview` with an EMPTY attempts table returns all-zero shapes (no NaN anywhere — `accuracy 0`, `learnRatePerDay 0`, `onPace false`, `estimatedLevel null`).
- [ ] **Step 2: RED → implement stats.ts/statsConfig.ts/routes → GREEN.** If a hand-computed expectation disagrees with the implementation, re-derive BY HAND first — the fixture comment must show the arithmetic; only change the expectation when the hand math was wrong.
- [ ] **Step 3: Route tests** (`statsRoutes.test.ts`): overview returns 200 and parses with `statsOverviewSchema`; words endpoint sorts ascending by strength.
- [ ] **Step 4: Gate + commit**: `npm run check`; coverage still ≥80 (stats.ts is the big new surface — the golden test should cover it well; add cases if the branch % dips).

```bash
git add -A && git commit -m "feat: stats engine with golden-tested v1 five analytics"
```

---

### Task 6: Stats screen + error screens

**Files:**
- Create: `src/ui/screens/StatsScreen.tsx`, `src/ui/screens/ServerErrorScreen.tsx`, `src/ui/hud/charts.tsx` (small presentational pieces: LevelBars, TrendChart, StreakGrid, LeechTable — keep each tiny)
- Modify: `src/App.tsx` (screen 'stats', Title button), `src/ui/screens/TitleScreen.tsx` (Stats button), `src/index.css`
- Test: `src/ui/__tests__/StatsScreen.test.tsx` (mocked fetch)

**Interfaces:**
- Consumes: `statsOverviewSchema`, `profileSchema`, `StatsOverview` from shared api.
- Produces: `StatsScreen({ onBack })` fetches `/api/stats/overview` + `/api/profile` in parallel; renders: (1) two learned counters "Reading N · Recall M"; (2) level bars N5→N2 (coverage + mastery per level; Recharts BarChart or plain divs — plain divs are fine and test-friendlier; label "vocab-only estimate"); (3) pace panel: on-pace ✓/✗, learn rate vs required, days to exam; (4) TrendChart (Recharts `LineChart` words/day + accuracy line, last 30d) + StreakGrid (30 cells); (5) LeechTable (kanji/kana/gloss/strength). Profile mini-editor: three inputs (target level select, exam date, daily goal) with Save → `PUT /api/profile` → refetch overview (pace changes). States: loading spinner; `dbError` payload (503) → `ServerErrorScreen` variant showing `path` + `recovery`; fetch rejection → server-down variant ("start the app with npm run dev / npm start").
- Test coverage (RTL, mocked fetch): renders the five sections from a fixture `StatsOverview` (assert the learned numbers, on-/behind-pace text, leech row content); 503 dbError renders path + recovery; profile save PUTs and refetches (assert fetch call sequence).

- [ ] Steps: failing RTL tests → RED → implement screens (+ App/Title wiring, CSS) → GREEN → `npm run check` → commit:

```bash
git add -A && git commit -m "feat: stats screen with five analytics views and profile editor"
```

---

### Task 7: E2E persistence proof, npm start, docs

**Files:**
- Create: `e2e/global-setup.ts`
- Modify: `playwright.config.ts`, `e2e/game.spec.ts`, `server/index.ts` (`--dist --open`), `package.json` (`start`), `README.md`, spec §6 annotation
- Test: the extended e2e itself

**Interfaces / behavior:**
- `playwright.config.ts`: `globalSetup: './e2e/global-setup.ts'`, webServer `command: 'npm run dev:e2e'`, url unchanged (5183), `reuseExistingServer: false`, add `timeout: 120_000` for the webServer (two processes boot).
- `e2e/global-setup.ts`: delete `data/e2e.db` (+ `-wal`/`-shm` siblings) if present (`fs.rmSync(..., { force: true })`).
- Extend the READING spec after the score assertion (the DB proof the spec's §8 demands):

```ts
  const overview = await page.request.get('/api/stats/overview');
  expect(overview.ok()).toBeTruthy();
  const body = await overview.json();
  const today = body.trend[body.trend.length - 1];
  expect(today.words).toBeGreaterThanOrEqual(1); // the kill landed in SQLite
```

(The request rides the vite proxy → API → e2e DB. The recall spec stays as-is.)
- `server/index.ts`: parse argv — `--dist` serves `./dist` via `serveStatic` from `@hono/node-server/serve-static` (SPA fallback to `index.html` for non-`/api` paths); `--open` launches the default browser (`child_process.exec('start http://localhost:'+port)` on win32, `open`/`xdg-open` elsewhere). `package.json`: `"start": "npm run build && tsx server/index.ts --dist --open"`.
- README: replace the Run section — `npm run dev` (game + API, two processes, one command), `npm start` (build + single process + opens browser), DB location `data/kotoba.db`, backup = copy the file, `npm run e2e` unchanged note, stats screen mention. Spec: in §6, annotate the lists lines with "(M4 — ships with the import UI)".
- Full sweep: `npm run check`, `npm run e2e` (both specs + persistence assertion), `npm run coverage`, plus a manual `npm start` smoke: page loads from 8790, play one word, Stats screen shows it; Ctrl-C; report evidence.

- [ ] Steps: global-setup + config → extend spec → RED-ish (run e2e; the new assertion fails until dev:e2e wiring is right) → implement `--dist --open` + scripts → GREEN → docs → full sweep → commit:

```bash
git add -A && git commit -m "feat: single-process npm start; e2e proves attempts persist; m3 docs"
```

---

## Milestone Exit

Play several real runs across days if possible. Gate questions before planning M4:
1. Do the five stats views answer "how am I doing?" at a glance — what's missing, what's noise?
2. Is the pace panel motivating or stressful? (Thresholds in `server/statsConfig.ts`.)
3. Does recording ever make the game feel less snappy? (It never should — flushes are async at wave boundaries.)

## Deferred (deliberately absent here)

- M4: custom-list import UI + `/api/lists` routes; particles/bloom/CRT/SFX; settings; IME warning banner; bundled font; word-intro delivery polish (user's open UX note); full revenge-round e2e (recorded M3→M4 debt); player-scoped word introductions driven by the attempts DB (replace the session seen-set with "no prior attempt" + `introduced_at` exposure events — schedule as an early M4 task now that the data exists).
