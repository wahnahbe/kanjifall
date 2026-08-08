// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SetupScreen } from '../screens/SetupScreen';

const noop = () => {};

/**
 * Keyed by pool so a test can prove the `[pool]`-dependent re-fetch actually
 * happened (each pool gets a distinct payload) rather than merely proving
 * SOME payload rendered, which a pool-agnostic stub can't tell apart from a
 * broken effect dependency.
 */
function stubPlanFetch(tiersByPool: Record<string, unknown[]>) {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const u = String(url);
    if (u.includes('/api/plan')) {
      const pool = new URL(u, 'http://localhost').searchParams.get('pool');
      const tiers = pool === null ? undefined : tiersByPool[pool];
      if (tiers === undefined) return Promise.reject(new Error(`no stub for pool: ${pool}`));
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ newCardIds: [], seenCardIds: [], seenCards: [], runBudget: 0, tiers }),
      } as Response);
    }
    return Promise.reject(new Error(`unhandled fetch: ${u}`));
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('SetupScreen tier progress (spec §5.4)', () => {
  it('renders the selected pool\'s active-tier line', async () => {
    stubPlanFetch({ n5: [{ level: 5, index: 4, totalTiers: 64, size: 10, solid: 6, amnestied: 0 }] });
    render(<SetupScreen loading={false} error={null} onBegin={noop} onBack={noop} />);
    await waitFor(() =>
      expect(screen.getByTestId('tier-progress')).toHaveTextContent('N5 · Tier 4 of 64 — 6/10 solid'),
    );
  });

  it('renders the cleared form when a level has no active tier', async () => {
    stubPlanFetch({ n5: [{ level: 5, index: null, totalTiers: 64, size: 0, solid: 0, amnestied: 0 }] });
    render(<SetupScreen loading={false} error={null} onBegin={noop} onBack={noop} />);
    await waitFor(() =>
      expect(screen.getByTestId('tier-progress')).toHaveTextContent('N5 · All 64 tiers cleared'),
    );
  });

  it('renders one line per level for the mixed pool', async () => {
    // n5's payload is deliberately distinct from its entry in the mixed
    // payload below, so the assertions are load-bearing for the [pool]
    // re-fetch: a stale/broken effect would still be showing the n5-only
    // line (or the pre-switch tier-4 line), never the N2 line, which only
    // the mixed payload can produce.
    stubPlanFetch({
      n5: [{ level: 5, index: 4, totalTiers: 64, size: 10, solid: 6, amnestied: 0 }],
      mixed: [
        { level: 5, index: 2, totalTiers: 64, size: 10, solid: 3, amnestied: 1 },
        { level: 4, index: 1, totalTiers: 62, size: 10, solid: 0, amnestied: 0 },
        { level: 3, index: 1, totalTiers: 145, size: 10, solid: 0, amnestied: 0 },
        { level: 2, index: 1, totalTiers: 168, size: 10, solid: 0, amnestied: 0 },
      ],
    });
    const { getByTestId } = render(
      <SetupScreen loading={false} error={null} onBegin={noop} onBack={noop} />,
    );
    // Establish the n5-only render first so the post-click assertion below
    // can only pass via a genuine re-fetch, not a payload that was already
    // sitting there from the initial mount.
    await waitFor(() =>
      expect(getByTestId('tier-progress')).toHaveTextContent('N5 · Tier 4 of 64 — 6/10 solid'),
    );
    getByTestId('pool-mixed').click();
    await waitFor(() => {
      const text = getByTestId('tier-progress').textContent ?? '';
      expect(text).toContain('N5 · Tier 2 of 64 — 3/10 solid');
      expect(text).toContain('N2 · Tier 1 of 168');
    });
  });

  it('shows nothing when the plan cannot be fetched (server down never blocks setup)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    render(<SetupScreen loading={false} error={null} onBegin={noop} onBack={noop} />);
    await waitFor(() => expect(screen.queryByTestId('tier-progress')).toBeNull());
  });
});
