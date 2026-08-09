import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { levelFileSchema } from '../../src/data/schema';
import * as schema from './schema';

export type DbHandle = { db: BetterSQLite3Database<typeof schema>; sqlite: Database.Database };

export class DbOpenError extends Error {
  readonly dbPath: string;

  constructor(dbPath: string, cause: unknown) {
    super(`could not open or migrate the database at ${dbPath}`, { cause });
    this.name = 'DbOpenError';
    this.dbPath = dbPath;
  }
}

const LEVELS = [5, 4, 3, 2] as const;

/**
 * Idempotent: INSERT OR REPLACE all committed cards (4,652 rows, one
 * transaction), then purge source='jlpt' rows from superseded list versions.
 * Without the purge, a data regeneration that REMOVES ids (e.g. the v3
 * homograph merge) leaves ghost rows: never spawnable (the static pool no
 * longer has them) yet counted by every tier-gate denominator and stats
 * total — a permanent, silent stall. Custom cards are never touched.
 */
function seedCards(handle: DbHandle): void {
  const upsert = handle.sqlite.prepare(
    `INSERT OR REPLACE INTO cards (id, kanji, kana, gloss, pos, jlpt, tier, source, list_version)
     VALUES (@id, @kanji, @kana, @gloss, @pos, @jlpt, @tier, @source, @listVersion)`,
  );
  const tx = handle.sqlite.transaction((rows: Record<string, unknown>[]) => {
    for (const row of rows) upsert.run(row);
  });
  const rows: Record<string, unknown>[] = [];
  const liveVersions = new Set<string>();
  for (const level of LEVELS) {
    const file = levelFileSchema.parse(
      JSON.parse(readFileSync(`public/data/jlpt-n${level}.json`, 'utf8')),
    );
    liveVersions.add(file.listVersion);
    for (const card of file.cards) {
      rows.push({
        id: card.id,
        kanji: card.kanji,
        kana: JSON.stringify(card.kana),
        gloss: card.gloss,
        pos: card.pos,
        jlpt: card.jlpt,
        tier: card.tier ?? null,
        source: card.source,
        listVersion: file.listVersion,
      });
    }
  }
  tx(rows);
  const versions = [...liveVersions];
  const placeholders = versions.map(() => '?').join(',');
  handle.sqlite
    .prepare(`DELETE FROM cards WHERE source = 'jlpt' AND list_version NOT IN (${placeholders})`)
    .run(...versions);
}

function ensureProfileRow(handle: DbHandle): void {
  handle.sqlite
    .prepare(
      `INSERT OR IGNORE INTO profile (id, target_level, exam_date, daily_word_goal)
       VALUES (1, 2, '2026-12-06', 20)`,
    )
    .run();
}

// NOTE: PRAGMA foreign_keys stays OFF by design: routes guard run existence on one
// synchronous connection, there are no delete endpoints, and drizzle-kit's SQLite
// rebuild migrations can fail spuriously with it enabled. Orphans are filtered in stats.
/** Opens + migrates + seeds. Never deletes user data (runs, attempts,
 *  custom cards); only superseded jlpt seed rows are purged — see seedCards.
 *  A failed migration throws DbOpenError. */
export function connect(dbPath: string): DbHandle {
  try {
    mkdirSync(dirname(dbPath), { recursive: true });
    const sqlite = new Database(dbPath);
    sqlite.pragma('journal_mode = WAL');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: 'drizzle' });
    const handle = { db, sqlite };
    seedCards(handle);
    ensureProfileRow(handle);
    return handle;
  } catch (error: unknown) {
    throw new DbOpenError(dbPath, error);
  }
}
