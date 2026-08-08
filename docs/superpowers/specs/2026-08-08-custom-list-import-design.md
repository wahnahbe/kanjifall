# Custom List Import — Design Spec

**Date:** 2026-08-08
**Status:** Implemented — see docs/superpowers/plans/2026-08-08-custom-list-import.md
**Scope:** M4 sub-project B. Independent of C (the juice pass).
**Amends:** main spec's file map (§4): `src/data/importParser.ts` is superseded by a server-side parser — resolution requires the DB (see §9)
**Builds on:** `2026-07-24-word-introduction-v2-design.md` (M4-A) and `2026-07-27-tiered-vocabulary-design.md` (M4-D); list pools consume both

## 1. Purpose

Get the owner's actual problem words into the game.

The tiered JLPT pools (M4-D) are the study *path*; the words that most need arcade reinforcement are the ones the owner's real SRS (n2-prep) says are failing. This sub-project lets a pasted export become a playable pool: mostly bare words auto-resolved against the 4,678 bundled cards, with a full-line fallback for anything the bundle lacks.

Custom lists get the full M4-A treatment — acquisition ceremonies, the shared daily budget, weighted review — but no tier gate: a list is already a curation, so intake ordering is the list's own business.

### Non-goals

- **A card editor.** Unresolvable lines are fixed in the paste, not in an editing UI.
- **Auto-fill from jmdict at runtime.** The raw dictionaries are build-time inputs, not server dependencies. Resolution is against the seeded `cards` table only.
- **Tiers for custom cards.** `tier` stays NULL; list pools are ungated by design.
- **List membership in `mixed`.** Mixed is the JLPT variety mode, unchanged.
- **Sharing, export, or sync.** Single-player, local DB, as ever.

## 2. Decisions log

| Decision | Choice | Why |
|---|---|---|
| Primary source | n2-prep exports (bare words) | The owner's real workflow; auto-resolution does the heavy lifting |
| Unresolved lines | Full-line fallback `word‹TAB›kana‹TAB›gloss` | Off-bundle words stay importable; errors are per-line and actionable |
| Where parsing lives | Server (`server/listImport.ts`) | Resolution needs the cards table; one implementation, one source of truth |
| Plan treatment | Full M4-A: ceremonies + shared budget + weighted review, no gate | Words new to the game deserve their acquisition moment; the budget paces a 50-word dump over days |
| Re-import, same name | Replace membership, same list id | One-step weekly refresh; pool string `list:<id>` stays stable |
| Custom card ids | Deterministic: `custom-` + hash of `kanji|kana` | Re-imports and cross-list duplicates converge on one card and its history |
| Deleting a list | Removes list + membership only | The app never deletes history; deterministic ids mean re-import re-links it |
| JLPT members at play time | Ids only; client hydrates from static JSON | Sentences/kanji-part hooks keep working without content columns in the DB |
| Save with error lines | Allowed, labeled "Save N words (M lines skipped)" | One typo must not block 50 leeches; skipping is explicit, never silent |

## 3. The model

### 3.1 Lists and membership

A **list** is a named, ordered set of card references. `lists`: `id` (autoincrement), `name` (unique), `createdAt`, `updatedAt`. `list_cards`: (`listId`, `cardId`) primary key plus `position` (import line order). Saving under an existing name replaces that list's membership in place — same `id`, bumped `updatedAt`.

### 3.2 Custom cards

A full line that resolves to no existing card creates a row in `cards`:

- `id`: `custom-` + first 12 hex chars of SHA-256 over `${kanji ?? ''}|${kana}` — deterministic, so the same word imported twice (any list, any day) is the same card.
- `kanji`: the word, or NULL when the word is pure kana (wanakana `isKana`, the pipeline's own rule).
- `kana`: `[reading]`. `gloss`: as supplied (≤28 chars, the committed-data invariant). `pos`: `'unclassified'`. `jlpt`: NULL. `tier`: NULL. `source`: `'custom'`. `listVersion`: `'custom-v1'`.
- No `sentence`/`kanjiParts` — both optional everywhere already.

Custom cards contribute to every stat except level coverage/mastery (main spec §5.1 — already enforced by the `source === 'jlpt'` filter in `computeLevelRows`; no change needed).

### 3.3 Parsing and resolution

One server module, `server/listImport.ts`, exporting a pure `parseListText(text, cardIndex)` plus the index builder. Rules, applied per line:

1. Trim; skip empty lines and lines starting with `#` (export headers/comments).
2. Delimiter: TAB when the line contains one; otherwise comma, splitting only the **first two** commas so glosses may contain them.
3. Field counts: 1 = bare word; 3 = `word, kana, gloss`; anything else = per-line error.
4. **Bare word W:** look up by exact kanji, or — when W is pure kana — by membership in any card's `kana` array. Exactly one match → resolved (`jlpt` or `custom-existing`). Zero → error `not in the built-in N5–N2 data — supply word‹TAB›kana‹TAB›gloss`. More than one (homophones: かみ → 紙/神/髪) → error listing the candidates' kanji+gloss so the full form can be pasted.
5. **Full line:** resolve first — a unique existing card matching kanji AND reading (or, for kana-only words, a unique kana-only card with that reading) is reused, its own gloss winning (`custom-existing` when it's a prior custom card, `jlpt` otherwise). No unique match → `custom-new`. Ambiguity with a full line therefore never errors; it creates.
6. `kana` field must be pure kana; `gloss` ≤ 28 chars — each a per-line error otherwise.
7. A line resolving to a card already produced by an earlier line → error `duplicate of line N` (first occurrence wins).
8. Caps: 1,000 lines, 200 chars per line — hard 400 beyond.

The resolution index is built in memory from the full `cards` table per request (`byKanji`, `byKana` maps over ~5k rows — trivial at this scale, and it automatically sees prior custom cards, which is what makes duplicate detection honest).

## 4. Data model

Two new tables (drizzle migration, generated):

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

No changes to `cards` (custom rows use existing columns; `tier` is already nullable for exactly this reason).

## 5. Architecture

### 5.1 API

| Route | Behavior |
|---|---|
| `POST /api/lists/preview` `{text}` | Parse + resolve, **no writes**. Returns `{lines: [{line, raw, status: 'jlpt'\|'custom-existing'\|'custom-new'\|'error', cardId?, display?: {kanji, kana, gloss}, error?}], summary: {total, resolved, customNew, errors}}` — `line` is the 1-based number in the original paste (blank/comment lines counted, not returned) |
| `POST /api/lists` `{name, text}` | Re-parses the raw text inside one transaction (the preview is advisory display, never trusted state): upsert list by name, replace membership, `INSERT OR IGNORE` new custom cards. Returns `{id, name, cardCount, replaced: boolean}`. All-lines-invalid or empty name → 400 |
| `GET /api/lists` | `[{id, name, cardCount, updatedAt}]`, newest first |
| `GET /api/lists/:id/cards` | `{list: {id, name, updatedAt}, customCards: Card[], jlptCardIds: string[]}` in list `position` order — `updatedAt` is what the client's run `listVersion` derives from (§5.3); unknown id → 404 |
| `DELETE /api/lists/:id` | Removes the list row + membership. Cards and attempts are untouched — the app never deletes history, and deterministic custom ids mean a later re-import re-links it. Unknown id → 404 |

Zod schemas for the request/response shapes live in `src/shared/api.ts` alongside the existing ones.

### 5.2 Planner

Pool strings gain the form **`list:<id>`** (`/^list:\d+$/`). `isKnownPool` accepts the shape; `computeRunPlan` resolves membership and treats a nonexistent id exactly like an unknown pool (empty plan — the client will have 404'd on the cards fetch first anyway).

For a list pool: `newCardIds` = members never attempted and never introduced, minus mode-unreachable ones (`mode=reading` excludes kana-only, the M4-D rule — there is simply no gate in front of it); `seenCards` = met members with the standard weakness×staleness weights; `runBudget` unchanged (introductions are global, so JLPT and list intake share the daily goal); **`tiers: []`**.

The empty `tiers` array is load-bearing and already handled everywhere: `noticeFor`'s structural branch returns null for it (a list has no tiers to gate or complete — budget-exhausted and starved notices still fire), the setup screen renders no tier line, and `tierAdvanceLine` finds no level to advance.

### 5.3 Client

**Pool loading.** `loadPool` accepts `list:<id>`: fetch `/api/lists/:id/cards`, load the four static JLPT files (cached — the same cost `mixed` already pays), hydrate `jlptCardIds` from them, and return customs + hydrated members in list order. `listVersion` for the run: `list-<id>@<updatedAt>`.

**Setup screen.** Below the pool row: the player's lists as picker buttons (name + count; from `GET /api/lists`, refreshed on mount and on return from import; server down → row absent, same posture as tier progress) plus an "Import…" button. A selected list plays `list:<id>`. `?pool=list:3` works for the dev auto-run.

**Import screen.** Name field, textarea, Preview → per-line table (status chip, resolved display or error text) → Save labeled `Save N words` / `Save N words (M lines skipped)`; save disabled only when zero lines are valid. Success returns to Setup with the new list selected.

### 5.4 The one engine-adjacent guard

An all-kana list in Reading mode would hand the engine an **empty pool**, which today loops wave-cleared forever (unreachable for JLPT pools — the data invariant guarantees ≥50% kanji cards — but reachable for lists). `beginFromPool` blocks it after loading: if `mode === 'reading'` and no card has kanji, show `This list has no kanji words — Reading mode unavailable.` as the load error and stay on Setup. No engine change.

## 6. Data flow

```
Import screen → POST /api/lists/preview → per-line table → POST /api/lists (raw text, one txn)
setup → GET /api/lists → pick list:<id>
      → GET /api/plan?pool=list:<id>&mode=… (no gate; budget + weights as M4-A/D)
      → GET /api/lists/:id/cards + static JLPT JSON → hydrated pool
      → GameEngine(plan) → ceremonies for unmet members → attempts/introductions flush (unchanged)
```

## 7. Error handling

| Failure | Behavior |
|---|---|
| Un-parseable / unresolvable line | Per-line error in preview; save skips it, labeled |
| Every line invalid | Save 400s; inline error |
| Homophone bare word | Per-line error listing candidates; full line disambiguates |
| Duplicate line in one paste | Per-line error `duplicate of line N`; first wins |
| Paste beyond caps (1,000 lines / 200 chars) | 400 with a plain message |
| List fetch fails at play time | Existing `DataLoadError` path — load error on Setup, no run |
| Plan fetch fails | Unchanged M4-A: play proceeds, no intros, uniform seen weights |
| Reading mode × all-kana list | Blocked at Begin with a plain message (§5.4) |
| Delete selected list | Selection falls back to N5 |
| Nonexistent list id (cards or plan) | 404 / empty plan respectively |

## 8. Testing

**Parser unit tests** (`server/__tests__/listImport.test.ts`, pure, no DB): every §3.3 rule — delimiters (TAB, comma, gloss-with-commas), comments/blanks, bare-word resolution incl. kana-array matches, zero/one/many candidates, full-line reuse vs create, kana validation, gloss cap, in-paste duplicates, caps, deterministic custom ids.

**Route tests** (temp DB): preview writes nothing; save creates then replaces by name (same id, membership swapped, custom cards persist); delete preserves cards/attempts; cards endpoint returns customs + jlpt ids in position order; 404s.

**Planner goldens**: a list pool with met/unmet/custom members yields gate-free `newCardIds`, standard weights, shared budget, `tiers: []`; `mode=reading` excludes a kana-only member; nonexistent list → empty plan; JLPT pool goldens untouched.

**Client**: loader hydration branch (order preserved, customs merged); ImportScreen preview/save/skip-label states; SetupScreen list row + import navigation + reading-mode block.

**E2E** (`e2e/import.spec.ts`, new): through the UI — import a two-line list (one bare word that resolves, one full-line custom), play it in reading mode, the ceremony shows, an attempt persists. The keystone spec is untouched.

## 9. Doc amendment riding along

The main spec's file map (§4) places `importParser.ts` in `src/data/`. Parsing and resolution live server-side instead (`server/listImport.ts`): resolution requires the cards table, and a client-side parser would mean two sources of matching truth. The main spec gets a one-line note at that entry pointing here, in the same spirit as prior amendments.
