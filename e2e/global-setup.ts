import { rmSync } from 'node:fs';

const DB_PATH = 'data/e2e.db';

/**
 * Runs once, before Playwright's webServer boots. Wipes the e2e SQLite file
 * (and its WAL/SHM sidecars) so every `npm run e2e` invocation starts from an
 * empty database — the persistence assertion in game.spec.ts needs a clean
 * "today has zero recorded words" baseline, not leftover rows from a
 * previous run. `connect()` (server/db/connect.ts) recreates, migrates, and
 * reseeds the file on next server startup, so deleting it here is safe.
 */
export default function globalSetup(): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${DB_PATH}${suffix}`;
    try {
      rmSync(file, { force: true });
    } catch (error) {
      console.warn('[e2e-setup] could not remove ' + file + ': ' + String(error));
    }
  }
}
