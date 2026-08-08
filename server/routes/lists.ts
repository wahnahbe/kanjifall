import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { previewRequestSchema, listSaveRequestSchema } from '../../src/shared/api';
import type { DbHandle } from '../db/connect';
import { cards, listCards, lists } from '../db/schema';
import { buildCardIndex, parseListText, type CardIndex, type ParsedLine } from '../listImport';

const CAPS = { maxLines: 1_000, maxLineLength: 200 } as const;

/** Request-size caps live at the route (spec §3.3 rule 8): a hard 400, so
 *  the parser itself stays total. Counts non-empty lines only. */
function capsError(text: string): string | null {
  const rawLines = text.split('\n');
  if (rawLines.filter((l) => l.trim().length > 0).length > CAPS.maxLines) {
    return `too many lines (max ${CAPS.maxLines})`;
  }
  if (rawLines.some((l) => l.length > CAPS.maxLineLength)) {
    return `line too long (max ${CAPS.maxLineLength} chars)`;
  }
  return null;
}

/** The index sees the whole cards table — including prior custom cards,
 *  which is what makes duplicate detection honest (spec §3.3). ~5k rows,
 *  trivially rebuilt per request. */
function loadIndex(handle: DbHandle): CardIndex {
  const rows = handle.db
    .select({ id: cards.id, kanji: cards.kanji, kana: cards.kana, gloss: cards.gloss, source: cards.source })
    .from(cards)
    .all();
  return buildCardIndex(rows);
}

/** The preview's advisory view: newCard bodies are server-internal. */
function toResponseLine({ newCard: _newCard, ...line }: ParsedLine): Omit<ParsedLine, 'newCard'> {
  return line;
}

export function listsRoutes(handle: DbHandle): Hono {
  const app = new Hono();

  app.post('/preview', async (c) => {
    const body = previewRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'text is required' }, 400);
    const capped = capsError(body.data.text);
    if (capped !== null) return c.json({ error: capped }, 400);
    const result = parseListText(body.data.text, loadIndex(handle));
    return c.json({ lines: result.lines.map(toResponseLine), summary: result.summary });
  });

  app.post('/', async (c) => {
    const body = listSaveRequestSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: 'name and text are required' }, 400);
    const capped = capsError(body.data.text);
    if (capped !== null) return c.json({ error: capped }, 400);

    // Re-parse the RAW text inside the save path — the preview is advisory
    // display, never trusted state (spec §5.1).
    const result = parseListText(body.data.text, loadIndex(handle));
    const valid = result.lines.filter((l) => l.status !== 'error');
    if (valid.length === 0) return c.json({ error: 'no valid lines to save' }, 400);

    const now = Date.now();
    const name = body.data.name.trim();
    const upsertCustom = handle.sqlite.prepare(
      `INSERT OR IGNORE INTO cards (id, kanji, kana, gloss, pos, jlpt, tier, source, list_version)
       VALUES (@id, @kanji, @kana, @gloss, @pos, NULL, NULL, 'custom', 'custom-v1')`,
    );
    const insertMember = handle.sqlite.prepare(
      `INSERT INTO list_cards (list_id, card_id, position) VALUES (?, ?, ?)`,
    );

    const save = handle.sqlite.transaction(() => {
      const existing = handle.db.select().from(lists).where(eq(lists.name, name)).get();
      let listId: number;
      const replaced = existing !== undefined;
      if (existing !== undefined) {
        listId = existing.id;
        handle.sqlite.prepare(`UPDATE lists SET updated_at = ? WHERE id = ?`).run(now, listId);
        handle.sqlite.prepare(`DELETE FROM list_cards WHERE list_id = ?`).run(listId);
      } else {
        const inserted = handle.sqlite
          .prepare(`INSERT INTO lists (name, created_at, updated_at) VALUES (?, ?, ?)`)
          .run(name, now, now);
        listId = Number(inserted.lastInsertRowid);
      }
      for (const line of valid) {
        if (line.newCard !== undefined) {
          upsertCustom.run({
            id: line.newCard.id,
            kanji: line.newCard.kanji,
            kana: JSON.stringify(line.newCard.kana),
            gloss: line.newCard.gloss,
            pos: line.newCard.pos,
          });
        }
      }
      valid.forEach((line, position) => insertMember.run(listId, line.cardId!, position));
      return { listId, replaced };
    });
    const { listId, replaced } = save();
    return c.json({ id: listId, name, cardCount: valid.length, replaced });
  });

  app.get('/', (c) => {
    const rows = handle.sqlite
      .prepare(
        `SELECT l.id, l.name, l.updated_at AS updatedAt, COUNT(lc.card_id) AS cardCount
         FROM lists l LEFT JOIN list_cards lc ON lc.list_id = l.id
         GROUP BY l.id ORDER BY l.updated_at DESC`,
      )
      .all();
    return c.json(rows);
  });

  app.get('/:id/cards', (c) => {
    const idParam = c.req.param('id');
    if (!/^\d+$/.test(idParam)) return c.json({ error: 'malformed list id' }, 400);
    const id = Number(idParam);
    const list = handle.db.select().from(lists).where(eq(lists.id, id)).get();
    if (list === undefined) return c.json({ error: `no list ${id}` }, 404);

    const members = handle.db
      .select({
        cardId: listCards.cardId,
        kanji: cards.kanji,
        kana: cards.kana,
        gloss: cards.gloss,
        pos: cards.pos,
        source: cards.source,
      })
      .from(listCards)
      .innerJoin(cards, eq(cards.id, listCards.cardId))
      .where(eq(listCards.listId, id))
      .orderBy(listCards.position)
      .all();

    const customCards = members
      .filter((m) => m.source === 'custom')
      .map((m) => ({
        id: m.cardId, kanji: m.kanji, kana: m.kana, gloss: m.gloss,
        pos: m.pos, jlpt: null, source: 'custom' as const,
      }));
    const jlptCardIds = members.filter((m) => m.source === 'jlpt').map((m) => m.cardId);
    return c.json({
      list: { id: list.id, name: list.name, updatedAt: list.updatedAt },
      customCards,
      jlptCardIds,
    });
  });

  app.delete('/:id', (c) => {
    const idParam = c.req.param('id');
    if (!/^\d+$/.test(idParam)) return c.json({ error: 'malformed list id' }, 400);
    const id = Number(idParam);
    const list = handle.db.select().from(lists).where(eq(lists.id, id)).get();
    if (list === undefined) return c.json({ error: `no list ${id}` }, 404);
    // List + membership only — cards and attempts are NEVER deleted (spec
    // §5.1): deterministic custom ids mean a re-import re-links the history.
    const remove = handle.sqlite.transaction(() => {
      handle.sqlite.prepare(`DELETE FROM list_cards WHERE list_id = ?`).run(id);
      handle.sqlite.prepare(`DELETE FROM lists WHERE id = ?`).run(id);
    });
    remove();
    return c.json({ ok: true });
  });

  return app;
}
