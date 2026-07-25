import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRunPlan } from '../planClient';

const ok = (body: unknown) =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as Response;
const fail = (status: number) =>
  ({ ok: false, status, json: () => Promise.reject(new Error('no body')) }) as Response;

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('fetchRunPlan', () => {
  it('maps a valid plan onto the engine shape', async () => {
    fetchMock.mockResolvedValueOnce(
      ok({ newCardIds: ['a', 'b'], seenCardIds: ['c'], runBudget: 4 }),
    );
    const plan = await fetchRunPlan('n5');
    expect(plan).not.toBeNull();
    expect(plan!.newCardIds).toEqual(['a', 'b']);
    expect(plan!.runBudget).toBe(4);
    expect(plan!.perWaveNewCap).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledWith('/api/plan?pool=n5');
  });

  it('returns null when the server is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await expect(fetchRunPlan('n5')).resolves.toBeNull();
  });

  it('returns null on an error status or an invalid payload', async () => {
    fetchMock.mockResolvedValueOnce(fail(503));
    await expect(fetchRunPlan('n5')).resolves.toBeNull();
    fetchMock.mockResolvedValueOnce(ok({ nope: true }));
    await expect(fetchRunPlan('n5')).resolves.toBeNull();
  });
});
