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
const failed = (status: number, body: unknown) =>
  ({ ok: false, status, json: () => Promise.resolve(body) }) as Response;

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
    const result = await previewList('犬');
    if (!result.ok) throw new Error('expected previewList to succeed');
    expect(result.value.summary.resolved).toBe(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('/api/lists/preview');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ text: '犬' });
  });

  it('saveList falls back to a generic message on a 400 with no error body', async () => {
    fetchMock.mockResolvedValueOnce(failed(400, {}));
    expect(await saveList('x', 'bad')).toEqual({
      ok: false, message: 'Request failed — is the server running?',
    });
  });

  // Final-review fix 1: a 400 the server explains (e.g. a caps rejection)
  // must surface its own message instead of collapsing into the generic
  // fallback above — that's what previously misdiagnosed a caps rejection as
  // "is the server running?".
  it('previewList surfaces the error message the server sent on a 400', async () => {
    fetchMock.mockResolvedValueOnce(failed(400, { error: 'too many lines (max 1000)' }));
    expect(await previewList('x')).toEqual({ ok: false, message: 'too many lines (max 1000)' });
  });
});
