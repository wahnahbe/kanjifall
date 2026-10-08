# Visual identity, second pass — QA checklist

Task 15 of `docs/superpowers/plans/2026-10-07-visual-identity-second-pass.md`.
Verifies spec `docs/superpowers/specs/2026-10-07-visual-identity-second-pass-design.md`
§6 (effects contract), §7 (legibility), §9 (testing) against the running app.

Browser: `kanjifall-e2e` (port 5183) only, via Playwright MCP — never the dev
config, which writes to the real study database.

**How this was walked (2026-10-07).** Every measurement ran against
`kanjifall-e2e` with its isolated `data/e2e.db`, at 1280×800 unless a row says
otherwise, with `?seed=42` (and `&mode=reading&pool=n5` where the game was
started from the URL). Playwright's own Chromium is not installed, so the
matrix was driven by temporary Playwright scripts on system Edge (headless),
and the late-wave frame timing ran in the Claude browser pane (a real,
GPU-composited Chromium). Effects levels were set through the Settings screen
for the matrix walk (title → Settings → level → Back, so every level also
re-entered the title through a transition); the legibility, brightness and
README runs set `kotoba-settings-v1` in `localStorage` before load. Numbers
come from the live objects, not from reading the code: computed styles and
`getAnimations()` for the DOM, and for Pixi a page-side wrapper around
`PixiStage`/`WordSprite` prototype methods (imported from `/src/render/…`,
the same module instances the app uses) that recorded per-frame alpha, blur,
filter lists, fx and particle counts. Nothing was added to the repository for
this; the probes lived only in the page.

**Re-walked after the fixes.** Five findings from the first walk were ruled
fixes (§5). After they landed, the whole §1 matrix was walked again at all
three levels, on a dev server restarted so the probes' module imports matched
the app's. The cells below record the re-walk: words are now 52px at
1280×800. The §7 stroke-detail and brightness rows, and the late-wave row,
were re-measured too. Where a cell changed, it says what it was before.

**On the evidence referenced below.** As with the first pass, the `*.png`
names are identifiers of screenshots examined at the time, kept in a scratch
directory outside the repository; they are not paths you can open. The
verdicts and the numbers recorded here are the durable record.

## 1. §6 effects contract — one row per table cell

| Element | Level | Expected | Observed | Result |
|---|---|---|---|---|
| Atmosphere washes, shaft, vignette, sumi | full | On, drifting | `--atmosphere-alpha` 1 and `.atmosphere-depth` opacity 1 on title, chooser and game; `atmosphere-sway` running on the system wash (46 s) and the cool wash (58 s), the deep wash static as specified. On Settings the scene is `calm` and the depth layer is at opacity 0. | PASS — `title-full.png`, `beat-full.png` |
| Atmosphere washes, shaft, vignette, sumi | reduced | Half opacity, static | `--atmosphere-alpha` 0.5, depth opacity 0.5, `data-drift="0"`, `getAnimations()` empty on all three washes. | PASS — `title-reduced.png` |
| Atmosphere washes, shaft, vignette, sumi | off | Absent | `--atmosphere-alpha` 0, depth opacity 0; only the ground gradient paints. | PASS — `title-off.png` |
| Ghost glyphs (game) | full / reduced / off | Drift / static half / absent | 言 葉 降 at 4.5% ink, blur 2.4px. 降 now sits left of the light shaft (F6). Full: `atmosphere-drift` (70 s) running in the game scene. Reduced: no animation, inside the 0.5 depth layer. Off: depth opacity 0. | PASS — `beat-full.png`, `miss-reduced.png`, `miss-off.png` |
| Ghost words falling (title, chooser) | full / reduced / off | Fall / static half opacity / absent (reduced amended by F5) | Six spans (雨 勉強 光 図書館 女 犬), never the deck. Full: colour alpha 0.16 on the title and 0.08 on the chooser, `title-fall` running (14–19 s). Reduced: `data-drift="0"`, 0.08 and 0.04, no animation, each held at its rest height (14 / 46 / 24 / 56 / 36 / 50% of the height). On a 2 s resample its computed `top` was unchanged. Off: not rendered (0 spans). First walk: still falling at reduced (F5). | PASS — `title-*.png`, `setup-*.png` |
| Brush-edged chrome | full / reduced / off | Present at every level; glow only at full | At all three levels the `::before` of Stats, Settings, Back, every picker, the HUD value boxes, the buffer and the title sign carries the brush SVG mask at `100% 100%` over a token colour; primaries carry the torn `clip-path`. Glow: `.hud-glow` at full only (value box-shadow 6px, buffer 8px, tab and live-pip drop-shadows); none at reduced or off. Stroke weight after F3: the wide mask is now 2.5:1. Measured on mask-only renders at 4×, the side-to-top ink ratio is 0.95 on Stats, 1.16 on Settings and 0.91 on Back; it was 0.49, 0.58 and 0.45. The narrow pickers stay at 1.14. Import… is 102×36 beside 55px list pickers; it was stretched to 55px. | PASS — `mask-*.png` |
| Spawn bleed + flicker | full / reduced / off | Blur+flicker / alpha only / appear | Full: `BlurFilter` 8px → 0 with alpha eased 0 → 1, filter removed at 258 ms; light × 0.3 for the second snap step (alpha 0.56 at 88 ms, 0.17 at 92 ms, 0.92 at 183 ms). Reduced: params `{ blurPx: 0, flicker: 0 }`, no filter, a plain alpha ramp. Off: `beginSpawn` never called; the first frame of the sprite is alpha 1 with no filter. | PASS |
| Lock reticle + underline | full / reduced / off | Snap+flicker / snap / snap — present at every level | Brackets and underline visible from the first frame at every level. Full: alpha 0.9 (0–90 ms) → 0.2 (90–180 ms) → 1, glow filter on. Reduced: alpha 1 throughout, glow on at 0.5. Off: alpha 1, no glow filter (flat). | PASS — `locked-*.png` |
| Slash / splatter / flare | full / reduced / off | All / slash, half, half / none | Full: the slash sprite is 135 × 26px at −16° for 52px words, which shows about 5px of dry-brush ink. scaleX goes 0 → 1 by 120 ms, holds, and fades by 390 ms. 10 droplets (combo 1). Flare alpha 1 → 0 while it scales up over 420 ms. Reduced: slash at alpha 1; 5 droplets; flare at half (0.43 at 62 ms against 0.86 at full). Off: no fx and 0 droplets; the word simply vanishes. First walk: a 117 × 5.4px sprite showing about 1px of ink, a hairline (F2). | PASS — `kill-*.png`, `judge-slash-crop.png` |
| Approach tint / swell | full / reduced / off | Both / tint only / none | Full: at y 0.85 the red-halo copy is at 0.50 over the base at 1 and the swell at 0.25; at y 0.93 hot 1, base 0.69, swell 0.65 and wider. Reduced: the same two-copy crossfade, no swell sprite. Off: no hot copy is ever built, no swell. | PASS — `approach-*.png` |
| Miss splash / impact glow | full / reduced / off | Both / half, half / none | Full: 7 droplets, impact glow (danger tint) 1 → 0 over 420 ms (0.76 at 100 ms). Reduced: 4 droplets, impact 0.38 at 100 ms. Off: 0 droplets, no impact sprite. | PASS — `miss-*.png` |
| Deadline flicker / shake (2px) | full / reduced / off | Both / none / none | Full: deadline alpha 0.45 (7–90 ms) → 1 (94–186 ms) → 0.45 (186–274 ms) → 1; stage jitter within ±2px (max 1.997) for 150 ms, then exactly (0, 0). Reduced and off: deadline at 1 and stage at (0, 0) on every frame. | PASS |
| Miss reveal text, pip change | full / reduced / off | Present at every level | The reveal (`一 いち — one` on its vermillion underline) is present for 1600 ms at every level, fading from 15% of its life; pips read 2 live / 1 spent (spent at 16% danger) at every level. | PASS — `miss-off.png` |
| Screen transition | full / reduced / off | Bleed+flicker / crossfade / 120ms crossfade — never a cut | Full: incoming `screen-bleed` 360 ms (opacity 0 → 1, blur 12 → 0) then `screen-settle` brightness 2 / 0.5 / 1 at 380 / 467 / 559 ms; outgoing `screen-drain` 360 ms, `inert` and `aria-hidden`; focus inside the incoming layer. Reduced: 360 ms crossfade, blur 0, no settle. Off: 120 ms crossfade, blur 0. Measured on Settings → title, title → chooser and chooser → game; the outgoing layer was present for every change, so none was a cut. The other directions go through the same `ScreenTransition` in `App.tsx`. | PASS |
| Wave header | full / reduced / off | Centre beat + slot / centre fade + slot / slot only | Full: 第1波 `wave-bleed` 260 ms, `wave-drain` from 940 ms; the HUD label is `hud-wave-hidden` for the whole beat and bleeds in from ~1.33 s. Reduced: `data-beat="fade"`, `wave-fade-in` / `wave-fade-out`, no blur. Off: no `wave-start` element; the HUD label (class `hud-wave`, no bleed class) is at opacity 1 within ~115 ms of the ceremony ending. | PASS — `beat-full.png`, `beat-reduced.png` |
| Wave light sweep | full / reduced / off | On / off / off | Full: `wave-sweep` 700 ms, displayed. Reduced: `display: none`. Off: not rendered. | PASS |
| Title sign flicker / stagger | full / reduced / off | Both / bleed, no stagger / appear | Full: `sign-on` 520 ms, delay 540 ms (`--transition-ms` + two snaps), brightness 0.1 → 2 → 0.4 → 1 with 129 / 133 ms steps, starting after the transition's settle had ended; tagline, hint and the three controls at 1060 / 1140 / 1220 / 1300 / 1380 ms (80 ms stagger). Reduced: sign `screen-bleed` 260 ms (opacity only), every copy delay 0. Off: no animation on the sign or the copy. | PASS — `title-*.png` |
| Existing: bloom, CRT, particle counts | each × crt on/off | As the juice pass | Toggled live at each level. Full: stage filters `[AdvancedBloom]` → `[AdvancedBloom, CRT]` with crt on → back; floor `GlowFilter`; grain 1. Reduced: `[]` → `[CRT]`; floor glow at 0.5; grain 0.5. Off: `[]` → `[CRT]`; floor flat (no filter); grain 0. Kill burst 10 / 5 / 0 and splash 7 / 4 / 0 droplets; shake 2px at full only. | PASS — `crt-*.png` |

## 2. §7 legibility

| Check | Expected | Observed | Result |
|---|---|---|---|
| 議 職 験 at 52px, atmosphere on, each level | Stroke detail unambiguous; words brightest on screen | Re-measured after F1 at 1280×800, where the words are now 52px (sprite `wordPx` 52, `--size-word-play` 52px). One single-word QA list per target in the e2e DB, so wave 1 always spawns it. Each word was captured mid-fall (y ≈ 0.30) over the atmosphere at full, reduced and off, and cropped at 4× nearest-neighbour. 議: the 言 bars and the 我 hooks separate. 職: the 耳 rungs and 戈 separate. 験: the four dots of 馬 separate and stay countable under the chromatic split at full. Ink (Y ≈ 0.88) is the brightest thing on screen; the brightest atmosphere pixel is Y 0.017. The first walk checked 45px at 1280×800 and 52px at 1280×920, with the same result. | PASS (eyeballed from the crops) — `legib-{full,reduced,off}-800-{議,職,験}.png` |
| Depth-layer luminance over the ground | ≤ ~8% at the brightest point (sample the shaft's base) | Metric: WCAG relative luminance Y (the luminance the first pass's contrast checks use), per pixel, ΔY = Y(level) − Y(off), on an atmosphere-only frame (screen content hidden) at 1280×800, with the washes at both ends of their drift. Re-sampled after F6 moved 降 off the shaft. Shaft base (640, 684): +0.74 points of luminance (Y 0.0024 → 0.0098). Brightest wash (cool, 1100, 450): +0.55. Brightest point anywhere: +1.3, inside the shaft's lower body (at the drift's start) or at its edge over the cool wash (at the drift's end). Reduced: +0.51 at most. In CIE lightness for reference: shaft base ΔL* 6.6, maximum ΔL* 10.2. First walk: +1.9 (ΔL* 13.6) at the 降 glyph where it crossed the shaft (F6). | PASS (≤ 8% luminance with a wide margin) — `atmos-full-start.png`, `atmos-full-end.png` |
| Any flicker, each level | ≤ 3 steps, ≤ 300ms each, none at reduced/off | Every flicker in the build, measured at full: screen settle 2 / 0.5 / 1 (≈ 90 ms steps); title sign 0.1 / 2 / 0.4 / 1 (130 ms); spawn light 1 / 0.3 / 1 (90 ms); lock 0.9 / 0.2 / 1 (90 ms); deadline 0.45 / 1 / 0.45 / 1 (≈ 90 ms). Each is one event per trigger and never repeats. At reduced and off: no `screen-settle`, no `sign-on`, spawn and lock alpha never dip, the deadline never leaves 1. | PASS |

## 3. prefers-reduced-motion

| Check | Expected | Observed | Result |
|---|---|---|---|
| First run with the media query on | effects defaults to reduced: no blur, no flicker, no shake | Edge with `reducedMotion: 'reduce'` and empty storage: `matchMedia` true, `kotoba-settings-v1` absent (the default is not persisted), `getSettings().effects` is `reduced`, and Settings shows `reduced` selected. Title `data-flicker="0"`, the sign bleeds by opacity only; transition blur 0px and no settle; spawn params `{ blurPx: 0, flicker: 0 }` with no `BlurFilter`; `shakePx` 0; washes static. After F5, re-checked: `drift` 0. The title ghosts are `data-drift="0"` with no animation, resting at 112–448px. The only animations running on the title were the finite 260 ms entrance bleeds, so nothing on the first two screens moves continuously. | PASS — `rm-title.png`. This closes the first pass's stated gap (it could not emulate the media query). |

## 4. Late-wave frame time

| Check | Expected | Observed | Result |
|---|---|---|---|
| Wave 10+, effects full, 1280×800 | No sustained drop below 55fps; ≤ 4 concurrent spawn blurs | Played through at the real constants (no tuning edit): an in-page autoplayer escaped ceremonies and typed readings, reaching wave 10 at 216 s with all lives. Re-measured after the fixes, with 52px words and the thicker slash: 30 s of `playing` frames over waves 10–11 in the browser pane (GPU-composited, emulated 1280×800, 144 Hz display). 4319 frames; every one-second window at 143–144fps; slowest frame 16.7 ms (once); p99 8.5 ms; 0 frames over 18.2 ms. Load in the window: 89 kills including four bursts of 3–4 simultaneous kills (up to 9 live fx and 136 droplets), and 4 lazy hot-copy builds. None of it caused a sustained drop. First walk (45px words): 4320 frames, all windows at 144fps, slowest 9.5 ms. Natural play never had more than one bleed at a time (spawns are at least 1.2 s apart; a bleed lasts 260 ms), so the cap was exercised directly: 8 new 52px words in one `sync` → 4 with a `BlurFilter`, 4 alpha-only. | PASS |

## 5. Fixes landed during this pass

No cell in §1–§4 failed on the first walk. Six of the deviations it recorded
in §6 were then ruled on: F1, F2, F3, F5 and F6 as fixes, F4 as a spec
amendment. Each fix is its own commit, with its covering tests re-run and
`npm run check` green after it:

- `d012424` fix: play scale gives 52px words at an 800px-tall window (F1).
  `WORD_HEIGHT_RATIO` 0.065 → 0.0756, because the playfield is the window
  minus the 14% band. Covering: `scale.test.ts` (688 → 52px, floor 34, both
  clamp ends) and `GameScreen.scale.test.tsx` (1000px → 72px). All three
  changed assertions failed against the old ratio.
- `213381f` fix: kill slash reads as a brush cut, not a hairline (F2).
  `SLASH_THICKNESS_RATIO` 0.5 and `SLASH_MIN_THICKNESS_PX` 8, beside
  `SLASH_STROKE_OPTIONS`. No unit test pins a Pixi sprite's size, so this was
  confirmed in the browser: a 26px sprite with about 5px of ink at 52px
  words (`judge-slash-crop.png`). `killFx.test.ts` and
  `presenceInvariant.test.ts` were re-run.
- `92103fd` fix: wide brush frame matches its controls' aspect so strokes
  keep their weight (F3). `--brush-frame-wide` 200×40 → 100×40, and a plain
  button in a picker row centres instead of stretching. Covering:
  `brushChrome.test.ts`, `brushFrame.test.ts`, the SetupScreen tests. The
  stroke weights were measured as in the brush-edged chrome row.
- `5a2e0f4` fix: title and chooser ghost words hold still at reduced motion
  (F5). `visualParams.drift` is 1 / 0 / 0. `Atmosphere` and `TitleGhosts`
  read it, and at drift 0 the ghosts rest at `REST_TOP_PCT`. Covering:
  `visualParams.test.ts` (three objects plus a drift line), `Atmosphere.test.tsx`
  and a new `TitleScreen.test.tsx` case (reduced → `data-drift="0"`, each
  ghost carries its `--rest-top`).
- `d26065c` fix: the 降 ghost glyph sits off the light shaft (F6). 34% → 18%.
  Covering: `Atmosphere.test.tsx`. The brightness ceiling was re-sampled (§2).

F4 (the sign's height) is a spec amendment only, landed with this
checklist. F7 and F8 are deferred: both pre-date this pass.

## 6. Findings from the first walk

The finding and the recommendation are as recorded on the first walk; the
Status column says what became of each.

| # | Finding | Recommendation | Status |
|---|---|---|---|
| F1 | At the 1280×800 reference window words are **45px**, not the 52px (+30%) the decisions log and §3.3 name: `playScale` is keyed on the playfield, which is the window minus the machine band (688px at 800 tall). 52px needs a ~920px-tall window. | Decide what "52 at 800 tall" meant. If the +30% intent stands, key `playScale` on the game-screen height (or raise `WORD_HEIGHT_RATIO` to ≈ 0.0756), then recheck Task 3's buffer-fits-band arithmetic. Otherwise amend §3.3. | **Resolved** — `d012424`: ratio 0.0756 on the playfield, i.e. 0.065 of the window; §3.3's formula amended. The buffer still fits the band at every height (the buffer is `wordPx + 18`, the band `clamp(72, 14vh, 120)`): band 72 → wordPx 44 → buffer 62; in the 14vh range wordPx ≈ 0.065H against a 0.14H band; band 120 → wordPx ≤ 72 → buffer ≤ 90. |
| F2 | The kill slash reads as a hairline cut, not a brush slash. The sprite is `max(4, 0.12 × wordPx)` = 5.4px tall at 45px, and `brushStrokeDataUri` keeps the floor's proportions, a painted bar 5/26 of the canvas height, so about 1px of ink plus raggedness shows (`judge-slash-crop.png`). The flare and the droplets carry the kill. | Tuning: about 0.25 × wordPx for the slash height, or a slash texture whose painted bar fills more of its canvas. | **Resolved** — `213381f`: half a word-height, at least 8px. Re-measured at 52px: a 26px sprite with about 5px of ragged dry-brush ink, read as a brush cut (`judge-slash-crop.png`, `judge-burst.png`). |
| F3 | `--brush-frame-wide` is a 200×40 (5:1) mask, but most of its users are 2–3:1 (Back 82×36, Stats 84×36, Settings 104×36, HUD values ~72×36). Stretched to `100% 100%`, the side strokes render 1.7–2.7× thinner than the top and bottom (the ratio of the two scale factors), and the top and bottom noise is squeezed sideways. The chooser's Import… button is also stretched to 102×55 by its row's default `align-items: stretch`. Visible at 4×, subtle at 1×. The narrow pickers the ledger asked about are fine: 136×36 on the 260×70 tall mask (3.8 vs 3.7). | A mask at ~2.5:1 (e.g. 100×40) for buttons and HUD values, and `align-self: center` on the Import button. | **Resolved** — `92103fd`: wide mask 100×40, and plain buttons centre in picker rows. Side-to-top ink ratio is now 0.91–1.16 on Back, Stats and Settings (was 0.45–0.58); Import… is 102×36. |
| F4 | The title sign centres at **31%** of the height, not the spec's 37%: the sign and its copy are centred as a group in the stage above the 30% band. | Keep 31% and amend §5.1. Moving the sign down 6% (29px at 480 tall) would shrink the hint-to-floor gap on short windows from 32px to ~3px (800×480), which is already the known tight spot. | **Resolved (spec)** — 31% kept. §5.1 now reads "centred with its copy in the stage above the band, landing at about a third of the height". |
| F5 | At reduced, the default under `prefers-reduced-motion`, the title and chooser ghost words keep falling (§6 asks only for half opacity). The game's ghost glyphs, by contrast, are static at reduced. | Consider "static, half" for the falling ghosts at reduced, so a reduced-motion first run has no continuous motion on its first two screens. This changes the §6 row. | **Resolved** — `5a2e0f4`: `visualParams.drift`, ghosts rest at reduced; the spec §6 reduced cell now reads "Static, half opacity". |
| F6 | The brightest depth-layer point is the 降 ghost glyph where it crosses the light shaft (ΔY +1.9 points of luminance, ΔL* 13.6, centre-left of the playfield). It passes the luminance ceiling and is blurred, faint and 3× word size, but it is the one place where a letterform is the brightest thing in the depth layer. | Optional: move 降 off the shaft (e.g. `left: 20%`) or let the shaft fade out below it. | **Resolved** — `d26065c`: 降 at `left: 18%`. The maximum lift is now +1.3 points (ΔL* 10.2), and it is the shaft itself. |
| F7 | Pre-existing, not from this pass: centre-lane words spawn under the HUD wave header and overlap 第N波 for about the first second of their fall (visible in `legib-*-920.png`). The +30% words make it a little larger than in the first pass. | Low; a spawn y below the header, or a header that ducks, if it ever matters. | **Deferred: pre-existing.** |
| F8 | Pre-existing (juice pass, 2026-08-08), outside this pass's contract: two renderer paths still branch on `effects` directly: the `×N!` combo flash in `PixiStage.playKill` and the particle counts via `burstCount` in `Particles`. | Fold them into `visualParams` the next time either is touched. | **Deferred: pre-existing.** |

## 7. Judgements the ledger asked for

- **Ghost density on the title.** Six reads calm at 1280×800: the ghosts sit in
  the outer lanes at 16% and never reach the sign or the controls. Keep six.
- **The sign's vertical placement.** See F4: kept at ~31%; the spec is
  amended.
- **Slash thickness at small word sizes.** On the first walk, a hairline
  (F2). Fixed: the sprite is half a word-height tall, never under 8px, so
  22px at the 44px floor; at 52px words it shows about 5px of ink.
- **Brush masks on off-aspect boxes.** Narrow pickers are fine. The short
  buttons and HUD values were the ones that distorted (F3); with the 2.5:1
  mask, Back, Stats and Settings are within 1.2× side to top.
- **The kill's three stacked effects at a high kill rate.** A 4-word burst
  frozen at +120 ms (`judge-burst.png`) reads as four distinct
  flare + slash + splatter clusters, not as noise. Keep; the droplet count
  stays the knob.
- **Known cosmetic items, confirmed cosmetic.** 図書館 in the 94% lane clips at
  the right edge on narrower windows (clearly at 960 wide, ~1px at 1280).
  The title hint sits 10px above the floor box at 534×417 (32px at 800×480,
  74px at 960×600). The HUD wave label starts its bleed 12–13ms after the
  header finishes draining at full and reduced (measured; the ledger
  estimated ~40ms). None of them hides or misstates state.

## 8. `npm run check` / e2e

At the final tree, after the five fixes:

```
$ npm run check
tsc -b && oxlint && vitest run --passWithNoTests
 Test Files  75 passed (75)
      Tests  526 passed (526)

$ npx playwright test -c playwright.edge.tmp.config.ts   # repo config + use.channel 'msedge'; temporary, deleted
Running 3 tests using 2 workers
  ok 2 e2e\game.spec.ts:106:1 › reading mode: intro → dismiss → type reading → kill scores (17.1s)
  ok 1 e2e\import.spec.ts:101:1 › import a list and play it: ceremony, kill, persistence (17.1s)
  ok 3 e2e\game.spec.ts:158:1 › recall mode: gloss prompt still killed by typing the reading (2.3s)
  3 passed (21.6s)
```

`npm run e2e` as written needs Playwright's Chromium, which is not installed
on this machine (`npx playwright install chromium` is a download). The same
suite was run against system Edge through a temporary config that spreads
`playwright.config.ts` and sets `use.channel = 'msedge'`. No `concurrently`,
`tsx` or `vite` process pointing into the worktree was left running before
or after the run.
