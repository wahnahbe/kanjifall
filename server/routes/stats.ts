import { Hono } from 'hono';
import type { DbHandle } from '../db/connect';
import { computeOverview, computeWordStats } from '../stats';

const DEFAULT_WORDS_LIMIT = 50;

export function statsRoutes(handle: DbHandle): Hono {
  const app = new Hono();

  app.get('/overview', (c) => c.json(computeOverview(handle, Date.now())));

  app.get('/words', (c) => {
    const sort = c.req.query('sort');
    const parsedLimit = Number.parseInt(c.req.query('limit') ?? '', 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : DEFAULT_WORDS_LIMIT;

    const words = computeWordStats(handle, Date.now());
    // 'strength' is the only documented sort key (ascending: weakest words first); any other/absent
    // value is returned in the function's natural order (thin route, no additional stats logic).
    const sorted = sort === 'strength' ? [...words].sort((a, b) => a.strength - b.strength) : words;
    return c.json(sorted.slice(0, limit));
  });

  return app;
}
