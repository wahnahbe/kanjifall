import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import { buildApp } from '../app';
import { makeTestDb } from '../testDb';
import { attempts, cards, runs } from '../db/schema';
import { statsOverviewSchema } from '../../src/shared/api';
import type { DbHandle } from '../db/connect';

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function seedRun(handle: DbHandle, runId: string): void {
  handle.db.insert(runs).values({
    id: runId, startedAt: Date.now(), mode: 'reading', pool: 'n5', appVersion: '1.0.0', listVersion: 'v1',
  }).run();
}

function insertAttempt(
  handle: DbHandle, runId: string, cardId: string, outcome: 'kill' | 'miss', msToKill: number | null,
): void {
  handle.db.insert(attempts).values({
    runId,
    cardId,
    mode: 'reading',
    outcome,
    msToKill,
    msToFirstKey: outcome === 'kill' ? 100 : null,
    backspaceCount: 0,
    hintShown: false,
    wasTargeted: true,
    airborneCount: 1,
    speedLevel: 1,
    createdAt: Date.now(),
  }).run();
}

describe('GET /api/stats/overview', () => {
  it('returns 200 on an empty DB and the body parses with statsOverviewSchema', async () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const res = await buildApp(t.handle).request('/api/stats/overview');
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(() => statsOverviewSchema.parse(body)).not.toThrow();
  });

  it('still parses with statsOverviewSchema once real attempts exist', async () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const runId = randomUUID();
    seedRun(t.handle, runId);
    const [card] = t.handle.db.select().from(cards)
      .where(and(eq(cards.source, 'jlpt'), eq(cards.jlpt, 5)))
      .limit(1).all();
    insertAttempt(t.handle, runId, card.id, 'kill', 900);
    insertAttempt(t.handle, runId, card.id, 'miss', null);

    const res = await buildApp(t.handle).request('/api/stats/overview');
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(() => statsOverviewSchema.parse(body)).not.toThrow();
  });
});

describe('GET /api/stats/words', () => {
  it('sorts ascending by strength when ?sort=strength', async () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const app = buildApp(t.handle);
    const runId = randomUUID();
    seedRun(t.handle, runId);

    const n5 = t.handle.db.select().from(cards)
      .where(and(eq(cards.source, 'jlpt'), eq(cards.jlpt, 5)))
      .orderBy(asc(cards.id))
      .limit(2)
      .all();
    const [weakCard, strongCard] = n5;

    // weakCard: a single miss -> no kills in its strength window -> recencyAccuracy 0, speedFactor 0 -> strength 0.
    insertAttempt(t.handle, runId, weakCard.id, 'miss', null);
    // strongCard: a single fast kill -> recencyAccuracy 1, speedFactor = clamp01(1-100/15000) ~= 0.9933 ->
    // strength = round(100*(0.7*1+0.3*0.9933)) = round(99.8) = 100.
    insertAttempt(t.handle, runId, strongCard.id, 'kill', 100);

    const res = await app.request('/api/stats/words?sort=strength');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cardId: string; strength: number }[];

    const weakIdx = body.findIndex((w) => w.cardId === weakCard.id);
    const strongIdx = body.findIndex((w) => w.cardId === strongCard.id);
    expect(weakIdx).toBeGreaterThanOrEqual(0);
    expect(strongIdx).toBeGreaterThanOrEqual(0);
    // Ascending: the weak (low-strength) card sorts before the strong (high-strength) card.
    expect(weakIdx).toBeLessThan(strongIdx);
    // The whole response is non-decreasing by strength.
    for (let i = 1; i < body.length; i++) {
      expect(body[i].strength).toBeGreaterThanOrEqual(body[i - 1].strength);
    }
  });

  it('returns natural order (still limited) when no sort param is given', async () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const app = buildApp(t.handle);
    const runId = randomUUID();
    seedRun(t.handle, runId);
    const [card] = t.handle.db.select().from(cards)
      .where(and(eq(cards.source, 'jlpt'), eq(cards.jlpt, 5)))
      .limit(1).all();
    insertAttempt(t.handle, runId, card.id, 'kill', 500);

    const res = await app.request('/api/stats/words');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { cardId: string }[];
    expect(body).toEqual([expect.objectContaining({ cardId: card.id })]);
  });

  it('respects the limit query param', async () => {
    const t = makeTestDb();
    cleanup = t.cleanup;
    const app = buildApp(t.handle);
    const runId = randomUUID();
    seedRun(t.handle, runId);

    const n5 = t.handle.db.select().from(cards)
      .where(and(eq(cards.source, 'jlpt'), eq(cards.jlpt, 5)))
      .orderBy(asc(cards.id))
      .limit(3)
      .all();
    for (const card of n5) insertAttempt(t.handle, runId, card.id, 'kill', 500);

    const res = await app.request('/api/stats/words?sort=strength&limit=2');
    expect(res.status).toBe(200);
    const body = (await res.json()) as unknown[];
    expect(body).toHaveLength(2);
  });
});
