import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { DbOpenError, type DbHandle } from './db/connect';

export const RECOVERY =
  'The app never deletes your history. Back up the file, then either restore a copy or move it aside and restart to begin a fresh database.';

export function buildApp(handle: DbHandle | DbOpenError): Hono {
  const app = new Hono();

  if (handle instanceof DbOpenError) {
    app.all('/api/*', (c) =>
      c.json({ dbError: { path: handle.dbPath, message: handle.message, recovery: RECOVERY } }, 503),
    );
    return app;
  }

  app.get('/api/health', (c) => {
    const row = handle.db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM cards`);
    return c.json({ ok: true, cards: row?.n ?? 0 });
  });

  return app;
}
