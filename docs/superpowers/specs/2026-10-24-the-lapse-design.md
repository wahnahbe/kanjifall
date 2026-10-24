# The Lapse — Design Spec

**Date:** 2026-10-24
**Status:** Draft, awaiting owner review
**Scope:** Make a dropped word you already own feel different from a dropped word you've just met: owned words fall lit, a lapse puts the light out and shows only the reading you dropped, and the word comes back dark for you to relight.
**Builds on:** the main spec's engine/render/audio boundary (`2026-07-22-kotoba-drop-design.md` §4: Pixi, the React HUD and audio are passive consumers of engine events), the juice pass (`2026-08-08-juice-pass-design.md`: SFX voices, effects levels), the second-pass visual identity (`2026-10-07-visual-identity-second-pass-design.md` §4.3: the moments of play, §6: the effects contract, §7: legibility), and the tiered-vocabulary plan (`2026-07-27-tiered-vocabulary-design.md` §3.4: the seen-card weights this spec extends).

## 1. Purpose

The owner's words, from the brainstorm that produced this spec: *"Losing a word I've practiced before feels the same as losing a brand-new one. It feels flat. I need it to grab my attention with every attempt."*

Today a word reaching the floor is one event. The server records every attempt in detail and uses that history to draw weak and stale words more often, but the client only receives a draw weight, and the playfield shows nothing of it. A word you've cleared six times falls at the same speed, colour and size as one introduced this wave, dies with the same splash, costs the same pip, and is revealed with the same line. The game reacts to the keystroke, never to you.

This spec splits that one event in two and gives the second a shape:

- **A lesson.** A word you have never cleared reaches the floor. The game is teaching you. Unchanged: full reveal, the thunk.
- **A lapse.** A word you *have* cleared reaches the floor. You dropped something you owned. You saw it coming, because the word was lit; the light goes out as it lands; the floor shows you exactly the reading you failed to produce and nothing else; the sound is a filament going cold; and the word comes back next wave, dark, for you to relight.

Both still cost a life. Every falling word was taught before it ever fell (the acquisition ceremony), so a lesson is not free. The difference is entirely in how the drop feels and in the comeback.

### Goals

- Every owned word in the air is a visible stake before it lands.
- A lapse is unmistakable from a lesson in the first half second: look, sound, reveal.
- Clearing a word you dropped is its own moment, not a routine kill.
- Zero change to what a run teaches or to the planner's draw; this is feel and a comeback, not scheduling.

### Non-goals

- Stopping or pausing play on a miss (the owner ruled this out: it defeats the game).
- Asymmetric life cost between lessons and lapses (ruled out: every word was taught first).
- Changing the stats screen, the learned gate, tier progression, or the review weights. The new `comeback` field is recorded, not consumed, in this project.
- Music, or any new SFX beyond the two voices in §7.
- A per-word kill count on screen (the "tally" option was rejected as clutter).

### Anti-goals

- Owned words must not become harder to read than new ones at any effects level (second-pass spec §7). The light is additive; darkness is dimmer ink, never faint-on-dark small type.
- A dark (dropped) word must never be confused with a word near the floor. The approach tint is vermillion; dark is the *absence* of light. No red on returning words (the "ember" option was rejected for exactly this).
- The comeback must not inflate wave size or pacing.

## 2. Decisions log

| Decision | Choice | Why |
|---|---|---|
| How the two misses differ | Feel and comeback only; both cost a life | Owner: every word was taught before it fell |
| The mark on owned words | **Lit**: a white core inside the existing cyan halo | Owner's pick over a tally count and a seal token: "the light going out is the feel I want"; nothing extra on screen |
| The lapse reveal | **The reading, and nothing else**: big reading in dead ink, kanji small above, "you had this" beneath; no gloss | Owner's pick over a tagged full line and a word lying on the floor: a lapse shows the one thing you dropped |
| The lapse sound | **Power-down**: a tick, then a hum collapsing | Owner played Power-down and Snap several times each and ended on Power-down |
| The returning word | **Unlit**: dim ink, no halo; the clear relights it | Owner's pick over a vermillion scar and a red "ember" glow; three states on one dial |
| What "owned" means | At least one kill on the card, either mode, any run — **not** the stats screen's learned gate | My call: the gate is windowed and can flip back; one kill is the plain meaning of "I've practiced this" |
| Ownership within a run | A card killed earlier in this run counts as owned for the rest of it | My call: otherwise a word introduced and cleared this wave could lapse without a light to lose |
| When it comes back | First word(s) of the next wave, once per card per run; displaces review draws, never grows the wave | Owner confirmed; wave pacing is untouched |
| Second drop | Stays dark for the rest of the run; no second re-queue; any later kill still relights it | Owner confirmed; the planner already weights weak words next run |
| Relit kill bonus | None | My call: the light is the reward; score stays a pure speed/length/combo signal |
| Where the state lives | `owned` arrives on the plan; the engine owns per-run light state and the comeback queue; render and audio consume events | The main spec's boundary (§4); same posture as the juice pass |
| Effects levels | Light state is **state**, not decoration: visible at `full`, `reduced` and `off` | Second-pass spec §6/§9.4: state survives `off` |
| Recording | `attempts.comeback` boolean, recorded, not consumed | Main spec §2: capture raw signals from day one; a forced re-test is not derivable later |
| Replays (play again, revenge) | Words killed in the run just played start the replay **lit** | My call, after the builder check: "at least one kill, any run" includes the run three minutes ago; a replay must not feel flatter than a fresh run from Setup |
| No-plan runs | Nothing starts lit; kills this run still light words, so lapses can happen | My call, after the builder check: the engine never needs a "lights enabled" flag; a no-plan run is today's game at spawn and gains the lapse only from what the player did in it |
| Effects `off` | `plain` and `lit` both render exactly as today; only `dark` differs (dim ink) | My call, after the builder check: `off` stays additive, "a run without a plan is today's game" holds at every level, and the lapse is still told by the reveal and the voice |
| Relit kill timing | No deferral: the kill plays at the moment of the kill, as today; the relight flicker overlays it on the detached glyph copy | My call, after the builder check: the HUD publishes the snapshot synchronously, so a deferred Pixi kill would desync from the combo pop |
| Two instances of one card airborne | Events and effects key on the instance's spawn-time `light`; only the per-run map moves on | My call, after the builder check: the player reacts to what they saw fall |

## 3. The three states of a word

Every airborne word carries a light state, fixed at spawn and changed only by the events below:

| State | Who | In flight | On the floor | On the kill |
|---|---|---|---|---|
| **plain** | never cleared (new this run, or introduced in an earlier run but never killed) | today's look: ink with the cyan halo | **lesson**: today's reveal (`kanji kana — gloss`), today's thunk | today's kill |
| **lit** | owned: at least one kill, either mode, in any run including this one | ink with a white core inside the cyan halo | **lapse**: the light goes out; the reading-only reveal; Power-down; the card is queued to come back dark | today's kill |
| **dark** | dropped this run (a lapse), not yet relit | dim ink, no halo | a second drop: lesson-shaped reveal in dead ink (§6.4), Power-down; **no** second re-queue | **relit**: the light snaps on, then today's kill, with a "relit" flash and the relit voice |

Transitions, per card, per run: `plain → lit` on its first kill; `lit → dark` on a lapse; `dark → lit` on a kill. A card never goes back to `plain`. The state is per run: the next run starts from the plan's `owned` flag alone.

Mode does not change any of this. In recall mode the gloss falls instead of the kanji; it is lit, dark or plain the same way, and the lapse reveal still shows the reading you dropped.

## 4. The plan: who is owned

### 4.1 Server

`seenCards` entries gain `owned: boolean`: true when the card's pooled attempt group (`groupByCard(...).all`, both modes) contains at least one `outcome === 'kill'`, hinted or not. Computed in `server/plan.ts` beside `cardWeight`, for both the JLPT and the list pools. Cards in `newCardIds` are never owned (they have no attempts by definition). The `RunPlan` zod schema in `src/shared/api.ts` gains the field; the plan route's response is otherwise unchanged.

### 4.2 Client

`SeenCardRef` (`src/engine/types.ts`) gains `owned: boolean`; `fetchRunPlan`/`toEnginePlan` pass it through. The no-plan fallback (server unavailable, `GameEngine`'s synthesised plan) marks nothing owned: every word spawns plain. Gameplay never depends on the API (main spec §7), and that rule is kept: a run without a plan is today's game at spawn. The within-run promotion of §5.2 still applies, so a card killed and then dropped in a no-plan run is a lapse like any other; there is no "lights enabled" switch.

**Replays.** `replayPlan` (revenge rounds and play-again in `src/App.tsx`) builds the replay's `seenCards` from the last fetched plan plus the cards introduced in the run just played. It must also light every card the previous run killed: the engine exposes `getLightById()` (or the set of killed card ids) at game over, and `replayPlan` takes it as an input and sets `owned: true` for each. Dark cards (dropped, not relit) count as killed-before and start the replay lit; a replay is a new run and starts from ownership alone, like a fresh run. No network round-trip: the replay path stays synchronous.

## 5. Engine

All in `src/engine/`, deterministic under the injected seed as before.

### 5.1 State

- `AirborneWord.light: 'plain' | 'lit' | 'dark'`, set at spawn from the engine's per-run light map and never mutated on the word (a sprite's treatment is fixed for its lifetime, as today).
- The engine keeps `lightById: Map<string, 'lit' | 'dark'>` for the run, seeded from the plan's `owned` cards (`lit`). Absent means `plain`.
- The engine keeps `comebackQueue: Card[]` (cards owed a comeback, in lapse order) and `comebackDone: Set<string>` (cards that have had their one comeback this run).

**Instances, not cards.** The same card can be airborne twice (`drawSeen` refills when the seen pool is smaller than the wave). Every event and effect keys on the instance's spawn-time `word.light`, which is what the player saw fall; only the per-run `lightById` map moves on. So a plain instance that lands after its twin was killed is a lesson, not a lapse, and the map stays `lit`.

### 5.2 Kill

`killWord`: if `word.light` was `dark`, the kill is a **relit** kill. In every case set `lightById` to `lit`. `wordKilled` gains `relit: boolean`.

### 5.3 Miss

`missWord`: a **lapse** is a miss of a word whose `light` is `lit`. On a lapse, set `lightById` to `dark` and, if the card is not in `comebackDone`, push it to `comebackQueue` and add it to `comebackDone`. A miss of a `dark` instance (second drop) changes nothing in the maps. A miss of a `plain` instance is a lesson and changes nothing in the maps, even if the map already says `lit`. `wordMissed` gains `lapse: boolean` and `light: 'plain' | 'lit' | 'dark'` (the state the word fell with, so the renderer can shape the reveal for a second drop without a third flag).

Lives, combo reset, `missed`, and game over are unchanged for all three.

### 5.4 Wave planning

`Spawner.planWave(wave, comebacks)` takes the pending comebacks (the engine drains `comebackQueue` into the call). The wave's card list is `[...comebacks, ...newCards, ...drawSeen(size - comebacks.length - newCards.length)]`:

- Comebacks lead. They fall first, before this wave's introductions and reviews.
- They **displace** review draws: `size` is unchanged. If comebacks plus the wave's new cards exceed `size`, the introductions are reduced for that wave (the comeback is a debt; the budget's new cards are simply deferred to the next wave, as the budget already tolerates), never the comebacks.
- A comeback card is not also drawn by `drawSeen` for the same wave (exclude it from that wave's candidates).
- Comebacks spawn with `light: 'dark'`, from `lightById` like any other card.

A lapse during the last wave the run will play (lives reach 0 on that or a later miss before the next wave begins) never comes back; the queue is simply dropped with the run. A lapse in wave *n* whose card is also drawn by chance in wave *n* again after the lapse is fine: it falls dark; killing it relights it; the queued comeback still happens in wave *n+1* (it is a debt, not a draw).

### 5.5 Snapshot

`EngineSnapshot` is unchanged except that `missed` keeps today's meaning. The HUD does not need light state; the results screen does not change in this project (§12).

## 6. Render

All in `src/render/`, passive consumers of the events above, with the pure parts split out and tested without a canvas (as `approach.ts` and `particleSim.ts` are).

### 6.1 The light, in flight

A pure `lightStyle(light, params)` in a new `src/render/light.ts` decides the treatment from the word's state and `visualParams(effects)`:

| State | `full` | `reduced` | `off` |
|---|---|---|---|
| plain | today: `--color-ink`, cyan halo (`haloAlpha`) | today | today: `--color-ink`, no halo |
| lit | `--color-ink`, cyan halo **plus a white core**: a second `Text` layer behind the main glyph with `dropShadow` in `--color-ink`, a tighter blur than `HALO_BLUR` and alpha ≤ 0.9, built the way `hotText` is (same label, same resolution) | same core at half alpha, matching the halved halo | same as plain (no halo to light) |
| dark | `--color-ink-dim`, no halo, no chromatic split, no spawn-halo flicker | same | `--color-ink-dim`, no halo |

`off` stays exactly today's look for plain and lit words: it is additive-only, and a no-plan run at `off` is pixel-identical to today. The one distinction `off` keeps is dark, which is the state that matters for play (this word is owed). The lesson/lapse difference at `off` is carried by the reveal and the voice, both state. `--color-ink-dim` at 52px+ clears the large-text contrast ratio on `--color-ground`; it is never used for small type by this spec.

**The white core, for reference.** The approved mockup (panel B of `known-mark.html`, a gitignored session file) drew the lit glyph with three stacked shadows, sized relative to the glyph's font size *s*: ink at blur 0.045·*s* alpha 0.95, ink at blur 0.15·*s* alpha 0.6, and the cyan halo at blur 0.27·*s* alpha 0.55; a plain glyph had the cyan halo alone at blur 0.055·*s* alpha 0.45 plus 0.18·*s* alpha 0.28. In Pixi the cyan halo already exists (`HALO_BLUR` on the main Text); the core is the ink pair, which one extra Text with one `dropShadow` approximates. The builder tunes by eye against the legibility rules in second-pass §7.

The approach warm-up (second-pass §4.3) is unchanged for plain and lit words: the cyan halo tints toward vermillion as they near the floor; a lit word's white core stays until the lapse. Dark words have no halo to tint; the floor swell still rises under them (position is the signal).

### 6.2 The lapse

On `wordMissed` with `lapse: true`, in order:

1. **The light goes out.** The word's sprite lingers at the floor for three snap steps (`MOTION.snapMs` × 3): white core and halo off, on, off, ending as `dark` (dim ink, no halo). Today the dead word's sprite is swept by the next `sync()`; the builder keeps it for the flicker (the same lingering `PixiStage` already does for `fx`). `reduced`: no flicker, the light simply goes out. `off`: the word vanishes as today.
2. **The reveal.** A new reveal layout, `revealLayout(card, light)` in a pure helper: the reading (`card.kana[0]`) at 0.75 × `wordPx` in `--color-ink-faint` on the existing 2px vermillion underline; the kanji (`card.kanji`, omitted for kana-only cards) at `HINT_SIZE_RATIO` × `wordPx` above it in `--color-ink-faint`; and the micro-label `you had this` in `--color-danger`, Chakra Petch, `--tracking-label`, below the underline. Same 1600ms life and fade as today's reveal; same position. The reveal is state and plays at every effects level.
3. **The rest is today's miss**: vermillion splash, impact glow, deadline flicker, 2px jolt, pip to 16%, all under their existing effects gates.

A **lesson** (`lapse: false`, `light: 'plain'`) is unchanged in every detail.

### 6.3 The comeback and the relit kill

A dark word spawns with today's bleed-in, in its dark treatment. Lock-on is unchanged (reticle, vermillion underline, flicker).

On `wordKilled` with `relit: true`, all at the moment of the kill (nothing is deferred: the HUD's score and combo pop come from the snapshot published synchronously, and the Pixi kill must stay in step with them):

1. **Today's kill** plays as at that combo: slash, splatter, flare, blip; the word's live sprite is removed as today.
2. **The light comes on, over the kill.** A detached copy of the glyph (the same `fx` mechanism the slash uses) sits where the word was and runs dark, lit, dark, lit over three snap steps, ending lit, then fades with the flare. The slash draws across it. `reduced`: a single step to lit. `off`: no copy; the kill is the state.
3. **A `relit` flash** in `--color-accent` at the word, using the `×N!` mechanism (`spawnFx`), at `full` and `reduced`; skipped at `off`. If the kill also lands on a ×5 combo step, the `×N!` flash wins and `relit` is skipped; the voice (§7) still says it.

### 6.4 A second drop

On `wordMissed` with `lapse: false, light: 'dark'`: no flicker (there is no light to lose), today's lesson-shaped reveal in `--color-ink-faint` instead of `--color-ink` (it is a dead word, and the player has now seen it twice), Power-down (§7), and the rest of today's miss.

## 7. Audio

Two voices join `src/audio/sfx.ts`, in the existing recipe style (oscillator, frequency curve, envelope, ≤ ~700ms):

| Voice | Recipe (the brainstorm mockup's numbers; the builder may tune by ear within the character) | Trigger |
|---|---|---|
| `lapse()` — **Power-down** | sine 1800Hz, 25ms, peak 0.18; then from 20ms a triangle 196→38Hz over 680ms, peak 0.26, and a sawtooth 98→22Hz over 680ms, peak 0.10 | `wordMissed` with `lapse: true`, and with `light: 'dark'` (a second drop) |
| `relit(combo)` — the light switching on in front of the kill blip | sine 1600Hz, 20ms, peak 0.14; sine 330→660Hz from 20ms over 160ms, peak 0.16; sine 495→990Hz from 60ms over 180ms, peak 0.12; then the normal kill blip (`comboPitch(combo)`, triangle, 90ms) at 200ms | `wordKilled` with `relit: true` |

`attachSfx` routes: `wordMissed` → `lapse()` when `lapse` is true or `light` is `'dark'`, else `miss()`; `wordKilled` → `relit(combo)` when `relit`, else `kill(combo)`. Mute, volume and the no-`AudioContext` no-op behave as for every other voice. The reference recipes are playable in `.superpowers/brainstorm/1559-1792877933/content/lapse-reveal.html` and `comeback.html`.

## 8. Recording

`AttemptEvent` (`src/shared/api.ts`) and the `attempts` table (`server/db/schema.ts`, a new Drizzle migration via `npm run db:generate`) gain `comeback: boolean`, default false: true for the attempt made on a card's forced comeback fall (the first dark fall after a lapse, whether it is killed or dropped). `RunRecorder.attemptRow` sets it from a new `AirborneWord.comeback: boolean` the engine stamps at spawn for queue-drawn cards only. Nothing reads the column in this project; it exists so a later stats pass can tell a thirty-second re-test from a day-later one.

The lapse itself is not recorded: it is derivable (an attempt is a lapse iff the card had a kill before it).

## 9. Settings

No new settings. The effects three-way governs everything above through `visualParams` (§6); sound/volume govern the voices. The Settings screen is unchanged.

## 10. Error handling

| Failure | Behaviour |
|---|---|
| Plan unavailable or malformed | No `owned`: every word spawns plain. Today's game at spawn; kills this run still light words (§4.2). |
| Plan from an older server without `owned` | `runPlanSchema` treats `owned` as optional-defaulting-to-false during the transition, so a stale server still yields a valid plan |
| Sprite missing when a lapse or relit event fires (swept early) | The flicker is skipped; the reveal and the voices still play (the reveal is state, built from the event, not the sprite) |
| `relit` and `×N!` on the same kill | `×N!` wins on screen; the relit voice still plays |
| Comebacks exceed wave size | Introductions deferred for that wave; comebacks never dropped; wave size never exceeded |
| Game over with a non-empty comeback queue | Dropped with the run; nothing is persisted |
| Migration fails | `DbOpenError`, as today |

## 11. Testing

**Engine (pure, `src/engine/__tests__`):** light seeding from `owned`; `plain → lit` on first kill; `lit → dark` on lapse; `dark → lit` on relit kill; `relit` and `lapse`/`light` payloads on events; a card introduced and killed this run lapses later in the same run; the comeback leads the next wave; wave size unchanged with one, two and more comebacks than `size - newCards`; introductions deferred, never comebacks dropped; one comeback per card per run; second drop does not re-queue; comeback card excluded from that wave's review draw; two instances of one card: the plain twin landing after the lit twin's kill is a lesson and leaves the map `lit`; determinism under a fixed seed (same seed, same inputs, same wave lists). No-plan fallback: nothing spawns lit, and a card killed then dropped in the same run still lapses. Replay: `replayPlan` marks every card the previous run killed as owned (`src/ui/__tests__/App.replayPlan.test.tsx`).

**Plan (server, `server/__tests__/plan.test.ts`):** `owned` true after a kill in either mode, false with misses only, false for `newCardIds`, present for list pools.

**Recorder (`src/data/__tests__/recorder.test.ts`):** `comeback` stamped on queue-drawn attempts only; the schema round-trips.

**Render (pure):** `lightStyle` for the nine state × level cells; `revealLayout` for lit (reading-only), plain (today's line), dark (dead lesson), kana-only (no kanji line).

**Audio:** `attachSfx` routing for the four event shapes; `relit` includes the kill blip at `comboPitch(combo)`.

**Component/e2e:** the keystone e2e passes unchanged (it plays without a plan or with a fresh DB, so nothing is owned). No new e2e. A manual QA checklist in the plan: the three states side by side at each effects level; a lapse, a second drop, a comeback and a relit kill, each with sound; 60fps with max airborne words at `full` (main spec §8 gate).

## 12. Deferred

- Marking lapses in the results screen's missed list (e.g. "forgot" beside a lapsed word) and surfacing comebacks in Stats. Easy once `comeback` is recorded; out of scope here.
- Discounting comeback kills in the learned gate / strength score. Needs a look at the golden stats fixtures; not this project.
- A lit treatment for the recall hint text and the acquisition ceremony. Out of scope: they are not falling words.

## 13. Risks

- **Two Text layers per lit word.** Late waves can have six lit words plus hot (approach) copies. Each lit word adds one more Text. The builder measures against the 60fps gate; if it fails, the core can be baked as a second `dropShadow` pass on the same Text at `full` only, with `reduced` falling back to a brighter single halo.
- **The lingering glyph.** Both flickers (the lapse's light going out, the relit kill's light coming on) run on a detached copy of the glyph in the existing `fx` list, never on the live sprite, so `PixiStage.sync()`'s remove-on-absence rule stays dumb. The copy is built the way `hotText` is, from the event's word, so a sprite swept early costs nothing.
- **The mockups are session files.** The three brainstorm pages live under `.superpowers/`, which is gitignored. Everything the builder needs from them is copied into §6.1 (the white core) and §7 (the two voices); the pages themselves are a convenience while they exist.
- **Schema change during an open run.** Outbox batches from a client built before this change lack `comeback`; the server's zod schema defaults it to false.

## 14. What is left to the builder

The exact blur/alpha of the white core; the flicker timings beyond "three snap steps"; the relit flash's size and life; whether the lapse reveal's kanji line is omitted or dimmed further for kana-only cards in recall mode; migration naming; the particle counts (unchanged); the test fixtures. Anything not named above follows the second-pass spec's grammar.
