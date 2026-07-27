# Tiered Vocabulary — Design Spec

**Date:** 2026-07-27
**Status:** Approved pending final user review
**Scope:** M4 sub-project D. Independent of B (custom list import) and C (the juice pass); no ordering constraint between them.
**Amends:** main spec §1's "no spaced-repetition scheduling" non-goal (see §9)
**Builds on:** `2026-07-24-word-introduction-v2-design.md` (M4-A), which this composes with rather than replaces

## 1. Purpose

Make a 633-word level learnable instead of merely available.

M4-A gave new words an acquisition moment and capped intake at a daily budget. It did not decide **which** words arrive, or **which** words come back. Both are currently uniform random draws, and that is the whole problem:

1. **Intake is arbitrary.** `Spawner.planWave` shuffles the new pool and takes the first N, so today's 6 words are a random sample of 633 — no ordering by usefulness, no coherence between them.
2. **Review is diluted.** `Spawner.drawSeen` shuffles the entire seen pool flat. A word met yesterday and a word killed twenty times have identical odds. At 39 seen cards that is survivable; at 300 it is noise.
3. **The working set is unbounded.** Nothing stops intake, so a month of play leaves ~600 half-known words competing for the same wave slots.

This spec adds two things: **frequency-ordered tiers with a mastery gate** (fixes 1 and 3) and a **weighted review draw** (fixes 2).

### Non-goals

- **A scheduler.** No due dates, no intervals, no ease factors, no per-card state machine, no new table to keep in sync. Review *priority* is computed on demand from the attempt history that already exists.
- **Thematic or curricular grouping.** Tiers are frequency-ranked. Semantic clustering within a tier was considered and rejected as pipeline cost with uncertain payoff.
- **Tier-cleared celebration.** A plain line ships here; the moment belongs to sub-project C, which builds the audio and effect systems properly.
- **Retiring `n2-prep`.** This does not make kotoba-drop a replacement for a real FSRS system. It makes the game's own word selection non-random.
- **Changing the daily budget or the acquisition ceremony.** Both ship from M4-A unchanged.

## 2. Decisions log

| Decision | Choice | Why |
|---|---|---|
| Tier ordering | Tatoeba corpus frequency, ranked within a level | 97% of N5 cards appear in the corpus already on disk; the same scan that picks each card's example sentence produces the count for free |
| Tier size | 10 cards | Smallest working set that still amortizes a gate; N5 → 64 tiers. Matches "introduce them slowly" |
| Gate | ≥80% of the tier solid before the next unlocks | Intake cannot outrun retention |
| "Solid" | The **existing** learned rule, run over pooled attempts | No second definition of knowing a word; the gate and the Stats screen can never disagree |
| Leech escape | Amnestied cards leave the **denominator** | Counting them as passes would unlock a tier on 2 solid words out of 10; removing them prevents a permanent stall without rewarding failure |
| Review draw | Weighted by staleness × weakness | Both derive from `attempts`; no per-card state to persist or migrate |
| Weight computation | Server, shipped in the plan | Same split M4-A established: the server plans, the engine consumes a pure input |
| Active tier | **Derived**, never stored | Nothing to migrate, nothing to drift, self-healing after any data change |
| Locked cards | Explicit third set in the plan | The gate makes "not new" ≠ "seen"; see §5.3 |
| `mixed` pool | Union of each level's active tier | Accepted as a weaker gate (up to 40 eligible); `mixed` is not the study path |
| Shared scoring code | Extracted to `server/cardScoring.ts` | M4-A separated planning from statistics on purpose; the planner must not import stats internals |

## 3. The model

### 3.1 Tiers

A **tier** is 10 cards from one JLPT level, ranked by corpus frequency. Tier 1 is the ten most frequent N5 words, tier 2 the next ten, and so on. N5's 633 cards yield 64 tiers, the last holding 3.

Tier membership is **static**: computed at build time, committed with the card data, identical for every player. It is a property of the language, not of the player.

### 3.2 Solid, amnestied, and the gate

A card is **solid** when its pooled attempts (both directions) clear the app's existing learned gate: at least `learnedMinEncounters` (3) encounters, and the last `learnedWindow` (5) attempts reach `learnedMinAccuracy` (0.8) weighted accuracy, where a hinted kill counts `hintedKillWeight` (0.5).

This is deliberately not a new rule. `groupByCard` already builds a pooled `all` bucket for exactly this kind of card-level question, and `evaluateDirection` already implements the gate. Reusing them means the tier gate and the Stats screen cannot disagree about whether you know a word.

A card is **amnestied** when it has at least `amnestyMinEncounters` (8) pooled encounters and is still not solid. You have met it eight times; the strength score's window has fully saturated on it; it is a leech.

**Tier T passes when:**

```
denominator = size(T) − amnestied(T)
pass = denominator === 0  OR  solid(T) / denominator >= tierMasteryThreshold
```

Amnestied cards leave the denominator; they never enter the numerator. The distinction is the whole point. Counting a leech as a pass would unlock a tier of 10 on 2 solid words if the other 8 were leeches. Removing it from the denominator instead means you must still be 80% solid on every card you are actually capable of learning, while a genuinely intractable word cannot hold you forever.

The `denominator === 0` branch — every card in the tier amnestied — unlocks. You have hit each of them eight or more times; a permanent stall is the failure mode this design rejects, and they remain in the review pool at high weight regardless.

Cards never attempted are neither solid nor amnestied, so they sit in the denominator and hold the gate shut. A tier with 3 of 10 introduced cannot pass.

### 3.3 The active tier

For a level: the **active tier** is the lowest-numbered tier that does not pass. If every tier passes, the level has no active tier and produces no new cards.

Nothing about this is stored. It is recomputed from `attempts` on every plan request, so it cannot drift from reality, needs no migration, and self-corrects if data is ever repaired by hand.

**Existing history is absorbed, not discarded.** The 39 cards already met are scattered across the frequency ranking. Tier 1 will therefore show partial progress on first launch, and some already-solid cards will sit in tiers 40+. Those cards stay in the seen set and keep appearing in review (§3.4) regardless of tier — only *intake* is gated.

### 3.4 The review draw

Each seen card gets a weight from two signals the server already computes:

- **weakness** — `cardStrength` returns 0–100 from recency-decayed accuracy plus kill speed over the last `leechWindow` (8) pooled attempts. `weakness = 1 − strength/100`.
- **staleness** — `staleness = min(1, hoursSince(lastAttemptAt) / reviewStalenessCeilingHours)`, ceiling 72 hours. `lastAttemptAt` is the newest `createdAt` across **both** directions, and "now" is the `nowMs` `computeRunPlan` already receives.

```
weight = reviewWeightFloor + reviewWeaknessWeight · weakness + reviewStalenessWeight · staleness
       = 0.1 + 0.6 · weakness + 0.4 · staleness
```

Range `[0.1, 1.1]`, an 11× spread between the strongest-and-freshest and the weakest-and-stalest card. The floor matters: a word you have aced becomes rare, never unreachable, so strong words cannot silently rot.

A card that was **introduced but never attempted** has no attempts to score. It receives the maximum weight (1.1): it just arrived and has not been tested once. This is the common case immediately after an acquisition ceremony, and it is the mechanism that makes the introduce → use gap short.

## 4. Data model

### 4.1 Card tier (build output + `cards` column)

Every card gains a required `tier` field in `public/data/jlpt-n*.json`:

```ts
tier: number  // 1-based, within the card's own JLPT level
```

The `cards` table gains a matching `tier` column. No backfill script is needed: `seedCards` is already an idempotent `INSERT OR REPLACE` over all 4,678 rows on every boot, so the column populates on next start.

`levelFileSchema` in `src/data/loader.ts` gains `tier: z.number().int().positive()`. It is required, not optional — the pipeline guarantees it, and a missing tier should fail loudly at load rather than silently degrade the gate.

### 4.2 No new tables

No `tier_state`, no `card_state`, no scheduling rows. Active tier, solid, amnestied, and weight are all derived from `attempts` and `introductions`, which already exist.

### 4.3 Plan response shape

`RunPlan` in `src/shared/api.ts` changes:

```ts
{
  newCardIds: string[],                              // eligible: in an active tier, never met
  seenCards: { id: string; weight: number }[],       // reviewable, with draw weights
  runBudget: number,                                 // unchanged from M4-A
  tiers: {
    level: number;        // 5 | 4 | 3 | 2
    index: number | null; // active tier, or null when the level is complete
    totalTiers: number;
    size: number;         // cards in the active tier (10, or fewer for the last)
    solid: number;
    amnestied: number;
  }[],
}
```

When `index` is `null` the level has no active tier, and `size`, `solid`, and `amnestied` are all `0` — they describe the active tier, and there isn't one. `totalTiers` stays populated so the UI can still say "64 of 64".

`seenCardIds: string[]` becomes `seenCards`. `tiers` holds one entry per level in the pool — one element for a single-level pool, four for `mixed`.

**Cards in neither `newCardIds` nor `seenCards` are locked** and must not spawn. See §5.3.

## 5. Architecture

### 5.1 Build pipeline

An extension of `scripts/build-data.ts`, output committed like the card data.

The Tatoeba scan already finds every qualifying sentence per card and keeps the shortest, including the standalone-vs-embedded kanji preference added in `6abbe70`. It simply discards the count. Keep it.

**Ranking key, descending within each level:** `(sentenceCount, jmdictCommon, id)` — count first, the JMdict `common` flag as tiebreak, card id last. `common` is already read from `jmdict-eng-3.6.2.json` by the existing pipeline.

The `common` tiebreak exists for the tail. N5 sentence coverage is 97% (616/633), so ties barely matter there. N2 coverage is 64%, leaving ~640 cards tied at zero; `common` splits them meaningfully instead of collapsing to arbitrary JMdict id order. Tiering therefore degrades gracefully as coverage falls rather than becoming noise.

`tier = floor(rank / tierSize) + 1`, where `rank` is **0-based** within the level — so ranks 0–9 form tier 1.

Including `id` in the key makes the ordering total, so two builds of the same inputs produce byte-identical tiers.

### 5.2 Server

**`server/cardScoring.ts` (new).** `groupByCard`, the learned gate (`evaluateDirection` and its `windowedAccuracy`/`outcomeWeight` helpers), and `cardStrength` move here. `server/stats.ts` and `server/plan.ts` both import from it.

The extraction is not cosmetic. M4-A separated planning from statistics deliberately — that is why `planConfig.ts` exists apart from `statsConfig.ts` — and having the planner reach into `statsHelpers.ts` would undo that. These functions describe *what is known about a card*; they lived in `statsHelpers.ts` only because Stats was the sole consumer. Their constants (`learnedWindow`, `leechWindow`, and the strength weights) stay in `statsConfig.ts`, which is where card-knowledge thresholds already live and are already golden-tested.

**`server/planConfig.ts`** gains the genuinely new knobs:

```ts
tierSize: 10,
tierMasteryThreshold: 0.8,
amnestyMinEncounters: 8,
reviewWeightFloor: 0.1,
reviewWeaknessWeight: 0.6,
reviewStalenessWeight: 0.4,
reviewStalenessCeilingHours: 72,
```

`amnestyMinEncounters` duplicates `STATS.leechWindow`'s value on purpose. Amnesty is a planning decision; if the leech window is ever retuned for how the Stats list reads, the tier gate must not move with it silently.

**`computeRunPlan`** extends to: group attempts by card once; compute solid/amnestied per tier per level in the pool; find each level's active tier; emit `newCardIds` from active-tier cards with no attempt and no introduction; emit `seenCards` with weights; emit `tiers`. The daily-budget computation is unchanged from M4-A.

### 5.3 Engine — the one correctness change

`Spawner` currently derives its seen pool by **negation**: `pool.filter(c => !newIds.has(c.id))`. That is only correct while every card is either new or seen.

The gate breaks that invariant. The ~620 N5 cards in tiers ahead of the active one are **neither**: absent from `newCardIds` because the gate excludes them, absent from the seen set because they have never been met. Under the current logic they would fall into the seen pool and start spawning as review words for words the player has never seen — defeating the feature entirely.

**So `Spawner` builds its seen pool from the plan's `seenCards`, intersected with the loaded card pool, instead of by negation.** Cards in neither set are locked and never spawn — including as the starved-pool fallback, which may only draw from the active tier.

`EnginePlan` gains the weighted seen list. `drawSeen` becomes a cumulative-weight walk over the injected seeded RNG, sampling without replacement within a wave while the pool is large enough and falling back to repeats when it is not (M4-A's behavior, preserved). Wave composition stays deterministic for a given seed and plan, so M4-A's determinism tests keep their meaning.

### 5.4 Client

The setup screen shows tier progress per level in the pool: `N5 · Tier 4 of 64 — 6/10 solid`.

`src/planNotice.ts` gains two cases. It currently distinguishes plan-unavailable, budget-exhausted, and starved-pool; the gate makes "no new words" far more common and the reason matters:

| Condition | Notice |
|---|---|
| Plan unavailable | *(existing)* Introductions need the server — playing without them |
| Starved pool | *(existing)* No budget and nothing met in this pool — playing without introductions |
| Level complete (no active tier) | You've cleared every N5 tier — this run is review |
| Tier gated (active tier fully introduced, gate not passed) | Tier 4 isn't solid yet — this run is review |
| Budget exhausted (eligible new cards remain) | Today's 20 new words are done — this run is review |

**Precedence, when more than one holds: plan-unavailable → starved → level-complete → tier-gated → budget-exhausted.** Structural reasons outrank temporal ones. "Today's new words are done" implies tomorrow brings more; if the gate is also shut, that is false and the gate message is the honest one.

Tier-cleared celebration is explicitly out of scope. A plain results-screen line stating the tier advanced is enough here; the moment belongs to sub-project C.

### 5.5 Pools

`mixed` unions each level's active tier — up to 40 eligible new cards, a weaker gate than any single level. Accepted: `mixed` is a variety mode, not the study path, and its `tiers` array shows all four so the weakening is visible rather than hidden.

`revenge` bypasses planning entirely, as it does today.

## 6. Data flow

```
setup → GET /api/plan?pool=n5
          ├ group attempts by card (cardScoring)
          ├ solid / amnestied per tier → active tier
          ├ newCardIds  = active tier ∩ never met
          ├ seenCards   = met, each with weight = f(strength, staleness)
          └ tiers       = progress for the setup screen
      → GameEngine(plan)
          ├ newPool  = pool ∩ newCardIds        → ceremonies, budget-capped
          ├ seenPool = pool ∩ seenCards         → weighted draw
          └ locked   = everything else          → never spawns
      → play → attempts + introductions flush under one batchId (unchanged)
```

## 7. Error handling

| Failure | Behavior |
|---|---|
| Plan fetch fails / server down | Unchanged from M4-A: every card treated as seen, no intros, no gate, uniform draw, **play proceeds**, one-line notice |
| Card JSON missing `tier` | `levelFileSchema` rejects at load — loud failure, not silent degradation |
| Every tier in the level passes | No active tier, `newCardIds` empty, pure review, notice shown |
| Last tier smaller than `tierSize` | Gate uses actual tier size, not the constant |
| All of a tier's cards amnestied | Denominator 0 → tier passes (§3.2) |
| Budget 0 **and** seen pool empty | M4-A's starved-pool rule, restricted: the fallback draws from the **active tier only**, never from locked cards |
| Frequency ties at zero count | Total ranking key `(count, common, id)` — deterministic and stable across rebuilds |

## 8. Testing

**Pipeline invariants** (extending the M4-A hook tests): every card has a tier ≥ 1; tiers are contiguous from 1 within each level; every tier holds exactly `tierSize` cards except the last of each level; two builds of identical inputs produce identical tier assignments.

**Server golden tests** (seeded temp DB, the established stats-engine pattern): empty history → active tier 1; a tier at 8/10 solid passes and 7/10 does not; an amnestied card leaves the denominator without entering the numerator; a fully amnestied tier passes; `newCardIds` never contains a card outside an active tier; a seen card from a far tier still appears in `seenCards`; an introduced-but-never-attempted card outweighs a strong stale card; the weight floor keeps a perfect card strictly above 0; `mixed` returns four `tiers` entries; the M4-A budget tests still pass unchanged.

**Engine (deterministic)**: locked cards never spawn, including in the starved case; the weighted draw favors high-weight cards over many seeded samples; repeats occur only when the seen pool cannot fill a wave; same seed + same plan → same waves.

**Client**: each `planNotice` case renders its own text; precedence resolves correctly when budget-exhausted and tier-gated both hold; the setup screen renders tier progress for single-level and `mixed` pools.

**E2E**: the existing keystone test should pass unchanged. A wiped database means tier 1 is active and every card is new, so the ceremony and the attempt/introduction assertions behave exactly as before.

## 9. Doc amendment riding along

Main spec §1 states the app "deliberately does not implement its own SRS" and lists "any spaced-repetition scheduling" among the non-goals.

That stays substantially true and is worth keeping: there are no due dates, no intervals, no ease factors, and no scheduler. But review priority is no longer descriptive, and §1 should say so precisely rather than be quietly contradicted by the code. The amendment ships with this work, in the same spirit as M4-A's §3.6 status update:

> The game does not schedule reviews — no due dates, intervals, or ease factors, and no card-level scheduling state. It does *prioritize* them: intake is gated to a frequency-ordered tier, and the review draw is weighted by how weak and how stale each card is. Scheduling proper remains n2-prep's job.
