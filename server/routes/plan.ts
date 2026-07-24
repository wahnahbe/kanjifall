import { Hono } from 'hono';
import type { DbHandle } from '../db/connect';
import { computeRunPlan } from '../plan';

export function planRoutes(handle: DbHandle): Hono {
  const app = new Hono();

  app.get('/', (c) => {
    const pool = c.req.query('pool');
    if (pool === undefined || pool.length === 0) {
      return c.json({ error: 'pool query parameter is required' }, 400);
    }
    return c.json(computeRunPlan(handle, pool, Date.now()));
  });

  return app;
}
