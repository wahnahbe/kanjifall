# Custom List Import (M4-B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pasted word lists (n2-prep exports) become playable pools — bare words auto-resolved against the bundled cards, full-line fallback for the rest, full M4-A plan treatment with no tier gate — per `docs/superpowers/specs/2026-08-08-custom-list-import-design.md`.

**Architecture:** Server-owned import: one pure parser module resolves lines against an in-memory index of the `cards` table; routes persist lists/membership/custom cards transactionally with replace-by-name; the planner gains ungated `list:<id>` pools; the client hydrates JLPT members from its static JSON and gains an Import screen plus a Setup list row.

**Tech Stack:** TypeScript, Zod, Hono, Drizzle/better-sqlite3, wanakana (already a dependency, server-usable), node:crypto, React, Vitest, Playwright. No new dependencies.

## Global Constraints

- Custom card ids are deterministic: `custom-` + first 12 hex of SHA-256 over `` `${kanji ?? ''}|${kana}` `` (spec §3.2) — same word, same card, forever.
- Parsing/resolution rules verbatim from spec §3.3: TAB else first-two-commas split; 1 field = bare, 3 = full, else error; bare resolves on exactly one match (zero → "not in the built-in N5–N2 data — supply word‹TAB›kana‹TAB›gloss", many → candidates listed); full lines resolve on a unique kanji+reading (or kana-only) match, otherwise create — never an ambiguity error; kana field pure kana; gloss ≤ 28 chars; in-paste duplicate → `duplicate of line N`; `#` and blank lines skipped but counted (1-based line numbers).
- Caps enforced at the ROUTE with a hard 400: 1,000 lines, 200 chars per line (spec §3.3 rule 8; the parser itself stays total).
- The save endpoint re-parses the raw text inside one transaction — the preview is advisory display, never trusted state (spec §5.1).
- `DELETE` removes list + membership ONLY; cards and attempts are never deleted (spec §5.1).
- List pools: no tier gate, `tiers: []`, shared daily budget, standard weights, mode-aware kana-only exclusion from `newCardIds` (spec §5.2). `noticeFor`, `tierAdvanceLine`, and the setup tier display already handle `tiers: []` — zero changes to them.
- JLPT members return from the cards endpoint as ids only; the client hydrates from static JSON (spec §5.1/§5.3). Order within each array is list `position` order; interleaving across the two arrays is not meaningful (the Spawner shuffles/weights — pool order never reaches gameplay).
- Reading mode × all-kana list is blocked client-side at Begin: `This list has no kanji words — Reading mode unavailable.` (spec §5.4 — guards a real engine infinite-loop edge; no engine change).
- Commit format: `<type>: <description>`, no attribution footer.
- Every task ends green: `npm run check` passes before its commit.

---

### Task 1: Parser — `server/listImport.ts`

Pure parse + resolve against an injected index. No DB, no routes.

**Files:**
- Create: `server/listImport.ts`
- Test: `server/__tests__/listImport.test.ts`

**Interfaces:**
- Consumes: `wanakana.isKana`, `node:crypto`, engine `Card` type.
- Produces (Tasks 2–3 rely on these exact names):
  ```ts
  export interface CardIndexEntry {
    id: string; kanji: string | null; kana: string[]; gloss: string; source: string;
  }
  export interface CardIndex {
    byKanji: Map<string, CardIndexEntry[]>;
    byKana: Map<string, CardIndexEntry[]>;
  }
  export function buildCardIndex(rows: readonly CardIndexEntry[]): CardIndex;
  export function customCardId(kanji: string | null, kana: string): string;
  export type LineStatus = 'jlpt' | 'custom-existing' | 'custom-new' | 'error';
  export interface ParsedLine {
    line: number;            // 1-based in the original paste
    raw: string;
    status: LineStatus;
    cardId?: string;         // set for jlpt / custom-existing / custom-new
    display?: { kanji: string | null; kana: string; gloss: string };
    error?: string;
    /** Full card body when status is 'custom-new' — server-internal, the
     *  routes strip it before responding. */
    newCard?: Card;
  }
  export interface ParseResult {
    lines: ParsedLine[];     // skipped blanks/comments are NOT included
    summary: { total: number; resolved: number; customNew: number; errors: number };
  }
  export function parseListText(text: string, index: CardIndex): ParseResult;
  ```

- [ ] **Step 1: Write the failing tests**

Create `server/__tests__/listImport.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  buildCardIndex, customCardId, parseListText, type CardIndexEntry,
} from '../listImport';

const entry = (
  id: string, kanji: string | null, kana: string[], gloss: string, source = 'jlpt',
): CardIndexEntry => ({ id, kanji, kana, gloss, source });

// 紙/神 share the reading かみ; 犬 is unique; ばら is a kana-only card;
// prior-custom is what an earlier import created.
const INDEX = buildCardIndex([
  entry('jm-1', '犬', ['いぬ'], 'dog'),
  entry('jm-2', '紙', ['かみ'], 'paper'),
  entry('jm-3', '神', ['かみ'], 'god'),
  entry('jm-4', null, ['ばら'], 'rose'),
  entry('custom-aaaaaaaaaaaa', '猫背', ['ねこぜ'], 'slouch', 'custom'),
]);

describe('customCardId', () => {
  it('is deterministic and distinguishes kanji from kana-only forms', () => {
    expect(customCardId('猫背', 'ねこぜ')).toBe(customCardId('猫背', 'ねこぜ'));
    expect(customCardId('猫背', 'ねこぜ')).toMatch(/^custom-[0-9a-f]{12}$/);
    expect(customCardId(null, 'ねこぜ')).not.toBe(customCardId('猫背', 'ねこぜ'));
  });
});

describe('parseListText — line shapes', () => {
  it('skips blanks and # comments but keeps 1-based original numbering', () => {
    const r = parseListText('# from n2-prep\n\n犬\n', INDEX);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ line: 3, status: 'jlpt', cardId: 'jm-1' });
    expect(r.summary).toEqual({ total: 1, resolved: 1, customNew: 0, errors: 0 });
  });

  it('two fields is a per-line error', () => {
    const r = parseListText('犬\tいぬ', INDEX);
    expect(r.lines[0].status).toBe('error');
    expect(r.lines[0].error).toMatch(/1 .*or 3/);
  });

  it('splits on TAB when present, else on the first two commas (gloss keeps its commas)', () => {
    const r = parseListText('狛犬,こまいぬ,guardian dog, lion-dog', INDEX);
    expect(r.lines[0].status).toBe('custom-new');
    expect(r.lines[0].display).toEqual({ kanji: '狛犬', kana: 'こまいぬ', gloss: 'guardian dog, lion-dog' });
  });
});

describe('parseListText — bare-word resolution', () => {
  it('unique kanji match resolves as jlpt', () => {
    const r = parseListText('犬', INDEX);
    expect(r.lines[0]).toMatchObject({
      status: 'jlpt', cardId: 'jm-1', display: { kanji: '犬', kana: 'いぬ', gloss: 'dog' },
    });
  });

  it('a kana bare word matches through the kana index', () => {
    const r = parseListText('ばら', INDEX);
    expect(r.lines[0]).toMatchObject({ status: 'jlpt', cardId: 'jm-4' });
  });

  it('homophones are an error listing every candidate', () => {
    const r = parseListText('かみ', INDEX);
    expect(r.lines[0].status).toBe('error');
    expect(r.lines[0].error).toContain('紙');
    expect(r.lines[0].error).toContain('神');
  });

  it('an unknown bare word tells you to supply the full form', () => {
    const r = parseListText('狛犬', INDEX);
    expect(r.lines[0].status).toBe('error');
    expect(r.lines[0].error).toMatch(/word.+kana.+gloss/);
  });

  it('a bare word resolving to a prior custom card is custom-existing', () => {
    const r = parseListText('猫背', INDEX);
    expect(r.lines[0]).toMatchObject({ status: 'custom-existing', cardId: 'custom-aaaaaaaaaaaa' });
  });
});

describe('parseListText — full lines', () => {
  it('a unique kanji+reading match reuses the existing card, its own gloss winning', () => {
    const r = parseListText('紙\tかみ\tsheet', INDEX);
    expect(r.lines[0]).toMatchObject({
      status: 'jlpt', cardId: 'jm-2', display: { kanji: '紙', kana: 'かみ', gloss: 'paper' },
    });
  });

  it('no unique match creates a custom card with the deterministic id', () => {
    const r = parseListText('狛犬\tこまいぬ\tguardian dog', INDEX);
    const line = r.lines[0];
    expect(line.status).toBe('custom-new');
    expect(line.cardId).toBe(customCardId('狛犬', 'こまいぬ'));
    expect(line.newCard).toMatchObject({
      id: line.cardId, kanji: '狛犬', kana: ['こまいぬ'], gloss: 'guardian dog',
      pos: 'unclassified', jlpt: null, source: 'custom',
    });
  });

  it('a kana-only full line stores null kanji', () => {
    const r = parseListText('ぺけ\tぺけ\tcross mark', INDEX);
    expect(r.lines[0].newCard).toMatchObject({ kanji: null, kana: ['ぺけ'] });
  });

  it('non-kana reading and over-long gloss are per-line errors', () => {
    const bad = parseListText('狛犬\tkomainu\tguardian dog', INDEX);
    expect(bad.lines[0].status).toBe('error');
    const long = parseListText(`狛犬\tこまいぬ\t${'x'.repeat(29)}`, INDEX);
    expect(long.lines[0].status).toBe('error');
    expect(long.lines[0].error).toMatch(/28/);
  });
});

describe('parseListText — duplicates', () => {
  it('a later line resolving to the same card errors with the first line number', () => {
    const r = parseListText('犬\n犬\tいぬ\tdog', INDEX);
    expect(r.lines[0].status).toBe('jlpt');
    expect(r.lines[1].status).toBe('error');
    expect(r.lines[1].error).toBe('duplicate of line 1');
  });

  it('two full lines creating the same custom card also collide', () => {
    const r = parseListText('狛犬\tこまいぬ\tguardian dog\n狛犬\tこまいぬ\tlion-dog', INDEX);
    expect(r.lines[1].error).toBe('duplicate of line 1');
    expect(r.summary).toEqual({ total: 2, resolved: 0, customNew: 1, errors: 1 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run server/__tests__/listImport.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `server/listImport.ts`**

```ts
import { createHash } from 'node:crypto';
import { isKana } from 'wanakana';
import type { Card } from '../src/engine/types';

/**
 * Pure parse + resolve for pasted word lists (custom-list-import spec §3.3).
 * Resolution runs against an in-memory index of the cards table — including
 * prior custom cards, which is what makes duplicate detection honest. The
 * routes own persistence and the request-size caps; this module is total.
 */

export interface CardIndexEntry {
  id: string;
  kanji: string | null;
  kana: string[];
  gloss: string;
  source: string;
}

export interface CardIndex {
  byKanji: Map<string, CardIndexEntry[]>;
  byKana: Map<string, CardIndexEntry[]>;
}

export function buildCardIndex(rows: readonly CardIndexEntry[]): CardIndex {
  const byKanji = new Map<string, CardIndexEntry[]>();
  const byKana = new Map<string, CardIndexEntry[]>();
  const push = (map: Map<string, CardIndexEntry[]>, key: string, row: CardIndexEntry) => {
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  };
  for (const row of rows) {
    if (row.kanji !== null) push(byKanji, row.kanji, row);
    for (const reading of row.kana) push(byKana, reading, row);
  }
  return { byKanji, byKana };
}

/** Deterministic across imports and lists (spec §3.2): the same word always
 *  maps to the same card, so history survives deletes and re-imports. */
export function customCardId(kanji: string | null, kana: string): string {
  return 'custom-' + createHash('sha256').update(`${kanji ?? ''}|${kana}`).digest('hex').slice(0, 12);
}

export type LineStatus = 'jlpt' | 'custom-existing' | 'custom-new' | 'error';

export interface ParsedLine {
  line: number;
  raw: string;
  status: LineStatus;
  cardId?: string;
  display?: { kanji: string | null; kana: string; gloss: string };
  error?: string;
  /** Full card body when status is 'custom-new' — server-internal, the
   *  routes strip it before responding. */
  newCard?: Card;
}

export interface ParseResult {
  lines: ParsedLine[];
  summary: { total: number; resolved: number; customNew: number; errors: number };
}

const GLOSS_MAX = 28; // the committed-data invariant (src/data/schema.ts)

/** TAB when present; otherwise the first two commas, so glosses keep theirs. */
function splitFields(line: string): string[] {
  if (line.includes('\t')) {
    return line.split('\t').map((f) => f.trim()).filter((f) => f.length > 0);
  }
  const first = line.indexOf(',');
  if (first === -1) return [line.trim()];
  const second = line.indexOf(',', first + 1);
  const fields = second === -1
    ? [line.slice(0, first), line.slice(first + 1)]
    : [line.slice(0, first), line.slice(first + 1, second), line.slice(second + 1)];
  return fields.map((f) => f.trim()).filter((f) => f.length > 0);
}

function statusOf(entry: CardIndexEntry): 'jlpt' | 'custom-existing' {
  return entry.source === 'custom' ? 'custom-existing' : 'jlpt';
}

function displayOf(entry: CardIndexEntry): { kanji: string | null; kana: string; gloss: string } {
  return { kanji: entry.kanji, kana: entry.kana[0], gloss: entry.gloss };
}

type Resolution =
  | { kind: 'one'; entry: CardIndexEntry }
  | { kind: 'none' }
  | { kind: 'many'; candidates: CardIndexEntry[] };

function resolveBare(word: string, index: CardIndex): Resolution {
  const kanjiMatches = index.byKanji.get(word) ?? [];
  if (kanjiMatches.length === 1) return { kind: 'one', entry: kanjiMatches[0] };
  if (kanjiMatches.length > 1) return { kind: 'many', candidates: kanjiMatches };
  if (isKana(word)) {
    const kanaMatches = index.byKana.get(word) ?? [];
    if (kanaMatches.length === 1) return { kind: 'one', entry: kanaMatches[0] };
    if (kanaMatches.length > 1) return { kind: 'many', candidates: kanaMatches };
  }
  return { kind: 'none' };
}

/** Full lines resolve only on a UNIQUE match; any ambiguity creates instead —
 *  a full line carries everything needed to stand alone (spec §3.3 rule 5). */
function resolveFull(word: string, kana: string, index: CardIndex): CardIndexEntry | null {
  const kanaOnly = word === kana || isKana(word);
  const candidates = kanaOnly
    ? (index.byKana.get(kana) ?? []).filter((c) => c.kanji === null)
    : (index.byKanji.get(word) ?? []).filter((c) => c.kana.includes(kana));
  return candidates.length === 1 ? candidates[0] : null;
}

export function parseListText(text: string, index: CardIndex): ParseResult {
  const lines: ParsedLine[] = [];
  const firstLineByCard = new Map<string, number>();
  const rawLines = text.split('\n');

  for (let i = 0; i < rawLines.length; i++) {
    const lineNo = i + 1;
    const raw = rawLines[i].trim();
    if (raw.length === 0 || raw.startsWith('#')) continue;

    const push = (parsed: Omit<ParsedLine, 'line' | 'raw'>) =>
      lines.push({ line: lineNo, raw, ...parsed });
    const pushResolved = (parsed: Omit<ParsedLine, 'line' | 'raw'> & { cardId: string }) => {
      const firstLine = firstLineByCard.get(parsed.cardId);
      if (firstLine !== undefined) {
        push({ status: 'error', error: `duplicate of line ${firstLine}` });
        return;
      }
      firstLineByCard.set(parsed.cardId, lineNo);
      push(parsed);
    };

    const fields = splitFields(raw);
    if (fields.length === 1) {
      const word = fields[0];
      const resolved = resolveBare(word, index);
      if (resolved.kind === 'one') {
        pushResolved({
          status: statusOf(resolved.entry),
          cardId: resolved.entry.id,
          display: displayOf(resolved.entry),
        });
      } else if (resolved.kind === 'many') {
        const listing = resolved.candidates
          .map((c) => `${c.kanji ?? c.kana[0]} (${c.gloss})`)
          .join(', ');
        push({ status: 'error', error: `ambiguous — ${listing}; supply word‹TAB›kana‹TAB›gloss` });
      } else {
        push({
          status: 'error',
          error: 'not in the built-in N5–N2 data — supply word‹TAB›kana‹TAB›gloss',
        });
      }
      continue;
    }

    if (fields.length !== 3) {
      push({ status: 'error', error: `${fields.length} fields — need 1 (word) or 3 (word, kana, gloss)` });
      continue;
    }

    const [word, kana, gloss] = fields;
    if (!isKana(kana)) {
      push({ status: 'error', error: 'second field must be pure kana' });
      continue;
    }
    if (gloss.length > GLOSS_MAX) {
      push({ status: 'error', error: `gloss too long (max ${GLOSS_MAX} chars)` });
      continue;
    }

    const existing = resolveFull(word, kana, index);
    if (existing !== null) {
      pushResolved({ status: statusOf(existing), cardId: existing.id, display: displayOf(existing) });
      continue;
    }

    const kanaOnly = word === kana || isKana(word);
    const id = customCardId(kanaOnly ? null : word, kana);
    const newCard: Card = {
      id,
      kanji: kanaOnly ? null : word,
      kana: [kana],
      gloss,
      pos: 'unclassified',
      jlpt: null,
      source: 'custom',
    };
    pushResolved({
      status: 'custom-new',
      cardId: id,
      display: { kanji: newCard.kanji, kana, gloss },
      newCard,
    });
  }

  let resolved = 0;
  let customNew = 0;
  let errors = 0;
  for (const line of lines) {
    if (line.status === 'error') errors += 1;
    else if (line.status === 'custom-new') customNew += 1;
    else resolved += 1;
  }
  return { lines, summary: { total: lines.length, resolved, customNew, errors } };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run server/__tests__/listImport.test.ts`
Expected: PASS. Then `npm run check` — green.

- [ ] **Step 5: Commit**

```bash
git add server/listImport.ts server/__tests__/listImport.test.ts
git commit -m "feat: pure list-import parser with index-backed resolution"
```

(Amended after review: resolution must ALSO consult a paste-local overlay of the cards created earlier in the same paste — `resolveBare`/`resolveFull` take the union of index and overlay candidates, so a later bare word duplicating a full line's creation yields `duplicate of line N` instead of "not in the built-in data". The parser never mutates the caller's index. Error strings use the visible `‹TAB›` marker, never a literal tab control character, and the tests assert the visible form with `toContain`.)

---

### Task 2: Tables, shared schemas, and `/api/lists` routes

**Files:**
- Modify: `server/db/schema.ts` (two tables)
- Create: `drizzle/0003_*.sql` (via `npm run db:generate` — never hand-write)
- Modify: `src/shared/api.ts` (request/response schemas)
- Create: `server/routes/lists.ts`
- Modify: `server/app.ts` (register)
- Test: `server/__tests__/listsRoutes.test.ts`

**Interfaces:**
- Consumes: Task 1's `buildCardIndex`/`parseListText`/`ParsedLine`.
- Produces:
  - Tables `lists` (`id` autoincrement PK, `name` unique, `createdAt`, `updatedAt`) and `list_cards` ((`listId`,`cardId`) composite PK, `position`).
  - `src/shared/api.ts` exports: `previewRequestSchema` `{text}`, `listSaveRequestSchema` `{name, text}`, `parsedLineSchema`, `previewResponseSchema` `{lines, summary}`, `listSummarySchema` `{id, name, cardCount, updatedAt}`, `customCardSchema` (= `cardSchema.omit({tier: true}).extend({jlpt: z.null(), source: z.literal('custom')})`), `listCardsResponseSchema` `{list: {id, name, updatedAt}, customCards: customCardSchema[], jlptCardIds: string[]}`, `listSaveResponseSchema` `{id, name, cardCount, replaced}` — plus inferred types (`PreviewResponse`, `ListSummary`, `ListCardsResponse`, `ListSaveResponse`).
  - Routes: `POST /api/lists/preview`, `POST /api/lists`, `GET /api/lists`, `GET /api/lists/:id/cards`, `DELETE /api/lists/:id` — behaviors per spec §5.1. Caps: >1,000 non-empty payload lines or any line >200 chars → 400.

- [ ] **Step 1: Schema + migration**

`server/db/schema.ts` — append (note the composite-PK import):

```ts
import { integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
```

```ts
export const lists = sqliteTable('lists', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull().unique(),
  createdAt: integer('created_at').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const listCards = sqliteTable('list_cards', {
  listId: integer('list_id').notNull().references(() => lists.id),
  cardId: text('card_id').notNull(),
  position: integer('position').notNull(),
}, (t) => [primaryKey({ columns: [t.listId, t.cardId] })]);
```

Run: `npm run db:generate` — inspect `drizzle/0003_*.sql`: two `CREATE TABLE` statements matching the above (unique index on `lists.name`, composite PK on `list_cards`).

- [ ] **Step 2: Shared schemas**

`src/shared/api.ts` — append after `runPlanSchema`:

```ts
export const previewRequestSchema = z.object({ text: z.string().min(1) });
export const listSaveRequestSchema = z.object({
  name: z.string().trim().min(1).max(60),
  text: z.string().min(1),
});

export const parsedLineSchema = z.object({
  /** 1-based line number in the original paste (blanks/comments counted, not returned). */
  line: z.number().int().positive(),
  raw: z.string(),
  status: z.union([
    z.literal('jlpt'), z.literal('custom-existing'), z.literal('custom-new'), z.literal('error'),
  ]),
  cardId: z.string().optional(),
  display: z.object({
    kanji: z.string().nullable(), kana: z.string(), gloss: z.string(),
  }).optional(),
  error: z.string().optional(),
});

export const previewResponseSchema = z.object({
  lines: z.array(parsedLineSchema),
  summary: z.object({
    total: z.number().int().nonnegative(),
    resolved: z.number().int().nonnegative(),
    customNew: z.number().int().nonnegative(),
    errors: z.number().int().nonnegative(),
  }),
});

export const listSummarySchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  cardCount: z.number().int().nonnegative(),
  updatedAt: z.number().int().positive(),
});

/** Custom cards ship whole from the DB — same shape as a level-file card
 *  minus the tier the pipeline stamps (custom cards have none). */
export const customCardSchema = cardSchema
  .omit({ tier: true })
  .extend({ jlpt: z.null(), source: z.literal('custom') });

export const listCardsResponseSchema = z.object({
  list: z.object({
    id: z.number().int().positive(),
    name: z.string(),
    updatedAt: z.number().int().positive(),
  }),
  customCards: z.array(customCardSchema),
  jlptCardIds: z.array(z.string()),
});

export const listSaveResponseSchema = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  cardCount: z.number().int().nonnegative(),
  replaced: z.boolean(),
});

export type PreviewResponse = z.infer<typeof previewResponseSchema>;
export type ListSummary = z.infer<typeof listSummarySchema>;
export type ListCardsResponse = z.infer<typeof listCardsResponseSchema>;
export type ListSaveResponse = z.infer<typeof listSaveResponseSchema>;
```

(`cardSchema` lives in `src/data/schema.ts` — add `import { cardSchema } from '../data/schema';` at the top of `src/shared/api.ts`. Both are client-safe modules; no cycle: `data/schema.ts` imports only zod + engine types.)

- [ ] **Step 3: Write the failing route tests**

Create `server/__tests__/listsRoutes.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { listCardsResponseSchema, listSaveResponseSchema, previewResponseSchema } from '../../src/shared/api';
import { buildApp } from '../app';
import { makeTestDb } from '../testDb';

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function setup() {
  const t = makeTestDb();
  cleanup = t.cleanup;
  const app = buildApp(t.handle);
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  // A real N5 word with kanji, straight from the seeded data.
  const seeded = t.handle.sqlite
    .prepare(`SELECT kanji FROM cards WHERE source='jlpt' AND jlpt=5 AND kanji IS NOT NULL ORDER BY id LIMIT 1`)
    .get() as { kanji: string };
  const count = (sql: string) =>
    (t.handle.sqlite.prepare(sql).get() as { n: number }).n;
  return { t, app, post, seededKanji: seeded.kanji, count };
}

describe('POST /api/lists/preview', () => {
  it('parses and resolves without writing anything', async () => {
    const { post, seededKanji, count } = setup();
    const before = count(`SELECT COUNT(*) AS n FROM cards`);
    const res = await post('/api/lists/preview', {
      text: `${seededKanji}\n狛犬\tこまいぬ\tguardian dog\nかみ かみ`,
    });
    expect(res.status).toBe(200);
    const body = previewResponseSchema.parse(await res.json());
    expect(body.summary.total).toBe(3);
    expect(body.lines[0].status).toBe('jlpt');
    expect(body.lines[1].status).toBe('custom-new');
    expect(body.lines[1]).not.toHaveProperty('newCard'); // server-internal field stripped
    expect(count(`SELECT COUNT(*) AS n FROM cards`)).toBe(before);
    expect(count(`SELECT COUNT(*) AS n FROM lists`)).toBe(0);
  });

  it('rejects oversized pastes with 400', async () => {
    const { post } = setup();
    const tooMany = Array.from({ length: 1001 }, (_, i) => `word${i}`).join('\n');
    expect((await post('/api/lists/preview', { text: tooMany })).status).toBe(400);
    expect((await post('/api/lists/preview', { text: 'x'.repeat(201) })).status).toBe(400);
  });
});

describe('POST /api/lists', () => {
  it('creates, then replaces by name keeping the same id; custom cards persist', async () => {
    const { post, seededKanji, count } = setup();
    const first = await post('/api/lists', {
      name: 'leeches', text: `${seededKanji}\n狛犬\tこまいぬ\tguardian dog`,
    });
    expect(first.status).toBe(200);
    const created = listSaveResponseSchema.parse(await first.json());
    expect(created).toMatchObject({ name: 'leeches', cardCount: 2, replaced: false });

    const second = await post('/api/lists', { name: 'leeches', text: seededKanji });
    const replaced = listSaveResponseSchema.parse(await second.json());
    expect(replaced).toMatchObject({ id: created.id, cardCount: 1, replaced: true });
    expect(count(`SELECT COUNT(*) AS n FROM lists`)).toBe(1);
    // The custom card survives losing its membership (history is never deleted).
    expect(count(`SELECT COUNT(*) AS n FROM cards WHERE source='custom'`)).toBe(1);
  });

  it('400s when no line is valid', async () => {
    const { post } = setup();
    expect((await post('/api/lists', { name: 'bad', text: 'かみ かみ' })).status).toBe(400);
  });
});

describe('GET /api/lists and /api/lists/:id/cards', () => {
  it('summaries carry counts; the cards endpoint splits customs from jlpt ids in position order', async () => {
    const { app, post, seededKanji } = setup();
    const saved = listSaveResponseSchema.parse(
      await (await post('/api/lists', {
        name: 'mixed', text: `狛犬\tこまいぬ\tguardian dog\n${seededKanji}`,
      })).json(),
    );

    const listRes = await app.request('/api/lists');
    const summaries = (await listRes.json()) as { id: number; cardCount: number }[];
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ id: saved.id, cardCount: 2 });

    const cardsRes = await app.request(`/api/lists/${saved.id}/cards`);
    const body = listCardsResponseSchema.parse(await cardsRes.json());
    expect(body.list).toMatchObject({ id: saved.id, name: 'mixed' });
    expect(body.customCards).toHaveLength(1);
    expect(body.customCards[0].kanji).toBe('狛犬');
    expect(body.jlptCardIds).toHaveLength(1);
  });

  it('404s on an unknown or malformed id', async () => {
    const { app } = setup();
    expect((await app.request('/api/lists/999/cards')).status).toBe(404);
    expect((await app.request('/api/lists/abc/cards')).status).toBe(400);
  });
});

describe('DELETE /api/lists/:id', () => {
  it('removes the list and membership but never cards or attempts', async () => {
    const { t, app, post, count } = setup();
    const saved = listSaveResponseSchema.parse(
      await (await post('/api/lists', {
        name: 'doomed', text: '狛犬\tこまいぬ\tguardian dog',
      })).json(),
    );
    // Attach an attempt to the custom card so history survival is provable.
    const customId = (t.handle.sqlite
      .prepare(`SELECT id FROM cards WHERE source='custom'`).get() as { id: string }).id;
    t.handle.sqlite.prepare(
      `INSERT OR IGNORE INTO runs (id, started_at, mode, pool, app_version, list_version)
       VALUES ('run-x', 1, 'reading', 'list:1', 'test', 'test')`,
    ).run();
    t.handle.sqlite.prepare(
      `INSERT INTO attempts (run_id, card_id, mode, outcome, ms_to_first_key, ms_to_kill,
         backspace_count, hint_shown, was_targeted, airborne_count, speed_level, created_at)
       VALUES ('run-x', ?, 'reading', 'kill', 100, 400, 0, 0, 1, 1, 1, 2)`,
    ).run(customId);

    expect((await app.request(`/api/lists/${saved.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(count(`SELECT COUNT(*) AS n FROM lists`)).toBe(0);
    expect(count(`SELECT COUNT(*) AS n FROM list_cards`)).toBe(0);
    expect(count(`SELECT COUNT(*) AS n FROM cards WHERE source='custom'`)).toBe(1);
    expect(count(`SELECT COUNT(*) AS n FROM attempts`)).toBe(1);
    expect((await app.request(`/api/lists/${saved.id}`, { method: 'DELETE' })).status).toBe(404);
  });
});
```

Run: `npx vitest run server/__tests__/listsRoutes.test.ts` — FAIL (no route).

- [ ] **Step 4: Implement `server/routes/lists.ts`**

```ts
import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { previewRequestSchema, listSaveRequestSchema } from '../../src/shared/api';
import type { DbHandle } from '../db/connect';
import { cards, listCards, lists } from '../db/schema';
import { buildCardIndex, parseListText, type CardIndex, type ParsedLine } from '../listImport';

const CAPS = { maxLines: 1_000, maxLineLength: 200 } as const;

/** Request-size caps live at the route (spec §3.3 rule 8): a hard 400, so
 *  the parser itself stays total. Counts non-empty lines only. */
function capsError(text: string): string | null {
  const rawLines = text.split('\n');
  if (rawLines.filter((l) => l.trim().length > 0).length > CAPS.maxLines) {
    return `too many lines (max ${CAPS.maxLines})`;
  }
  if (rawLines.some((l) => l.length > CAPS.maxLineLength)) {
    return `line too long (max ${CAPS.maxLineLength} chars)`;
  }
  return null;
}

/** The index sees the whole cards table — including prior custom cards,
 *  which is what makes duplicate detection honest (spec §3.3). ~5k rows,
 *  trivially rebuilt per request. */
function loadIndex(handle: DbHandle): CardIndex {
  const rows = handle.db
    .select({ id: cards.id, kanji: cards.kanji, kana: cards.kana, gloss: cards.gloss, source: cards.source })
    .from(cards)
    .all();
  return buildCardIndex(rows);
}

/** The preview's advisory view: newCard bodies are server-internal. */
function toResponseLine({ newCard: _newCard, ...line }: ParsedLine): Omit<ParsedLine, 'newCard'> {
  return line;
}

export function listsRoutes(handle: DbHandle): Hono {
  const app = new Hono();

  app.post('/preview', async (c) => {
    const body = previewRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'text is required' }, 400);
    const capped = capsError(body.data.text);
    if (capped !== null) return c.json({ error: capped }, 400);
    const result = parseListText(body.data.text, loadIndex(handle));
    return c.json({ lines: result.lines.map(toResponseLine), summary: result.summary });
  });

  app.post('/', async (c) => {
    const body = listSaveRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'name and text are required' }, 400);
    const capped = capsError(body.data.text);
    if (capped !== null) return c.json({ error: capped }, 400);

    // Re-parse the RAW text inside the save path — the preview is advisory
    // display, never trusted state (spec §5.1).
    const result = parseListText(body.data.text, loadIndex(handle));
    const valid = result.lines.filter((l) => l.status !== 'error');
    if (valid.length === 0) return c.json({ error: 'no valid lines to save' }, 400);

    const now = Date.now();
    const name = body.data.name.trim();
    const upsertCustom = handle.sqlite.prepare(
      `INSERT OR IGNORE INTO cards (id, kanji, kana, gloss, pos, jlpt, tier, source, list_version)
       VALUES (@id, @kanji, @kana, @gloss, @pos, NULL, NULL, 'custom', 'custom-v1')`,
    );
    const insertMember = handle.sqlite.prepare(
      `INSERT INTO list_cards (list_id, card_id, position) VALUES (?, ?, ?)`,
    );

    const save = handle.sqlite.transaction(() => {
      const existing = handle.db.select().from(lists).where(eq(lists.name, name)).get();
      let listId: number;
      const replaced = existing !== undefined;
      if (existing !== undefined) {
        listId = existing.id;
        handle.sqlite.prepare(`UPDATE lists SET updated_at = ? WHERE id = ?`).run(now, listId);
        handle.sqlite.prepare(`DELETE FROM list_cards WHERE list_id = ?`).run(listId);
      } else {
        const inserted = handle.sqlite
          .prepare(`INSERT INTO lists (name, created_at, updated_at) VALUES (?, ?, ?)`)
          .run(name, now, now);
        listId = Number(inserted.lastInsertRowid);
      }
      for (const line of valid) {
        if (line.newCard !== undefined) {
          upsertCustom.run({
            id: line.newCard.id,
            kanji: line.newCard.kanji,
            kana: JSON.stringify(line.newCard.kana),
            gloss: line.newCard.gloss,
            pos: line.newCard.pos,
          });
        }
      }
      valid.forEach((line, position) => insertMember.run(listId, line.cardId!, position));
      return { listId, replaced };
    });
    const { listId, replaced } = save();
    return c.json({ id: listId, name, cardCount: valid.length, replaced });
  });

  app.get('/', (c) => {
    const rows = handle.sqlite
      .prepare(
        `SELECT l.id, l.name, l.updated_at AS updatedAt, COUNT(lc.card_id) AS cardCount
         FROM lists l LEFT JOIN list_cards lc ON lc.list_id = l.id
         GROUP BY l.id ORDER BY l.updated_at DESC`,
      )
      .all();
    return c.json(rows);
  });

  app.get('/:id/cards', (c) => {
    const idParam = c.req.param('id');
    if (!/^\d+$/.test(idParam)) return c.json({ error: 'malformed list id' }, 400);
    const id = Number(idParam);
    const list = handle.db.select().from(lists).where(eq(lists.id, id)).get();
    if (list === undefined) return c.json({ error: `no list ${id}` }, 404);

    const members = handle.db
      .select({
        cardId: listCards.cardId,
        kanji: cards.kanji,
        kana: cards.kana,
        gloss: cards.gloss,
        pos: cards.pos,
        source: cards.source,
      })
      .from(listCards)
      .innerJoin(cards, eq(cards.id, listCards.cardId))
      .where(eq(listCards.listId, id))
      .orderBy(listCards.position)
      .all();

    const customCards = members
      .filter((m) => m.source === 'custom')
      .map((m) => ({
        id: m.cardId, kanji: m.kanji, kana: m.kana, gloss: m.gloss,
        pos: m.pos, jlpt: null, source: 'custom' as const,
      }));
    const jlptCardIds = members.filter((m) => m.source === 'jlpt').map((m) => m.cardId);
    return c.json({
      list: { id: list.id, name: list.name, updatedAt: list.updatedAt },
      customCards,
      jlptCardIds,
    });
  });

  app.delete('/:id', (c) => {
    const idParam = c.req.param('id');
    if (!/^\d+$/.test(idParam)) return c.json({ error: 'malformed list id' }, 400);
    const id = Number(idParam);
    const list = handle.db.select().from(lists).where(eq(lists.id, id)).get();
    if (list === undefined) return c.json({ error: `no list ${id}` }, 404);
    // List + membership only — cards and attempts are NEVER deleted (spec
    // §5.1): deterministic custom ids mean a re-import re-links the history.
    const remove = handle.sqlite.transaction(() => {
      handle.sqlite.prepare(`DELETE FROM list_cards WHERE list_id = ?`).run(id);
      handle.sqlite.prepare(`DELETE FROM lists WHERE id = ?`).run(id);
    });
    remove();
    return c.json({ ok: true });
  });

  return app;
}
```

Register in `server/app.ts`:

```ts
import { listsRoutes } from './routes/lists';
```
```ts
  app.route('/api/lists', listsRoutes(handle));
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run server/__tests__/listsRoutes.test.ts` — PASS. Then `npm run check` — green.

- [ ] **Step 6: Commit**

```bash
git add server/db/schema.ts drizzle/ src/shared/api.ts server/routes/lists.ts server/app.ts server/__tests__/listsRoutes.test.ts
git commit -m "feat: lists tables and /api/lists routes with transactional replace-by-name"
```

---

### Task 3: Planner — ungated `list:<id>` pools

**Files:**
- Modify: `server/plan.ts`
- Test: `server/__tests__/plan.test.ts` (new describe block; existing goldens untouched)
- Modify: `server/__tests__/planRoutes.test.ts` (list-pool happy path + malformed)

**Interfaces:**
- Consumes: `lists`/`list_cards` tables (Task 2).
- Produces: `isKnownPool` accepts `/^list:\d+$/`; `computeRunPlan(handle, 'list:<id>', nowMs, mode?)` returns `{newCardIds, seenCards, runBudget, tiers: []}` per spec §5.2. A nonexistent list id behaves like an unknown pool (fully empty plan).

- [ ] **Step 1: Write the failing goldens**

Append to `server/__tests__/plan.test.ts` (the existing `setup()` helper carries `attempt`/`introduce`/`weightOf`; extend it with a list builder):

Inside `setup()`, after the existing helpers, add and return:

```ts
  const makeList = (id: number, cardIds: string[]) => {
    t.handle.sqlite
      .prepare(`INSERT INTO lists (id, name, created_at, updated_at) VALUES (?, ?, 1, 1)`)
      .run(id, `list-${id}`);
    const insert = t.handle.sqlite
      .prepare(`INSERT INTO list_cards (list_id, card_id, position) VALUES (?, ?, ?)`);
    cardIds.forEach((cardId, i) => insert.run(id, cardId, i));
  };
  const insertCustomCard = (id: string, kanji: string | null) =>
    t.handle.sqlite
      .prepare(
        `INSERT INTO cards (id, kanji, kana, gloss, pos, jlpt, tier, source, list_version)
         VALUES (?, ?, '["よみ"]', 'g', 'unclassified', NULL, NULL, 'custom', 'custom-v1')`,
      )
      .run(id, kanji);
```

New describe block:

```ts
describe('computeRunPlan — list pools (custom-list-import spec §5.2)', () => {
  it('an unmet member is new, a met member is weighted seen, and tiers is empty', () => {
    const { t, ids, attempt, makeList } = setup();
    makeList(1, [ids[0], ids[1]]);
    attempt(ids[0], NOW - HOUR);
    const plan = computeRunPlan(t.handle, 'list:1', NOW);
    expect(plan.newCardIds).toEqual([ids[1]]);
    expect(plan.seenCards.map((s) => s.id)).toEqual([ids[0]]);
    expect(plan.tiers).toEqual([]);
    expect(plan.runBudget).toBe(PLAN.perRunNewCap);
  });

  it('there is no gate: every unmet member is eligible at once', () => {
    const { t, ids, makeList } = setup();
    makeList(1, ids.slice(0, 15)); // spans far more than one tier's worth
    const plan = computeRunPlan(t.handle, 'list:1', NOW);
    expect(plan.newCardIds).toHaveLength(15);
  });

  it('mode=reading excludes an unmet kana-only member; recall and absent do not', () => {
    const { t, ids, makeList, insertCustomCard } = setup();
    insertCustomCard('custom-kanaonly01', null);
    makeList(1, [ids[0], 'custom-kanaonly01']);
    expect(computeRunPlan(t.handle, 'list:1', NOW, 'reading').newCardIds).toEqual([ids[0]]);
    expect(computeRunPlan(t.handle, 'list:1', NOW, 'recall').newCardIds)
      .toEqual(expect.arrayContaining([ids[0], 'custom-kanaonly01']));
    expect(computeRunPlan(t.handle, 'list:1', NOW).newCardIds).toHaveLength(2);
  });

  it('the daily budget is shared with JLPT intake', () => {
    const { t, ids, introduce, makeList } = setup();
    makeList(1, [ids[19]]);
    for (let i = 0; i < 18; i++) introduce(ids[i], NOW - HOUR);
    expect(computeRunPlan(t.handle, 'list:1', NOW).runBudget).toBe(2); // goal 20 - 18
  });

  it('an introduced-never-attempted member carries the maximum weight', () => {
    const { t, ids, introduce, makeList, weightOf } = setup();
    makeList(1, [ids[0]]);
    introduce(ids[0], NOW - HOUR);
    const plan = computeRunPlan(t.handle, 'list:1', NOW);
    expect(weightOf(plan, ids[0])).toBeCloseTo(
      PLAN.reviewWeightFloor + PLAN.reviewWeaknessWeight + PLAN.reviewStalenessWeight,
      10,
    );
  });

  it('a nonexistent list id yields the fully empty plan', () => {
    const { t } = setup();
    expect(computeRunPlan(t.handle, 'list:99', NOW)).toEqual({
      newCardIds: [], seenCards: [], runBudget: 0, tiers: [],
    });
  });
});
```

`server/__tests__/planRoutes.test.ts` — add:

```ts
  it('accepts a list pool and returns a schema-valid gate-free plan', async () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    t.handle.sqlite
      .prepare(`INSERT INTO lists (id, name, created_at, updated_at) VALUES (1, 'x', 1, 1)`)
      .run();
    const cardId = (t.handle.sqlite
      .prepare(`SELECT id FROM cards WHERE jlpt = 5 ORDER BY id LIMIT 1`)
      .get() as { id: string }).id;
    t.handle.sqlite
      .prepare(`INSERT INTO list_cards (list_id, card_id, position) VALUES (1, ?, 0)`)
      .run(cardId);
    const res = await buildApp(t.handle).request('/api/plan?pool=list:1&mode=reading');
    expect(res.status).toBe(200);
    const parsed = runPlanSchema.parse(await res.json());
    expect(parsed.tiers).toEqual([]);
  });

  it('rejects a malformed list pool', async () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    expect((await buildApp(t.handle).request('/api/plan?pool=list:abc')).status).toBe(400);
  });
```

Run: `npx vitest run server/__tests__/plan.test.ts` — FAIL (`list:1` is an unknown pool today).

- [ ] **Step 2: Implement in `server/plan.ts`**

(a) Below `POOL_LEVELS`:

```ts
const LIST_POOL_RE = /^list:\d+$/;
```

(b) `isKnownPool` becomes:

```ts
/** Pools the planner knows. The route rejects anything else; computeRunPlan
 *  itself stays total, returning an empty plan for an unknown pool — and for
 *  a well-formed list pool whose id doesn't exist. */
export function isKnownPool(pool: string): boolean {
  return Object.hasOwn(POOL_LEVELS, pool) || LIST_POOL_RE.test(pool);
}
```

(c) Extract two helpers from `computeRunPlan`'s body so the list branch shares them without duplication (a pure move of the existing statements — the untouched JLPT goldens prove neutrality):

```ts
/** Attempts grouped per card plus the introduced set — the planning state
 *  every pool kind derives from. */
function loadPlanningState(handle: DbHandle, nowMs: number): {
  grouped: Map<string, CardAttemptGroup>;
  introduced: Set<string>;
} {
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
  return { grouped, introduced };
}

/** M4-A's daily budget, unchanged: shared across every pool kind, because
 *  introductions are global. */
function computeBudget(handle: DbHandle, nowMs: number): number {
  const goal =
    handle.db.get<{ goal: number }>(sql`SELECT daily_word_goal AS goal FROM profile WHERE id = 1`)
      ?.goal ?? 0;
  const introducedToday =
    handle.db.get<{ n: number }>(
      sql`SELECT COUNT(*) AS n FROM introductions WHERE introduced_at >= ${startOfLocalDay(nowMs)}`,
    )?.n ?? 0;
  return Math.max(0, Math.min(goal - introducedToday, PLAN.perRunNewCap));
}
```

`computeRunPlan`'s existing body then calls these two instead of its inline copies (delete the moved statements).

(d) The list branch, first thing inside `computeRunPlan`:

```ts
  if (LIST_POOL_RE.test(pool)) {
    return computeListRunPlan(handle, Number(pool.slice('list:'.length)), nowMs, mode);
  }
```

and the new function:

```ts
/**
 * A list pool is a curation, not a curriculum: full M4-A treatment —
 * ceremonies via newCardIds, the shared daily budget, weighted review — but
 * NO tier gate and tiers: [] (custom-list-import spec §5.2). The empty tiers
 * array is load-bearing downstream: noticeFor's structural branch, the setup
 * tier display, and tierAdvanceLine all treat it as "nothing to gate".
 */
function computeListRunPlan(
  handle: DbHandle,
  listId: number,
  nowMs: number,
  mode?: Mode,
): RunPlan {
  const listExists = handle.sqlite
    .prepare(`SELECT id FROM lists WHERE id = ?`)
    .get(listId) as { id: number } | undefined;
  if (listExists === undefined) return { newCardIds: [], seenCards: [], runBudget: 0, tiers: [] };

  const members = handle.sqlite
    .prepare(
      `SELECT c.id, c.kanji FROM list_cards lc
       JOIN cards c ON c.id = lc.card_id
       WHERE lc.list_id = ? ORDER BY lc.position`,
    )
    .all(listId) as { id: string; kanji: string | null }[];

  const { grouped, introduced } = loadPlanningState(handle, nowMs);
  const newCardIds: string[] = [];
  const seenCards: { id: string; weight: number }[] = [];
  for (const member of members) {
    const group = grouped.get(member.id);
    if (group !== undefined || introduced.has(member.id)) {
      seenCards.push({ id: member.id, weight: cardWeight(group, nowMs) });
    } else if (!(mode === 'reading' && member.kanji === null)) {
      // The mode-unreachable rule (final-review Fix 1) without a gate to
      // feed: a kana-only member simply can't be introduced in reading mode.
      newCardIds.push(member.id);
    }
  }
  return { newCardIds, seenCards, runBudget: computeBudget(handle, nowMs), tiers: [] };
}
```

- [ ] **Step 3: Run to verify pass**

Run: `npx vitest run server/__tests__/plan.test.ts server/__tests__/planRoutes.test.ts`
Expected: PASS — including every pre-existing JLPT golden, unchanged (the extraction is behavior-neutral).

Then `npm run check` — green.

- [ ] **Step 4: Commit**

```bash
git add server/plan.ts server/__tests__/plan.test.ts server/__tests__/planRoutes.test.ts
git commit -m "feat: ungated list pools in the run planner"
```

---

### Task 4: Client pool loading — `list:<id>` in the loader

**Files:**
- Modify: `src/data/loader.ts`
- Test: `src/data/__tests__/loader.test.ts` (new describe block)

**Interfaces:**
- Consumes: `listCardsResponseSchema` (Task 2), existing `loadLevel` cache.
- Produces (Tasks 5–6 rely on these):
  ```ts
  export type ListPoolId = `list:${number}`;
  export type PlayablePool = PoolId | ListPoolId;
  export function isListPool(pool: string): pool is ListPoolId;  // /^list:\d+$/
  export async function loadPool(pool: PlayablePool): Promise<LoadedPool>;
  ```
  For a list pool: `cards` = customs + JLPT members hydrated from the static level files (each array in position order), `listVersion` = `` `list-${id}@${updatedAt}` ``. List membership is NEVER cached (lists change between imports); the per-level file cache still applies underneath.

- [ ] **Step 1: Write the failing tests**

Append to `src/data/__tests__/loader.test.ts`:

```ts
describe('loadPool — list pools', () => {
  const listBody = (jlptCardIds: string[]) => ({
    list: { id: 3, name: 'leeches', updatedAt: 1_700_000_000_000 },
    customCards: [{
      id: 'custom-abc123def456', kanji: '狛犬', kana: ['こまいぬ'], gloss: 'guardian dog',
      pos: 'unclassified', jlpt: null, source: 'custom',
    }],
    jlptCardIds,
  });

  it('hydrates jlpt members from the static files and appends customs', async () => {
    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      if (u === '/api/lists/3/cards') return Promise.resolve(ok(listBody(['w5'])));
      const level = Number(u.match(/n(\d)/)?.[1]) as 5 | 4 | 3 | 2;
      return Promise.resolve(ok(levelPayload(level, [`w${level}`])));
    });
    const { cards, listVersion } = await loadPool('list:3');
    expect(cards.map((c) => c.id)).toEqual(['custom-abc123def456', 'w5']);
    expect(cards[1].gloss).toBe('g'); // hydrated from the level file, hooks intact
    expect(listVersion).toBe('list-3@1700000000000');
  });

  it('skips a jlpt id the level files no longer contain', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      if (u === '/api/lists/3/cards') return Promise.resolve(ok(listBody(['gone-id'])));
      const level = Number(u.match(/n(\d)/)?.[1]) as 5 | 4 | 3 | 2;
      return Promise.resolve(ok(levelPayload(level, [`w${level}`])));
    });
    const { cards } = await loadPool('list:3');
    expect(cards.map((c) => c.id)).toEqual(['custom-abc123def456']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('membership is never cached: two loads fetch the list twice', async () => {
    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      if (u === '/api/lists/3/cards') return Promise.resolve(ok(listBody([])));
      const level = Number(u.match(/n(\d)/)?.[1]) as 5 | 4 | 3 | 2;
      return Promise.resolve(ok(levelPayload(level, [`w${level}`])));
    });
    await loadPool('list:3');
    await loadPool('list:3');
    const listFetches = fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/lists/'));
    expect(listFetches).toHaveLength(2);
  });

  it('a failed list fetch surfaces as DataLoadError', async () => {
    fetchMock.mockResolvedValue(fail(404));
    await expect(loadPool('list:9')).rejects.toBeInstanceOf(DataLoadError);
  });
});
```

Run: `npx vitest run src/data/__tests__/loader.test.ts` — FAIL.

- [ ] **Step 2: Implement in `src/data/loader.ts`**

Add after the `PoolId` type:

```ts
export type ListPoolId = `list:${number}`;
export type PlayablePool = PoolId | ListPoolId;

export function isListPool(pool: string): pool is ListPoolId {
  return /^list:\d+$/.test(pool);
}
```

Add the import `import { listCardsResponseSchema } from '../shared/api';` and, before `loadPool`:

```ts
/**
 * List membership is fetched fresh on every load — lists change between
 * imports, so caching them would serve stale pools. The per-level file
 * cache underneath still applies, so the JLPT hydration cost matches what
 * `mixed` already pays (custom-list-import spec §5.3). Arrays arrive in
 * list position order; interleaving across the two is not meaningful — the
 * Spawner shuffles and weights, so pool order never reaches gameplay.
 */
async function loadListPool(pool: ListPoolId): Promise<LoadedPool> {
  try {
    const response = await fetch(`/api/lists/${pool.slice('list:'.length)}/cards`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = listCardsResponseSchema.parse(await response.json());
    const levels = await Promise.all(MIXED_ORDER.map(loadLevel));
    const byId = new Map(levels.flat().map((c) => [c.id, c]));
    const hydrated: Card[] = [];
    for (const id of body.jlptCardIds) {
      const card = byId.get(id);
      if (card === undefined) {
        console.warn(`[loader] list ${body.list.id}: jlpt member ${id} not in the level files — skipped`);
        continue;
      }
      hydrated.push(card);
    }
    return {
      cards: [...body.customCards, ...hydrated],
      listVersion: `list-${body.list.id}@${body.list.updatedAt}`,
    };
  } catch (error: unknown) {
    if (error instanceof DataLoadError) throw error;
    throw new DataLoadError(pool, error);
  }
}
```

and `loadPool` becomes:

```ts
export async function loadPool(pool: PlayablePool): Promise<LoadedPool> {
  if (isListPool(pool)) return loadListPool(pool);
  if (pool !== 'mixed') {
    const cards = await loadLevel(pool);
    return { cards, listVersion: listVersions.get(pool)! };
  }
  const levels = await Promise.all(MIXED_ORDER.map(loadLevel));
  // All four data files share one pipeline version; n5 stands in for the pool.
  return { cards: levels.flat(), listVersion: listVersions.get('n5')! };
}
```

(`customCards` parse through `customCardSchema`, which is structurally assignable to the engine `Card` — same bridge `toCards` relies on.)

- [ ] **Step 3: Run to verify pass**

Run: `npx vitest run src/data/__tests__/loader.test.ts` — PASS. Then `npm run check` — green.

- [ ] **Step 4: Commit**

```bash
git add src/data/loader.ts src/data/__tests__/loader.test.ts
git commit -m "feat: loader hydrates list pools from the cards endpoint"
```

---

### Task 5: `listsClient` + ImportScreen component

**Files:**
- Create: `src/data/listsClient.ts`
- Create: `src/ui/screens/ImportScreen.tsx`
- Test: `src/data/__tests__/listsClient.test.ts`, `src/ui/__tests__/ImportScreen.test.tsx`

**Interfaces:**
- Consumes: shared schemas (Task 2).
- Produces (Task 6 relies on these):
  ```ts
  // src/data/listsClient.ts — all return null on any failure; never throw
  export async function fetchLists(): Promise<readonly ListSummary[] | null>;
  export async function previewList(text: string): Promise<PreviewResponse | null>;
  export async function saveList(name: string, text: string): Promise<ListSaveResponse | null>;
  ```
  (No `deleteList`: the spec defines the DELETE endpoint (§5.1, server-tested in Task 2) but no delete UI — the vanished-list fallback (Task 6) covers externally-deleted lists, and a client function with no caller would be dead code. A delete affordance is a deliberate follow-up, not part of this plan.)
  ```tsx
  // ImportScreen props
  interface ImportScreenProps {
    onSaved: (list: { id: number; name: string }) => void;
    onBack: () => void;
  }
  ```

- [ ] **Step 1: Write the failing listsClient tests**

Create `src/data/__tests__/listsClient.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLists, previewList, saveList } from '../listsClient';

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const ok = (body: unknown) =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as Response;

describe('listsClient', () => {
  it('fetchLists parses summaries and nulls on failure', async () => {
    fetchMock.mockResolvedValueOnce(ok([{ id: 1, name: 'leeches', cardCount: 2, updatedAt: 5 }]));
    expect(await fetchLists()).toEqual([{ id: 1, name: 'leeches', cardCount: 2, updatedAt: 5 }]);
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await fetchLists()).toBeNull();
  });

  it('previewList POSTs the text and parses the response', async () => {
    fetchMock.mockResolvedValueOnce(ok({
      lines: [{ line: 1, raw: '犬', status: 'jlpt', cardId: 'jm-1' }],
      summary: { total: 1, resolved: 1, customNew: 0, errors: 0 },
    }));
    const preview = await previewList('犬');
    expect(preview?.summary.resolved).toBe(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('/api/lists/preview');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ text: '犬' });
  });

  it('saveList returns null on a 400 so the screen can show its own error', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: () => Promise.resolve({}) } as Response);
    expect(await saveList('x', 'bad')).toBeNull();
  });
});
```

Run: `npx vitest run src/data/__tests__/listsClient.test.ts` — FAIL.

- [ ] **Step 2: Implement `src/data/listsClient.ts`**

```ts
import {
  listSaveResponseSchema, listSummarySchema, previewResponseSchema,
  type ListSaveResponse, type ListSummary, type PreviewResponse,
} from '../shared/api';
import { z } from 'zod';

/**
 * Thin client for /api/lists. Every function resolves null (or false) on any
 * failure — the import UI degrades to inline messages and the setup screen
 * simply hides its list row; nothing here ever throws (custom-list-import
 * spec §5.3, same posture as fetchRunPlan).
 */

export async function fetchLists(): Promise<readonly ListSummary[] | null> {
  try {
    const response = await fetch('/api/lists');
    if (!response.ok) return null;
    return z.array(listSummarySchema).parse(await response.json());
  } catch {
    return null;
  }
}

export async function previewList(text: string): Promise<PreviewResponse | null> {
  try {
    const response = await fetch('/api/lists/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) return null;
    return previewResponseSchema.parse(await response.json());
  } catch {
    return null;
  }
}

export async function saveList(name: string, text: string): Promise<ListSaveResponse | null> {
  try {
    const response = await fetch('/api/lists', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, text }),
    });
    if (!response.ok) return null;
    return listSaveResponseSchema.parse(await response.json());
  } catch {
    return null;
  }
}
```

Run the listsClient tests — PASS.

- [ ] **Step 3: Write the failing ImportScreen tests**

Create `src/ui/__tests__/ImportScreen.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImportScreen } from '../screens/ImportScreen';

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const ok = (body: unknown) =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as Response;

const PREVIEW = {
  lines: [
    { line: 1, raw: '犬', status: 'jlpt', cardId: 'jm-1', display: { kanji: '犬', kana: 'いぬ', gloss: 'dog' } },
    { line: 2, raw: 'かみ', status: 'error', error: 'ambiguous — 紙 (paper), 神 (god); supply word\tkana\tgloss' },
  ],
  summary: { total: 2, resolved: 1, customNew: 0, errors: 1 },
};

function stub(routes: Record<string, unknown>) {
  fetchMock.mockImplementation((url: string) => {
    const body = routes[String(url)];
    if (body === undefined) return Promise.reject(new Error(`unhandled fetch: ${url}`));
    return Promise.resolve(ok(body));
  });
}

describe('ImportScreen', () => {
  it('previews a paste and renders per-line statuses and errors', async () => {
    stub({ '/api/lists/preview': PREVIEW });
    render(<ImportScreen onSaved={() => {}} onBack={() => {}} />);
    await userEvent.type(screen.getByTestId('import-text'), '犬{enter}かみ');
    await userEvent.click(screen.getByTestId('preview-button'));
    await waitFor(() => {
      expect(screen.getByTestId('preview-table')).toHaveTextContent('犬');
      expect(screen.getByTestId('preview-table')).toHaveTextContent('ambiguous');
    });
    expect(screen.getByTestId('save-button')).toHaveTextContent('Save 1 word (1 line skipped)');
  });

  it('save is disabled without a name or without any valid line', async () => {
    stub({
      '/api/lists/preview': {
        lines: [{ line: 1, raw: 'かみ', status: 'error', error: 'ambiguous' }],
        summary: { total: 1, resolved: 0, customNew: 0, errors: 1 },
      },
    });
    render(<ImportScreen onSaved={() => {}} onBack={() => {}} />);
    await userEvent.type(screen.getByTestId('import-text'), 'かみ');
    await userEvent.click(screen.getByTestId('preview-button'));
    await waitFor(() => expect(screen.getByTestId('save-button')).toBeDisabled());
  });

  it('saving calls onSaved with the response identity', async () => {
    const onSaved = vi.fn();
    stub({
      '/api/lists/preview': {
        lines: [{ line: 1, raw: '犬', status: 'jlpt', cardId: 'jm-1', display: { kanji: '犬', kana: 'いぬ', gloss: 'dog' } }],
        summary: { total: 1, resolved: 1, customNew: 0, errors: 0 },
      },
      '/api/lists': { id: 7, name: 'leeches', cardCount: 1, replaced: false },
    });
    render(<ImportScreen onSaved={onSaved} onBack={() => {}} />);
    await userEvent.type(screen.getByTestId('import-name'), 'leeches');
    await userEvent.type(screen.getByTestId('import-text'), '犬');
    await userEvent.click(screen.getByTestId('preview-button'));
    await waitFor(() => expect(screen.getByTestId('save-button')).toBeEnabled());
    await userEvent.click(screen.getByTestId('save-button'));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith({ id: 7, name: 'leeches' }));
  });

  it('a failed save shows an inline error and stays on the screen', async () => {
    stub({
      '/api/lists/preview': {
        lines: [{ line: 1, raw: '犬', status: 'jlpt', cardId: 'jm-1', display: { kanji: '犬', kana: 'いぬ', gloss: 'dog' } }],
        summary: { total: 1, resolved: 1, customNew: 0, errors: 0 },
      },
    });
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url) === '/api/lists/preview') {
        return Promise.resolve(ok({
          lines: [{ line: 1, raw: '犬', status: 'jlpt', cardId: 'jm-1', display: { kanji: '犬', kana: 'いぬ', gloss: 'dog' } }],
          summary: { total: 1, resolved: 1, customNew: 0, errors: 0 },
        }));
      }
      if (String(url) === '/api/lists' && init?.method === 'POST') {
        return Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({}) } as Response);
      }
      return Promise.reject(new Error(`unhandled: ${url}`));
    });
    render(<ImportScreen onSaved={() => {}} onBack={() => {}} />);
    await userEvent.type(screen.getByTestId('import-name'), 'x');
    await userEvent.type(screen.getByTestId('import-text'), '犬');
    await userEvent.click(screen.getByTestId('preview-button'));
    await waitFor(() => expect(screen.getByTestId('save-button')).toBeEnabled());
    await userEvent.click(screen.getByTestId('save-button'));
    await waitFor(() => expect(screen.getByTestId('import-error')).toHaveTextContent(/could not save/i));
  });
});
```

Run: FAIL (no component).

- [ ] **Step 4: Implement `src/ui/screens/ImportScreen.tsx`**

```tsx
import { useState } from 'react';
import { previewList, saveList } from '../../data/listsClient';
import type { PreviewResponse } from '../../shared/api';

interface ImportScreenProps {
  onSaved: (list: { id: number; name: string }) => void;
  onBack: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  jlpt: 'built-in', 'custom-existing': 'custom (known)', 'custom-new': 'custom (new)', error: 'error',
};

/**
 * Paste → preview → save (custom-list-import spec §5.3). The preview is
 * advisory: the server re-parses the raw text on save, so this screen only
 * ever ships the text itself. Error lines don't block saving — the button
 * says exactly what will be skipped, so nothing is dropped silently.
 */
export function ImportScreen({ onSaved, onBack }: ImportScreenProps) {
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid = preview === null ? 0 : preview.summary.total - preview.summary.errors;
  const skipped = preview?.summary.errors ?? 0;

  const doPreview = async () => {
    setBusy(true);
    setError(null);
    const result = await previewList(text);
    if (result === null) setError('Preview failed — is the server running?');
    setPreview(result);
    setBusy(false);
  };

  const doSave = async () => {
    setBusy(true);
    setError(null);
    const saved = await saveList(name.trim(), text);
    setBusy(false);
    if (saved === null) {
      setError('Could not save the list — check the lines and try again.');
      return;
    }
    onSaved({ id: saved.id, name: saved.name });
  };

  return (
    <div className="screen-center" data-testid="import">
      <h2>Import a word list</h2>
      <p className="hint">
        One word per line — bare words resolve against the built-in N5–N2 data;
        anything else needs word&#9;kana&#9;gloss. Lines starting with # are ignored.
      </p>
      <input
        data-testid="import-name"
        placeholder="List name (re-importing a name replaces it)"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <textarea
        data-testid="import-text"
        rows={10}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setPreview(null); // edits invalidate the advisory preview
        }}
      />
      <div className="picker-row">
        <button data-testid="preview-button" disabled={busy || text.trim().length === 0} onClick={() => void doPreview()}>
          Preview
        </button>
        <button
          data-testid="save-button"
          disabled={busy || preview === null || valid === 0 || name.trim().length === 0}
          onClick={() => void doSave()}
        >
          {`Save ${valid} ${valid === 1 ? 'word' : 'words'}`
            + (skipped > 0 ? ` (${skipped} ${skipped === 1 ? 'line' : 'lines'} skipped)` : '')}
        </button>
        <button onClick={onBack}>Back</button>
      </div>
      {error !== null && (
        <p className="load-error" data-testid="import-error">{error}</p>
      )}
      {preview !== null && (
        <table data-testid="preview-table" className="preview-table">
          <tbody>
            {preview.lines.map((l) => (
              <tr key={l.line} className={l.status === 'error' ? 'preview-error' : ''}>
                <td>{l.line}</td>
                <td>{STATUS_LABELS[l.status]}</td>
                <td>
                  {l.status === 'error'
                    ? `${l.raw} — ${l.error}`
                    : `${l.display?.kanji ?? l.display?.kana} · ${l.display?.kana} · ${l.display?.gloss}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run src/ui/__tests__/ImportScreen.test.tsx src/data/__tests__/listsClient.test.ts` — PASS. Then `npm run check` — green (the screen is not yet reachable from App; that's Task 6).

- [ ] **Step 6: Commit**

```bash
git add src/data/listsClient.ts src/data/__tests__/listsClient.test.ts src/ui/screens/ImportScreen.tsx src/ui/__tests__/ImportScreen.test.tsx
git commit -m "feat: lists client and import screen with advisory preview"
```

---

### Task 6: Wiring — Setup list row, App navigation, list pools playable

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/ui/screens/SetupScreen.tsx`
- Modify: `src/ui/__tests__/SetupScreen.tiers.test.tsx` (stubs gain an `/api/lists` branch — REQUIRED to keep them green)
- Test: `src/ui/__tests__/SetupScreen.lists.test.tsx` (new), plus an App-level reading-block test in `src/ui/__tests__/App.introFlow.test.tsx`'s style appended to a new `src/ui/__tests__/App.listPool.test.tsx`

**Interfaces:**
- Consumes: `PlayablePool`/`isListPool` (Task 4), `fetchLists` (Task 5), `ImportScreen` (Task 5).
- Produces: pool `list:<id>` playable end to end; Setup shows the list row + Import button; reading mode × all-kana list blocked with the exact message `This list has no kanji words — Reading mode unavailable.`; `?pool=list:3` auto-run accepted.

- [ ] **Step 1: App changes**

`src/App.tsx`:
- `type Screen = 'title' | 'setup' | 'game' | 'stats' | 'import';`
- Import `isListPool, type PlayablePool` from `./data/loader`; `beginFromPool` takes `pool: PlayablePool`.
- `runFromUrl` accepts list pools:
  ```ts
  function runFromUrl(): { mode: GameMode; pool: PlayablePool } | null {
    const params = new URLSearchParams(window.location.search);
    const mode = params.get('mode') as GameMode | null;
    const pool = params.get('pool');
    if (mode === null || pool === null || !VALID_MODES.includes(mode)) return null;
    if ((VALID_POOLS as readonly string[]).includes(pool) || isListPool(pool)) {
      return { mode, pool: pool as PlayablePool };
    }
    return null;
  }
  ```
- The tier-advance refetch guard widens from `isPoolId` to plannable pools (a list pool's re-fetch legitimately returns `tiers: []`, and `tierAdvanceLine` correctly nulls):
  ```ts
  /** 'revenge' isn't a plannable pool (it bypasses planning entirely, spec
   *  §5.5); JLPT pools and list pools both are. */
  function isPlannablePool(pool: string): pool is PlayablePool {
    return (VALID_POOLS as readonly string[]).includes(pool) || isListPool(pool);
  }
  ```
  (replace `isPoolId` and its call site — grep for it; it has exactly one caller, the gameOver effect.)
- The reading-mode guard in `beginFromPool`, immediately after the `Promise.all`:
  ```ts
      if (mode === 'reading' && cards.every((c) => c.kanji === null)) {
        // An empty reading pool would loop wave-cleared forever in the
        // engine — reachable only via all-kana custom lists, so block it
        // here with a plain message (custom-list-import spec §5.4).
        setLoadError('This list has no kanji words — Reading mode unavailable.');
        return;
      }
  ```
  (the `finally` already clears `loading`.)
- Screen wiring:
  ```tsx
  if (screen === 'import') {
    return (
      <ImportScreen
        onSaved={(list) => {
          importedListRef.current = list;
          setScreen('setup');
        }}
        onBack={() => setScreen('setup')}
      />
    );
  }
  ```
  with `const importedListRef = useRef<{ id: number; name: string } | null>(null);` and SetupScreen gaining two props (below): `onImport={() => setScreen('import')}` and `initialListSelection={importedListRef.current}` (cleared inside SetupScreen's consumption — see Step 2 — or simply passed each render; SetupScreen treats it as the initial pool when non-null).

- [ ] **Step 2: SetupScreen changes**

Props gain:

```ts
  onImport: () => void;
  /** A list just saved by the import screen: preselect it (spec §5.3). */
  initialListSelection: { id: number; name: string } | null;
```

`onBegin` widens to `(mode: GameMode, pool: PlayablePool) => void`; the `pool` state becomes `useState<PlayablePool>(initialListSelection ? \`list:${initialListSelection.id}\` : 'n5')`.

List row state + fetch (after the tiers effect):

```tsx
  // The player's lists, or null while unknown/unavailable. Server down →
  // row absent, same posture as tier progress (spec §5.3).
  const [listRow, setListRow] = useState<readonly ListSummary[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchLists().then((lists) => {
      if (!cancelled) setListRow(lists);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // A selected list that no longer exists (deleted elsewhere) falls back to N5.
  useEffect(() => {
    if (listRow === null || !isListPool(pool)) return;
    const id = Number(pool.slice('list:'.length));
    if (!listRow.some((l) => l.id === id)) setPool('n5');
  }, [listRow, pool]);
```

Render, between the pool row and the tier-progress block:

```tsx
      {listRow !== null && (
        <div className="picker-row" data-testid="list-row">
          {listRow.map((l) => (
            <button
              key={l.id}
              className={pool === `list:${l.id}` ? 'picker selected' : 'picker'}
              data-testid={`pool-list-${l.id}`}
              onClick={() => setPool(`list:${l.id}`)}
            >
              {l.name} <span className="hint">({l.cardCount})</span>
            </button>
          ))}
          <button data-testid="import-button" onClick={onImport}>Import…</button>
        </div>
      )}
      {listRow === null && (
        <div className="picker-row">
          <button data-testid="import-button" onClick={onImport}>Import…</button>
        </div>
      )}
```

(The Import button renders in both states — importing must not require the summaries fetch to have succeeded.) Imports: `fetchLists` from `../../data/listsClient`, `isListPool, type PlayablePool` and `ListSummary` types.

Note: the tiers effect already runs `fetchRunPlan(pool, mode)` — for a list pool that returns `tiers: []` and the display correctly shows nothing. No change needed there.

- [ ] **Step 3: Keep existing SetupScreen tests green + new tests**

`src/ui/__tests__/SetupScreen.tiers.test.tsx`: every stubbed fetch gains an `/api/lists` branch returning `ok([])`, and every `<SetupScreen …>` render gains `onImport={() => {}} initialListSelection={null}`.

Create `src/ui/__tests__/SetupScreen.lists.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SetupScreen } from '../screens/SetupScreen';

const noop = () => {};

function stubFetch(lists: unknown) {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const u = String(url);
    if (u === '/api/lists') {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(lists) } as Response);
    }
    if (u.includes('/api/plan')) {
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ newCardIds: [], seenCards: [], runBudget: 0, tiers: [] }),
      } as Response);
    }
    return Promise.reject(new Error(`unhandled fetch: ${u}`));
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('SetupScreen list row (custom-list-import spec §5.3)', () => {
  it('renders lists and selecting one begins a list pool', async () => {
    stubFetch([{ id: 3, name: 'leeches', cardCount: 12, updatedAt: 5 }]);
    const onBegin = vi.fn();
    render(
      <SetupScreen loading={false} error={null} onBegin={onBegin} onBack={noop}
        onImport={noop} initialListSelection={null} />,
    );
    await waitFor(() => expect(screen.getByTestId('pool-list-3')).toHaveTextContent('leeches'));
    await userEvent.click(screen.getByTestId('pool-list-3'));
    await userEvent.click(screen.getByTestId('begin-button'));
    expect(onBegin).toHaveBeenCalledWith('reading', 'list:3');
  });

  it('a just-imported list arrives preselected', async () => {
    stubFetch([{ id: 7, name: 'week32', cardCount: 4, updatedAt: 5 }]);
    const onBegin = vi.fn();
    render(
      <SetupScreen loading={false} error={null} onBegin={onBegin} onBack={noop}
        onImport={noop} initialListSelection={{ id: 7, name: 'week32' }} />,
    );
    await userEvent.click(screen.getByTestId('begin-button'));
    expect(onBegin).toHaveBeenCalledWith('reading', 'list:7');
  });

  it('a selected list that vanished falls back to N5', async () => {
    stubFetch([]);
    const onBegin = vi.fn();
    render(
      <SetupScreen loading={false} error={null} onBegin={onBegin} onBack={noop}
        onImport={noop} initialListSelection={{ id: 9, name: 'gone' }} />,
    );
    await waitFor(() => expect(screen.getByTestId('import-button')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('begin-button'));
    expect(onBegin).toHaveBeenCalledWith('reading', 'n5');
  });

  it('server down: no list row, but Import stays reachable', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    const onImport = vi.fn();
    render(
      <SetupScreen loading={false} error={null} onBegin={noop} onBack={noop}
        onImport={onImport} initialListSelection={null} />,
    );
    await waitFor(() => expect(screen.queryByTestId('list-row')).toBeNull());
    await userEvent.click(screen.getByTestId('import-button'));
    expect(onImport).toHaveBeenCalled();
  });
});
```

Create `src/ui/__tests__/App.listPool.test.tsx` (mocking `useEngine` exactly as `App.replayPlan.test.tsx` does — copy its mock block):

```tsx
// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EngineSnapshot } from '../../engine/types';

const start = vi.fn();
const resume = vi.fn();
let mockSnapshot: EngineSnapshot;

vi.mock('../useEngine', () => ({
  useEngine: () => ({ snapshot: mockSnapshot, hostRef: { current: null }, start, resume, introCards: [] }),
  isGameKey: () => false,
}));

import App from '../../App';

const snap = (over: Partial<EngineSnapshot>): EngineSnapshot => ({
  status: 'playing', mode: 'reading', score: 0, lives: 3, wave: 1, combo: 0,
  kills: 0, wrongSubmits: 0, maxCombo: 0, bufferKana: '', bufferRomaji: '',
  lockedIds: [], missed: [], timeMs: 0, ...over,
});

beforeEach(() => {
  start.mockClear();
  mockSnapshot = snap({});
});
afterEach(() => {
  vi.unstubAllGlobals();
  window.history.pushState({}, '', '/');
});

describe('App list pools', () => {
  it('blocks reading mode on an all-kana list with the plain message', async () => {
    window.history.pushState({}, '', '/?mode=reading&pool=list:3');
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const u = String(url);
      if (u === '/api/lists/3/cards') {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({
            list: { id: 3, name: 'kana-only', updatedAt: 5 },
            customCards: [{
              id: 'custom-abcdefabcdef', kanji: null, kana: ['ぺけ'], gloss: 'x',
              pos: 'unclassified', jlpt: null, source: 'custom',
            }],
            jlptCardIds: [],
          }),
        } as Response);
      }
      if (u.includes('/api/plan')) {
        return Promise.resolve({
          ok: true, status: 200,
          json: () => Promise.resolve({ newCardIds: [], seenCards: [], runBudget: 0, tiers: [] }),
        } as Response);
      }
      return Promise.reject(new Error(`unhandled fetch: ${u}`));
    }));
    render(<App />);
    // The auto-run lands back on Setup with the block message, never starting.
    await waitFor(() =>
      expect(screen.getByTestId('load-error')).toHaveTextContent(/no kanji words/i));
    expect(start).not.toHaveBeenCalled();
  });
});
```

(App renders Title first; the auto-run effect drives `beginFromPool`, whose error path sets `loadError` — but the screen showing `load-error` is Setup. Check App's flow: `loadError` renders inside SetupScreen, and the auto-run failure leaves `screen === 'title'`. The test must first navigate: after the waitFor on `start` NOT being called, assert via entering setup — if this proves awkward, assert instead that `start` was never called AND `screen.queryByTestId('load-error')` after clicking through Title → Start. The implementer adjusts the navigation to match App's actual behavior and documents the choice in the report; the load-bearing assertions are: `start` never called, the exact message reachable on the Setup screen.)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/ui/__tests__/SetupScreen.lists.test.tsx src/ui/__tests__/SetupScreen.tiers.test.tsx src/ui/__tests__/App.listPool.test.tsx src/ui/__tests__/ImportScreen.test.tsx`
Expected: PASS. Then `npm run check` — green.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/ui/screens/SetupScreen.tsx src/ui/__tests__/SetupScreen.tiers.test.tsx src/ui/__tests__/SetupScreen.lists.test.tsx src/ui/__tests__/App.listPool.test.tsx
git commit -m "feat: list pools playable end to end with setup row and import navigation"
```

---

### Task 7: E2E, doc amendments, status flip

**Files:**
- Create: `e2e/import.spec.ts`
- Modify: `docs/superpowers/specs/2026-07-22-kotoba-drop-design.md` (file-map note)
- Modify: `docs/superpowers/specs/2026-08-08-custom-list-import-design.md` (status line)

**Interfaces:**
- Consumes: everything above.
- Produces: the import→play seam proven end to end; docs honest.

- [ ] **Step 1: Write the e2e spec**

Create `e2e/import.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { toRomaji } from 'wanakana';

/** Import a two-line list through the real UI — one bare word that resolves
 *  against the bundled data, one full-line custom that cannot — then play it
 *  in reading mode: the resolved word gets its ceremony and an attempt lands
 *  (custom-list-import spec §8). The kana-only custom is deliberately
 *  unreachable in reading mode, exercising the mode-aware exclusion. */
test('import a list and play it: ceremony, kill, persistence', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByText('Start', { exact: false }).first().click();
  await page.getByTestId('import-button').click();

  await page.getByTestId('import-name').fill('e2e-list');
  await page.getByTestId('import-text').fill('犬\nぺけぺけ,ぺけぺけ,e2e test word');
  await page.getByTestId('preview-button').click();
  await expect(page.getByTestId('save-button')).toHaveText(/Save 2 words/);
  await page.getByTestId('save-button').click();

  // Back on setup with the new list preselected; reading mode is the default.
  await expect(page.getByTestId('setup')).toBeVisible();
  await page.getByTestId('begin-button').click();

  // The ceremony shows the resolved word (the kana-only custom is excluded
  // from reading mode's plan). Type its reading through, same as the
  // keystone spec.
  await page.waitForFunction(() => window.__kotoba?.snapshot().status === 'waveIntro');
  const reading = await page.getByTestId('ceremony-reading').textContent();
  await page.keyboard.type(toRomaji(reading!), { delay: 20 });
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.__kotoba?.snapshot().status === 'playing');

  // Kill the airborne word.
  await page.waitForFunction(() => {
    const snap = window.__kotoba?.snapshot();
    return !!snap && (snap.status !== 'playing' || !!snap.firstAirborneReading);
  });
  const airborne = await page.evaluate(() => window.__kotoba!.snapshot().firstAirborneReading!);
  await page.keyboard.type(toRomaji(airborne), { delay: 30 });
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('score')).not.toHaveText('0');

  // The list's plan sees the member as met once the batch flushes.
  const listId = ((await (await page.request.get('/api/lists')).json()) as { id: number }[])[0].id;
  await expect
    .poll(async () => {
      const res = await page.request.get(`/api/plan?pool=list:${listId}`);
      if (!res.ok()) return 0;
      const plan = (await res.json()) as { seenCards: unknown[] };
      return plan.seenCards.length;
    }, { timeout: 15_000 })
    .toBeGreaterThan(0);
});
```

(Two adjustments the implementer makes against reality, documenting each in the report: the Title screen's Start control — read `TitleScreen.tsx` for its actual text/testid; and whether a single kill flushes the batch — the keystone spec clears the whole wave to trigger the flush on `waveCleared`, so if the poll stalls, clear the remaining wave words the same way `clearRestOfWave` does in `game.spec.ts`.)

- [ ] **Step 2: Doc amendments**

`docs/superpowers/specs/2026-07-22-kotoba-drop-design.md` — on the file-map line `importParser.ts     # TSV/CSV parsing with per-line errors`, replace the comment with `# superseded: parsing lives server-side (server/listImport.ts) — see 2026-08-08-custom-list-import-design.md §9`.

`docs/superpowers/specs/2026-08-08-custom-list-import-design.md` — status line becomes `**Status:** Implemented — see docs/superpowers/plans/2026-08-08-custom-list-import.md`.

- [ ] **Step 3: Full verification**

Run: `npm run check` — green.
Run: `npm run e2e` — all three specs (both keystone specs + the new import spec) PASS.

- [ ] **Step 4: Commit**

```bash
git add e2e/import.spec.ts docs/superpowers/specs/2026-07-22-kotoba-drop-design.md docs/superpowers/specs/2026-08-08-custom-list-import-design.md
git commit -m "test: e2e import-and-play seam; docs: file-map amendment and status"
```

---

## Spec coverage map (self-review)

| Spec section | Where |
|---|---|
| §3.1 lists/membership, replace-by-name same id | Tasks 2 (tables, upsert) |
| §3.2 custom cards, deterministic ids, stat exclusion already enforced | Tasks 1 (id + card body), 2 (persistence); stats untouched |
| §3.3 parsing/resolution rules, caps | Task 1 (rules), Task 2 (route-level caps → 400) |
| §4 data model | Task 2 |
| §5.1 API surface incl. preview-no-writes, txn save, delete semantics | Task 2 |
| §5.2 planner: ungated, mode-aware, shared budget, tiers [] | Task 3 |
| §5.3 client: hydration, listVersion, Setup row, Import screen | Tasks 4, 5, 6 |
| §5.4 reading × all-kana guard | Task 6 |
| §6 data flow | Tasks 2–6 wiring |
| §7 error table | Task 1 (line errors), 2 (caps/400/404), 4 (DataLoadError), 5 (inline errors), 6 (vanished-list fallback, reading block), 3 (nonexistent list → empty plan) |
| §8 test matrix | Tasks 1–6 unit/component, Task 7 e2e |
| §9 file-map amendment | Task 7 |
