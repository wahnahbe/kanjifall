import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchRunPlan, toEnginePlan } from '../planClient';

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
      ok({
        newCardIds: ['a', 'b'], seenCardIds: ['c'],
        seenCards: [{ id: 'c', weight: 1 }],
        tiers: [{ level: 5, index: 1, totalTiers: 64, size: 10, solid: 0, amnestied: 0 }],
        runBudget: 4,
      }),
    );
    const plan = await fetchRunPlan('n5');
    expect(plan).not.toBeNull();
    expect(plan!.newCardIds).toEqual(['a', 'b']);
    expect(plan!.runBudget).toBe(4);
    expect(plan!.perWaveNewCap).toBeGreaterThan(0);
    // Carried through (not discarded) so the UI can tell a starved pool with
    // history from one that has never been touched at all (spec §3.2, §7) -
    // but kept off the engine-facing shape below.
    expect(plan!.seenCardIds).toEqual(['c']);
    expect(fetchMock).toHaveBeenCalledWith('/api/plan?pool=n5');
  });

  it('toEnginePlan narrows away seenCardIds', () => {
    const engine = toEnginePlan({ newCardIds: ['a'], seenCardIds: ['b'], runBudget: 1, perWaveNewCap: 2 });
    expect(engine).toEqual({ newCardIds: ['a'], runBudget: 1, perWaveNewCap: 2 });
    expect(engine).not.toHaveProperty('seenCardIds');
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
