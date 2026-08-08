import { Hono } from 'hono';
import type { DbHandle } from '../db/connect';
import { computeRunPlan, isKnownPool } from '../plan';

export function planRoutes(handle: DbHandle): Hono {
  const app = new Hono();

  app.get('/', (c) => {
    const pool = c.req.query('pool');
    if (pool === undefined || pool.length === 0) {
      return c.json({ error: 'pool query parameter is required' }, 400);
    }
    if (!isKnownPool(pool)) {
      return c.json({ error: `unknown pool: ${pool}` }, 400);
    }
    // Optional: absent means the pooled view (no exclusions), mirroring the
    // unknown-pool rejection below for any other non-empty, non-mode value.
    const modeParam = c.req.query('mode');
    if (
      modeParam !== undefined && modeParam.length > 0
      && modeParam !== 'reading' && modeParam !== 'recall'
    ) {
      return c.json({ error: `unknown mode: ${modeParam}` }, 400);
    }
    const mode = modeParam === 'reading' || modeParam === 'recall' ? modeParam : undefined;
    return c.json(computeRunPlan(handle, pool, Date.now(), mode));
  });

  return app;
}
