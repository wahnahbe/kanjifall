# Visual Identity — Design Spec

**Date:** 2026-08-15
**Status:** Approved, not yet implemented
**Scope:** A full art-direction pass over every surface: design tokens, self-hosted typography, the Pixi playfield, the HUD, and the calm screens (title, setup, stats, settings, results, ceremony, import, errors). No engine, data, or server changes.
**Builds on:** `2026-08-08-juice-pass-design.md` — this spec inherits its effects/settings contract (§3.1, §5.1) and its load-bearing boundary: the Pixi layer, React HUD, and audio are passive consumers of engine events. Nothing here touches a game rule.

## 1. Purpose

The game plays well and looks unfinished.

Five milestones produced a correct, honest, well-tested game. But nothing has ever been art-directed: every surface uses the browser's default type at default sizes, ~25 hex literals are scattered across CSS and TypeScript with no scale behind them, the playfield is a flat fill with no floor, and the HUD reads as debug output. The juice pass gave the game motion; it never gave it a look.

This spec commits KanjiFall to one visual identity — **brushed ink lit as neon** — and defines the token layer, type system, and rendering rules that make it reproducible rather than a set of one-off tweaks.

### Non-goals

- **Engine, data, or server changes.** Zero. This is presentation only.
- **New gameplay affordances.** The reticle and floor make existing state *visible*; they do not add mechanics.
- **Illustration or sprite art.** No character art, no backgrounds-as-images. Everything is procedural except fonts and one noise tile.
- **Audio.** The juice pass owns SFX. Untouched.
- **Layout re-architecture of Stats.** Its charts and sections keep their current structure; only its presentation changes.
- **Responsive/mobile.** The game is keyboard-first on a desktop browser. Out of scope, as today.

## 2. Decisions log

| Decision | Choice | Why |
|---|---|---|
| Direction | Brushed ink lit as neon — sumi-e forms, Night City chrome | Chosen from live comps over pure ink, pure synthwave, and calm-studio alternatives |
| Palette basis | Cyberpunk 2077's yellow/black/red, **not** synthwave cyan/magenta | The user's stated reference; 2077's real signature is hazard yellow and hard chrome |
| Colour order | Ink white → cyan → vermillion → hazard yellow → ground | Approved explicitly; yellow demoted from dominant to accent |
| Chrome layout | The "Night City Dojo" HUD: hazard stripe, tab+value blocks, corner reticle, skewed pips, framed buffer | Approved explicitly |
| Falling-word face | Shippori Mincho B1, **not** a true brush face | Brush faces smear stroke detail, and the user is learning those strokes |
| True brush face | Yuji Syuku, restricted to titles, wave headers, ceremony | Personality where legibility pressure is low |
| Calm screens | Same palette and type, **no arcade chrome** | Approved explicitly; charts and dense numbers fight glow and stripes |
| Token source of truth | CSS custom properties, mirrored in TS, parity enforced by a unit test | Pixi needs `0xRRGGBB` numbers; a test catches drift without runtime coupling |
| Font hosting | Self-hosted, subset to the bundled corpus | Local-first: the app must work offline, and the repo is public |
| Out-of-corpus glyphs | System JP stack fallback, documented | Imported custom lists can contain any kanji; honest degradation beats a broken subset |
| Effects scaling | Information survives `effects: 'off'`; only decoration scales | A player who turns off juice must not lose the ability to see what is targeted |

## 3. The token layer

### 3.1 Colour order

The ranking is the design. Each colour has exactly one job, and a colour never borrows another's job.

| Rank | Token | Value | Owns |
|---|---|---|---|
| 01 | `--color-ink` | `#f6f1e6` | Falling words, score numerals, the kana being typed. Always the brightest thing on screen. |
| 02 | `--color-system` | `#00e5ff` | System chrome and ambient light: the floor stroke, panel tabs and borders, the target reticle, the buffer frame. |
| 03 | `--color-danger` | `#ff2a3c` | Now-or-never: the target's brush underline, health pips, the deadline, miss effects. |
| 04 | `--color-accent` | `#fcee0a` | Accent only: micro-labels, combo value, the caret, the top hazard stripe. **Never a surface.** |
| 05 | `--color-ground` | `#070910` | Base, with an indigo lift toward the top (`#0a0d16`) and a darker floor (`#04060b`). |

Supporting tokens: `--color-ink-dim` `#a8b0c4` (secondary label text), `--color-ink-faint` `#6c7690` (tertiary, hints), `--color-surface` `rgba(0,229,255,.06)` (panel fill), `--color-line` `rgba(0,229,255,.32)` (panel border).

**Retired:** the current kill-green `0x9dffb0`, the confetti palette's pink/blue/amber mix, and the miss pink `0xff8f8f`. Green is not in the order; kill particles become ink white with a cyan cast, misses become vermillion, confetti draws from ink/cyan/accent only.

### 3.2 Type scale

Four faces, each with one job:

| Token | Face | Used for |
|---|---|---|
| `--font-word` | Shippori Mincho B1 (600) | Falling words, score numerals, the kana buffer, ceremony word |
| `--font-display` | Yuji Syuku (400) | Title, wave headers, ceremony label, results heading |
| `--font-ui` | Chakra Petch (500/700) | Buttons, panel tabs, HUD values, section headings |
| `--font-mono` | IBM Plex Mono (400/600) | Micro-labels, data readouts, stats table figures |

Sizes are a fixed ramp, not ad-hoc rems: `--text-2xs` .6875rem, `--text-xs` .75rem, `--text-sm` .875rem, `--text-base` 1rem, `--text-lg` 1.25rem, `--text-xl` 1.75rem, `--text-2xl` 2.5rem, `--text-3xl` 3.5rem. Micro-labels are `--text-2xs` uppercase with `.3em` tracking — the tracking is what makes them read as labels rather than small text.

Spacing is an 8px ramp (`--space-1` .25rem through `--space-10` 5rem). Radius: `--radius-sm` 2px, `--radius-md` 4px. This world is hard-edged; nothing rounder than 4px except the buffer frame's optional pill treatment on calm screens.

### 3.3 Where tokens live

- `src/ui/tokens.css` — the source of truth. All colour, type, spacing, radius, and duration custom properties on `:root`.
- `src/design/palette.ts` — a TS mirror exporting the same colours as `0xRRGGBB` numbers, because Pixi cannot read CSS custom properties.
- `src/design/__tests__/tokenParity.test.ts` — reads `tokens.css`, parses every `--color-*` declaration, and asserts each has a matching `palette.ts` entry with an equal value, and vice versa. Drift becomes a failing test rather than a slow visual divergence.

No component may introduce a raw hex literal. The 30 distinct literals currently spread across `index.css`, `PixiStage.ts`, `WordSprite.ts`, `Particles.ts`, and `charts.tsx` all resolve to tokens.

## 4. Fonts

### 4.1 Licensing and hosting

All four faces are SIL Open Font License, so they can be self-hosted and redistributed with the MIT repo provided each family's `OFL.txt` ships alongside it in `public/fonts/`.

**Self-hosted, not CDN.** The app is local-first and must work with no network. No Google Fonts link, no external request — this also keeps the strict-offline promise the README makes about data never leaving the machine.

### 4.2 Subsetting

Full Japanese faces are multi-megabyte, which matters for a public repo even though runtime load is a local file read. The subset is generated from what the app can actually display:

- **Shippori Mincho B1** — every kanji and kana present in the bundled `public/data/jlpt-n{2,3,4,5}.json` corpus, plus full kana, latin, digits, and common punctuation. Roughly 1,500 glyphs.
- **Yuji Syuku** — a fixed, tiny set: the app's headings, 第/波, kanji numerals 一〜十, and latin.
- **Chakra Petch / IBM Plex Mono** — latin, digits, punctuation only.

`scripts/build-fonts.mjs` regenerates the subsets from the corpus with `pyftsubset`, writes woff2 into `public/fonts/`, and is documented as a step to re-run whenever the bundled corpus changes. The generated files are committed — contributors must not need a Python toolchain to run the game.

### 4.3 The fallback that must be named

**Imported custom lists can contain kanji outside the subset.** Those glyphs fall back to the system JP stack (`'Yu Gothic UI', 'Meiryo', 'Noto Sans JP', sans-serif`) and will visibly differ from the mincho used elsewhere. This is deliberate: shipping a 6MB font to cover glyphs most players will never see is the worse trade. The Import screen states it in one line.

### 4.4 Loading

`PixiStage.create()` already awaits `document.fonts.ready` before constructing the app — the JP glyph-measurement gate from the main spec (§7). That gate now covers the webfonts too, and must be verified to still resolve before first paint with four self-hosted families. `@font-face` declarations use `font-display: block` for `--font-word` (a fallback-metrics flash on the falling words would be worse than a beat of nothing) and `swap` for everything else.

## 5. The playfield (Pixi)

### 5.1 Ground

Replaces the flat `0x0b0e14` background:

- A vertical gradient from `#070910` at the top through `#0a0d16` to `#04060b` at the floor, drawn once into a `Graphics` and resized with the stage.
- A faint vertical data grid (`--color-system` at 5% alpha, 76px pitch) — the cheapest possible depth cue, and it reads as machine.
- Paper grain and diagonal washi fibre at very low opacity, as a tiling sprite inside Pixi rather than a CSS overlay: a full-screen `mix-blend-mode` layer over a canvas is a known compositor cost, and inside Pixi it participates in the existing filter stack for free.

### 5.2 The floor

The single most important addition: **"don't let it hit the floor" currently has no floor.**

A dry-brush stroke spanning the width, sitting at the kill line, burning `--color-system`. It is generated once at boot as a texture via fractal-noise displacement of a tapered bar — the same construction proven in the comps — and redrawn on resize. A 1px `--color-danger` deadline sits directly beneath it, and a soft cyan underglow rises from the bottom edge.

The stroke is **information, not decoration**: it renders at every effects level. Only its glow and underglow scale.

### 5.3 Words

`WordSprite` gains a real style rather than a size and a fill:

- `--font-word` at the existing size, filled `--color-ink`, with a tight white core shadow plus a wide cyan halo — ink shape, neon light.
- A ±1.4px red/cyan chromatic split, at `effects: 'full'` only. It is what makes the words read as *lit* rather than *drawn*, and it is also the first thing to go when a player wants clarity.
- The existing recall-mode hint keeps its fade, restyled to `--color-ink-dim`.

**The target treatment replaces the current `LOCKED_TINT` recolour**, which signals with colour alone:

- A **cyan corner-bracket reticle** — four L-brackets, drawn in `Graphics`, snapping to the sprite's bounds.
- A **vermillion brush underline** beneath the word, glowing.

Two channels (shape and colour) rather than one, which is both better design and better accessibility. Cyan for the reticle keeps vermillion reserved for genuine danger.

### 5.4 Effects, recoloured

Existing behaviour is preserved; only colour and scale change. Kill bursts become ink-white-to-cyan, the miss puff becomes vermillion, wave-clear confetti draws from ink/cyan/accent. `killBurstBase`, `burstCount`, and the whole of `particleSim.ts` are untouched — they are pure, tested, and correct.

The miss reveal text (`kanji kana — gloss`) keeps its 1600ms life and becomes `--color-ink` on a vermillion underline rather than pink text, because it is the game's most important teaching moment and pink-on-black is the worst-contrast thing currently on screen.

## 6. The HUD (React + CSS)

Structure, left to right along the top:

- **Hazard stripe**, 3px, `--color-accent` at 55% — the one place yellow touches a large dimension, and it is 3px tall.
- **Score**: a solid cyan tab reading `SCORE` in `--font-ui`, butted against a bordered value block with the figure in `--font-word`. Mincho numerals inside the chrome are what keep this from reading as a straight 2077 skin.
- **Wave**: centred, 第N波 in `--font-display` over `wave NN` in `--font-mono` accent.
- **Combo**: mirrored tab+value block on the right, value in `--color-accent`. Retains the existing `combo-pop` animation.
- **Lives**: skewed vermillion pips beneath the combo block, replacing `♥` characters. Spent pips drop to 16% alpha rather than disappearing, so the total is always readable.
- **Buffer**: a cyan-framed block, centred at the bottom, kana in `--font-word` with an `IN` micro-label and a yellow caret.

The `plan-notice`, `tier-advance`, and `ime-warning` elements keep their current deliberately-muted treatment (juice-pass §5.4, §6) — restyled to tokens, not promoted.

## 7. Effects and settings contract

This spec adds no new settings. It maps onto the existing `effects: 'full' | 'reduced' | 'off'` and `crt` from `settings.ts`, and the governing rule is:

> **Anything that conveys game state renders at every effects level. Only decoration scales.**

| Element | `full` | `reduced` | `off` |
|---|---|---|---|
| Floor stroke, deadline | Full glow | Reduced glow | Flat, no glow |
| Target reticle + underline | Glow | Glow, no pulse | Flat |
| Lives, score, combo, buffer | Glow on accents | Flat accents | Flat |
| Word chromatic split | Yes | No | No |
| Word halo | Full | Reduced | Core only |
| Grain / fibre | Yes | Yes at half opacity | No |
| Bloom filter | Yes (existing) | No (existing) | No (existing) |
| Scanlines | Only when `crt` on (existing) | Only when `crt` | Only when `crt` |
| Particles | Existing counts | Existing halving | Existing zero |
| Screen shake | Existing | No (existing) | No (existing) |

`prefers-reduced-motion` continues to default `effects` to `reduced` at first run.

## 8. The calm screens

Title, Setup, Stats, Settings, Results, Ceremony, Import, and ServerError share the palette, type scale, and spacing ramp — **and none of the arcade chrome.** No hazard stripes, no reticles, no glow, no scanlines, no chromatic split.

- **Ground**: the same gradient, no grid, no grain.
- **Type**: `--font-display` for the screen title, `--font-ui` for controls and section headings, `--font-mono` for figures and labels, `--font-word` for any Japanese content.
- **Controls**: buttons become cyan-bordered blocks on `--color-surface` with a tab-style accent on the primary action only. One primary per screen.
- **Charts** (`charts.tsx`, Recharts): axes and gridlines in `--color-ink-faint`, series in the colour order — coverage cyan, mastery ink, deficits vermillion. Three literals go away: the trend chart's `#7fdfff` words line and `#ffb0b0` accuracy line, and the `.level-bar-fill.mastery` green `#9fffb0` in `index.css`.
- **Stats density**: figures in `--font-mono` so columns align, labels in `--text-2xs` tracked uppercase. This is the screen that most needs the calm treatment and benefits most from a real type hierarchy.
- **Ceremony** is the one calm screen allowed a flourish: the word arrives in `--font-word` at `--text-3xl` with the existing 320ms arrival animation, and its label uses `--font-display`. It is a ceremony; it should feel like one.

**Title screen** gets the identity's one showpiece: the wordmark in `--font-display` over a single cyan brush stroke, on the game's ground. It is the first thing anyone sees and currently it is a default `<h1>`.

## 9. Legibility rules (non-negotiable)

These override aesthetic preference wherever they conflict:

1. **Kanji stroke detail wins.** No brush face, no blur, and no chromatic split on falling words below 40px. If an effect makes a N2 kanji ambiguous, the effect loses.
2. **No glow on text below `--text-base`.** Glow on small type destroys it. Micro-labels are flat, always.
3. **Vermillion is never small text.** It is lines, pips, and underlines. At `--text-sm` and below on the ground colour it does not clear 4.5:1.
4. **Never signal with colour alone.** The target has a reticle *and* an underline. Lives have position *and* alpha. Chart series get direct labels, not just hues.
5. **The buffer is always the second-brightest thing on screen**, after the word being targeted. It is where the player's eyes actually live.

## 10. Implementation shape

Phased so that each phase leaves the game shippable:

1. **Foundations** — `tokens.css`, `palette.ts`, the parity test, font subsetting script and `@font-face` declarations. Replaces every existing hex literal. Visible change: typography only.
2. **Playfield** — ground, grid, grain, floor stroke, deadline, word styling, target reticle, particle recolour.
3. **HUD** — hazard stripe, tab+value blocks, wave header, pips, buffer frame.
4. **Calm screens** — title, setup, results, ceremony, settings, import, errors, then stats and charts.
5. **Effects and a11y pass** — wire every new visual to the effects table in §7, verify the §9 rules, contrast-check every pair.

Files touched: `src/index.css` (largely rewritten), new `src/ui/tokens.css` and `src/design/palette.ts`, `src/render/{PixiStage,WordSprite,Particles,filters}.ts`, `src/ui/hud/{Hud,charts}.tsx`, all of `src/ui/screens/`, plus `public/fonts/` and `scripts/build-fonts.mjs`.

## 11. Testing

- **Unit**: token parity (§3.3); a pure `visualParams(effects)` function returning the §7 table's values, tested per level; existing `filters.test.ts` extended for token-sourced values. `particleSim.ts` tests stay green untouched.
- **Component**: existing HUD/screen tests keep passing against restyled markup. One known coupling must be fixed rather than worked around: `Hud.test.tsx:17` asserts `toHaveTextContent('♥♥')`, which the pip treatment (§6) breaks. It is rewritten to assert on the count of rendered live pips inside `[data-testid="lives"]` — testing the state, not the glyph.
- **E2E**: the keystone Playwright flow is untouched and must stay green. No new e2e.
- **Manual QA checklist**: every screen at `effects` full/reduced/off × `crt` on/off, plus a `prefers-reduced-motion` pass — the same shape as the juice-pass checklist.
- **Legibility check**: a N2-density kanji (e.g. 議, 職, 験) rendered at play size and screenshot-compared at each effects level, to enforce §9.1 rather than assume it.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Bloom filter + per-word halo double-glow washes out kanji | Halo is tuned *with* bloom on at `full`; §9.1 screenshot check is the gate |
| Subset misses glyphs in imported lists | Documented system-font fallback (§4.3); Import screen says so |
| Grain/fibre overlay costs frames | Rendered inside Pixi as a tiling sprite, not a CSS blend layer; dropped entirely at `effects: 'off'` |
| Four webfonts delay first paint behind `document.fonts.ready` | `font-display: block` only for `--font-word`; verify the existing gate still resolves promptly |
| Yellow creeps back into surfaces | §3.1 states it as a rule; review any diff that puts `--color-accent` on a background |
| Token drift between CSS and Pixi | Parity unit test (§3.3) |

## 13. Open questions

None blocking. Two deliberately deferred:

- **A wordmark/logotype** beyond type-plus-brush-stroke, and a matching favicon, are worth doing once the identity has settled in the product. `public/favicon.svg` stays as-is for now.
- **Motion language** (easing curves, transition durations as tokens) is sketched only where this spec needs it. If screen transitions get their own pass later, that is a separate, smaller spec.
