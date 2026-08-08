// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SetupScreen } from '../screens/SetupScreen';

const noop = () => {};

function stubPlanFetch(tiers: unknown[]) {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    if (String(url).includes('/api/plan')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ newCardIds: [], seenCardIds: [], seenCards: [], runBudget: 0, tiers }),
      } as Response);
    }
    return Promise.reject(new Error(`unhandled fetch: ${url}`));
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('SetupScreen tier progress (spec §5.4)', () => {
  it('renders the selected pool\'s active-tier line', async () => {
    stubPlanFetch([{ level: 5, index: 4, totalTiers: 64, size: 10, solid: 6, amnestied: 0 }]);
    render(<SetupScreen loading={false} error={null} onBegin={noop} onBack={noop} />);
    await waitFor(() =>
      expect(screen.getByTestId('tier-progress')).toHaveTextContent('N5 · Tier 4 of 64 — 6/10 solid'),
    );
  });

  it('renders the cleared form when a level has no active tier', async () => {
    stubPlanFetch([{ level: 5, index: null, totalTiers: 64, size: 0, solid: 0, amnestied: 0 }]);
    render(<SetupScreen loading={false} error={null} onBegin={noop} onBack={noop} />);
    await waitFor(() =>
      expect(screen.getByTestId('tier-progress')).toHaveTextContent('N5 · All 64 tiers cleared'),
    );
  });

  it('renders one line per level for the mixed pool', async () => {
    stubPlanFetch([
      { level: 5, index: 2, totalTiers: 64, size: 10, solid: 3, amnestied: 1 },
      { level: 4, index: 1, totalTiers: 62, size: 10, solid: 0, amnestied: 0 },
      { level: 3, index: 1, totalTiers: 145, size: 10, solid: 0, amnestied: 0 },
      { level: 2, index: 1, totalTiers: 168, size: 10, solid: 0, amnestied: 0 },
    ]);
    const { getByTestId } = render(
      <SetupScreen loading={false} error={null} onBegin={noop} onBack={noop} />,
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
