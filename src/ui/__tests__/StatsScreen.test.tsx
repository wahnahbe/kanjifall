// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Profile, StatsOverview } from '../../shared/api';
import { StatsScreen } from '../screens/StatsScreen';

const ok = (body: unknown): Response =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as Response;
const dbErrorResponse = (detail: { path: string; message: string; recovery: string }): Response =>
  ({ ok: false, status: 503, json: () => Promise.resolve({ dbError: detail }) }) as Response;

afterEach(() => vi.unstubAllGlobals());

// Fixed, arbitrary anchor date (unrelated to the real system clock) so the trend/streak fixture
// is deterministic regardless of when the test suite actually runs.
function isoDate(daysAgo: number): string {
  const anchor = Date.UTC(2026, 6, 22);
  return new Date(anchor - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

function buildTrend(): StatsOverview['trend'] {
  return Array.from({ length: 30 }, (_, i) => {
    const daysAgo = 29 - i;
    return { date: isoDate(daysAgo), words: daysAgo === 0 ? 4 : 1, accuracy: 0.5 };
  });
}

const baseOverview: StatsOverview = {
  learned: { reading: 42, recall: 17 },
  levels: [
    { level: 5, total: 600, encountered: 480, learned: 360, coverage: 0.8, mastery: 0.75 },
    { level: 4, total: 600, encountered: 120, learned: 60, coverage: 0.2, mastery: 0.5 },
    { level: 3, total: 600, encountered: 30, learned: 6, coverage: 0.05, mastery: 0.2 },
    { level: 2, total: 600, encountered: 0, learned: 0, coverage: 0, mastery: 0 },
  ],
  estimatedLevel: 5,
  pace: { learnRatePerDay: 3, requiredRatePerDay: 2, remainingTargetWords: 150, daysToExam: 125, onPace: true },
  trend: buildTrend(),
  streakDates: [isoDate(0), isoDate(1), isoDate(2)],
  leeches: [
    { cardId: 'c1', kanji: '猫', kana: 'ねこ', gloss: 'cat', strength: 12, encounters: 5 },
    { cardId: 'c2', kanji: null, kana: 'いぬ', gloss: 'dog', strength: 34, encounters: 4 },
  ],
};

const baseProfile: Profile = { targetLevel: 2, examDate: '2026-12-06', dailyWordGoal: 20 };

describe('StatsScreen', () => {
  it('renders all five analytics sections from the fetched overview and profile', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(ok(baseOverview)).mockResolvedValueOnce(ok(baseProfile)));

    render(<StatsScreen onBack={() => {}} />);
    await screen.findByTestId('stats-screen');

    // (1) learned counters
    expect(screen.getByTestId('learned-reading')).toHaveTextContent('42');
    expect(screen.getByTestId('learned-recall')).toHaveTextContent('17');

    // (2) level bars + estimated level (honesty-rule caption)
    expect(screen.getByTestId('level-bar-5')).toHaveTextContent('80%');
    expect(screen.getByTestId('level-bar-5')).toHaveTextContent('75%');
    expect(screen.getByTestId('level-bar-4')).toBeInTheDocument();
    expect(screen.getByTestId('level-bar-3')).toBeInTheDocument();
    expect(screen.getByTestId('level-bar-2')).toBeInTheDocument();
    expect(screen.getByTestId('estimated-level')).toHaveTextContent('N5');
    expect(screen.getByText(/vocab-only estimate/i)).toBeInTheDocument();

    // (3) pace panel — on pace
    expect(screen.getByTestId('pace-panel')).toHaveTextContent('On pace ✓');

    // (4) trend chart + streak grid (presence only — recharts renders empty SVG in jsdom)
    expect(screen.getByTestId('trend-chart')).toBeInTheDocument();
    expect(screen.getByTestId('streak-grid')).toBeInTheDocument();

    // (5) leech table
    const leechTable = screen.getByTestId('leech-table');
    expect(leechTable).toHaveTextContent('猫');
    expect(leechTable).toHaveTextContent('ねこ');
    expect(leechTable).toHaveTextContent('cat');
    expect(leechTable).toHaveTextContent('12');
    expect(leechTable).toHaveTextContent('いぬ');
    expect(leechTable).toHaveTextContent('dog');
    expect(leechTable).toHaveTextContent('34');

    // profile mini-editor, seeded from the fetched profile
    expect(screen.getByTestId('profile-form')).toBeInTheDocument();
    expect(screen.getByLabelText('Exam date')).toHaveValue('2026-12-06');
    expect(screen.getByLabelText('Daily goal')).toHaveValue(20);
  });

  it('shows "Behind pace" with both rates and days to exam when off pace', async () => {
    const behindOverview: StatsOverview = {
      ...baseOverview,
      pace: { learnRatePerDay: 1.5, requiredRatePerDay: 4.2, remainingTargetWords: 500, daysToExam: 120, onPace: false },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(ok(behindOverview)).mockResolvedValueOnce(ok(baseProfile)),
    );

    render(<StatsScreen onBack={() => {}} />);
    const pacePanel = await screen.findByTestId('pace-panel');
    expect(pacePanel).toHaveTextContent('Behind pace');
    expect(pacePanel).toHaveTextContent('1.5');
    expect(pacePanel).toHaveTextContent('4.2');
    expect(pacePanel).toHaveTextContent('120');
  });

  it('shows a loading state before the initial fetch resolves', () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => new Promise(() => {})));

    render(<StatsScreen onBack={() => {}} />);
    expect(screen.getByTestId('stats-loading')).toBeInTheDocument();
    expect(screen.queryByTestId('stats-screen')).not.toBeInTheDocument();
  });

  it('renders the DB error variant with path and recovery verbatim on a 503 dbError response', async () => {
    const detail = {
      path: '/data/kotoba.db',
      message: 'unable to open database file',
      recovery: 'Restore the backup or move the corrupt file aside and restart.',
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(dbErrorResponse(detail)).mockResolvedValueOnce(dbErrorResponse(detail)),
    );

    render(<StatsScreen onBack={() => {}} />);
    const errorEl = await screen.findByTestId('db-error');
    expect(errorEl).toHaveTextContent(detail.path);
    expect(errorEl).toHaveTextContent(detail.recovery);
  });

  it('renders the server-down variant with the start command hint on any other failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));

    render(<StatsScreen onBack={() => {}} />);
    const errorEl = await screen.findByTestId('server-down');
    expect(errorEl).toHaveTextContent('npm run dev');
    expect(errorEl).toHaveTextContent('npm start');
  });

  it('Retry re-fetches after a failure and shows the stats once it succeeds', async () => {
    const fetchMock = vi.fn().mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'));
    vi.stubGlobal('fetch', fetchMock);

    render(<StatsScreen onBack={() => {}} />);
    await screen.findByTestId('server-down');

    fetchMock.mockResolvedValueOnce(ok(baseOverview)).mockResolvedValueOnce(ok(baseProfile));
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByTestId('stats-screen');
  });

  it('Back on the error screen calls onBack', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    const onBack = vi.fn();

    render(<StatsScreen onBack={onBack} />);
    await screen.findByTestId('server-down');
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('profile save PUTs the edited draft and refetches overview (GET, GET, PUT, GET)', async () => {
    const updatedProfile: Profile = { targetLevel: 3, examDate: '2027-03-01', dailyWordGoal: 30 };
    const updatedOverview: StatsOverview = { ...baseOverview, pace: { ...baseOverview.pace, onPace: false } };

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(ok(baseOverview))
      .mockResolvedValueOnce(ok(baseProfile))
      .mockResolvedValueOnce(ok(updatedProfile))
      .mockResolvedValueOnce(ok(updatedOverview));
    vi.stubGlobal('fetch', fetchMock);

    render(<StatsScreen onBack={() => {}} />);
    await screen.findByTestId('stats-screen');

    await userEvent.selectOptions(screen.getByLabelText('Target level'), '3');
    fireEvent.change(screen.getByLabelText('Exam date'), { target: { value: '2027-03-01' } });
    fireEvent.change(screen.getByLabelText('Daily goal'), { target: { value: '30' } });
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));

    expect(fetchMock.mock.calls[0]).toEqual(['/api/stats/overview']);
    expect(fetchMock.mock.calls[1]).toEqual(['/api/profile']);
    expect(fetchMock.mock.calls[2]).toEqual(['/api/profile', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(updatedProfile),
    }]);
    expect(fetchMock.mock.calls[3]).toEqual(['/api/stats/overview']);

    // the post-save refetch is reflected (pace flipped to "behind" in updatedOverview)
    await waitFor(() => expect(screen.getByTestId('pace-panel')).toHaveTextContent('Behind pace'));
  });
});
