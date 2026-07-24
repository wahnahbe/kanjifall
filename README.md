# kotoba-drop

Falling-words Japanese vocab typing game. Words fall; type the reading in
romaji (auto-converts to kana) and press Enter before they hit the floor.
Every attempt is recorded to a local SQLite database and summarized on a
Stats screen: words learned per direction, a vocab-only JLPT level estimate,
pace against the exam date, a 30-day trend, and a leech list of your weakest
words.

## Run

- `npm install`
- `npm run dev` — play at the port Vite prints (5173, or 5174+ if 5173 is taken). One command starts both the
  client (Vite) and the API server side by side; Vite proxies `/api` to the
  API on 8790.
- `npm start` — builds the client, then serves the build and the API from a
  single process on http://localhost:8790 and opens it in your default
  browser. No Vite, no proxy — use this for a normal play session.
- `npm run check` — typecheck (app, node, e2e, server projects) + lint + unit tests
- `npm run e2e` — Playwright keystone test (first run: `npx playwright install chromium`). Runs its own dev server on port 5183 against a separate `data/e2e.db` (wiped before each run). The e2e client runs on its own port 5183 (no collision with 5173), but the API shares port 8790 with both `npm run dev` and `npm start`, so stop either before starting e2e. Never touches your real data.
- `npm run build:data` — regenerate `public/data/jlpt-n*.json` from local raw
  datasets (expects `data/raw/` populated with `term_meta_bank_*.json` and
  `jmdict-eng-3.6.2.json`; copies live in the n2-prep repo's `data/raw/`).
  Generated files are committed — you only need this when changing the pipeline.

## Data

Attempts, runs, and your profile live in `data/kotoba.db` (SQLite,
gitignored). The app never deletes or silently recreates this file — if it
can't be opened, you get an error screen with the path and recovery steps
instead of a silent reset. To back it up, stop the server and copy the file
(plus its `-wal`/`-shm` siblings, if present).

## Status

Milestone 3 of the design spec:
`docs/superpowers/specs/2026-07-22-kotoba-drop-design.md`.
Both modes (Reading: kanji → type the reading; Recall: English → type the
Japanese) over JLPT N5–N2 pools (~4,700 words) + Mixed, pre-wave word
introductions, results screen with revenge rounds, and a local backend
(Hono + SQLite) that records every attempt behind a Stats screen (learned
words, level estimate, pace vs. exam date, trend, leech list).
Pacing knobs live in `src/engine/constants.ts`; stats thresholds live in
`server/statsConfig.ts`.

Turn OFF the Windows Japanese IME (Win+Space) while playing — the game reads
plain keystrokes.
