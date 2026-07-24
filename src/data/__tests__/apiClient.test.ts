import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateRun, EventsBatch, FinalizeRun } from '../../shared/api';
import { api, ApiError } from '../apiClient';

const ok = (body: unknown = {}) =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as Response;
const fail = (status: number) =>
  ({ ok: false, status, json: () => Promise.reject(new Error('no body')) }) as Response;

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const createRunBody: CreateRun = {
  id: 'run-1', startedAt: 1_000, mode: 'reading', pool: 'n5', appVersion: '1.0.0', listVersion: 'v1',
};

const eventsBatch: EventsBatch = { batchId: 'batch-1', attempts: [], wrongSubmits: [] };

const finalizeBody: FinalizeRun = {
  endedAt: 2_000, score: 100, wavesCleared: 1, durationMs: 1_000, pausedMs: 0, maxCombo: 2, accuracy: 1,
};

describe('api.createRun', () => {
  it('POSTs the run payload as JSON to /api/runs', async () => {
    fetchMock.mockResolvedValueOnce(ok());
    await api.createRun(createRunBody);
    expect(fetchMock).toHaveBeenCalledWith('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(createRunBody),
    });
  });

  it('throws ApiError carrying the response status on a non-ok response', async () => {
    fetchMock.mockResolvedValueOnce(fail(400));
    await expect(api.createRun(createRunBody)).rejects.toBeInstanceOf(ApiError);

    fetchMock.mockResolvedValueOnce(fail(503));
    const error = await api.createRun(createRunBody).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(503);
  });
});

describe('api.postEvents', () => {
  it('POSTs the batch as JSON to /api/runs/:id/events', async () => {
    fetchMock.mockResolvedValueOnce(ok());
    await api.postEvents('run-1', eventsBatch);
    expect(fetchMock).toHaveBeenCalledWith('/api/runs/run-1/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(eventsBatch),
    });
  });

  it('throws ApiError on failure', async () => {
    fetchMock.mockResolvedValueOnce(fail(404));
    await expect(api.postEvents('run-1', eventsBatch)).rejects.toMatchObject({ status: 404 });
  });
});

describe('api.finalizeRun', () => {
  it('PATCHes the finalize body as JSON to /api/runs/:id', async () => {
    fetchMock.mockResolvedValueOnce(ok());
    await api.finalizeRun('run-1', finalizeBody);
    expect(fetchMock).toHaveBeenCalledWith('/api/runs/run-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(finalizeBody),
    });
  });

  it('throws ApiError on failure', async () => {
    fetchMock.mockResolvedValueOnce(fail(500));
    await expect(api.finalizeRun('run-1', finalizeBody)).rejects.toMatchObject({ status: 500 });
  });

  it('resolves without throwing on success', async () => {
    fetchMock.mockResolvedValueOnce(ok());
    await expect(api.finalizeRun('run-1', finalizeBody)).resolves.toBeUndefined();
  });
});
