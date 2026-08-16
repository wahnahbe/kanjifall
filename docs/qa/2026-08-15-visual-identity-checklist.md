# Visual identity — QA checklist

Task 11 of `docs/superpowers/plans/2026-08-15-visual-identity.md`. Verifies spec
`docs/superpowers/specs/2026-08-15-visual-identity-design.md` §7 (effects
contract), §9 (legibility), §11 (testing) against the running app.

Browser: `kanjifall-e2e` (port 5183) only, via Playwright MCP. Screenshots in
`.superpowers/sdd/2026-08-15-visual-identity/`, referenced by filename below.
Two fixes landed during this pass are noted inline where they change the
observed column from a first-pass failure to a pass — see
`task-11-report.md` for the full account of every fix.

## 1. §7 effects contract — one row per table cell

| Element | Level | Expected | Observed | Result |
|---|---|---|---|---|
| Floor stroke, deadline | full | Full glow | Cyan `GlowFilter` on the floor sprite, clearly bloomed; 1px deadline confirmed present underneath (see §3 below — ruling: keep as-is). | PASS — `matrix-full-crt-off.png` |
| Floor stroke, deadline | reduced | Reduced glow | Visibly dimmer glow than `full` (`glowAlpha` 0.5 vs 1, `PixiStage.applyFloorGlow`). | PASS — `matrix-reduced-crt-off.png` |
| Floor stroke, deadline | off | Flat, no glow | Stroke still renders (cyan band), no glow halo. Deadline still drawn (Graphics, unconditional). | PASS — `matrix-off-crt-off.png` |
| Target reticle + underline | full | Glow | **First pass: FAILED.** Brackets/underline were flat at every level (no `GlowFilter` ever applied — see report Q1). **Fixed** in `WordSprite.ts` (`GlowFilter` on both, scaled by `glowAlpha`). Re-verified: reticle and underline both show a clear glow halo. | PASS (after fix) — `t11-reticle-glow-full.png` |
| Target reticle + underline | reduced | Glow, no pulse | Glow present (scaled `glowAlpha` 0.5); no pulse animation exists anywhere in the codebase for the reticle at any level, so "no pulse" is trivially true — not a gap, see report. | PASS — `matrix-reduced-crt-off.png` (locked word, top-right) |
| Target reticle + underline | off | Flat | Brackets and underline render with no `GlowFilter` at all (`glowAlpha === 0` skips filter assignment entirely, same "genuinely flat" posture as the halo). All four falling copies confirmed flat and locked in the same frame. | PASS — `matrix-off-reticle-flat2.png` |
| Lives, score, combo, buffer | full | Glow on accents | **First pass: FAILED.** No `box-shadow`/`text-shadow` anywhere in `index.css` for any HUD element at any effects level — flat regardless of setting. **Fixed**: `Hud.tsx` adds a `hud-glow` class when `effects === 'full'`; `index.css` adds `box-shadow` to `.hud-tab`/`.hud-value`/`.hud-pip-live`/`.hud-buffer` and `text-shadow` to `.hud-value-accent` (the combo digits) only — never to the `--text-2xs` micro-labels (`.hud-tab`, `.hud-wave-lat`, `.hud-buffer-tick`), per §9.2. | PASS (after fix) — `matrix-full-crt-off.png` |
| Lives, score, combo, buffer | reduced | Flat accents | No `hud-glow` class (only added at `full`); score/pip/buffer chrome renders flat. | PASS — `matrix-reduced-crt-off.png` |
| Lives, score, combo, buffer | off | Flat | Same as reduced — flat, and all elements still present (score, pips, buffer). | PASS — `matrix-off-crt-off.png` |
| Word chromatic split | full | Yes | Confirmed via existing unit-tested gate (`chromaticSplitAllowed`, `WordSprite.test.ts`) and `visualParams('full').chromaticSplitPx === 1.4`; visually a subtle red/cyan fringe on unlocked word edges (hard to capture in a static screenshot but code-verified, matches Task 7's own review evidence `reticle-full-chromatic-crop.png`). | PASS |
| Word chromatic split | reduced | No | `visualParams('reduced').chromaticSplitPx === 0` (unit test). | PASS |
| Word chromatic split | off | No | `visualParams('off').chromaticSplitPx === 0` (unit test). | PASS |
| Word halo | full | Full | Bright soft-white glow around every falling glyph. | PASS — `matrix-full-crt-off.png` |
| Word halo | reduced | Reduced | Visibly dimmer halo (`haloAlpha` 0.5 vs 1). | PASS — `matrix-reduced-crt-off.png` |
| Word halo | off | Core only | No halo — crisp flat glyph, no `dropShadow` (omitted entirely at `haloAlpha === 0`, not just zeroed). | PASS — `matrix-off-crt-off.png` |
| Grain / fibre | full | Yes | Backdrop grain + diagonal washi fibre both visible. Fibre was reading too strongly (see §3 below) — **tuned** `--color-fibre` alpha 0.03 → 0.015. Re-verified: texture now reads as grain, not scratches. | PASS (after tune) — `fibre-check-full-tuned.png` |
| Grain / fibre | reduced | Yes, half opacity | `visualParams('reduced').grainAlpha === 0.5` (unit test); `--grain-alpha` custom property drives `.pixi-host::before`'s `opacity` directly, so this is a direct multiply — code-verified, not independently re-screenshotted after the fibre tune (the tune only changed the token's own alpha, not the `grainAlpha` scaling logic). | PASS |
| Grain / fibre | off | No | `--grain-alpha: 0` → `opacity: 0` on the grain/fibre layer. Ground is flat with only the data-grid lines visible. | PASS — `matrix-off-crt-off.png` |
| Bloom filter (existing) | full | Yes | `filterKinds()` includes `'bloom'` only at `effects === 'full'` (`filters.ts`, pre-existing, unit-tested). Combined bloom+halo legibility checked in §2 below. | PASS |
| Bloom filter (existing) | reduced | No | `filterKinds()` excludes `'bloom'` outside `full`. | PASS |
| Bloom filter (existing) | off | No | Same. | PASS |
| Scanlines (existing) | full, `crt` on | Only when `crt` on | `CRTFilter` added when `settings.crt` regardless of effects level (pre-existing, unit-tested in `filters.test.ts`). Visually confirmed present. | PASS — `matrix-full-crt-on.png` |
| Scanlines (existing) | full, `crt` off | Absent | No `CRTFilter`. | PASS — `matrix-full-crt-off.png` |
| Scanlines (existing) | reduced, `crt` on/off | Same crt-gated rule | Confirmed at `reduced`. | PASS — `matrix-reduced-crt-on.png` / `matrix-reduced-crt-off.png` |
| Scanlines (existing) | off, `crt` on/off | Same crt-gated rule | Confirmed at `off` — scanlines independent of effects level. | PASS — `matrix-off-crt-on.png` / `matrix-off-crt-off.png` |
| Particles (existing) | full/reduced/off | Existing counts / halving / zero | Pre-existing `particleSim.ts` behaviour, untouched by this spec (per plan). Not independently re-tested here — out of this task's scope per the plan's own instruction that `particleSim.ts` is "pure, tested, and correct." | Not independently re-verified (pre-existing, unit-tested elsewhere) |
| Screen shake (existing) | full | Existing (miss only) | `PixiStage.playMiss` sets `shakeMs` only when `effects === 'full'` (pre-existing). | PASS (code-verified) |
| Screen shake (existing) | reduced/off | No | Guarded by the same `effects === 'full'` check. | PASS (code-verified) |

## 2. Six-combination matrix walk (Step 2)

One wave played per combination. **Load-bearing assertion**: at `effects: 'off'`,
floor, deadline, reticle, underline, pips, score, and buffer are all still
visible (flat, but present).

| # | effects | crt | Floor+deadline | Reticle+underline | Pips | Score | Buffer | Screenshot |
|---|---|---|---|---|---|---|---|---|
| 1 | full | off | glow | glow | visible | visible | visible | `matrix-full-crt-off.png` |
| 2 | full | on | glow + scanlines | glow | visible | visible | visible | `matrix-full-crt-on.png` |
| 3 | reduced | off | reduced glow | glow | visible | visible | visible | `matrix-reduced-crt-off.png` |
| 4 | reduced | on | reduced glow + scanlines | glow | visible | visible | visible | `matrix-reduced-crt-on.png` |
| 5 | off | off | **flat, present** | **flat, present** | **visible** | **visible** | **visible** | `matrix-off-crt-off.png`, `matrix-off-crt-off-locked.png`, `matrix-off-reticle-flat2.png` |
| 6 | off | on | flat, present + scanlines | flat, present | visible | visible | visible | `matrix-off-crt-on.png` |

**Result: PASS on all six.** Nothing disappears at `effects: 'off'`. Row 5 is
the load-bearing one; `matrix-off-reticle-flat2.png` specifically shows four
simultaneously-locked words, all with flat cyan brackets and flat vermillion
underlines still visible.

## 3. Three deferred questions

Full evidence and reasoning in `task-11-report.md`. Rulings only, here:

1. **Does the target underline glow at `full`?** No, it did not (real gap) —
   **fixed**. See table row above and `t11-reticle-glow-full.png`.
2. **Is the 1px deadline visible / distinct from the floor stroke?** **Ruling:
   keep as-is.** The deadline (vermillion) and the floor's brightest paint
   (cyan) do not occupy the same visual space — the brush texture's painted
   region sits well above the sprite's bottom edge (transparent padding below
   it in the source texture), so the deadline draws into that transparent
   band, not on top of opaque cyan. It is small and easy to miss at a glance,
   but it is present, correctly coloured, and not fighting the stroke for the
   same pixels. No code change made.
3. **Does the washi fibre read too strongly?** Yes — confirmed by direct
   visual inspection at `full` (`fibre-check-full-normal.png`: crisp, evenly
   spaced diagonal lines, closer to scratches than grain). **Tuned**
   `--color-fibre` alpha 0.03 → 0.015 in `src/ui/tokens.css`. Re-verified
   (`fibre-check-full-tuned.png`): texture reads as grain, not scratches.

## 4. Legibility check (spec §9.1)

High-stroke-density kanji rendered at play size via a QA-only custom list
(`qa-legibility`, words 会議/職業/試験/看護婦/年齢 — covering target characters
議・職・験・護・齢), at `effects: 'full'` (bloom **and** word halo both active
— the pairing spec §12 flags as most likely to wash out detail).

| Screenshot | What it shows |
|---|---|
| `t11-legibility-full-1.png` | 試験 and 会議 falling simultaneously at play size, full effects (bloom + halo). All strokes distinct, no merging. |
| `t11-legibility-full-2.png` | Run-over screen showing 試験/会議 in the missed table — vermillion at `--text-base`, still legible. |
| `t11-reticle-glow-full.png` | 看護婦 (護) locked, glowing reticle + underline, halo + bloom active. Strokes distinct. |
| `matrix-full-crt-off.png` | 試験, 職業, 年齢 all airborne simultaneously at full effects. No stroke merging on any of the five target characters observed across this session. |

**Result: no stroke merging or ambiguity observed on 議, 職, 験, 護, or 齢 at
`effects: 'full'` with bloom and halo both active.** `haloAlpha` was not
reduced — the existing tuning holds up under direct inspection at play size.

## 5. Contrast check (spec §9.2, §9.3)

Computed via the WCAG 2.1 relative-luminance formula against the ground
colours actually used behind each token (`node`, exact script in
`task-11-report.md`):

| Pair | Ratio | vs. 4.5:1 (AA, normal text) |
|---|---|---|
| `--color-ink` `#f6f1e6` vs `--color-ground` | 17.66:1 | PASS (comfortably, as spec claims) |
| `--color-ink-dim` `#a8b0c4` vs `--color-ground` | 9.16:1 | PASS |
| `--color-system` `#00e5ff` vs `--color-ground` | 12.93:1 | PASS |
| `--color-accent` `#fcee0a` vs `--color-ground` | 16.46:1 | PASS |
| `--color-danger` `#ff2a3c` vs `--color-ground` | 5.35:1 | PASS |
| `--color-danger` vs `--color-ground-deep` (floor area) | 5.45:1 | PASS |
| `--color-ink-faint` `#6c7690` vs `--color-ground` | 4.39:1 | **FAIL** (below 4.5:1) |
| `--color-ink-faint` vs `--color-ground-lift` (top of gradient) | 4.28:1 | **FAIL** |

`--color-ink-faint` is used at seven locations: `.hint`, `.plan-notice`,
`.tier-advance`, `.stat-label`, `.ceremony-sentence-en`, `.ceremony-credit`,
and `input::placeholder, textarea::placeholder` (line 45 of `index.css`) — all
`--text-xs`/`--text-sm`/`--text-2xs`/placeholder text, i.e. all "small text"
by the WCAG size threshold where 4.5:1 is the applicable bar. **Not fixed** —
see report for why (token-level shortfall, not a usage bug; the brief's own
guidance is to fix contrast failures by changing *usage*, and this usage is
uniform and intentional across all seven locations, not a mistake in any one
of them). Reported as a finding, not fixed.

`--color-danger` usage-as-text-only (§9.3): confirmed three text usages:
`.missed td` (line ~120, `--text-base`), `.load-error` (line ~185,
`--text-base`), and `.ceremony-buffer.rejected` (line 280, `--text-2xl`).
All three explicitly pin font sizes well above the spec §9.3 floor
(`--text-base` minimum). Searched `index.css` for `--color-danger` usage;
every other occurrence is a line (underlines), a pip, or the deadline —
text usage is confined to these three rules.

## 6. Colour-is-never-the-only-signal (spec §9.4)

| Signal | Channels | Verified |
|---|---|---|
| Target | Cyan corner brackets (shape) + vermillion underline (colour) | Yes — both render together always (`WordSprite.ensureTargetArt`); `matrix-off-reticle-flat2.png` shows both channels with no glow to lean on either. |
| Lives | Position (which pips, left-to-right) + alpha (`hud-pip-live` full vs `hud-pip-spent` 16%) — both pips share the same hue | Yes — `pips.ts`'s `pipStates()`; no hue difference between live/spent. |
| Chart series (Stats trend chart) | Cyan solid line (words) vs ink dashed line (`strokeDasharray="6 4"`, accuracy) | Yes — `charts.tsx`, explicit code comment citing §9.4. |

## 7. Recall-mode hint + locked underline (deferred from Task 7)

Task 7 flagged, but never tested, a possible crowding risk between the
recall-mode kanji hint (`HINT_OFFSET_Y`, fixed 34px) and the target underline.

**Confirmed real** — `recall-hint-check1.png`: for English gloss text
("congress"), the hint fades in almost on top of the underline's glow, and
also crowds into the buffer chrome below it near the floor.

**Fixed**: hint Y-offset in `WordSprite.showHint()` is now derived from the
word's own measured `text.height` (same formula shape the underline itself
uses: `halfH + UNDERLINE_GAP_PX + UNDERLINE_HALF_HEIGHT_PX + HINT_CLEARANCE_PX`)
instead of a flat constant. Re-verified — `recall-hint-fixed2.png`: hint now
sits with a clean visible gap below the underline for every word in frame.

**Residual, not fixed**: words very close to the kill line still visually
approach the fixed-position HUD buffer chrome (see `recall-hint-fixed2.png`'s
bottom word) — this is a pre-existing consequence of `FLOOR_Y_RATIO = 1.0`
(Task 6's ruling) and applies to *any* word near the floor, hint or no hint.
Fixing it would mean moving the buffer or the kill line, well outside this
task's scope — reported, not fixed.

## 8. Floor glow saturation (deferred note)

Judged deliberately: the floor's cyan glow (`FLOOR_GLOW_OUTER_STRENGTH = 3`,
full-strength cyan, `#00e5ff`) is highly saturated and draws real attention —
visible in every `full`-effects screenshot above. **Ruling: keep as-is.** It
marks the kill line, which is the single highest-stakes location on screen;
a background element deliberately pulling the eye there is the intended
design, not an oversight. Not changed.

## 9. `prefers-reduced-motion` pass

**Not independently observed in a live browser session** — no Playwright MCP
primitive available in this session emulates `prefers-reduced-motion` at the
OS/CDP level (`page.emulateMedia()` is a Node-side API, not reachable through
the `browser_evaluate` tool, and a full page reload — required to re-run
`defaultSettings()` — resets any in-page `matchMedia` stub). Verified instead
via the existing, passing unit test:
`src/data/__tests__/settings.test.ts:18` (`'prefers-reduced-motion defaults
effects to reduced'`), which stubs `matchMedia` and asserts
`defaultSettings().effects === 'reduced'`. This is a stated gap, not a
fabricated pass — see report for detail.

## 10. `npm run check` / `npm run e2e`

```
$ npm run check
tsc -b && oxlint && vitest run --passWithNoTests
 Test Files  56 passed (56)
      Tests  425 passed (425)

$ npm run e2e
Running 3 tests using 2 workers
  ok 2 e2e\game.spec.ts:106:1 › reading mode: intro → dismiss → type reading → kill scores (31.0s)
  ok 1 e2e\import.spec.ts:101:1 › import a list and play it: ceremony, kill, persistence (31.1s)
  ok 3 e2e\game.spec.ts:158:1 › recall mode: gloss prompt still killed by typing the reading (6.8s)
  3 passed (44.5s)
```

Both green. Ports 8790/5173/5183 confirmed free after the run (`netstat`, no
`LISTENING` entries).
