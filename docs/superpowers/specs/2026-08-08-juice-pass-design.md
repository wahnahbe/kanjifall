# The Juice Pass — Design Spec

**Date:** 2026-08-08
**Status:** Approved pending final user review
**Scope:** M4 sub-project C — the last M4 item. Covers the main spec's item-4 wishlist in full: SFX, particles, combo effects, bloom/CRT, settings, IME warning banner, README, plus the tier-cleared celebration deferred here by the tiered-vocabulary spec (§1, §5.4).
**Builds on:** `2026-07-27-tiered-vocabulary-design.md` (the `tierAdvance` results line this upgrades) and the main spec's load-bearing boundary (§4): the Pixi layer, React HUD, and audio are all passive consumers of engine events.

## 1. Purpose

Make the game feel as good as it works.

Four milestones built a correct game: deterministic engine, honest analytics, paced introductions, tiered progression, imported lists. The moments that structure all of it — a kill, a combo climbing, a wave cleared, a word acquired, a tier conquered — currently register as two text tweens and a plain sentence. This sub-project gives every one of those moments a sound and a shape, without touching a single engine rule.

### Non-goals

- **Engine changes.** Zero. Every effect consumes existing `GameEvent`s or existing React-owned moments.
- **Audio assets.** All SFX are synthesized in Web Audio at runtime — no files, no licensing, nothing to load.
- **Music.** A backing track is a different project; this is SFX only.
- **Server involvement.** Settings are device preferences and live in `localStorage`; the profile row stays study data.
- **New e2e coverage.** Audio and canvas visuals get unit tests for their pure logic plus a manual QA checklist; the keystone e2e stays untouched.

## 2. Decisions log

| Decision | Choice | Why |
|---|---|---|
| Scope | Full item-4 wishlist + tier celebration | Closes M4 entirely |
| SFX production | Synthesized (Web Audio oscillators/noise) | Zero assets, zero licensing, tiny, retro fit; combo pitch ramp is frequency math |
| Sound reach | Game events + ceremony chime + tier fanfare; menus silent | Tasteful; no generic UI bleeps |
| Architecture | Passive consumers on the existing event seam | The main spec's stated boundary; zero engine changes |
| Settings storage | `localStorage`, zod-validated, single key | Device prefs, not study data; corrupt data falls back silently |
| Reduced motion | `prefers-reduced-motion` defaults effects to `reduced` | Accessibility by default, overridable in Settings |
| Filters dependency | `pixi-filters` (v8-compatible line) | Named in the main spec's tech stack since day one; never installed until now |
| Celebration home | Results screen, DOM/CSS only | `tierAdvance` is computed post-run by design (M4-D); no Pixi mounts on results |
| Fanfare once | Played-once ref, StrictMode-safe | The M4-B `disposedRef` lesson: dev-mode effect double-invocation is real |

## 3. Settings

### 3.1 The store

`src/data/settings.ts` — one `localStorage` key, `kotoba-settings-v1`:

```ts
export const settingsSchema = z.object({
  sound: z.boolean(),
  volume: z.number().min(0).max(1),
  effects: z.union([z.literal('full'), z.literal('reduced'), z.literal('off')]),
  crt: z.boolean(),
});
export type Settings = z.infer<typeof settingsSchema>;
```

Defaults: `sound: true`, `volume: 0.6`, `crt: false`, `effects: 'full'` — except `'reduced'` when `matchMedia('(prefers-reduced-motion: reduce)')` matches at first load. Missing or corrupt storage → defaults, never a throw; every `updateSettings` writes back the validated whole.

API: `getSettings()`, `updateSettings(partial)`, `subscribeSettings(cb)` (returns unsubscribe), and a `useSettings()` React hook via `useSyncExternalStore`. Live application is the point: flipping CRT in Settings restyles the running stage; muting silences the next kill.

### 3.2 The screen

`src/ui/screens/SettingsScreen.tsx`, reached from a new Title-screen button. Controls: sound toggle, volume slider (range 0–1, step 0.05, disabled while sound is off), effects level three-way (full / reduced / off), CRT toggle, Back. Each control writes through `updateSettings` immediately — no save button.

## 4. Audio

### 4.1 SfxPlayer

`src/audio/sfx.ts`. A lazily-created `AudioContext` (first play call; every trigger sits downstream of a user key press, satisfying autoplay policy; `resume()` guards the suspended state). Missing `AudioContext` (jsdom, ancient browsers) makes every call a silent no-op. A master `GainNode` tracks `volume`; `sound: false` short-circuits before any node is built.

Seven voices, each a small pure recipe (oscillator type, frequency curve, envelope, duration ≤ ~700ms):

| Voice | Character | Trigger |
|---|---|---|
| `kill(combo)` | Short triangle blip; pitch = 440Hz × 2^(min(combo,12)/12) — a semitone per combo step, capped +1 octave | `wordKilled` |
| `miss()` | Low descending saw thunk | `wordMissed` |
| `wrongSubmit()` | Muted double-blip | `wrongSubmit` |
| `waveClear()` | Quick 3-note rising arpeggio | `waveCleared` |
| `gameOver()` | Descending minor arpeggio | `gameOver` |
| `ceremonyChime()` | Soft sine chime | AcquisitionCeremony, correct Enter |
| `tierFanfare()` | 4 rising notes + shimmer overtone | ResultsScreen, once, when `tierAdvance` is non-null |

`comboPitch(combo)` is exported pure for unit tests. The player exposes exactly these voice methods plus nothing — no generic `play(name)` string API.

### 4.2 Wiring

`attachSfx(player)` returns an event listener installed in `useEngine`'s existing `onEvent` seam — the same place `stage.playKill` is called — mapping the five game events above. The ceremony and results screens import the two React-owned voices directly. Mute/volume are read at play time from the settings store, so no re-wiring on change.

## 5. Visual effects

### 5.1 Particles

`src/render/Particles.ts`, owned by `PixiStage`, sharing its ticker. A pooled `Graphics`-dot emitter with a hard cap (~200 live); pure pool/expiry/velocity logic split from the Pixi drawing so it tests without canvas.

| Moment | Effect | Scaling |
|---|---|---|
| Kill | Burst at word position, existing kill-green | Count grows with combo tier; `reduced` halves counts; `off` none |
| Combo ×5 milestone | Bigger burst + `×N!` flash via the existing `spawnFx` | `full`/`reduced` show the flash; `off` skips both |
| Miss | Dim red puff + ~150ms 4px screen shake | Shake in `full` only |
| Wave clear | Brief confetti sweep across the top | `reduced` halves; `off` none |

### 5.2 Filters

`src/render/filters.ts` + the new `pixi-filters` dependency (the v8-compatible major). `filtersFor(settings)` is a pure decision function returning which filters apply: subtle bloom when `effects === 'full'`; CRT overlay when `crt` is true (independent of effects level); `reduced`/`off` contribute no bloom. `PixiStage` applies the returned set to `app.stage` and re-applies on settings changes via `subscribeSettings`.

### 5.3 HUD

The combo counter gets a CSS pop (scale pulse keyframe re-triggered on change) — `Hud.tsx` class toggle, no Pixi.

## 6. The tier-cleared celebration

On the results screen, when `tierAdvance` is non-null (the M4-D plain line's data, unchanged):

- **Fanfare** plays exactly once per results screen — a played-once `useRef` guard written StrictMode-safe (reset in the effect body, the M4-B pattern).
- The line upgrades to a **banner**: CSS scale-in/fade keyframes on the existing `tier-advance` element, styled as the run's headline.
- **Confetti**: ~24 absolutely-positioned colored dots falling via pure CSS animations over ~2s, then removed.

Effects level: `full` = all three; `reduced` = banner + fanfare, no confetti; `off` = today's plain line. `sound: false` drops the fanfare independently. Replays that advance nothing show nothing (M4-D's rebaseline already guarantees `tierAdvance` is null there).

## 7. IME warning banner

`src/ui/hud/ImeWarning.tsx`, rendered by GameScreen during play. A window `compositionstart` listener (attached while the game screen is mounted) shows: `Japanese IME is on — switch to EN input (Win+Space).` The banner hides 4s after the last composition event (timer reset per event). The engine already ignores composing keys (`isGameKey`); this makes the silent failure visible. Component-tested with dispatched `CompositionEvent`s and fake timers.

## 8. README

The repository README (`README.md`, currently absent): what the game is (one paragraph + the reinforcement-tool framing from the main spec §1), quick start (`npm run start`; `npm run dev` for development), the raw-data rebuild (`npm run build:data`, data/raw expectations), test commands (`npm run check`, `npm run e2e`), and a pointer to `docs/superpowers/` for specs and plans. No screenshots.

## 9. Error handling

| Failure | Behavior |
|---|---|
| `AudioContext` missing / construction throws | Every voice call is a silent no-op |
| Context suspended (autoplay policy) | `resume()` attempted per play; failure = skip this sound |
| Corrupt/missing localStorage | Defaults; next `updateSettings` rewrites clean |
| `pixi-filters` misbehaves at runtime | Filters wrapped: a construction failure logs one warning and runs unfiltered; gameplay never blocks |
| Particle pool exhausted | Oldest particles recycled; the cap is the guarantee |
| Reduced-motion media query unsupported | Treated as no-match (defaults to `full`) |

## 10. Testing

**Unit (pure):** settings store (defaults, reduced-motion default, corrupt-storage fallback, subscribe/notify, write-through); `comboPitch` (base, per-step semitone, octave cap); particle pool logic (spawn counts per effects level, cap enforcement, expiry); `filtersFor` (all four settings combinations that matter).

**Wiring:** `attachSfx` against a fake player — each of the five events calls exactly its voice with the event's payload (`wordKilled` passes `combo`); `sound: false` short-circuits.

**Component (jsdom):** SettingsScreen (each control writes through; volume disabled when muted); ImeWarning (compositionstart shows, 4s fake-timer hide, reset on repeat); ResultsScreen celebration (banner when `tierAdvance` set, fanfare called exactly once under `<StrictMode>`, `reduced` renders no confetti, `off` renders the plain line); HUD combo pop class.

**Manual QA checklist (committed in the plan, run before merge):** 60fps at max airborne words + particles at `full` (the main spec §8 gate); audible check of all seven voices; CRT/bloom toggles live-apply; mute mid-run silences immediately.

**E2E:** all three existing specs pass unchanged — the juice layer must never alter game semantics or block any flow.
