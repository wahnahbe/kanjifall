import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Card } from '../../engine/types';
import { clearDataCache, DataLoadError, loadPool, POOL_LABELS } from '../loader';

const card = (id: string, jlpt: 5 | 4 | 3 | 2): Card => ({
  id, kanji: '字', kana: ['かな'], gloss: 'g', pos: 'n', jlpt, source: 'jlpt', tier: 1,
});

const levelPayload = (level: 5 | 4 | 3 | 2, ids: string[]) => ({
  listVersion: 'test-v1', level, cards: ids.map((id) => card(id, level)),
});

const ok = (body: unknown) =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as Response;
const fail = (status: number) =>
  ({ ok: false, status, json: () => Promise.reject(new Error('no body')) }) as Response;

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  clearDataCache();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('loadPool', () => {
  it('fetches, validates, and returns a single level', async () => {
    fetchMock.mockResolvedValueOnce(ok(levelPayload(5, ['a', 'b'])));
    const { cards, listVersion } = await loadPool('n5');
    expect(cards.map((c) => c.id)).toEqual(['a', 'b']);
    expect(listVersion).toBe('test-v1');
    expect(fetchMock).toHaveBeenCalledWith('/data/jlpt-n5.json');
  });

  it('caches per level (second load = zero fetches)', async () => {
    fetchMock.mockResolvedValueOnce(ok(levelPayload(4, ['x'])));
    await loadPool('n4');
    await loadPool('n4');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('mixed concatenates all four levels in n5→n2 order', async () => {
    fetchMock.mockImplementation((url: string) => {
      const level = Number(String(url).match(/n(\d)/)?.[1]) as 5 | 4 | 3 | 2;
      return Promise.resolve(ok(levelPayload(level, [`w${level}`])));
    });
    const { cards, listVersion } = await loadPool('mixed');
    expect(cards.map((c) => c.id)).toEqual(['w5', 'w4', 'w3', 'w2']);
    expect(listVersion).toBe('test-v1'); // the n5 file's version
  });

  it('retries once on network failure, then succeeds', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(ok(levelPayload(3, ['r'])));
    const { cards } = await loadPool('n3');
    expect(cards).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws DataLoadError after retry exhaustion and on HTTP errors', async () => {
    fetchMock.mockResolvedValue(fail(404));
    await expect(loadPool('n2')).rejects.toBeInstanceOf(DataLoadError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws DataLoadError on schema-invalid payload and does not cache it', async () => {
    fetchMock.mockResolvedValue(ok({ listVersion: 'v', level: 5, cards: [{ bogus: true }] }));
    await expect(loadPool('n5')).rejects.toBeInstanceOf(DataLoadError);
    fetchMock.mockResolvedValue(ok(levelPayload(5, ['a'])));
    const { cards } = await loadPool('n5');
    expect(cards).toHaveLength(1);
  });

  it('exposes a label for every pool', () => {
    for (const pool of ['n5', 'n4', 'n3', 'n2', 'mixed'] as const) {
      expect(POOL_LABELS[pool].length).toBeGreaterThan(0);
    }
  });

  it('concurrent loads of the same level fetch exactly once', async () => {
    fetchMock.mockResolvedValueOnce(ok(levelPayload(5, ['a'])));
    const [first, second] = await Promise.all([loadPool('n5'), loadPool('n5')]);
    expect(first).toEqual(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('mixed rejects as a whole when one level fails, without refetching the healthy levels later', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes('n3')) return Promise.resolve(fail(500));
      const level = Number(String(url).match(/n(\d)/)?.[1]) as 5 | 4 | 3 | 2;
      return Promise.resolve(ok(levelPayload(level, [`w${level}`])));
    });
    await expect(loadPool('mixed')).rejects.toBeInstanceOf(DataLoadError);
    // n3 fetched twice (retry); n5/n4/n2 once each = 5 calls total
    expect(fetchMock).toHaveBeenCalledTimes(5);
    fetchMock.mockClear();
    fetchMock.mockResolvedValue(ok(levelPayload(3, ['w3'])));
    const { cards } = await loadPool('mixed');
    expect(cards).toHaveLength(4);
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the previously-failed n3 refetches
    expect(fetchMock).toHaveBeenCalledWith('/data/jlpt-n3.json');
  });

  it('DataLoadError carries the level and name', async () => {
    fetchMock.mockResolvedValue(fail(404));
    const error = await loadPool('n2').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DataLoadError);
    expect((error as DataLoadError).level).toBe('n2');
    expect((error as DataLoadError).name).toBe('DataLoadError');
  });
});

describe('loadPool — list pools', () => {
  const listBody = (jlptCardIds: string[]) => ({
    list: { id: 3, name: 'leeches', updatedAt: 1_700_000_000_000 },
    customCards: [{
      id: 'custom-abc123def456', kanji: '狛犬', kana: ['こまいぬ'], gloss: 'guardian dog',
      pos: 'unclassified', jlpt: null, source: 'custom',
    }],
    jlptCardIds,
  });

  it('hydrates jlpt members from the static files and appends customs', async () => {
    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      if (u === '/api/lists/3/cards') return Promise.resolve(ok(listBody(['w5'])));
      const level = Number(u.match(/n(\d)/)?.[1]) as 5 | 4 | 3 | 2;
      return Promise.resolve(ok(levelPayload(level, [`w${level}`])));
    });
    const { cards, listVersion } = await loadPool('list:3');
    expect(cards.map((c) => c.id)).toEqual(['custom-abc123def456', 'w5']);
    expect(cards[1].gloss).toBe('g'); // hydrated from the level file, hooks intact
    expect(listVersion).toBe('list-3@1700000000000');
  });

  it('skips a jlpt id the level files no longer contain', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      if (u === '/api/lists/3/cards') return Promise.resolve(ok(listBody(['gone-id'])));
      const level = Number(u.match(/n(\d)/)?.[1]) as 5 | 4 | 3 | 2;
      return Promise.resolve(ok(levelPayload(level, [`w${level}`])));
    });
    const { cards } = await loadPool('list:3');
    expect(cards.map((c) => c.id)).toEqual(['custom-abc123def456']);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('membership is never cached: two loads fetch the list twice', async () => {
    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      if (u === '/api/lists/3/cards') return Promise.resolve(ok(listBody([])));
      const level = Number(u.match(/n(\d)/)?.[1]) as 5 | 4 | 3 | 2;
      return Promise.resolve(ok(levelPayload(level, [`w${level}`])));
    });
    await loadPool('list:3');
    await loadPool('list:3');
    const listFetches = fetchMock.mock.calls.filter(([u]) => String(u).includes('/api/lists/'));
    expect(listFetches).toHaveLength(2);
  });

  it('a failed list fetch surfaces as DataLoadError', async () => {
    fetchMock.mockResolvedValue(fail(404));
    await expect(loadPool('list:9')).rejects.toBeInstanceOf(DataLoadError);
  });

  it('a level-file failure during hydration is re-tagged with the list pool', async () => {
    fetchMock.mockImplementation((url: string) => {
      const u = String(url);
      if (u === '/api/lists/3/cards') return Promise.resolve(ok(listBody(['w5'])));
      return Promise.resolve(fail(500)); // every level file fails (and retries fail too)
    });
    const error = await loadPool('list:3').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DataLoadError);
    expect((error as DataLoadError).level).toBe('list:3');
  });
});
