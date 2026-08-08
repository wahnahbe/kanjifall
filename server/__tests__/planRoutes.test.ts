import { afterEach, describe, expect, it } from 'vitest';
import { runPlanSchema } from '../../src/shared/api';
import { buildApp } from '../app';
import { makeTestDb } from '../testDb';

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe('GET /api/plan', () => {
  it('returns a schema-valid plan for a known pool', async () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const res = await buildApp(t.handle).request('/api/plan?pool=n5');
    expect(res.status).toBe(200);
    const parsed = runPlanSchema.parse(await res.json());
    expect(parsed.newCardIds).toHaveLength(10); // tier 1 of N5 — the gate is on
    expect(parsed.tiers).toHaveLength(1);
    expect(parsed.tiers[0].index).toBe(1);
    expect(parsed.runBudget).toBeGreaterThan(0);
  });

  it('rejects a missing pool parameter', async () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const res = await buildApp(t.handle).request('/api/plan');
    expect(res.status).toBe(400);
  });

  it('rejects an unknown pool', async () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const res = await buildApp(t.handle).request('/api/plan?pool=nope');
    expect(res.status).toBe(400);
  });

  it('rejects an unknown mode', async () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const res = await buildApp(t.handle).request('/api/plan?pool=n5&mode=nope');
    expect(res.status).toBe(400);
  });

  it('accepts a known mode and returns a schema-valid, mode-filtered plan', async () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const res = await buildApp(t.handle).request('/api/plan?pool=n5&mode=reading');
    expect(res.status).toBe(200);
    const parsed = runPlanSchema.parse(await res.json());
    expect(parsed.tiers[0]).toMatchObject({ index: 1 });
  });

  it('accepts a list pool and returns a schema-valid gate-free plan', async () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    t.handle.sqlite
      .prepare(`INSERT INTO lists (id, name, created_at, updated_at) VALUES (1, 'x', 1, 1)`)
      .run();
    const cardId = (t.handle.sqlite
      .prepare(`SELECT id FROM cards WHERE jlpt = 5 ORDER BY id LIMIT 1`)
      .get() as { id: string }).id;
    t.handle.sqlite
      .prepare(`INSERT INTO list_cards (list_id, card_id, position) VALUES (1, ?, 0)`)
      .run(cardId);
    const res = await buildApp(t.handle).request('/api/plan?pool=list:1&mode=reading');
    expect(res.status).toBe(200);
    const parsed = runPlanSchema.parse(await res.json());
    expect(parsed.tiers).toEqual([]);
  });

  it('rejects a malformed list pool', async () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    expect((await buildApp(t.handle).request('/api/plan?pool=list:abc')).status).toBe(400);
  });
});
