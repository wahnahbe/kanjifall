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
});
