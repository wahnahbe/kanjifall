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
        newCardIds: ['a', 'b'],
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
    // Passed straight through so both the UI (starved-pool detection, spec
    // §3.2, §7) and the engine (Spawner's seen pool, spec §5.3) see the
    // weighted list untouched.
    expect(plan!.seenCards).toEqual([{ id: 'c', weight: 1 }]);
    expect(fetchMock).toHaveBeenCalledWith('/api/plan?pool=n5');
  });

  it('toEnginePlan narrows away tiers', () => {
    const engine = toEnginePlan({
      newCardIds: ['a'],
      seenCards: [{ id: 'b', weight: 0.5 }],
      tiers: [{ level: 5, index: 1, totalTiers: 64, size: 10, solid: 0, amnestied: 0 }],
      runBudget: 1,
      perWaveNewCap: 2,
    });
    expect(engine).toEqual({
      newCardIds: ['a'], seenCards: [{ id: 'b', weight: 0.5 }], runBudget: 1, perWaveNewCap: 2,
    });
    expect(engine).not.toHaveProperty('tiers');
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
