# Word Introduction v2 — Design Spec

**Date:** 2026-07-24
**Status:** Approved pending final user review
**Scope:** M4 sub-project A of three (B = custom list import, C = the juice pass — each gets its own spec/plan/execute cycle)
**Supersedes:** the session-scoped half of the main spec's §3.6; completes its player-scoped half

## 1. Purpose

Turn meeting a new word from a **speed bump** into an **acquisition moment**: the point in a run where you gain something, rehearse it once without pressure, and are then guaranteed to meet it again.

This closes spec §3.6's player-scoped half (deferred out of M3 because it needs attempt history, which now exists) and answers the M2 fun-check feedback — *"the word intro definitely helps but the delivery is missing something."* Diagnosed with the user as three deficits:

1. **Passive** — reading a table encodes nothing.
2. **No hook** — kanji + reading + meaning is data, not memory.
3. **Not part of the game** — a plain table interrupts rather than belongs.

Plus a fourth the user identified once those were named: **no promise of return.** A word met once dissolves back into a 4,678-card pool and may not reappear for weeks.

### Non-goals

- **Personal association notes** ("make it yours" in full). Typing the word once is this version's generation beat. Deferred until playtest says it isn't enough.
- **Audio pronunciation** and the **related-words hook** — considered, not chosen.
- **Cross-session review scheduling.** In-run recycling falls out of the budget (§3); anything smarter is an SRS conversation this project deliberately avoids (the main spec forbids rolling our own SRS).
- **Sound for the ceremony.** CSS animation ships here; audio waits for sub-project C, which builds the audio system properly instead of bolting on a one-off player.
- The import UI, settings screen, and the leech-vs-hint-dependence product question — separate work.

## 2. Decisions log

| Decision | Choice | Why |
|---|---|---|
| What's missing | Active beat + hook + game-feel + promise of return | User-diagnosed from concrete hypotheses |
| Hooks | Example sentence (Tatoeba) + kanji component meanings (kanjidic2) | Both available locally; context and form-memory respectively |
| Placement | At wave start, one word at a time; the wave then spawns just-introduced words **first** | Keeps the game's rhythm (no mid-wave freezes) while making the introduce→use gap seconds |
| Active beat | Type the reading once, unpressured | Rehearses the exact motor pattern the wave demands; generation beats reading |
| New-word budget | Derived from `profile.dailyWordGoal`, per-run sub-cap 6 | Gives a dead profile field a real job; caps intake |
| Promise of return | **Emerges from the budget** — a run that can't introduce must recycle | No separate scheduler to build or maintain |
| Architecture | Server plans the run; engine consumes the plan as a pure input | Puts each decision where its data lives; keeps `src/engine/` pure |
| Introduction events | Ride the existing `POST /api/runs/:id/events` batch | One flush path, one idempotency mechanism, one outbox |
| Day boundary | **Local date** for the daily budget, and the stats trend/streak switch to local with it | A goal that rolls over at 5pm local (UTC midnight) is wrong; consistency across both matters more than preserving M3's UTC choice |
| Server unavailable | No intros, one-line notice, play proceeds | Gameplay never blocks on the API (§7 of main spec) |

## 3. The experience

### 3.1 A run

1. The player picks mode + pool. Alongside the card fetch, the client requests the **run plan** (§5.1).
2. Wave 1 begins. For each card in that wave the player has never met, an **acquisition moment** plays, one at a time:
   - The word arrives with weight — kanji large and centred, in the game's visual world, with a settling animation.
   - Beneath it: the canonical reading, the meaning, **one short real sentence using the word with its English translation**, and for kanji words **each character's own meaning** (勉強 → 勉 *exertion* + 強 *strong*).
   - The player **types the reading once**. No timer, nothing falling, no lives at risk. Input uses the real `InputBuffer` and matcher, so romaji→kana behaves exactly as in gameplay (including the naive-typing acceptance added post-M2).
   - **Enter** on a correct reading advances. **Escape** skips.
   - The run's new-word counter ticks up.
3. The wave then spawns the just-introduced words **first**, so the first real, timed encounter follows within seconds.
4. Play proceeds as today.

### 3.2 The budget, and why it *is* the promise of return

`profile.dailyWordGoal` (default 20) is the day's intake. A single run may introduce at most `PER_RUN_NEW_CAP` (6). Once a run's budget is spent, its waves can only be composed from cards the player has already met — **so the game is structurally forced to bring recent words back**. Capping intake produces rehearsal as a side effect; no review queue exists to maintain.

On a fresh database: run one introduces 6, and waves 2+ are built almost entirely from those same 6 — massed rehearsal exactly when a new word needs it.

When a wave is larger than the entire seen pool, cards may repeat **within** a wave. This is rehearsal-positive and mechanically safe: two identical words airborne resolve under the existing closest-to-floor rule.

When the day's goal is exhausted, runs become pure review and the UI says so plainly (a line on the setup screen: *"Today's 20 new words are done — this run is review."*).

**Starved-pool rule.** A run must always be playable. If the budget is 0 *and* the pool's seen set is empty — e.g. today's goal was spent on N5 and the player now opens an N2 pool they've never touched — waves compose from new cards **without** ceremonies, and the setup screen says so: *"Today's new words are done, and you haven't met anything in this pool yet — playing without introductions."* Those cards remain un-introduced, so they still get their acquisition moment on a later day when budget exists.

### 3.3 Skipping

A skipped word (Escape) **still counts as introduced** and still spends budget. The player did see it, and this prevents skipping from farming extra new words. A word must never be able to trap the player in the ceremony.

## 4. Data model

### 4.1 New table: `introductions`

| column | type | notes |
|---|---|---|
| `card_id` | text | **PRIMARY KEY** — a card is introduced once, ever |
| `run_id` | text | the run during which it happened |
| `introduced_at` | integer | epoch ms |

`card_id` as the primary key makes ingest idempotent by construction (`INSERT OR IGNORE`), so outbox replays cannot double-count or re-spend budget.

### 4.2 "New" defined

A card is **new** when it has **no attempt row in any direction AND no introduction row**. Including introductions in the definition means quitting before a word falls doesn't cause a second introduction, and the budget can't be spent twice on the same card.

### 4.3 Card hooks (client JSON only)

Two optional fields per card in `public/data/jlpt-n*.json`:

```ts
sentence?: { ja: string; en: string }
kanjiParts?: { char: string; meaning: string }[]
```

Both optional: many N2 words have no Tatoeba match, and kana-only words have no kanji parts. **The server's `cards` table is unchanged** — the ceremony renders client-side, so the database gains nothing by carrying prose.

### 4.4 Events batch extension

`eventsBatchSchema` gains `introductions: { cardId, introducedAt }[]`, ingested in the same transaction as attempts and wrong-submits under the same `batchId`.

## 5. Architecture

### 5.1 Server

**`GET /api/plan?pool=<poolId>`** →

```ts
{
  newCardIds: string[],    // in this pool: never attempted, never introduced
  seenCardIds: string[],   // in this pool: attempted or introduced
  runBudget: number,       // min(dailyWordGoal − introducedToday, PER_RUN_NEW_CAP)
}
```

`introducedToday` counts `introductions` rows whose `introduced_at` falls on the server's **local** calendar date. Budget floors at 0.

`PER_RUN_NEW_CAP` and the day-boundary helper live in a new `server/planConfig.ts` — run planning is not statistics, and `server/statsConfig.ts` should keep its single purpose.

### 5.2 Engine

M2's `waveIntro` status and `resume()` already provide the pause; the engine changes are small and stay pure/seeded:

- `Spawner` accepts the run plan (`newCards`, `seenCards`, `runBudget`) and composes each wave as: up to the remaining budget in new cards, the remainder from seen cards, **new cards ordered first**. Repeats within a wave only when the seen pool cannot fill it.
- The `waveStarting` event gains `newCards: Card[]`.
- Wave composition remains deterministic for a given seed and plan.

### 5.3 Client

- The setup screen's existing loading state covers the plan fetch (parallel with the card fetch).
- `WaveIntroOverlay` is **replaced** by the acquisition ceremony: one card at a time, hooks rendered, typed input via the real `InputBuffer`/matcher, Enter to advance, Escape to skip.
- The recorder buffers an introduction row per completed moment; it flushes with the existing batch at wave/run end.
- The M2 session-scoped seen-set retires — no second implementation survives.

### 5.4 Data flow

```
setup → GET /api/plan  ─┐
        GET card JSON  ─┴→ GameEngine(plan) → waveStarting{newCards} → status 'waveIntro'
   → ceremony per new card (type once / skip) → introductions buffered
   → resume() → wave spawns new-first → attempts recorded as today
   → flush at wave end: { attempts, wrongSubmits, introductions } under one batchId
```

## 6. Hook data pipeline

An extension of `scripts/build-data.ts`; output committed like the card data. Sources are the local copies already used for the card build (`data/raw/`, gitignored).

- **Sentences** — scan Tatoeba (117,022 `en \t ja \t attribution` rows) for sentences containing the card's kanji form, or its canonical kana for kana-only cards. Prefer the **shortest** qualifying sentence; reject any Japanese side longer than **50 characters**. Partial coverage is expected and fine.
- **Kanji parts** — from kanjidic2, the **primary** English meaning per character, emitted only for characters appearing in the corpus (~1,500 of 13,000+).
- **Attribution** — Tatoeba is CC-BY 2.0 (France). Required: a credit line in `README.md` **and** a small persistent credit line in the ceremony footer (the settings/about screen does not exist yet — it belongs to sub-project C).
- Build-time invariants (tested): every emitted sentence actually contains its word; Japanese side ≤ 50 chars; `kanjiParts` present for every card whose `kanji` is non-null and whose characters exist in kanjidic2; no card gains an empty-string hook.

## 7. Error handling

| Failure | Behavior |
|---|---|
| Plan fetch fails / server down | Treat every card as seen: no intros, no budget, **play proceeds**, one-line notice that introductions need the server |
| Card missing sentence and/or kanji parts | Ceremony renders what exists; layout must read as deliberate, not broken |
| Introduction flush fails | Existing retry → localStorage outbox → drained next launch |
| Player cannot type the word | Escape skips (counts as introduced) — the ceremony can never trap |
| Budget 0 **and** seen pool empty | Starved-pool rule (§3.2): play without ceremonies, notice shown, cards stay un-introduced for a later day |
| Duplicate introduction ingest | `INSERT OR IGNORE` on the `card_id` primary key |

## 8. Testing

- **Server golden tests** (seeded temp DB, the stats-engine pattern): new-versus-seen classification; `introducedToday` at the local-day boundary; budget exhaustion; per-run cap; budget floor at 0; a pool with no history at all.
- **Engine (deterministic)**: budget respected per wave; new cards ordered first; repeats only when the seen pool is too small; same seed + same plan → same waves; a zero-budget plan introduces nothing; the starved-pool case (zero budget, empty seen set) still composes a playable wave and marks nothing introduced.
- **Client components**: ceremony renders all hook shapes (full, no-sentence, kana-only/no-kanji-parts); Enter advances only on a correct reading; Escape skips; the run counter ticks; the no-plan notice renders.
- **Pipeline invariants**: as listed in §6.
- **E2E**: the e2e database is wiped per run, so every card is new — type through a ceremony, then assert an `introductions` row exists in the DB alongside the existing attempt assertion.

## 9. Consistency change riding along

The stats trend and streak currently bucket by **UTC** date (an M3 decision). The daily budget must use the **local** date — a goal that rolls over at 5pm local time is simply wrong for the user's timezone. To avoid two different meanings of "today" in one app, `computeTrendAndStreak` switches to local-date bucketing in this project. Contained (one helper), and it fixes a latent oddity where an evening session already lands on "tomorrow" in the trend chart.
