import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { buildApp } from '../app';
import { makeTestDb } from '../testDb';
import { runs } from '../db/schema';
import type { AttemptEvent, CreateRun, WrongSubmitEvent } from '../../src/shared/api';

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function jsonRequest(body: unknown, method = 'POST') {
  return {
    method,
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  };
}

function makeCreateRunBody(overrides: Partial<CreateRun> = {}): CreateRun {
  return {
    id: randomUUID(),
    startedAt: Date.now(),
    mode: 'reading',
    pool: 'n5',
    appVersion: '1.0.0',
    listVersion: 'v1',
    ...overrides,
  };
}

function makeAttempt(overrides: Partial<AttemptEvent> = {}): AttemptEvent {
  return {
    cardId: 'card-1',
    mode: 'reading',
    outcome: 'kill',
    msToFirstKey: 120,
    msToKill: 900,
    backspaceCount: 0,
    hintShown: false,
    wasTargeted: true,
    airborneCount: 1,
    speedLevel: 1,
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeWrongSubmit(overrides: Partial<WrongSubmitEvent> = {}): WrongSubmitEvent {
  return {
    submittedKana: 'ねこ',
    airborneCardIds: ['card-1'],
    matchedOtherCardId: null,
    createdAt: Date.now(),
    ...overrides,
  };
}

function countRows(sqlite: import('better-sqlite3').Database, table: string): number {
  const row = sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
  return row.n;
}

describe('POST /api/runs', () => {
  it('returns 201 on first create and 200 on idempotent replay, inserting only one row', async () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const app = buildApp(t.handle);
    const body = makeCreateRunBody();

    const first = await app.request('/api/runs', jsonRequest(body));
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({ id: body.id });

    const replay = await app.request('/api/runs', jsonRequest(body));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ id: body.id });

    expect(countRows(t.handle.sqlite, 'runs')).toBe(1);
  });
});

describe('POST /api/runs/:id/events', () => {
  async function createRun(app: ReturnType<typeof buildApp>): Promise<string> {
    const body = makeCreateRunBody();
    const res = await app.request('/api/runs', jsonRequest(body));
    expect(res.status).toBe(201);
    return body.id;
  }

  it('inserts attempts and wrongSubmits in one batch and returns their counts', async () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const app = buildApp(t.handle);
    const runId = await createRun(app);

    const batch = {
      batchId: randomUUID(),
      attempts: [makeAttempt(), makeAttempt({ cardId: 'card-2', outcome: 'miss' })],
      wrongSubmits: [makeWrongSubmit()],
    };

    const res = await app.request(`/api/runs/${runId}/events`, jsonRequest(batch));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ inserted: { attempts: 2, wrongSubmits: 1 } });

    expect(countRows(t.handle.sqlite, 'attempts')).toBe(2);
    expect(countRows(t.handle.sqlite, 'wrong_submits')).toBe(1);
  });

  it('replaying an already-ingested batchId returns {duplicate:true} and inserts nothing further', async () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const app = buildApp(t.handle);
    const runId = await createRun(app);

    const batch = {
      batchId: randomUUID(),
      attempts: [makeAttempt()],
      wrongSubmits: [makeWrongSubmit()],
    };

    const first = await app.request(`/api/runs/${runId}/events`, jsonRequest(batch));
    expect(first.status).toBe(201);

    const replay = await app.request(`/api/runs/${runId}/events`, jsonRequest(batch));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual({ duplicate: true });

    // Row counts must be unchanged by the replay (not doubled).
    expect(countRows(t.handle.sqlite, 'attempts')).toBe(1);
    expect(countRows(t.handle.sqlite, 'wrong_submits')).toBe(1);
  });

  it('returns 404 for an unknown run and inserts zero rows', async () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const app = buildApp(t.handle);

    const batch = {
      batchId: randomUUID(),
      attempts: [makeAttempt()],
      wrongSubmits: [makeWrongSubmit()],
    };

    const res = await app.request(`/api/runs/${randomUUID()}/events`, jsonRequest(batch));
    expect(res.status).toBe(404);

    expect(countRows(t.handle.sqlite, 'attempts')).toBe(0);
    expect(countRows(t.handle.sqlite, 'wrong_submits')).toBe(0);
    expect(countRows(t.handle.sqlite, 'ingested_batches')).toBe(0);
  });

  it('rejects a batch whose 2nd attempt violates the schema with 400 and inserts zero rows', async () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const app = buildApp(t.handle);
    const runId = await createRun(app);

    const batch = {
      batchId: randomUUID(),
      attempts: [makeAttempt(), { ...makeAttempt(), backspaceCount: -1 }],
      wrongSubmits: [],
    };

    const res = await app.request(`/api/runs/${runId}/events`, jsonRequest(batch));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(typeof body.error).toBe('string');

    expect(countRows(t.handle.sqlite, 'attempts')).toBe(0);
    expect(countRows(t.handle.sqlite, 'ingested_batches')).toBe(0);
  });
});

describe('PATCH /api/runs/:id', () => {
  it('returns 404 for an unknown run', async () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const app = buildApp(t.handle);

    const finalize = {
      endedAt: Date.now(),
      score: 100,
      wavesCleared: 1,
      durationMs: 1000,
      pausedMs: 0,
      maxCombo: 3,
      accuracy: 1,
    };

    const res = await app.request(`/api/runs/${randomUUID()}`, jsonRequest(finalize, 'PATCH'));
    expect(res.status).toBe(404);
  });

  it('persists every finalize field and is idempotent when replayed with identical values', async () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const app = buildApp(t.handle);
    const created = makeCreateRunBody();
    const createRes = await app.request('/api/runs', jsonRequest(created));
    expect(createRes.status).toBe(201);

    const finalize = {
      endedAt: created.startedAt + 60_000,
      score: 4200,
      wavesCleared: 5,
      durationMs: 60_000,
      pausedMs: 1500,
      maxCombo: 37,
      accuracy: 0.92,
    };

    const res = await app.request(`/api/runs/${created.id}`, jsonRequest(finalize, 'PATCH'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const row = t.handle.db.select().from(runs).where(eq(runs.id, created.id)).get();
    expect(row?.endedAt).toBe(finalize.endedAt);
    expect(row?.score).toBe(finalize.score);
    expect(row?.wavesCleared).toBe(finalize.wavesCleared);
    expect(row?.durationMs).toBe(finalize.durationMs);
    expect(row?.pausedMs).toBe(finalize.pausedMs);
    expect(row?.maxCombo).toBe(finalize.maxCombo);
    expect(row?.accuracy).toBe(finalize.accuracy);

    const replayRes = await app.request(`/api/runs/${created.id}`, jsonRequest(finalize, 'PATCH'));
    expect(replayRes.status).toBe(200);

    const rowAfterReplay = t.handle.db.select().from(runs).where(eq(runs.id, created.id)).get();
    expect(rowAfterReplay).toEqual(row);
  });
});
