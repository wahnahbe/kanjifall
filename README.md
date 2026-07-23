# kotoba-drop

Falling-words Japanese vocab typing game. Words fall; type the reading in
romaji (auto-converts to kana) and press Enter before they hit the floor.

## Run

- `npm install`
- `npm run dev` — play at http://localhost:5173
- `npm run check` — typecheck (app, node, e2e projects) + lint + unit tests
- `npm run e2e` — Playwright keystone test (first run: `npx playwright install chromium`). It starts its own dev server on port 5183, so it won't collide with a `npm run dev` already running on 5173.
- `npm run build:data` — regenerate `public/data/jlpt-n*.json` from local raw
  datasets (expects `data/raw/` populated with `term_meta_bank_*.json` and
  `jmdict-eng-3.6.2.json`; copies live in the n2-prep repo's `data/raw/`).
  Generated files are committed — you only need this when changing the pipeline.

## Status

Milestone 2 of the design spec:
`docs/superpowers/specs/2026-07-22-kotoba-drop-design.md`.
Two modes (Reading: kanji → type the reading; Recall: English → type the
Japanese), JLPT N5–N2 pools (~4,700 words) + Mixed, pre-wave word
introductions, results screen with revenge rounds.
Pacing knobs live in `src/engine/constants.ts`.

Turn OFF the Windows Japanese IME (Win+Space) while playing — the game reads
plain keystrokes.
