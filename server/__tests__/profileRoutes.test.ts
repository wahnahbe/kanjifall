import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../app';
import { makeTestDb } from '../testDb';
import type { Profile } from '../../src/shared/api';

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

describe('GET /api/profile', () => {
  it('returns the seeded default profile row', async () => {
    const t = makeTestDb();
    cleanup = t.cleanup;

    const res = await buildApp(t.handle).request('/api/profile');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: 1,
      targetLevel: 2,
      examDate: '2026-12-06',
      dailyWordGoal: 20,
    });
  });
});

describe('PUT /api/profile', () => {
  it('updates the profile and a subsequent GET reflects the new values', async () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const app = buildApp(t.handle);

    const update: Profile = { targetLevel: 3, examDate: '2027-01-15', dailyWordGoal: 35 };
    const putRes = await app.request('/api/profile', {
      method: 'PUT',
      body: JSON.stringify(update),
      headers: { 'content-type': 'application/json' },
    });
    expect(putRes.status).toBe(200);
    expect(await putRes.json()).toEqual({ id: 1, ...update });

    const getRes = await app.request('/api/profile');
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toEqual({ id: 1, ...update });
  });

  it('rejects an invalid profile body with 400', async () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const app = buildApp(t.handle);

    const res = await app.request('/api/profile', {
      method: 'PUT',
      body: JSON.stringify({ targetLevel: 9, examDate: 'not-a-date', dailyWordGoal: -1 }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe('string');
  });
});
