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
    expect(parsed.newCardIds.length).toBeGreaterThan(600);
    expect(parsed.runBudget).toBeGreaterThan(0);
  });

  it('rejects a missing pool parameter', async () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const res = await buildApp(t.handle).request('/api/plan');
    expect(res.status).toBe(400);
  });
});
