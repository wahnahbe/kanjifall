# kotoba-drop

Falling-words Japanese vocab typing game. Words fall; type the reading in
romaji (auto-converts to kana) and press Enter before they hit the floor.

## Run

- `npm install`
- `npm run dev` — play at http://localhost:5173
- `npm run check` — typecheck + unit tests
- `npm run e2e` — Playwright keystone test (first run: `npx playwright install chromium`). It starts its own dev server on port 5183, so it won't collide with a `npm run dev` already running on 5173.

## Status

Milestone 1 (core loop fun-check) of the design spec:
`docs/superpowers/specs/2026-07-22-kotoba-drop-design.md`.
Pacing knobs live in `src/engine/constants.ts`.

Turn OFF the Windows Japanese IME (Win+Space) while playing — the game reads
plain keystrokes.
