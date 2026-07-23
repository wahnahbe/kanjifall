# kotoba-drop — Design Spec

**Date:** 2026-07-22
**Status:** Approved pending final user review
**Working name:** `kotoba-drop` (rename freely)

## 1. Purpose

A standalone falling-words typing game for learning Japanese vocabulary. JLPT-tagged words fall from the top of the screen; the player types the Japanese (as romaji, converted live to kana) and presses Enter to destroy them before they hit the ground. Every attempt is recorded to a local database that powers a personal analytics profile: words learned per direction, a vocab-only JLPT level estimate, and pace tracking against the December 2026 N2 exam date.

The game is a **reinforcement** tool. Arcade speed pressure cements half-known words; it is weak for first exposure. First exposure and scheduling remain the job of the owner's SRS (n2-prep / FSRS). This app deliberately does not implement its own SRS.

### Non-goals (out of scope for v1)

- Mobile support. Desktop browser, physical keyboard required.
- Real Windows IME input mode (composition-based typing). Romaji-to-kana only.
- Listening mode (audio falls, type what you hear) — possible future mode.
- Cloud sync, accounts, multi-user, hosted deployment.
- Any spaced-repetition scheduling. Analytics are descriptive, not prescriptive.
- Grammar, reading passages, listening — the level estimate is vocab-only and labeled as such.

## 2. Decisions log

| Decision | Choice | Why |
|---|---|---|
| Project home | Fully standalone, no ties to n2-prep | User choice; keeps n2-prep's locked roadmap/budget untouched |
| Game modes (both v1) | Recall (English falls → type reading) and Reading (kanji falls → type reading) | Both validate the same kana reading, so one engine serves both; only the prompt display differs |
| Input method | Romaji → auto-kana via wanakana IME mode; validate kana readings only | Proven pattern from Japanese typing games; no IME fighting; never requires kanji conversion |
| Submit rule | **Enter to submit** (no auto-kill) | Deliberate answering; solves homophone targeting and prefix-collision problems outright |
| Word source | Bundled JLPT N5–N2 lists (yomitan-jlpt-vocab) + custom paste/CSV import | Best fit for N5→N2 climb; import covers current study words |
| Rendering | Full PixiJS v8 (WebGL) | User chose maximum visual spectacle; text risks mitigated (see 5.4) |
| Persistence | Local Node backend (Hono + better-sqlite3 + Drizzle), SQLite file on disk | Durable analytics that survive browser-data clears; SQL-queryable; stack already proven on this machine in n2-prep |
| Analytics scope | Capture all raw fields from day one; render only five v1 views | Raw signals can't be reconstructed later; dashboards can grow later for free |

## 3. Game design

### 3.1 Core loop

1. Words spawn at the top of the playfield and fall at a wave-dependent speed.
2. The player types romaji; an input buffer converts it live to kana (`benkyou` → べんきょう) and displays it at the bottom of the screen.
3. While typing, any airborne word whose accepted reading starts with the buffer highlights (lock-on feedback). Nothing dies until Enter.
4. **Enter** submits the buffer:
   - Exact match against an accepted reading of any airborne word → that word explodes. If multiple airborne words match (homophones), **the word closest to the floor dies**.
   - No match → buffer shakes/flashes and clears, combo resets. No life is lost on a wrong submit.
5. **Backspace** edits the buffer; **Escape** clears it. A dangling `n` commits to ん on Enter (`hon` + Enter = ほん).
6. A word reaching the floor costs one life (of 3), flashes its correct reading + meaning as it dies, and is added to the run's missed list.
7. Words come in waves. Clearing a wave increases fall speed and spawn rate.
8. Run ends at 0 lives → results screen: score, accuracy, missed-words list (with readings and meanings), and a **revenge round** button that replays exactly the missed words.

### 3.2 Modes

Both ship in v1 and share the engine, matcher, and input pipeline. Only the prompt display differs.

- **Recall mode:** the English gloss falls ("to study"); the player types the reading (べんきょう). When a word falls past 60% of screen height, its kanji form fades in beside the gloss as a grace hint. Kills after the hint appeared are recorded as hinted (see 6.2).
- **Reading mode:** the kanji form falls (勉強); the player types the reading. The English gloss flashes on the kill for passive meaning exposure. **Kana-only words are excluded from this mode** — typing visible kana teaches nothing.

### 3.3 Pool selection

Player picks a word pool per run: a single JLPT level (N5, N4, N3, N2), mixed (all levels weighted toward the selected target level), or a custom imported list.

### 3.4 Scoring

Per-word points scaled by word length and current fall speed, with a combo multiplier that grows on consecutive kills and resets on any wrong submit or floor miss. High scores stored per (mode, pool).

### 3.5 Known issues and their mitigations

| Issue | Mitigation |
|---|---|
| Synonym ambiguity in recall mode ("big" → 大きい? 大きな? でかい?) | Each card accepts all of its own valid readings; build pipeline selects short, distinctive glosses; on floor miss the answer is revealed ("target was 大きい") |
| Windows Japanese IME intercepts keystrokes if active in the browser | Detect `composition*` events during play and show a "switch to EN input (Win+Space)" banner |
| Long glosses make recall mode a reading-speed test | Build pipeline caps glosses at ~28 chars and strips parentheticals |
| Speed pressure favors already-known words | Positioned as reinforcement; missed list + revenge round are the acquisition mechanism |
| Homophones airborne simultaneously | Enter-submit + closest-to-floor rule (3.1.4) |
| Katakana words (コーヒー) | Buffer accepts hyphen for ー; matcher normalizes katakana↔hiragana before comparing |

## 4. Architecture

### 4.1 Stack

- **Client:** Vite, React 19, TypeScript (strict), PixiJS v8, pixi-filters (bloom, CRT), wanakana, Recharts (Stats screen)
- **Server:** Node, Hono, better-sqlite3, Drizzle ORM, drizzle-kit migrations
- **Testing:** Vitest, React Testing Library, Playwright (one E2E)
- **Modes of running:** `npm run dev` (Vite + API side by side, proxied); `npm start` (single process serves built client + API; browser opens). Local only, no auth.

### 4.2 Module layout

```
kotoba-drop/
  server/
    db/schema.ts          # Drizzle schema: cards, runs, attempts, wrong_submits, custom_lists, profile
    routes/runs.ts        # run lifecycle + event batch ingest
    routes/stats.ts       # derived analytics queries
    routes/lists.ts       # custom list CRUD
    index.ts              # Hono app; serves API + built client
  src/
    engine/               # pure TS — zero React/Pixi imports
      GameEngine.ts       # fixed-timestep loop: spawn, fall, floor, waves, lives, score
      InputBuffer.ts      # romaji→kana (wanakana IME mode); backspace/escape/enter semantics
      Matcher.ts          # normalization + exact/prefix matching vs accepted readings
      Spawner.ts          # wave composition, difficulty ramp; seeded RNG injected
      scoring.ts          # points, combo
      types.ts            # Card, AirborneWord, GameEvent, ModeConfig
    data/
      loader.ts           # fetch per-level JSON chunks; schema-validate
      importParser.ts     # TSV/CSV parsing with per-line errors
      outbox.ts           # localStorage fallback queue for failed event flushes
    render/               # Pixi layer — dumb, event-driven, no game logic
      PixiStage.ts        # app init, resize, context-loss pause, font-ready gate
      WordSprite.ts       # per-word PIXI.Text container (2x resolution); spawn/kill/miss anims
      Particles.ts        # explosion + ambient emitters
      filters.ts          # bloom, CRT toggle
    ui/
      screens/            # Title, ModeSelect, Game, Results, Stats, Import, Settings
      hud/                # ScoreBar, Lives, Combo, KanaBuffer, ImeWarning
      useEngine.ts        # useSyncExternalStore subscription to engine events
    audio/sfx.ts          # Web Audio SFX set; mute toggle
  scripts/build-data.ts   # yomitan-jlpt-vocab → cleaned per-level JSON in public/data
  data/kotoba.db          # SQLite file (gitignored)
```

**Load-bearing boundary:** `src/engine/` is pure TypeScript with no rendering or React imports. It emits typed events (`wordSpawned`, `wordKilled`, `wordMissed`, `waveCleared`, `gameOver`, `bufferChanged`); the Pixi layer, React HUD, and audio are all passive consumers. This is what makes the game logic unit-testable without canvas mocks.

### 4.3 Data flow

`keydown` → `InputBuffer` → buffer state → HUD display. **Enter** → `Matcher` resolves vs airborne words → `GameEngine` applies kill/reject → events → Pixi animates, HUD updates, SFX plays, attempt recorder buffers the event. The loop runs on `requestAnimationFrame` with a fixed-timestep accumulator; it auto-pauses on tab blur and WebGL context loss.

Attempt records buffer in memory during play and flush to the API at wave end and run end (retry with backoff; `localStorage` outbox on failure, drained on next launch). Gameplay never blocks on the API.

### 4.4 PixiJS text strategy

Each word's text is rasterized **once at spawn** (`PIXI.Text`, resolution 2x / devicePixelRatio-aware); falling is pure sprite transform. No per-frame text changes. Furigana is never shown during play (it would reveal the answer in both modes); readings appear only in kill/miss feedback and results, rendered as a second text line. First spawn waits on `document.fonts.ready`.

## 5. Data model

### 5.1 Cards

```ts
Card {
  id: string            // stable across list versions
  kanji: string | null  // null for kana-only words
  kana: string[]        // accepted readings; kana[0] canonical (shown in feedback)
  gloss: string         // short distinctive English, ≤ ~28 chars
  pos: string           // part of speech, from source data
  jlpt: 5 | 4 | 3 | 2
  source: 'jlpt' | 'custom'
}
```

JLPT cards are seeded into SQLite from the build pipeline output (also shipped as JSON for the client). Custom lists live in the DB via the import UI.

### 5.2 Event capture (append-only; raw truth)

**`runs`:** id, started_at, ended_at, mode, pool, score, waves_cleared, duration_ms, paused_ms, max_combo, accuracy, app_version, list_version.

**`attempts`** (one per word that left the screen, by kill or floor):
- card_id, run_id, mode, outcome (`kill` | `miss`)
- `ms_to_first_key` (spawn → first keystroke while this word was locked-on; null if never targeted)
- `ms_to_kill` (spawn → kill; null on miss)
- `backspace_count` (edits while targeting this word)
- `hint_shown` (recall mode: kanji grace hint was visible before resolution)
- `was_targeted` (miss subtype: had a matching prefix at any point vs never attempted)
- `airborne_count` (words on screen at resolution), `speed_level`, `created_at`

**`wrong_submits`:** run_id, submitted_kana, airborne_card_ids (JSON), matched_other_card_id (nullable — submitted kana is a valid reading of a different pool card), created_at.

**`profile`** (single row): target_level, exam_date, daily_word_goal.

### 5.3 Analytics — v1 rendered views (Stats screen)

1. **Words learned, per direction** — a card is *learned in reading* / *learned in recall* independently: ≥3 encounters in that direction with rolling accuracy ≥80% over the last 5 encounters; hinted kills count at half weight. Thresholds are constants in one file, tunable.
2. **Vocab Level Estimate** — per JLPT level: coverage (% of list encountered) and mastery (% of encountered that is learned), shown as N5→N2 progress bars. "Theoretical level" = highest level with coverage ≥60% and mastery ≥70%. Labeled **vocab-only estimate** everywhere it appears.
3. **Pace vs exam** — from profile (target N2, exam 2026-12): current learn rate (words/day, 14-day rolling) vs required rate to cover remaining target-level vocab by exam date; on-pace / behind-pace indicator.
4. **Trend** — words practiced and accuracy per day (last 30 days), play-streak calendar.
5. **Leech list** — lowest word-strength scores (0–100, recency-weighted accuracy + speed), feeds revenge rounds.

### 5.4 Analytics — captured now, rendered later (free once raw data exists)

Per-kanji weakness aggregation; retention-by-gap (forgetting curve); wrong-submit classification (typo ≤1 edit distance vs confusion-with-other-word vs blank); fatigue curve (accuracy by minute-in-session); time-of-day performance; new-vs-review balance; retrieval-vs-typing time split.

## 6. API sketch

- `POST /api/runs` — create run, returns id
- `POST /api/runs/:id/events` — batch ingest {attempts[], wrong_submits[]}; idempotent per batch id
- `PATCH /api/runs/:id` — finalize (score, duration, accuracy)
- `GET /api/stats/overview` — v1 five payload
- `GET /api/stats/words?sort=strength&filter=...` — word-level table / leech list
- `GET/POST/DELETE /api/lists` — custom lists; `POST /api/lists/preview` — parse + per-line errors without saving
- `GET/PUT /api/profile`

## 7. Error handling

- **DB:** WAL mode; drizzle-kit migrations; corrupt/incompatible DB → error screen with file path and recovery steps. The app never silently recreates or overwrites the database. Stats screen shows the DB path (backup = copy the file).
- **Event flush:** retry with backoff → `localStorage` outbox → drained next launch. Zero-loss goal; play never blocks.
- **Server unreachable at launch:** plain error screen ("start with `npm start`"), not a silent degrade.
- **Import:** preview with per-line errors before save; duplicate detection against existing cards.
- **Rendering:** pause on tab blur and WebGL context loss; resume on restore. Font-ready gate before first spawn.
- **Input:** IME composition detection → warning banner; buffer rejects non-romaji noise keys.
- **Data load:** per-level JSON fetch failures retry, then error screen.

## 8. Testing

- **Unit (Vitest), 80%+ on `engine/`, `data/`, `server/`:**
  - `Matcher`: katakana↔hiragana normalization, multi-reading acceptance, homophone closest-to-floor selection, dangling-`n` commit, っ/ん/ー edge cases.
  - `InputBuffer`: romaji conversion incl. alternate spellings (si/shi, tu/tsu, zya/ja), backspace/escape/enter semantics, composition-event guard.
  - `GameEngine` + `Spawner`: deterministic via fixed timestep + injected seeded RNG — wave composition, ramp curves, life loss, floor detection, pause accounting.
  - `importParser`: valid/invalid lines, per-line error messages, dupes.
  - **Stats golden tests:** seed temp SQLite with a known attempt history → assert exact learned counts, level-estimate math, pace numbers, leech ranking, confusion pairs.
- **API route tests:** Hono against temp DB file; batch idempotency.
- **Component smoke tests:** Results, Stats (mock API), Import preview errors.
- **E2E (Playwright, one keystone test):** launch server + client, start a seeded N5 reading run, type the deterministic first word via real keyboard events, Enter → assert score updates and the attempt row exists in the DB.
- **Manual:** 60fps check at max airborne words + particles; visual QA of effects.

## 9. Milestones (each ends playable)

1. **Core loop fun-check** — engine + input + matcher + plain falling Pixi text; reading mode only; hardcoded ~50 N5 words; no DB, no effects. *Gate: is it fun? Tune fall/spawn curves before building anything on top.*
2. **Real data + both modes** — build-data pipeline, level/pool select, recall mode with grace hint, results screen with missed words + revenge round.
3. **Backend + analytics** — server, schema, full raw event capture, profile/goals, Stats screen with the v1 five views.
4. **Juice + extras** — particles, bloom, CRT toggle, SFX, combo effects, custom-list import UI, settings, IME warning banner polish, README.

Visual polish ships last, after the loop is proven fun and the data is flowing — same "skin ships last" discipline as n2-prep.
