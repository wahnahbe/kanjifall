// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SetupScreen } from '../screens/SetupScreen';

const noop = () => {};

function stubFetch(lists: unknown) {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const u = String(url);
    if (u === '/api/lists') {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(lists) } as Response);
    }
    if (u.includes('/api/plan')) {
      return Promise.resolve({
        ok: true, status: 200,
        json: () => Promise.resolve({ newCardIds: [], seenCards: [], runBudget: 0, tiers: [] }),
      } as Response);
    }
    return Promise.reject(new Error(`unhandled fetch: ${u}`));
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe('SetupScreen list row (custom-list-import spec §5.3)', () => {
  it('renders lists and selecting one begins a list pool', async () => {
    stubFetch([{ id: 3, name: 'leeches', cardCount: 12, updatedAt: 5 }]);
    const onBegin = vi.fn();
    render(
      <SetupScreen loading={false} error={null} onBegin={onBegin} onBack={noop}
        onImport={noop} initialListSelection={null} />,
    );
    await waitFor(() => expect(screen.getByTestId('pool-list-3')).toHaveTextContent('leeches'));
    await userEvent.click(screen.getByTestId('pool-list-3'));
    await userEvent.click(screen.getByTestId('begin-button'));
    expect(onBegin).toHaveBeenCalledWith('reading', 'list:3');
  });

  it('a just-imported list arrives preselected', async () => {
    stubFetch([{ id: 7, name: 'week32', cardCount: 4, updatedAt: 5 }]);
    const onBegin = vi.fn();
    render(
      <SetupScreen loading={false} error={null} onBegin={onBegin} onBack={noop}
        onImport={noop} initialListSelection={{ id: 7, name: 'week32' }} />,
    );
    await userEvent.click(screen.getByTestId('begin-button'));
    expect(onBegin).toHaveBeenCalledWith('reading', 'list:7');
  });

  it('a selected list that vanished falls back to N5', async () => {
    stubFetch([]);
    const onBegin = vi.fn();
    render(
      <SetupScreen loading={false} error={null} onBegin={onBegin} onBack={noop}
        onImport={noop} initialListSelection={{ id: 9, name: 'gone' }} />,
    );
    await waitFor(() => expect(screen.getByTestId('import-button')).toBeInTheDocument());
    await userEvent.click(screen.getByTestId('begin-button'));
    expect(onBegin).toHaveBeenCalledWith('reading', 'n5');
  });

  it('server down: no list row, but Import stays reachable', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    const onImport = vi.fn();
    render(
      <SetupScreen loading={false} error={null} onBegin={noop} onBack={noop}
        onImport={onImport} initialListSelection={null} />,
    );
    await waitFor(() => expect(screen.queryByTestId('list-row')).toBeNull());
    await userEvent.click(screen.getByTestId('import-button'));
    expect(onImport).toHaveBeenCalled();
  });
});
