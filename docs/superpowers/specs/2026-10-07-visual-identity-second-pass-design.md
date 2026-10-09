# Visual Identity, Second Pass — Design Spec

**Date:** 2026-10-07
**Status:** Implemented — see docs/superpowers/plans/2026-10-07-visual-identity-second-pass.md
**Scope:** Atmosphere and ink material on the playfield, a motion language for every moment of play, screen transitions, a wave-start beat, and a title showpiece. Presentation only. No engine, data, or server changes.
**Builds on:** `2026-08-15-visual-identity-design.md`. This spec inherits its token layer (§3), its effects/settings contract (§7), and its legibility rules (§9) without restating them. Where it amends that spec it says so explicitly. It also inherits the juice pass's load-bearing boundary: the Pixi layer, the React HUD, and audio are passive consumers of engine events.
**Comps:** the approved mockups live in `.superpowers/brainstorm/1820-1791402381/content/` (gitignored, local to the machine the brainstorm ran on): `backdrop.html`, `chrome.html`, `scale.html`, `motion-v2.html`, `transitions.html`, `title-v2.html`. The spec is the source of truth; the comps show intent.

## 1. Purpose

The first identity pass declared "brushed ink lit as neon" and shipped the foundations: tokens, four purposeful fonts, a floor that exists, HUD chrome, a target reticle. Nothing in it is wrong. Looked at fresh, the result is thin rather than unfinished:

- **Void dominates the frame.** The playfield is mostly empty ground with no depth behind the action. Words are small for the viewport, and the floor stroke is the only element with weight.
- **The "brushed ink" half mostly did not ship.** A mincho face, one brush floor stroke, one faint title stroke. No ink texture, no sumi wash, no brush accents on panels or controls. It reads as dark neon UI more than ink lit as neon.
- **Scale is timid.** HUD blocks are small, the wordmark is modest, controls are plain rectangles.
- **There is no motion language.** The first spec deferred it. Spawn, fall, kill, screen changes and the title have no choreography. Nothing builds tension as a word nears the floor, screens hard-cut, and a wave begins with no beat beyond the HUD label changing.
- **The first impression is a wordmark in a void.**

This spec finishes the identity rather than reopening it. The colour order, the fonts, the token layer and the legibility rules all stand. Three phases, each shippable on its own, in dependency order: the playfield as a place, then motion, then the first impression.

### Non-goals

- **Engine, data, or server changes.** Zero. The one layout change (§3.4) is CSS on the canvas host; the engine's normalized coordinates make it invisible to game rules.
- **New gameplay affordances.** The approach treatment makes existing state more visible; it adds no mechanic.
- **Illustration or sprite art.** Everything is procedural except fonts. The one new asset is a favicon generated once from a glyph.
- **Audio.** The new moments (slash, splash, wave beat) have no sound in this spec. Noted as deferred (§11).
- **Stats, Settings, Import, Results and error screens.** They keep the first spec's calm treatment, gaining only the transition (§4.4) and brush-edged controls (§3.2).
- **Responsive/mobile.** Out of scope, as before.

## 2. Decisions log

Each row was chosen from live comps shown side by side; the rejected alternatives are listed so the choice is reproducible.

| Decision | Choice | Rejected | Why |
|---|---|---|---|
| Backdrop depth | Sumi atmosphere with three far ghost glyphs | Ghost kanji rain (two parallax layers); Night City skyline with perspective grid; sumi alone | Material first, a hint of the world second. Letterforms behind live words were judged semantic noise; the skyline was judged off-identity |
| Ink in the chrome | Brush-edged chrome: existing structure, borders drawn as dry-brush strokes | Hard chrome as shipped; ink replacing the chrome (no boxes) | Keeps the approved Night City Dojo layout; makes the material ink without giving up the buffer's frame |
| Play-layer scale | +30% words and floor, +15% HUD, window-relative and clamped | As shipped (fixed 40px); +60% with four lanes | 52px at 1280 wide clears three-character neighbours with room and keeps five lanes; 40px is the chromatic-split floor and is fixed regardless of window size |
| Buffer position | Below the kill line, in a machine band | Inside the playfield, as shipped | A centre-lane word falls straight through the shipped buffer; the approved comp already had it below |
| Motion grammar | Ink is the body, neon is the light: forms move like ink, light moves like neon | Neon electrical (everything flickers, hard shake); ink and water (everything fluid, no pulse) | It is what the identity statement already says |
| Kill effect | Brush slash + ink splatter + neon flare | Flash ring with sparks; slash + splatter only | The slash was taken from the ink grammar and added to the chosen one; three effects on the game's most frequent moment, with droplet count as the tuning knob |
| Screen transition | Bleed crossfade: blur-and-drain out, bleed in with one flicker | Ink wipe with a self-drawing header; neon cut with flash and scanlines | Cheapest on-grammar option, built from the same blur-and-flicker the words use to spawn |
| Wave start | Header bleeds in large while a band of light rises from the floor, then settles into the HUD slot | Header drawn by a moving pen then flown to its slot; header flickers in at the slot only | Pairs with the transition choice |
| Title showpiece | Neon sign over a raised floor, with ghost words falling in the outer lanes | Attract mode (title on the live playfield); monument (one enormous lit-edge kanji) | The sign reuses the HUD's own chrome; the falling ghosts were taken from attract mode and placed where they never cross the sign |
| Japanese wordmark | 漢字落 beside KanjiFall; 落 becomes the favicon | None offered | The identity had no glyph of its own |

## 3. The playfield as a place

### 3.1 The atmosphere

The backdrop gains a depth layer between the gradient and the words. It is DOM and CSS, not Pixi, keeping the first spec's split: **CSS owns the backdrop, Pixi owns anything tied to game coordinates.**

The atmosphere is one persistent element rendered at the app root, behind every screen, with a `data-scene` attribute set by the current screen. It is visible for the title, the run chooser and the game; it fades to transparent (via the transition duration, §4.2) for the calm screens. Rendering it once and keeping it mounted means the title, the chooser and the game share one continuous ground, and the blurred layers are rasterized once rather than on every screen mount.

Layers, bottom to top, all `pointer-events: none`:

1. **Ground gradient** — `--gradient-ground`, unchanged.
2. **Washes** — three large ellipses, `filter: blur(30px)`, `border-radius: 50%`. One in `--color-system` at 8.5% alpha, two in the ground-wash tokens (§3.5). Two of them drift on `transform` only, over 46s and 58s, by at most 4% of their size. They are promoted to their own compositor layers (`will-change: transform`) so the blur is rasterized once and only moved.
3. **Sumi texture** — a static element with an SVG `feTurbulence` data-URI background: low-frequency fractal noise, pre-tinted and alpha-thresholded through `feColorMatrix` and softened with `feGaussianBlur`, at 11% opacity. **No blend mode.** The first spec avoided `mix-blend-mode` for compositor cost; the tint is baked into the SVG instead.
4. **Light shaft** — a vertical gradient column, 28% of the width, centred, from `--color-system` at 11% alpha at the floor to transparent at 80% of the height, `filter: blur(16px)`, static.
5. **Ghost glyphs** — three spans in `--font-word` at 12% of the stage width, `--color-ink` at 4.5% alpha, `filter: blur(2.4px)`, drifting together ±5% vertically over 70s. The glyphs are a fixed ambient set, 言 葉 降, chosen for the identity. **They are never drawn from the deck**, so a ghost can never resemble a live card.
6. **Vignette** — a radial gradient from transparent at 48% to the ground at 70% alpha in the corners.

The existing grid, grain and fibre on `.pixi-host` are unchanged and stay above the canvas as today. The atmosphere must paint **below** the Pixi canvas. The host already gives the canvas `position: relative; z-index: 0`; the plan verifies the stacking visually the way the grain rule was verified, since Pixi appends the canvas as an in-flow child.

Brightness ceiling: no atmosphere layer may lift the ground by more than roughly 8% luminance at any point. The words stay the brightest thing on screen (first spec §3.1) and §9.1 holds. The legibility screenshot check (§9) is run with the atmosphere on.

### 3.2 Brush-edged chrome

The HUD and the calm-screen controls keep their layout and gain ink as a material: every 1px `--color-line` border becomes a dry-brush stroke.

Mechanism: a new generator, `brushFrameDataUri(seed, viewBox)` beside the existing `brushStrokeDataUri` in `src/render/brushStroke.ts`, returns a colour-free SVG: a rect stroked in white, displaced by the same `feTurbulence` + `feDisplacementMap` construction as the floor. It is applied as a CSS **mask** on a pseudo-element whose `background-color` is the token (`--color-line`, or `--color-line-soft` on secondary controls). Colour therefore still comes only from tokens, and the parity test's "no hex literal outside tokens" rule survives. `mask-size: 100% 100%` with `preserveAspectRatio='none'`; one mask per element class, with a viewBox at that class's typical aspect so the stroke weight does not visibly distort.

Applied to: the HUD value blocks, the buffer frame, every `button` and picker on the calm screens, the title sign (§5.1). Not applied to the reticle, which stays geometric: it is a targeting system, not a brush mark.

Two cheaper tears, no SVG: the solid cyan tab's trailing edge becomes a `clip-path` polygon (a torn edge, three notches), and the life pips get a slightly irregular `clip-path` quadrilateral in addition to their skew.

Brush chrome is **structure, not decoration**: it renders at every effects level. Only its glow scales, as today.

### 3.3 Scale

Shipped words are a fixed 40px regardless of window size, which is exactly the floor below which the chromatic split switches off (`CHROMATIC_SPLIT_MIN_FONT_SIZE`). On a 1440p or ultrawide window they shrink to annotation.

One pure function in `src/design/scale.ts`:

```
playScale(playfieldHeightPx) → { wordPx, floorPx, hudScale }
  wordPx   = clamp(44, round(playfieldHeightPx × 0.0756), 72)   // 0.065 of the window; 52 at 800 tall
  floorPx  = round(brushStroke.HEIGHT × wordPx / 40)       // 34 at 52
  hudScale = 1.15
```

- `wordPx` feeds `WordSprite`'s style (replacing the literal 40), the recall-mode hint scales with it (26 → `wordPx × 0.65`), and the reticle and underline clearance already derive from the sprite's bounds.
- `floorPx` is passed as the `height` option the stroke generator already accepts; the floor's proportions are preserved by construction (see the generator's own comment).
- `GameScreen` writes `--size-word-play` and `--hud-scale` as inline custom properties on the game screen root on mount and resize, from the same function, so the buffer kana (`--size-word-play`) and the HUD type (`calc(token × var(--hud-scale))`) scale with Pixi from one source of truth. Micro-labels scale too (11 → 12.65px); they never go below the 11px floor.
- The minimum of 44 keeps the chromatic split on at `effects: 'full'` at every window size.

Lanes are unchanged (`LANES`, five at 17% pitch). At 1280 wide and 52px, four-character words fit the pitch with ten pixels to spare; at the 44px floor on a 1024-wide window they touch. Accepted: the collision needs two adjacent lanes occupied at the same height by long words, and four-kanji cards are rare in the corpus.

### 3.4 The machine band

The shipped game puts the typing buffer inside the playfield, so a word in the centre lane falls straight through it. The approved comp had it below the kill line. This spec restores the comp.

`.pixi-host` becomes `height: calc(100% − var(--size-machine-band))` with `--size-machine-band: clamp(72px, 14vh, 120px)`. A `.machine-band` element fills the remainder below it and holds the buffer. The floor stroke stays in Pixi at the host's bottom edge (`FLOOR_Y_RATIO` unchanged at 1.0); the 1px deadline sits on the boundary; the cyan underglow is CSS on the band, rising from its bottom edge. The engine's `y ≥ 1` landing rule is unaffected: the kill line is still the host's bottom edge, now 14% higher on screen, and because fall speed is in normalized units the fall *time* is unchanged. Only the pixel speed drops.

The band is the machine: the buffer and, on the title and chooser, the controls live there (§5).

### 3.5 Token additions

`src/ui/tokens.css`, mirrored in TS where Pixi needs them, parity-tested as today:

- Colours (derived, rgba, excluded from hex parity like `--color-surface`): `--color-ground-wash: rgba(110,130,180,0.12)`, `--color-ground-wash-deep: rgba(90,100,140,0.11)`. They are ground-family; they never appear on text or chrome.
- Sizes: `--size-machine-band` (§3.4). `--size-word-play` and `--hud-scale` are written at runtime (§3.3), declared with defaults of 52px and 1.15.
- Motion: §4.2.

## 4. Motion language

### 4.1 The grammar

**Ink is the body, neon is the light.** Forms move like ink: they bleed in from blur, splatter, drip, drain. Light moves like neon: it flickers on, flares, pulses once. Every moment below is built from those two vocabularies and nothing else. A new moment added later must be describable in them.

Two constraints hold everywhere. Nothing decorative may flash more than three times per event or last longer than 300ms per step, and every flicker is gone at `effects: 'reduced'`, which `prefers-reduced-motion` already selects by default. Anything that conveys state keeps its first-spec behaviour at every level.

### 4.2 Motion tokens

Added to `tokens.css`, mirrored in `src/design/motion.ts`, with the parity test extended to parse `--duration-*` and `--ease-*`:

| Token | Value | Used for |
|---|---|---|
| `--duration-bleed` | 260ms | Spawn bleed-in, header bleed, control stagger |
| `--duration-snap` | 90ms | One flicker step (lock, spawn halo, transition settle) |
| `--duration-slash` | 120ms | The kill slash drawing itself |
| `--duration-flare` | 420ms | Kill flare, impact glow |
| `--duration-burst` | 480ms | Droplet life (splatter and splash) |
| `--duration-transition` | 360ms | Screen crossfade |
| `--duration-beat` | 1200ms | The wave-start beat, end to end |
| `--ease-ink` | cubic-bezier(0.15, 0.85, 0.35, 1) | Forms arriving: decelerating |
| `--ease-drain` | cubic-bezier(0.6, 0, 0.9, 0.6) | Forms leaving: accelerating |

The existing `--duration-fast/base/slow` stay for the UI transitions that already use them. Flicker is not an easing; it is a stepped keyframe over `--duration-snap` multiples.

### 4.3 Moments of play

All in `PixiStage`, as passive consumers of the same engine events it already consumes (`wordKilled`, `wordMissed`, `waveCleared`) plus the per-frame `sync`. Pure helpers are split out and tested without a canvas, as the particle simulation already is.

**Spawn** (decoration). Over `--duration-bleed`: alpha 0 → 1 with a `BlurFilter` on the sprite from 8px to 0, then the filter is removed. The halo runs a three-step flicker (1, 0.3, 1) inside the first two snap steps. Reduced: alpha only, no blur, no flicker. Off: appear. If more than four words are bleeding at once the fifth and later skip the blur, so late waves cannot stack filters.

**Lock** (state + decoration). The reticle and underline snap on at full alpha, as today; that is the state. Decoration at full only: a two-step flicker (0.9, 0.2, 0.9) over two snap steps.

**Kill** (decoration; the word's removal is the state and is instant). Three things at once:
- *Slash.* A brush-stroke sprite from `loadBrushTexture` in `--color-ink`, 2.6 word-heights long, rotated −16°, anchored at its left end at the word's left edge. `scaleX` 0 → 1 over `--duration-slash` with `--ease-ink`, holds one snap step, fades over two. The existing cyan glow filter lights it.
- *Splatter.* The existing burst (`killBurstBase`, `burstCount`, the pure `particleSim.ts` — all untouched) draws droplets instead of circles: irregular four-point polygons, 2–5px, `--color-ink` with every second one tinted toward `--color-system`. The droplet shape is a pure function of the particle's seed.
- *Flare.* A radial sprite (generated gradient texture: ink core, cyan edge, transparent rim) at the word's centre, scale 0.1 → 1.7, alpha 1 → 0 over `--duration-flare`, behind the word layer.

Reduced: splatter halved (existing), flare at half alpha, slash unchanged. Off: none. The combo pop in the HUD is unchanged.

**Approach** (decoration). `approachProgress(y) = clamp((y − 0.8) / 0.2, 0, 1)` as a pure function in `src/render/approach.ts`. With progress, the word's halo colour lerps from `--color-system` toward `--color-danger` (`approachTint(progress)`, pure, returning a palette number), and a swell sprite under the floor at the word's x grows from `scaleX` 0.2 to 1 in `--color-danger` at 60% alpha, blurred. The swell is removed on kill or miss. Both are decoration: the floor and the deadline are the state, and position is already the signal, so §9.4 is satisfied without the tint. Reduced: tint only, no swell. Off: none.

**Miss** (state + decoration). State, unchanged: the pip drops to 16% alpha, the reveal text (`kanji kana — gloss`) appears on its vermillion underline for 1600ms. Decoration, in order:
- *Splash.* Seven droplets in `--color-danger` from the impact point on the floor, with upward initial velocity, life `--duration-burst`. `stepParticles` already integrates gravity, so they rise and fall with no change to the simulation; only the spawn velocities differ from the kill burst's.
- *Impact glow.* A radial sprite on the floor at the impact x, `scaleX` 0.5 → 1.4, alpha 1 → 0 over `--duration-flare`.
- *Deadline flicker.* The deadline's alpha 0.45 → 1 → 0.45 → 1 → 0.45 over three snap steps.
- *Shake.* 2px for 150ms, down from the juice pass's 4px. The grammar wants a short jolt, not a hit.

Reduced: splash halved (existing), glow at half alpha, no flicker, no shake (existing). Off: state only.

**Wave clear.** The existing confetti sweep, recoloured in the first pass, is unchanged.

### 4.4 Screen transitions

Screens change by hard cut today (`App.tsx` renders one screen per `useState` value). This spec adds one `ScreenTransition` wrapper around that switch, and the same transition is used in every direction: title ⇄ chooser, chooser → game, game → title, title ⇄ stats/settings, chooser ⇄ import. Results and the chooser's load error are states inside the game and chooser screens (`App.tsx` has no screen value for either), not screen switches, so they do not transition; the results screen's Title button is the game → title switch.

Behaviour over `--duration-transition`:
- The outgoing screen stays mounted in an absolutely positioned layer with `pointer-events: none` and `inert`, and drains: `filter: blur(0 → 12px)`, opacity 1 → 0, `--ease-drain`.
- The incoming screen mounts immediately and receives focus immediately (keyboard-first: a key pressed during the crossfade reaches the new screen). It bleeds in: `filter: blur(12px → 0)`, opacity 0 → 1, `--ease-ink`, then at full one brightness flicker (2, 0.5, 1) over two snap steps as it settles.
- The atmosphere (§3.1) is outside the wrapper and does not crossfade with itself; only its `data-scene` changes.

The game screen is a special case only in that its Pixi canvas is created on mount: the host element is what bleeds in, so the canvas is already live under the blur. The ceremony overlay is not a screen; it keeps its own arrival animation.

Reduced: crossfade without blur or flicker. Off: a 120ms crossfade (`--duration-fast`). Never a cut: the cut was the problem.

### 4.5 The wave-start beat

A wave begins today with the HUD label changing. The engine already pauses into `waveIntro` at every wave start (`pauseOnWaveStart`), and the ceremony overlay calls `resume()` when it is done. The beat slots in behind the ceremony and owns the last `--duration-beat` of that pause:

1. The playfield is live but empty. 第N波 in `--font-display` at 2.6× the word size bleeds in at the centre over `--duration-bleed`, with `wave NN` in `--font-mono` accent beneath it.
2. A band of light, 22% of the playfield high, blurred, in `--color-system`, rises from the floor to the top over 700ms and fades as it goes.
3. The header holds, then drains over `--duration-bleed` as the HUD's own wave label (hidden until now) bleeds in.
4. Words arrive after the beat.

**Amended 2026-10-07, during planning (Task 11).** Ordering inside the pause: ceremonies for any new cards first, then the beat, then `resume()` — the beat is what finally resumes. The spec originally put the beat first; the keystone e2e's ceremony loop (`clearCeremony`) exits as soon as no ceremony is visible, so a beat-first order would have ended it before the ceremony appeared, and the flow must stay untouched. Narratively it also reads better: learn the words, then the wave announces itself. The app always runs with the wave pause on (`useEngine.start` is never called with `introduceWords: false`), so every wave gets the beat; a hypothetical no-pause run would show only the HUD label appearing.

The wave number is state: at `off` the header simply appears in its slot. At `reduced`: the header fades in at the centre and out again, no light sweep.

## 5. First impression

### 5.1 The title

**Amends the first spec's §8.** The title and the run chooser are reclassified from calm screens to arcade screens: they get the hazard stripe, the floor, the machine band and the atmosphere. Stats, Settings, Import, Results and the error screen remain calm.

Structure, top to bottom:
- The hazard stripe.
- The atmosphere (§3.1) in its title scene: the three ghost glyphs plus **six ghost words falling** in the outer lanes, at 6%, 13%, 21%, 79%, 85% and 94% of the width, so none can ever pass behind the sign or the controls. Each is `--font-word` at the play word size, `--color-ink` at 16% alpha, `filter: blur(0.5px)`, falling over 14–19s on staggered offsets, and dissolving into a gradient band just above the floor. They are a fixed ambient list (雨 勉強 光 図書館 女 犬), never the live deck. Six is the ceiling; four is the next stop down if it reads as busy.
- **The sign**, centred with its copy in the stage above the band, landing at about a third of the height: a brush-edged frame (§3.2) with four reticle corners reused from `reticleBrackets`' geometry, containing "KanjiFall" in `--font-display` at `--text-3xl × 1.3`, the cyan brush stroke at the sign's full width, and 漢字落 in `--font-display` at `--text-lg` with 0.42em tracking. On mount at full the sign **flickers on** like a tube over 520ms (a stepped brightness keyframe of three steps — 0.1, 2, 0.4, 1 — starting after the screen transition has settled, so it never stacks with the transition's own flicker; §7.7). Reduced: bleeds in. Off: appears.
- Tagline and the keyboard hint, as today, bleeding in after the sign on `--duration-bleed` with an 80ms stagger.
- **The floor stroke raised to a horizon** at 30% from the bottom, with the deadline beneath it and the underglow filling the machine band.
- The machine band holds the three controls in a row: Start (primary, solid tab with the torn edge), Stats, Settings (brush-edged). They bleed in last.

### 5.2 The run chooser

The setup screen inherits the title's structure: hazard stripe, atmosphere with the ghost words at half opacity, floor horizon and machine band. "Choose your run" is set in `--font-display`. Mode cards and level pickers get the brush-edged frame; the selected one keeps its solid-tab treatment. Begin and Back live in the band. No sign.

### 5.3 The wordmark and the favicon

漢字落 is the identity's Japanese wordmark and appears only on the title sign and in the README. `public/favicon.svg` becomes 落 in the display face, as a committed SVG path (generated once by `scripts/build-favicon.mjs` from the Fontsource WOFF with opentype.js; deterministic, re-run only if the face changes), filled `--color-ink` with a `--color-system` edge, on `--color-ground`. The first spec's deferred wordmark question is closed by this.

## 6. Effects and settings contract

No new settings. Everything maps onto `effects: 'full' | 'reduced' | 'off'` and `crt` from `settings.ts`, under the first spec's rule: **anything that conveys game state renders at every level; only decoration scales.** The `visualParams` mapping grows new fields; the table is the test's oracle.

| Element | Kind | `full` | `reduced` | `off` |
|---|---|---|---|---|
| Atmosphere washes, shaft, vignette, sumi | decoration | On | Half opacity | Off |
| Ghost glyphs (game) | decoration | Drift | Static, half | Off |
| Ghost words falling (title, chooser) | decoration | Fall | Static, half opacity | Off |
| Brush-edged chrome | structure | Glow | Flat | Flat |
| Spawn bleed / halo flicker | decoration | Both | Alpha only | Appear |
| Lock reticle + underline | state | Snap + flicker | Snap | Snap |
| Slash / splatter / flare | decoration | All | Slash, half splatter, half flare | None |
| Approach tint / swell | decoration | Both | Tint | None |
| Miss splash / impact glow | decoration | Both | Half / half | None |
| Deadline flicker / shake | decoration | Both | None | None |
| Miss reveal text, pip change | state | On | On | On |
| Screen transition | decoration | Bleed + flicker | Crossfade | 120ms crossfade |
| Wave header | state | Centre beat + slot | Centre fade + slot | Slot only |
| Wave light sweep | decoration | On | Off | Off |
| Title sign flicker / stagger | decoration | Both | Bleed, no stagger | Appear |
| Bloom, CRT, screen shake amplitude policy, particle counts | existing | As juice pass, except shake is now 2px | As juice pass | As juice pass |

`prefers-reduced-motion` continues to default `effects` to `reduced` at first run, which removes every flicker and every blur.

## 7. Legibility rules

The first spec's §9 stands in full. Two additions:

6. **The atmosphere never competes.** No depth layer may exceed the brightness ceiling in §3.1, and nothing in the depth layer may be a letterform that could be mistaken for a live card. The ghost set is fixed and blurred for that reason.
7. **A flicker is a single event.** At most three brightness steps, under 300ms per step, never repeating, and never at `reduced` or `off`.

## 8. Implementation shape

Six phases, each leaving the game shippable:

1. **Foundations.** Motion tokens and `motion.ts` with parity; `scale.ts` and the runtime custom properties; the machine-band layout (§3.4); `brushFrameDataUri` and the brush-edged chrome on the HUD and calm-screen controls. Visible change: bigger words, buffer below the floor, brush borders.
2. **Atmosphere.** The persistent root layer, its scenes, the ghost glyphs, stacking verified below the canvas.
3. **Moments.** Spawn, lock flicker, kill (slash, droplets, flare), approach, miss (splash, impact glow, deadline flicker, 2px shake), wired to `visualParams`.
4. **Transitions and the wave beat.** `ScreenTransition` in `App.tsx`; `WaveStart` overlay in `GameScreen` and its ordering with the ceremony.
5. **First impression.** Title, chooser, favicon script and asset.
6. **Effects and a11y pass.** Every row of §6 at every level × `crt`, the `prefers-reduced-motion` pass, the §9 stroke-detail screenshot at the new word size with the atmosphere on, and the README screenshots refreshed.

Files touched: `src/ui/tokens.css`, `src/design/{motion,scale,visualParams}.ts` and their tests, `src/render/{PixiStage,WordSprite,Particles,particleSim,brushStroke}.ts`, new `src/render/approach.ts`, `src/ui/hud/Hud.tsx`, `src/ui/screens/{GameScreen,TitleScreen,SetupScreen}.tsx`, new `src/ui/{Atmosphere,ScreenTransition,WaveStart}.tsx`, `src/App.tsx`, `src/index.css`, `public/favicon.svg`, new `scripts/build-favicon.mjs`, `README.md` screenshots.

## 9. Testing

- **Unit.** Token parity extended to `--duration-*` and `--ease-*`. `playScale` per height including both clamp ends. `approachProgress` and `approachTint` at 0, mid, 1. `visualParams` per level for every new field against §6. Droplet shape as a pure function of seed. The splash's upward spawn velocities, asserting that `stepParticles` brings them back down within `--duration-burst`. `brushFrameDataUri` output stable for a seed. Existing `particleSim`, `reticle`, `filters` tests stay green untouched.
- **Component.** `ScreenTransition` with fake timers: outgoing layer present for the duration then gone, incoming screen focused immediately, `inert` on the outgoing layer. `WaveStart` with fake timers: header visible, then slot label visible, `resume` called once and only after the beat, and after any ceremony. `Hud` tests pass against restyled markup; the pip-count assertion from the first spec stays. `TitleScreen` renders six ghost words from the fixed list and none from any deck.
- **E2E.** The keystone Playwright flow is untouched and must stay green. The transition must not swallow the first keystroke after Begin; the keystone flow is the check.
- **Manual QA checklist.** Every screen at full/reduced/off × crt on/off, plus the `prefers-reduced-motion` pass, in the same shape as the first spec's checklist; plus one late-wave pass (wave 10+) watching frame time with the atmosphere on.
- **Legibility check.** The first spec's N2-density screenshot comparison (議 職 験) repeated at 52px with the atmosphere on, at each effects level.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Blur filters on many simultaneous spawns cost frames in late waves | Cap at four concurrent bleeds (§4.3); the late-wave QA pass measures it; fall back to alpha-only if it drops frames |
| Three blurred atmosphere layers cost compositor time | Transform-only animation on promoted layers so blur rasterizes once; static shaft and vignette; measured in the same pass |
| Atmosphere paints over the canvas, like the grain once did | Stacking verified visually in phase 2 with the same rule the first spec recorded for `.pixi-host canvas` |
| Three effects on every kill read as noise after forty kills | Droplet count is the knob; the slash and flare stay |
| Flicker and photosensitivity | §7.7: one event, three steps, under 300ms, gone at reduced; reduced is the `prefers-reduced-motion` default |
| The transition eats a keystroke | Incoming screen receives focus at mount; keystone e2e covers Begin → first word |
| Four-kanji words touch at the 44px floor on small windows | Accepted (§3.3); needs two adjacent long words at one height |
| Ghost words on the title compete with the sign | Outer lanes only, 16% alpha, fixed list; six is the ceiling |
| The favicon script introduces a Node-only dependency | Dev dependency, run once, output committed; the app never runs it |

## 11. Deferred

- **Sound** for the slash, the splash and the wave beat. The juice pass owns SFX; a follow-up there can key off the same events.
- **Results-screen celebration** in the new grammar (the tier banner and confetti still use the juice pass's CSS). Small, separate.
- **A full logotype** beyond type and stroke. 漢字落 and the 落 favicon close the first spec's deferral; a drawn mark is not needed now.
