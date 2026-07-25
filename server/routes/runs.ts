import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { createRunSchema, eventsBatchSchema, finalizeRunSchema } from '../../src/shared/api';
import type { DbHandle } from '../db/connect';
import { attempts, ingestedBatches, runs, wrongSubmits } from '../db/schema';

export function runsRoutes(handle: DbHandle): Hono {
  const app = new Hono();

  app.post('/', async (c) => {
    const parsed = createRunSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    const run = parsed.data;
    const existing = handle.db.select().from(runs).where(eq(runs.id, run.id)).get();
    if (existing) return c.json({ id: run.id }, 200);
    handle.db.insert(runs).values({
      id: run.id,
      startedAt: run.startedAt,
      mode: run.mode,
      pool: run.pool,
      appVersion: run.appVersion,
      listVersion: run.listVersion,
    }).run();
    return c.json({ id: run.id }, 201);
  });

  app.post('/:id/events', async (c) => {
    const runId = c.req.param('id');
    const parsed = eventsBatchSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    const run = handle.db.select().from(runs).where(eq(runs.id, runId)).get();
    if (!run) return c.json({ error: 'unknown run' }, 404);
    const batch = parsed.data;
    const already = handle.db
      .select().from(ingestedBatches).where(eq(ingestedBatches.batchId, batch.batchId)).get();
    if (already) return c.json({ duplicate: true }, 200);

    const insertAll = handle.sqlite.transaction(() => {
      handle.db.insert(ingestedBatches)
        .values({ batchId: batch.batchId, runId, receivedAt: Date.now() }).run();
      for (const a of batch.attempts) {
        handle.db.insert(attempts).values({ runId, ...a }).run();
      }
      for (const w of batch.wrongSubmits) {
        handle.db.insert(wrongSubmits).values({ runId, ...w }).run();
      }
      for (const intro of batch.introductions) {
        // INSERT OR IGNORE: card_id is the primary key, so a re-introduction
        // (outbox replay, or a card met again on a later day) is a no-op.
        handle.sqlite
          .prepare(
            `INSERT OR IGNORE INTO introductions (card_id, run_id, introduced_at) VALUES (?, ?, ?)`,
          )
          .run(intro.cardId, runId, intro.introducedAt);
      }
    });
    insertAll();
    return c.json(
      {
        inserted: {
          attempts: batch.attempts.length,
          wrongSubmits: batch.wrongSubmits.length,
          introductions: batch.introductions.length,
        },
      },
      201,
    );
  });

  app.patch('/:id', async (c) => {
    const runId = c.req.param('id');
    const parsed = finalizeRunSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    const run = handle.db.select().from(runs).where(eq(runs.id, runId)).get();
    if (!run) return c.json({ error: 'unknown run' }, 404);
    handle.db.update(runs).set(parsed.data).where(eq(runs.id, runId)).run();
    return c.json({ ok: true }, 200);
  });

  return app;
}
