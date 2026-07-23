import { afterEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { buildApp, RECOVERY } from '../app';
import { DbOpenError } from '../db/connect';
import { makeTestDb } from '../testDb';

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe('server foundation', () => {
  it('connect() migrates and seeds all committed cards, idempotently', () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const count = () =>
      t.handle.db.get<{ n: number }>(sql`SELECT COUNT(*) AS n FROM cards`)?.n ?? 0;
    const first = count();
    expect(first).toBeGreaterThan(4000);
    // seeding again (fresh connect on same file) must not duplicate
    expect(count()).toBe(first);
  });

  it('creates the default profile row (N2, 2026-12-06, 20/day)', () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const row = t.handle.sqlite.prepare('SELECT * FROM profile WHERE id = 1').get() as {
      target_level: number; exam_date: string; daily_word_goal: number;
    };
    expect(row.target_level).toBe(2);
    expect(row.exam_date).toBe('2026-12-06');
    expect(row.daily_word_goal).toBe(20);
  });

  it('GET /api/health reports card count', async () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const res = await buildApp(t.handle).request('/api/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; cards: number };
    expect(body.ok).toBe(true);
    expect(body.cards).toBeGreaterThan(4000);
  });

  it('a DbOpenError app answers every /api route with 503 + path + recovery', async () => {
    const app = buildApp(new DbOpenError('C:/somewhere/kotoba.db', new Error('locked')));
    const res = await app.request('/api/health');
    expect(res.status).toBe(503);
    const body = (await res.json()) as { dbError: { path: string; recovery: string } };
    expect(body.dbError.path).toBe('C:/somewhere/kotoba.db');
    expect(body.dbError.recovery).toBe(RECOVERY);
  });
});
