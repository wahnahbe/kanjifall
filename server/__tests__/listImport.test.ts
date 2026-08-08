import { describe, expect, it } from 'vitest';
import {
  buildCardIndex, customCardId, parseListText, type CardIndexEntry,
} from '../listImport';

const entry = (
  id: string, kanji: string | null, kana: string[], gloss: string, source = 'jlpt',
): CardIndexEntry => ({ id, kanji, kana, gloss, source });

// 紙/神 share the reading かみ; 犬 is unique; ばら is a kana-only card;
// prior-custom is what an earlier import created.
const INDEX = buildCardIndex([
  entry('jm-1', '犬', ['いぬ'], 'dog'),
  entry('jm-2', '紙', ['かみ'], 'paper'),
  entry('jm-3', '神', ['かみ'], 'god'),
  entry('jm-4', null, ['ばら'], 'rose'),
  entry('custom-aaaaaaaaaaaa', '猫背', ['ねこぜ'], 'slouch', 'custom'),
]);

describe('customCardId', () => {
  it('is deterministic and distinguishes kanji from kana-only forms', () => {
    expect(customCardId('猫背', 'ねこぜ')).toBe(customCardId('猫背', 'ねこぜ'));
    expect(customCardId('猫背', 'ねこぜ')).toMatch(/^custom-[0-9a-f]{12}$/);
    expect(customCardId(null, 'ねこぜ')).not.toBe(customCardId('猫背', 'ねこぜ'));
  });
});

describe('parseListText — line shapes', () => {
  it('skips blanks and # comments but keeps 1-based original numbering', () => {
    const r = parseListText('# from n2-prep\n\n犬\n', INDEX);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0]).toMatchObject({ line: 3, status: 'jlpt', cardId: 'jm-1' });
    expect(r.summary).toEqual({ total: 1, resolved: 1, customNew: 0, errors: 0 });
  });

  it('two fields is a per-line error', () => {
    const r = parseListText('犬\tいぬ', INDEX);
    expect(r.lines[0].status).toBe('error');
    expect(r.lines[0].error).toContain('1');
    expect(r.lines[0].error).toContain('3');
  });

  it('splits on TAB when present, else on the first two commas (gloss keeps its commas)', () => {
    const r = parseListText('狛犬,こまいぬ,guardian dog, lion-dog', INDEX);
    expect(r.lines[0].status).toBe('custom-new');
    expect(r.lines[0].display).toEqual({ kanji: '狛犬', kana: 'こまいぬ', gloss: 'guardian dog, lion-dog' });
  });
});

describe('parseListText — bare-word resolution', () => {
  it('unique kanji match resolves as jlpt', () => {
    const r = parseListText('犬', INDEX);
    expect(r.lines[0]).toMatchObject({
      status: 'jlpt', cardId: 'jm-1', display: { kanji: '犬', kana: 'いぬ', gloss: 'dog' },
    });
  });

  it('a kana bare word matches through the kana index', () => {
    const r = parseListText('ばら', INDEX);
    expect(r.lines[0]).toMatchObject({ status: 'jlpt', cardId: 'jm-4' });
  });

  it('homophones are an error listing every candidate', () => {
    const r = parseListText('かみ', INDEX);
    expect(r.lines[0].status).toBe('error');
    expect(r.lines[0].error).toContain('紙');
    expect(r.lines[0].error).toContain('神');
  });

  it('an unknown bare word tells you to supply the full form', () => {
    const r = parseListText('狛犬', INDEX);
    expect(r.lines[0].status).toBe('error');
    expect(r.lines[0].error).toContain('word‹TAB›kana‹TAB›gloss');
  });

  it('a bare word resolving to a prior custom card is custom-existing', () => {
    const r = parseListText('猫背', INDEX);
    expect(r.lines[0]).toMatchObject({ status: 'custom-existing', cardId: 'custom-aaaaaaaaaaaa' });
  });
});

describe('parseListText — full lines', () => {
  it('a unique kanji+reading match reuses the existing card, its own gloss winning', () => {
    const r = parseListText('紙\tかみ\tsheet', INDEX);
    expect(r.lines[0]).toMatchObject({
      status: 'jlpt', cardId: 'jm-2', display: { kanji: '紙', kana: 'かみ', gloss: 'paper' },
    });
  });

  it('no unique match creates a custom card with the deterministic id', () => {
    const r = parseListText('狛犬\tこまいぬ\tguardian dog', INDEX);
    const line = r.lines[0];
    expect(line.status).toBe('custom-new');
    expect(line.cardId).toBe(customCardId('狛犬', 'こまいぬ'));
    expect(line.newCard).toMatchObject({
      id: line.cardId, kanji: '狛犬', kana: ['こまいぬ'], gloss: 'guardian dog',
      pos: 'unclassified', jlpt: null, source: 'custom',
    });
  });

  it('a kana-only full line stores null kanji', () => {
    const r = parseListText('ぺけ\tぺけ\tcross mark', INDEX);
    expect(r.lines[0].newCard).toMatchObject({ kanji: null, kana: ['ぺけ'] });
  });

  it('non-kana reading and over-long gloss are per-line errors', () => {
    const bad = parseListText('狛犬\tkomainu\tguardian dog', INDEX);
    expect(bad.lines[0].status).toBe('error');
    const long = parseListText(`狛犬\tこまいぬ\t${'x'.repeat(29)}`, INDEX);
    expect(long.lines[0].status).toBe('error');
    expect(long.lines[0].error).toMatch(/28/);
  });
});

describe('parseListText — duplicates', () => {
  it('a later line resolving to the same card errors with the first line number', () => {
    const r = parseListText('犬\n犬\tいぬ\tdog', INDEX);
    expect(r.lines[0].status).toBe('jlpt');
    expect(r.lines[1].status).toBe('error');
    expect(r.lines[1].error).toBe('duplicate of line 1');
  });

  it('two full lines creating the same custom card also collide', () => {
    const r = parseListText('狛犬\tこまいぬ\tguardian dog\n狛犬\tこまいぬ\tlion-dog', INDEX);
    expect(r.lines[1].error).toBe('duplicate of line 1');
    expect(r.summary).toEqual({ total: 2, resolved: 0, customNew: 1, errors: 1 });
  });

  it('a bare word duplicating a custom card created earlier in the same paste is flagged', () => {
    const r = parseListText('狛犬\tこまいぬ\tguardian dog\n狛犬', INDEX);
    expect(r.lines[0].status).toBe('custom-new');
    expect(r.lines[1].status).toBe('error');
    expect(r.lines[1].error).toBe('duplicate of line 1');
  });
});
