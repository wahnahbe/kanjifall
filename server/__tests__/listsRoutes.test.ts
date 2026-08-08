import { afterEach, describe, expect, it } from 'vitest';
import { listCardsResponseSchema, listSaveResponseSchema, previewResponseSchema } from '../../src/shared/api';
import { buildApp } from '../app';
import { makeTestDb } from '../testDb';

let cleanup: (() => void) | null = null;
afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function setup() {
  const t = makeTestDb();
  cleanup = t.cleanup;
  const app = buildApp(t.handle);
  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  // A real N5 word with kanji, straight from the seeded data.
  const seeded = t.handle.sqlite
    .prepare(`SELECT kanji FROM cards WHERE source='jlpt' AND jlpt=5 AND kanji IS NOT NULL ORDER BY id LIMIT 1`)
    .get() as { kanji: string };
  const count = (sql: string) =>
    (t.handle.sqlite.prepare(sql).get() as { n: number }).n;
  return { t, app, post, seededKanji: seeded.kanji, count };
}

describe('POST /api/lists/preview', () => {
  it('parses and resolves without writing anything', async () => {
    const { post, seededKanji, count } = setup();
    const before = count(`SELECT COUNT(*) AS n FROM cards`);
    const res = await post('/api/lists/preview', {
      text: `${seededKanji}\n狛犬\tこまいぬ\tguardian dog\nかみ かみ`,
    });
    expect(res.status).toBe(200);
    const body = previewResponseSchema.parse(await res.json());
    expect(body.summary.total).toBe(3);
    expect(body.lines[0].status).toBe('jlpt');
    expect(body.lines[1].status).toBe('custom-new');
    expect(body.lines[1]).not.toHaveProperty('newCard'); // server-internal field stripped
    expect(count(`SELECT COUNT(*) AS n FROM cards`)).toBe(before);
    expect(count(`SELECT COUNT(*) AS n FROM lists`)).toBe(0);
  });

  it('rejects oversized pastes with 400', async () => {
    const { post } = setup();
    const tooMany = Array.from({ length: 1001 }, (_, i) => `word${i}`).join('\n');
    expect((await post('/api/lists/preview', { text: tooMany })).status).toBe(400);
    expect((await post('/api/lists/preview', { text: 'x'.repeat(201) })).status).toBe(400);
  });
});

describe('POST /api/lists', () => {
  it('creates, then replaces by name keeping the same id; custom cards persist', async () => {
    const { post, seededKanji, count } = setup();
    const first = await post('/api/lists', {
      name: 'leeches', text: `${seededKanji}\n狛犬\tこまいぬ\tguardian dog`,
    });
    expect(first.status).toBe(200);
    const created = listSaveResponseSchema.parse(await first.json());
    expect(created).toMatchObject({ name: 'leeches', cardCount: 2, replaced: false });

    const second = await post('/api/lists', { name: 'leeches', text: seededKanji });
    const replaced = listSaveResponseSchema.parse(await second.json());
    expect(replaced).toMatchObject({ id: created.id, cardCount: 1, replaced: true });
    expect(count(`SELECT COUNT(*) AS n FROM lists`)).toBe(1);
    // The custom card survives losing its membership (history is never deleted).
    expect(count(`SELECT COUNT(*) AS n FROM cards WHERE source='custom'`)).toBe(1);
  });

  it('400s when no line is valid', async () => {
    const { post } = setup();
    expect((await post('/api/lists', { name: 'bad', text: 'かみ かみ' })).status).toBe(400);
  });
});

describe('GET /api/lists and /api/lists/:id/cards', () => {
  it('summaries carry counts; the cards endpoint splits customs from jlpt ids in position order', async () => {
    const { app, post, seededKanji } = setup();
    const saved = listSaveResponseSchema.parse(
      await (await post('/api/lists', {
        name: 'mixed', text: `狛犬\tこまいぬ\tguardian dog\n${seededKanji}`,
      })).json(),
    );

    const listRes = await app.request('/api/lists');
    const summaries = (await listRes.json()) as { id: number; cardCount: number }[];
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({ id: saved.id, cardCount: 2 });

    const cardsRes = await app.request(`/api/lists/${saved.id}/cards`);
    const body = listCardsResponseSchema.parse(await cardsRes.json());
    expect(body.list).toMatchObject({ id: saved.id, name: 'mixed' });
    expect(body.customCards).toHaveLength(1);
    expect(body.customCards[0].kanji).toBe('狛犬');
    expect(body.jlptCardIds).toHaveLength(1);
  });

  it('404s on an unknown or malformed id', async () => {
    const { app } = setup();
    expect((await app.request('/api/lists/999/cards')).status).toBe(404);
    expect((await app.request('/api/lists/abc/cards')).status).toBe(400);
  });
});

describe('DELETE /api/lists/:id', () => {
  it('removes the list and membership but never cards or attempts', async () => {
    const { t, app, post, count } = setup();
    const saved = listSaveResponseSchema.parse(
      await (await post('/api/lists', {
        name: 'doomed', text: '狛犬\tこまいぬ\tguardian dog',
      })).json(),
    );
    // Attach an attempt to the custom card so history survival is provable.
    const customId = (t.handle.sqlite
      .prepare(`SELECT id FROM cards WHERE source='custom'`).get() as { id: string }).id;
    t.handle.sqlite.prepare(
      `INSERT OR IGNORE INTO runs (id, started_at, mode, pool, app_version, list_version)
       VALUES ('run-x', 1, 'reading', 'list:1', 'test', 'test')`,
    ).run();
    t.handle.sqlite.prepare(
      `INSERT INTO attempts (run_id, card_id, mode, outcome, ms_to_first_key, ms_to_kill,
         backspace_count, hint_shown, was_targeted, airborne_count, speed_level, created_at)
       VALUES ('run-x', ?, 'reading', 'kill', 100, 400, 0, 0, 1, 1, 1, 2)`,
    ).run(customId);

    expect((await app.request(`/api/lists/${saved.id}`, { method: 'DELETE' })).status).toBe(200);
    expect(count(`SELECT COUNT(*) AS n FROM lists`)).toBe(0);
    expect(count(`SELECT COUNT(*) AS n FROM list_cards`)).toBe(0);
    expect(count(`SELECT COUNT(*) AS n FROM cards WHERE source='custom'`)).toBe(1);
    expect(count(`SELECT COUNT(*) AS n FROM attempts`)).toBe(1);
    expect((await app.request(`/api/lists/${saved.id}`, { method: 'DELETE' })).status).toBe(404);
  });
});
