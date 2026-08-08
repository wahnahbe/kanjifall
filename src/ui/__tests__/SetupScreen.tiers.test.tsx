// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SetupScreen } from '../screens/SetupScreen';

const noop = () => {};

/**
 * Keyed by pool so a test can prove the `[pool]`-dependent re-fetch actually
 * happened (each pool gets a distinct payload) rather than merely proving
 * SOME payload rendered, which a pool-agnostic stub can't tell apart from a
 * broken effect dependency. Returns the underlying mock so tests can also
 * inspect the fetched URL (final-review Fix 1: mode must ride along).
 */
function stubPlanFetch(tiersByPool: Record<string, unknown[]>) {
  const fetchMock = vi.fn((url: string) => {
    const u = String(url);
    if (u === '/api/lists') {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve([]) } as Response);
    }
    if (u.includes('/api/plan')) {
      const pool = new URL(u, 'http://localhost').searchParams.get('pool');
      const tiers = pool === null ? undefined : tiersByPool[pool];
      if (tiers === undefined) return Promise.reject(new Error(`no stub for pool: ${pool}`));
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ newCardIds: [], seenCards: [], runBudget: 0, tiers }),
      } as Response);
    }
    return Promise.reject(new Error(`unhandled fetch: ${u}`));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => vi.unstubAllGlobals());

describe('SetupScreen tier progress (spec §5.4)', () => {
  it('renders the selected pool\'s active-tier line', async () => {
    stubPlanFetch({
      n5: [{ level: 5, index: 4, totalTiers: 64, size: 10, solid: 6, amnestied: 0, unreachable: 0 }],
    });
    render(
      <SetupScreen loading={false} error={null} onBegin={noop} onBack={noop}
        onImport={noop} initialListSelection={null} />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('tier-progress')).toHaveTextContent('N5 · Tier 4 of 64 — 6/10 solid'),
    );
  });

  it('renders the cleared form when a level has no active tier', async () => {
    stubPlanFetch({
      n5: [{ level: 5, index: null, totalTiers: 64, size: 0, solid: 0, amnestied: 0, unreachable: 0 }],
    });
    render(
      <SetupScreen loading={false} error={null} onBegin={noop} onBack={noop}
        onImport={noop} initialListSelection={null} />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('tier-progress')).toHaveTextContent('N5 · All 64 tiers cleared'),
    );
  });

  it('renders one line per level for the mixed pool, in level-descending order regardless of arrival order', async () => {
    // n5's payload is deliberately distinct from its entry in the mixed
    // payload below, so the assertions are load-bearing for the [pool]
    // re-fetch: a stale/broken effect would still be showing the n5-only
    // line (or the pre-switch tier-4 line), never the N2 line, which only
    // the mixed payload can produce. The mixed payload also arrives
    // deliberately OUT of level order (N3, N5, N2, N4) to pin the
    // rendered order to a level-descending sort rather than array order
    // (final-review Fix 3 — same defensive posture noticeFor takes).
    stubPlanFetch({
      n5: [{ level: 5, index: 4, totalTiers: 64, size: 10, solid: 6, amnestied: 0, unreachable: 0 }],
      mixed: [
        { level: 3, index: 1, totalTiers: 145, size: 10, solid: 0, amnestied: 0, unreachable: 0 },
        { level: 5, index: 2, totalTiers: 64, size: 10, solid: 3, amnestied: 1, unreachable: 0 },
        { level: 2, index: 1, totalTiers: 168, size: 10, solid: 0, amnestied: 0, unreachable: 0 },
        { level: 4, index: 1, totalTiers: 62, size: 10, solid: 0, amnestied: 0, unreachable: 0 },
      ],
    });
    const { getByTestId } = render(
      <SetupScreen loading={false} error={null} onBegin={noop} onBack={noop}
        onImport={noop} initialListSelection={null} />,
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
    // Arrival order was N3,N5,N2,N4; rendered order must be N5,N4,N3,N2.
    const lines = [...getByTestId('tier-progress').querySelectorAll('p')].map((p) => p.textContent);
    const levelOrder = lines.map((line) => line?.match(/N(\d)/)?.[1]);
    expect(levelOrder).toEqual(['5', '4', '3', '2']);
  });

  it('shows nothing when the plan cannot be fetched (server down never blocks setup)', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    render(
      <SetupScreen loading={false} error={null} onBegin={noop} onBack={noop}
        onImport={noop} initialListSelection={null} />,
    );
    await waitFor(() => expect(screen.queryByTestId('tier-progress')).toBeNull());
  });
});

describe('SetupScreen kana-only tier progress (final-review Fix 1)', () => {
  it('appends the kana-only count and uses the reachable denominator when unreachable > 0', async () => {
    stubPlanFetch({
      n5: [{ level: 5, index: 2, totalTiers: 64, size: 10, solid: 3, amnestied: 0, unreachable: 4 }],
    });
    render(
      <SetupScreen loading={false} error={null} onBegin={noop} onBack={noop}
        onImport={noop} initialListSelection={null} />,
    );
    await waitFor(() =>
      expect(screen.getByTestId('tier-progress')).toHaveTextContent(
        'N5 · Tier 2 of 64 — 3/6 solid · 4 kana-only',
      ),
    );
  });

  it('omits the kana-only suffix entirely when unreachable is 0', async () => {
    stubPlanFetch({
      n5: [{ level: 5, index: 2, totalTiers: 64, size: 10, solid: 3, amnestied: 0, unreachable: 0 }],
    });
    render(
      <SetupScreen loading={false} error={null} onBegin={noop} onBack={noop}
        onImport={noop} initialListSelection={null} />,
    );
    await waitFor(() => {
      const text = screen.getByTestId('tier-progress').textContent ?? '';
      expect(text).toContain('N5 · Tier 2 of 64 — 3/10 solid');
      expect(text).not.toContain('kana-only');
    });
  });
});

describe('SetupScreen tier-preview fetch carries the selected mode (final-review Fix 1)', () => {
  it('requests mode=reading by default and refetches with mode=recall on toggle', async () => {
    const fetchMock = stubPlanFetch({
      n5: [{ level: 5, index: 1, totalTiers: 64, size: 10, solid: 0, amnestied: 0, unreachable: 2 }],
    });
    render(
      <SetupScreen loading={false} error={null} onBegin={noop} onBack={noop}
        onImport={noop} initialListSelection={null} />,
    );
    await waitFor(() => expect(screen.getByTestId('tier-progress')).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('mode=reading'));

    await userEvent.click(screen.getByTestId('mode-recall'));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('mode=recall')),
    );
  });
});
