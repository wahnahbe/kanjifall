import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';
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

/** Idempotent: INSERT OR REPLACE all committed cards (4,678 rows, one transaction). */
function seedCards(handle: DbHandle): void {
  const upsert = handle.sqlite.prepare(
    `INSERT OR REPLACE INTO cards (id, kanji, kana, gloss, pos, jlpt, source, list_version)
     VALUES (@id, @kanji, @kana, @gloss, @pos, @jlpt, @source, @listVersion)`,
  );
  const tx = handle.sqlite.transaction((rows: Record<string, unknown>[]) => {
    for (const row of rows) upsert.run(row);
  });
  const rows: Record<string, unknown>[] = [];
  for (const level of LEVELS) {
    const file = levelFileSchema.parse(
      JSON.parse(readFileSync(`public/data/jlpt-n${level}.json`, 'utf8')),
    );
    for (const card of file.cards) {
      rows.push({
        id: card.id,
        kanji: card.kanji,
        kana: JSON.stringify(card.kana),
        gloss: card.gloss,
        pos: card.pos,
        jlpt: card.jlpt,
        source: card.source,
        listVersion: file.listVersion,
      });
    }
  }
  tx(rows);
}

function ensureProfileRow(handle: DbHandle): void {
  handle.sqlite
    .prepare(
      `INSERT OR IGNORE INTO profile (id, target_level, exam_date, daily_word_goal)
       VALUES (1, 2, '2026-12-06', 20)`,
    )
    .run();
}

/** Opens + migrates + seeds. Never deletes: a failed migration throws DbOpenError. */
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
