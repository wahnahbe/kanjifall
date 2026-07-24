// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateRun, EventsBatch, FinalizeRun } from '../../shared/api';
import { drainOutbox, pushOutbox, type OutboxEntry } from '../outbox';

const STORAGE_KEY = 'kd.outbox.v1';

function readStored(): OutboxEntry[] {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw === null ? [] : (JSON.parse(raw) as OutboxEntry[]);
}

const ok = () => ({ ok: true, status: 200, json: () => Promise.resolve({}) }) as Response;
const fail = (status: number) =>
  ({ ok: false, status, json: () => Promise.reject(new Error('no body')) }) as Response;

const createRunPayload: CreateRun = {
  id: 'run-1', startedAt: 1, mode: 'reading', pool: 'n5', appVersion: '1.0.0', listVersion: 'v1',
};
const eventsPayload: EventsBatch = { batchId: 'b1', attempts: [], wrongSubmits: [] };
const finalizePayload: FinalizeRun = {
  endedAt: 2, score: 1, wavesCleared: 1, durationMs: 1, pausedMs: 0, maxCombo: 1, accuracy: 1,
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  localStorage.clear();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('pushOutbox', () => {
  it('appends entries to localStorage in FIFO order', () => {
    pushOutbox({ kind: 'createRun', runId: 'run-1', payload: createRunPayload });
    pushOutbox({ kind: 'events', runId: 'run-1', payload: eventsPayload });

    expect(readStored()).toEqual([
      { kind: 'createRun', runId: 'run-1', payload: createRunPayload },
      { kind: 'events', runId: 'run-1', payload: eventsPayload },
    ]);
  });

  it('treats corrupt localStorage content as an empty outbox rather than throwing', () => {
    localStorage.setItem(STORAGE_KEY, 'not valid json{{{');

    expect(() => pushOutbox({ kind: 'events', runId: 'run-1', payload: eventsPayload })).not.toThrow();
    expect(readStored()).toEqual([{ kind: 'events', runId: 'run-1', payload: eventsPayload }]);
  });

  it('treats non-array (but validly-parsed) localStorage content as an empty outbox', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ not: 'an array' }));

    pushOutbox({ kind: 'events', runId: 'run-1', payload: eventsPayload });

    expect(readStored()).toEqual([{ kind: 'events', runId: 'run-1', payload: eventsPayload }]);
  });

  it('caps the queue at 50 via repeated pushes, each dropping exactly one oldest entry (singular wording)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    for (let i = 0; i < 55; i += 1) {
      pushOutbox({ kind: 'events', runId: `run-${i}`, payload: { i } });
    }

    const stored = readStored();
    expect(stored).toHaveLength(50);
    // the oldest 5 (run-0..run-4) were dropped one at a time; run-5 is now the head
    expect(stored[0].runId).toBe('run-5');
    expect(stored[49].runId).toBe('run-54');
    // each of the last 5 pushes overflows the cap by exactly one entry
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dropped 1 oldest entry'));
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('oldest entries'));
    warn.mockRestore();
  });

  it('warns with the plural "entries" wording when a single push overflows the cap by more than one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Directly seed an already-oversized queue (as if the cap were lowered, or
    // storage was written by another tab) so ONE push overflows by 3, not 1.
    const seeded = Array.from({ length: 52 }, (_, i) => (
      { kind: 'events' as const, runId: `seed-${i}`, payload: {} }
    ));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));

    pushOutbox({ kind: 'events', runId: 'run-new', payload: {} });

    expect(readStored()).toHaveLength(50);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('dropped 3 oldest entries'));
    warn.mockRestore();
  });
});

describe('drainOutbox', () => {
  it('is a no-op on an empty outbox', async () => {
    const result = await drainOutbox();
    expect(result).toEqual({ drained: 0, remaining: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('replays every entry via the api in FIFO order and empties the outbox on full success', async () => {
    pushOutbox({ kind: 'createRun', runId: 'run-1', payload: createRunPayload });
    pushOutbox({ kind: 'events', runId: 'run-1', payload: eventsPayload });
    pushOutbox({ kind: 'finalize', runId: 'run-1', payload: finalizePayload });
    fetchMock.mockResolvedValue(ok());

    const result = await drainOutbox();

    expect(result).toEqual({ drained: 3, remaining: 0 });
    expect(readStored()).toEqual([]);
    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/runs', expect.objectContaining({ method: 'POST' }));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/runs/run-1/events',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      '/api/runs/run-1',
      expect.objectContaining({ method: 'PATCH' }),
    );
  });

  it('stops at the first failure, leaving the remaining entries queued in order', async () => {
    pushOutbox({ kind: 'createRun', runId: 'run-1', payload: createRunPayload });
    pushOutbox({ kind: 'events', runId: 'run-1', payload: eventsPayload });
    pushOutbox({ kind: 'finalize', runId: 'run-1', payload: finalizePayload });
    fetchMock
      .mockResolvedValueOnce(ok()) // createRun succeeds
      .mockResolvedValueOnce(fail(500)); // events fails -> drain stops here

    const result = await drainOutbox();

    expect(result).toEqual({ drained: 1, remaining: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2); // finalize never attempted
    expect(readStored()).toEqual([
      { kind: 'events', runId: 'run-1', payload: eventsPayload },
      { kind: 'finalize', runId: 'run-1', payload: finalizePayload },
    ]);
  });

  it('a later drain resumes from where the previous one stopped', async () => {
    pushOutbox({ kind: 'events', runId: 'run-1', payload: eventsPayload });
    pushOutbox({ kind: 'finalize', runId: 'run-1', payload: finalizePayload });
    fetchMock.mockResolvedValueOnce(fail(500));
    const first = await drainOutbox();
    expect(first).toEqual({ drained: 0, remaining: 2 });

    fetchMock.mockResolvedValue(ok());
    const second = await drainOutbox();
    expect(second).toEqual({ drained: 2, remaining: 0 });
    expect(readStored()).toEqual([]);
  });
});
