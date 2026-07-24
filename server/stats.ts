import { asc, eq } from 'drizzle-orm';
import type { DbHandle } from './db/connect';
import { attempts, cards, profile } from './db/schema';
import {
  computeCardStats, computeEstimatedLevel, computeLeeches, computeLevelRows, computePace,
  computeTrendAndStreak, groupByCard, toLevel, type Level,
} from './statsHelpers';
import type { StatsOverview } from '../src/shared/api';

export interface WordStat {
  cardId: string;
  kanji: string | null;
  kana: string;
  gloss: string;
  level: Level | null;
  reading: { encounters: number; accuracy: number };
  recall: { encounters: number; accuracy: number };
  encounters: number;
  strength: number;
  lastSeenAt: number;
}

type AttemptRow = typeof attempts.$inferSelect;
type CardRow = typeof cards.$inferSelect;

/** Shared load: all attempts (ascending by createdAt, and never later than `nowMs` — a defensive
 *  guard against clock-skewed/future-dated rows corrupting the learned/leech/pace math), every card
 *  (level totals need the full table), and the single profile row (guaranteed to exist — connect()'s
 *  ensureProfileRow always seeds id=1). */
function loadAll(handle: DbHandle, nowMs: number): {
  attemptRows: AttemptRow[]; cardRows: CardRow[]; profileRow: typeof profile.$inferSelect;
} {
  const attemptRows = handle.db.select().from(attempts)
    .orderBy(asc(attempts.createdAt))
    .all()
    .filter((a) => a.createdAt <= nowMs);
  const cardRows = handle.db.select().from(cards).all();
  const profileRow = handle.db.select().from(profile).where(eq(profile.id, 1)).get()!;
  return { attemptRows, cardRows, profileRow };
}

export function computeOverview(handle: DbHandle, nowMs: number): StatsOverview {
  const { attemptRows, cardRows, profileRow } = loadAll(handle, nowMs);
  const cardsById = new Map(cardRows.map((c) => [c.id, c]));
  const grouped = groupByCard(attemptRows);
  // An attempt whose cardId has no matching `cards` row (run_id/card_id FKs are declared but not
  // runtime-enforced, see connect.ts) is dropped here, at the single shared source, rather than
  // relying on each downstream consumer to re-check — so an orphaned attempt is invisible EVERYWHERE
  // (learned counts, pace, leeches, trend, streak), not just in the display-oriented ones.
  const cardStats = new Map(
    [...grouped]
      .filter(([cardId]) => cardsById.has(cardId))
      .map(([id, g]) => [id, computeCardStats(g)]),
  );

  // Build the filtered attempt list for trend/streak — only attempts with known cards
  const knownAttempts = attemptRows.filter((a) => cardsById.has(a.cardId));
  const orphanCount = attemptRows.length - knownAttempts.length;
  if (orphanCount > 0) {
    console.warn(`[stats] ignoring ${orphanCount} attempt(s) for unknown cards`);
  }

  const levels = computeLevelRows(cardRows, cardStats);
  const estimatedLevel = computeEstimatedLevel(levels);
  const pace = computePace(cardStats, levels, toLevel(profileRow.targetLevel), profileRow.examDate, nowMs);
  const { trend, streakDates } = computeTrendAndStreak(knownAttempts, nowMs);
  const leeches = computeLeeches(cardStats, cardsById);

  let learnedReading = 0;
  let learnedRecall = 0;
  for (const stats of cardStats.values()) {
    if (stats.reading.learned) learnedReading += 1;
    if (stats.recall.learned) learnedRecall += 1;
  }

  return {
    learned: { reading: learnedReading, recall: learnedRecall },
    levels,
    estimatedLevel,
    pace,
    trend,
    streakDates,
    leeches,
  };
}

export function computeWordStats(handle: DbHandle, nowMs: number): WordStat[] {
  const { attemptRows, cardRows } = loadAll(handle, nowMs);
  const cardsById = new Map(cardRows.map((c) => [c.id, c]));
  const grouped = groupByCard(attemptRows);

  const rows: WordStat[] = [];
  for (const [cardId, group] of grouped) {
    const card = cardsById.get(cardId);
    if (!card) continue; // defensive: an attempt referencing an unknown card id
    const stats = computeCardStats(group);
    rows.push({
      cardId,
      kanji: card.kanji,
      kana: card.kana[0],
      gloss: card.gloss,
      level: card.source === 'jlpt' && card.jlpt !== null ? toLevel(card.jlpt) : null,
      reading: { encounters: stats.reading.encounters, accuracy: stats.reading.accuracy },
      recall: { encounters: stats.recall.encounters, accuracy: stats.recall.accuracy },
      encounters: stats.encounters,
      strength: stats.strength,
      lastSeenAt: stats.lastSeenAt,
    });
  }
  return rows;
}
