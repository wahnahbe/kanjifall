import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLists, previewList, saveList } from '../listsClient';

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const ok = (body: unknown) =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as Response;

describe('listsClient', () => {
  it('fetchLists parses summaries and nulls on failure', async () => {
    fetchMock.mockResolvedValueOnce(ok([{ id: 1, name: 'leeches', cardCount: 2, updatedAt: 5 }]));
    expect(await fetchLists()).toEqual([{ id: 1, name: 'leeches', cardCount: 2, updatedAt: 5 }]);
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    expect(await fetchLists()).toBeNull();
  });

  it('previewList POSTs the text and parses the response', async () => {
    fetchMock.mockResolvedValueOnce(ok({
      lines: [{ line: 1, raw: '犬', status: 'jlpt', cardId: 'jm-1' }],
      summary: { total: 1, resolved: 1, customNew: 0, errors: 0 },
    }));
    const preview = await previewList('犬');
    expect(preview?.summary.resolved).toBe(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('/api/lists/preview');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ text: '犬' });
  });

  it('saveList returns null on a 400 so the screen can show its own error', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: () => Promise.resolve({}) } as Response);
    expect(await saveList('x', 'bad')).toBeNull();
  });
});
