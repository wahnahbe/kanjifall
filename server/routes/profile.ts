import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { profileSchema } from '../../src/shared/api';
import type { DbHandle } from '../db/connect';
import { profile } from '../db/schema';

export function profileRoutes(handle: DbHandle): Hono {
  const app = new Hono();

  app.get('/', (c) => {
    const row = handle.db.select().from(profile).where(eq(profile.id, 1)).get();
    return c.json(row);
  });

  app.put('/', async (c) => {
    const parsed = profileSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.message }, 400);
    handle.db.update(profile).set(parsed.data).where(eq(profile.id, 1)).run();
    return c.json(handle.db.select().from(profile).where(eq(profile.id, 1)).get());
  });

  return app;
}
