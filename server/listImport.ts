import { createHash } from 'node:crypto';
import { isKana } from 'wanakana';
import { GLOSS_MAX } from '../src/data/schema';
import type { Card } from '../src/engine/types';

/**
 * Pure parse + resolve for pasted word lists (custom-list-import spec §3.3).
 * Resolution runs against an in-memory index of the cards table — including
 * prior custom cards, which is what makes duplicate detection honest. The
 * routes own persistence and the request-size caps; this module is total.
 */

export interface CardIndexEntry {
  id: string;
  kanji: string | null;
  kana: string[];
  gloss: string;
  source: string;
}

export interface CardIndex {
  byKanji: Map<string, CardIndexEntry[]>;
  byKana: Map<string, CardIndexEntry[]>;
}

export function buildCardIndex(rows: readonly CardIndexEntry[]): CardIndex {
  const byKanji = new Map<string, CardIndexEntry[]>();
  const byKana = new Map<string, CardIndexEntry[]>();
  const push = (map: Map<string, CardIndexEntry[]>, key: string, row: CardIndexEntry) => {
    const list = map.get(key);
    if (list) list.push(row);
    else map.set(key, [row]);
  };
  for (const row of rows) {
    if (row.kanji !== null) push(byKanji, row.kanji, row);
    for (const reading of row.kana) push(byKana, reading, row);
  }
  return { byKanji, byKana };
}

/** Deterministic across imports and lists (spec §3.2): the same word always
 *  maps to the same card, so history survives deletes and re-imports. */
export function customCardId(kanji: string | null, kana: string): string {
  return 'custom-' + createHash('sha256').update(`${kanji ?? ''}|${kana}`).digest('hex').slice(0, 12);
}

export type LineStatus = 'jlpt' | 'custom-existing' | 'custom-new' | 'error';

export interface ParsedLine {
  line: number;
  raw: string;
  status: LineStatus;
  cardId?: string;
  display?: { kanji: string | null; kana: string; gloss: string };
  error?: string;
  /** Full card body when status is 'custom-new' — server-internal, the
   *  routes strip it before responding. */
  newCard?: Card;
}

export interface ParseResult {
  lines: ParsedLine[];
  summary: { total: number; resolved: number; customNew: number; errors: number };
}


/** TAB when present; otherwise the first two commas, so glosses keep theirs. */
function splitFields(line: string): string[] {
  if (line.includes('\t')) {
    return line.split('\t').map((f) => f.trim()).filter((f) => f.length > 0);
  }
  const first = line.indexOf(',');
  if (first === -1) return [line.trim()];
  const second = line.indexOf(',', first + 1);
  const fields = second === -1
    ? [line.slice(0, first), line.slice(first + 1)]
    : [line.slice(0, first), line.slice(first + 1, second), line.slice(second + 1)];
  return fields.map((f) => f.trim()).filter((f) => f.length > 0);
}

function statusOf(entry: CardIndexEntry): 'jlpt' | 'custom-existing' {
  return entry.source === 'custom' ? 'custom-existing' : 'jlpt';
}

function displayOf(entry: CardIndexEntry): { kanji: string | null; kana: string; gloss: string } {
  return { kanji: entry.kanji, kana: entry.kana[0], gloss: entry.gloss };
}

type Resolution =
  | { kind: 'one'; entry: CardIndexEntry }
  | { kind: 'none' }
  | { kind: 'many'; candidates: CardIndexEntry[] };

function resolveBare(word: string, index: CardIndex, overlay?: { byKanji: Map<string, CardIndexEntry[]>; byKana: Map<string, CardIndexEntry[]> }): Resolution {
  const kanjiMatches = [
    ...(index.byKanji.get(word) ?? []),
    ...(overlay?.byKanji.get(word) ?? []),
  ];
  if (kanjiMatches.length === 1) return { kind: 'one', entry: kanjiMatches[0] };
  if (kanjiMatches.length > 1) return { kind: 'many', candidates: kanjiMatches };
  if (isKana(word)) {
    const kanaMatches = [
      ...(index.byKana.get(word) ?? []),
      ...(overlay?.byKana.get(word) ?? []),
    ];
    if (kanaMatches.length === 1) return { kind: 'one', entry: kanaMatches[0] };
    if (kanaMatches.length > 1) return { kind: 'many', candidates: kanaMatches };
  }
  return { kind: 'none' };
}

/** Full lines resolve only on a UNIQUE match; any ambiguity creates instead —
 *  a full line carries everything needed to stand alone (spec §3.3 rule 5). */
function resolveFull(word: string, kana: string, index: CardIndex, overlay?: { byKanji: Map<string, CardIndexEntry[]>; byKana: Map<string, CardIndexEntry[]> }): CardIndexEntry | null {
  // kana is already validated pure-kana by the caller before this runs, so
  // word === kana would imply isKana(word) anyway — isKana(word) alone
  // covers both cases (final-review fix 7; behavior-neutral).
  const kanaOnly = isKana(word);
  const candidates = kanaOnly
    ? [
      ...(index.byKana.get(kana) ?? []).filter((c) => c.kanji === null),
      ...(overlay?.byKana.get(kana) ?? []).filter((c) => c.kanji === null),
    ]
    : [
      ...(index.byKanji.get(word) ?? []).filter((c) => c.kana.includes(kana)),
      ...(overlay?.byKanji.get(word) ?? []).filter((c) => c.kana.includes(kana)),
    ];
  return candidates.length === 1 ? candidates[0] : null;
}

export function parseListText(text: string, index: CardIndex): ParseResult {
  const lines: ParsedLine[] = [];
  const firstLineByCard = new Map<string, number>();
  const rawLines = text.split('\n');

  // Paste-local overlay: tracks cards created within this paste for duplicate detection
  const overlay: { byKanji: Map<string, CardIndexEntry[]>; byKana: Map<string, CardIndexEntry[]> } = {
    byKanji: new Map(),
    byKana: new Map(),
  };
  const pushToOverlay = (entry: CardIndexEntry) => {
    if (entry.kanji !== null) {
      const list = overlay.byKanji.get(entry.kanji);
      if (list) list.push(entry);
      else overlay.byKanji.set(entry.kanji, [entry]);
    }
    for (const reading of entry.kana) {
      const list = overlay.byKana.get(reading);
      if (list) list.push(entry);
      else overlay.byKana.set(reading, [entry]);
    }
  };

  for (let i = 0; i < rawLines.length; i++) {
    const lineNo = i + 1;
    const raw = rawLines[i].trim();
    if (raw.length === 0 || raw.startsWith('#')) continue;

    const push = (parsed: Omit<ParsedLine, 'line' | 'raw'>) =>
      lines.push({ line: lineNo, raw, ...parsed });
    const pushResolved = (parsed: Omit<ParsedLine, 'line' | 'raw'> & { cardId: string }) => {
      const firstLine = firstLineByCard.get(parsed.cardId);
      if (firstLine !== undefined) {
        push({ status: 'error', error: `duplicate of line ${firstLine}` });
        return;
      }
      firstLineByCard.set(parsed.cardId, lineNo);
      push(parsed);
    };

    const fields = splitFields(raw);
    if (fields.length === 1) {
      const word = fields[0];
      const resolved = resolveBare(word, index, overlay);
      if (resolved.kind === 'one') {
        pushResolved({
          status: statusOf(resolved.entry),
          cardId: resolved.entry.id,
          display: displayOf(resolved.entry),
        });
      } else if (resolved.kind === 'many') {
        const listing = resolved.candidates
          .map((c) => `${c.kanji ?? c.kana[0]} (${c.gloss})`)
          .join(', ');
        push({ status: 'error', error: `ambiguous — ${listing}; supply word‹TAB›kana‹TAB›gloss` });
      } else {
        push({
          status: 'error',
          error: 'not in the built-in N5–N2 data — supply word‹TAB›kana‹TAB›gloss',
        });
      }
      continue;
    }

    if (fields.length !== 3) {
      push({ status: 'error', error: `${fields.length} fields — need 1 (word) or 3 (word, kana, gloss)` });
      continue;
    }

    const [word, kana, gloss] = fields;
    if (!isKana(kana)) {
      push({ status: 'error', error: 'second field must be pure kana' });
      continue;
    }
    if (gloss.length > GLOSS_MAX) {
      push({ status: 'error', error: `gloss too long (max ${GLOSS_MAX} chars)` });
      continue;
    }

    const existing = resolveFull(word, kana, index, overlay);
    if (existing !== null) {
      pushResolved({ status: statusOf(existing), cardId: existing.id, display: displayOf(existing) });
      continue;
    }

    const kanaOnly = word === kana || isKana(word);
    const id = customCardId(kanaOnly ? null : word, kana);
    const newCard: Card = {
      id,
      kanji: kanaOnly ? null : word,
      kana: [kana],
      gloss,
      pos: 'unclassified',
      jlpt: null,
      source: 'custom',
    };
    // Register the new card to the overlay for duplicate detection
    const overlayEntry: CardIndexEntry = {
      id: newCard.id,
      kanji: newCard.kanji,
      kana: newCard.kana,
      gloss: newCard.gloss,
      source: newCard.source,
    };
    pushToOverlay(overlayEntry);

    pushResolved({
      status: 'custom-new',
      cardId: id,
      display: { kanji: newCard.kanji, kana, gloss },
      newCard,
    });
  }

  let resolved = 0;
  let customNew = 0;
  let errors = 0;
  for (const line of lines) {
    if (line.status === 'error') errors += 1;
    else if (line.status === 'custom-new') customNew += 1;
    else resolved += 1;
  }
  return { lines, summary: { total: lines.length, resolved, customNew, errors } };
}
