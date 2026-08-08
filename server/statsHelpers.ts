import { STATS } from './statsConfig';
import type { attempts, cards } from './db/schema';
import { localDateKey } from './dates';
import { cardStrength, evaluateDirection, type CardAttemptGroup, type DirectionState } from './cardScoring';

type AttemptRow = typeof attempts.$inferSelect;
type CardRow = typeof cards.$inferSelect;

export type Level = 5 | 4 | 3 | 2;

/** profile.targetLevel / cards.jlpt are plain `number` columns at the DB layer (validated on write by
 *  zod, not re-validated on read); defensively narrow to the closed level set, falling back to N2
 *  (the app's own default) rather than propagating a corrupt value into pace/level math. */
export function toLevel(n: number): Level {
  return n === 5 || n === 4 || n === 3 || n === 2 ? n : 2;
}

export interface CardComputed {
  reading: DirectionState;
  recall: DirectionState;
  /** min of both directions' learnedAtMs (whichever direction crossed the gate FIRST), or null if
   *  neither ever has. */
  learnedAtMs: number | null;
  anyLearned: boolean;
  encounters: number;
  strength: number;
  lastSeenAt: number;
}

export function computeCardStats(group: CardAttemptGroup): CardComputed {
  const reading = evaluateDirection(group.reading);
  const recall = evaluateDirection(group.recall);
  const crossings = [reading.learnedAtMs, recall.learnedAtMs].filter((v): v is number => v !== null);
  return {
    reading,
    recall,
    learnedAtMs: crossings.length > 0 ? Math.min(...crossings) : null,
    anyLearned: reading.learned || recall.learned,
    encounters: group.all.length,
    strength: cardStrength(group.all),
    lastSeenAt: group.all[group.all.length - 1].createdAt, // group.all is always non-empty (see groupByCard)
  };
}

export interface LevelStat {
  level: Level;
  total: number;
  encountered: number;
  learned: number;
  coverage: number;
  mastery: number;
}

const LEVELS: readonly Level[] = [5, 4, 3, 2];

/** Level rows count `source==='jlpt'` cards only — custom cards never contribute to level coverage
 *  or mastery denominators (spec §5.1). */
export function computeLevelRows(
  cardRows: readonly CardRow[],
  cardStats: ReadonlyMap<string, CardComputed>,
): LevelStat[] {
  return LEVELS.map((level) => {
    const levelCards = cardRows.filter((c) => c.source === 'jlpt' && c.jlpt === level);
    const total = levelCards.length;
    let encountered = 0;
    let learned = 0;
    for (const card of levelCards) {
      const stats = cardStats.get(card.id);
      if (!stats) continue;
      encountered += 1;
      if (stats.anyLearned) learned += 1;
    }
    return {
      level,
      total,
      encountered,
      learned,
      coverage: total > 0 ? encountered / total : 0,
      mastery: encountered > 0 ? learned / encountered : 0,
    };
  });
}

/** "Highest" JLPT level cleared == LOWEST N-number (N2 is more advanced than N5): spec §5.3 item 2's
 *  "highest level with coverage>=60% and mastery>=70%" is restated here as a literal numeric-minimum
 *  rule since JLPT N-numbers decrease as proficiency increases. */
export function computeEstimatedLevel(levels: readonly LevelStat[]): Level | null {
  let best: Level | null = null;
  for (const l of levels) {
    const passes = l.coverage >= STATS.coverageThreshold && l.mastery >= STATS.masteryThreshold;
    if (passes && (best === null || l.level < best)) best = l.level;
  }
  return best;
}

export interface PaceStat {
  learnRatePerDay: number;
  requiredRatePerDay: number;
  remainingTargetWords: number;
  daysToExam: number;
  onPace: boolean;
}

const DAY_MS = 86_400_000;

export function computePace(
  cardStats: ReadonlyMap<string, CardComputed>,
  levels: readonly LevelStat[],
  targetLevel: Level,
  examDate: string,
  nowMs: number,
): PaceStat {
  const windowStartMs = nowMs - STATS.paceWindowDays * DAY_MS;
  let learnedInWindow = 0;
  for (const stats of cardStats.values()) {
    if (stats.learnedAtMs !== null && stats.learnedAtMs >= windowStartMs && stats.learnedAtMs <= nowMs) {
      learnedInWindow += 1;
    }
  }
  const learnRatePerDay = learnedInWindow / STATS.paceWindowDays;

  // targetLevel always passed through toLevel() and `levels` always has one row per Level (see
  // computeLevelRows), so this lookup can never miss — guarded anyway rather than trusting callers.
  const targetRow = levels.find((l) => l.level === targetLevel);
  const remainingTargetWords = targetRow ? targetRow.total - targetRow.learned : 0;

  // Date-only ISO strings are UTC-midnight per spec, but constructed explicitly here rather than
  // relying on that implicit parsing rule, since examDate is a raw DB string, not zod-revalidated on
  // this read path (see toLevel's comment for the same "defend against a DB-layer value" stance).
  const examMs = Date.parse(`${examDate}T00:00:00.000Z`);
  const daysToExam = Math.max(1, Math.ceil((examMs - nowMs) / DAY_MS));
  const requiredRatePerDay = remainingTargetWords / daysToExam;

  return {
    learnRatePerDay,
    requiredRatePerDay,
    remainingTargetWords,
    daysToExam,
    onPace: learnRatePerDay >= requiredRatePerDay,
  };
}

export interface TrendRow {
  date: string;
  words: number;
  accuracy: number;
}

/** Last `trendDays` calendar days ending today, bucketed by LOCAL date (see `./dates`) so the
 *  trend agrees with the daily new-word budget about what "today" means. Days are walked with
 *  setDate() rather than fixed 24h offsets, which would duplicate or skip a date across a
 *  daylight-saving transition. `trend` has one entry per day in the window (including
 *  zero-activity days); `streakDates` is the subset that actually saw an attempt. */
export function computeTrendAndStreak(
  attemptsAsc: readonly AttemptRow[],
  nowMs: number,
): { trend: TrendRow[]; streakDates: string[] } {
  const dates: string[] = [];
  const cursor = new Date(nowMs);
  cursor.setHours(0, 0, 0, 0);
  for (let i = STATS.trendDays - 1; i >= 0; i--) {
    const day = new Date(cursor);
    day.setDate(cursor.getDate() - i);
    dates.push(localDateKey(day.getTime()));
  }
  const buckets = new Map(dates.map((d) => [d, { cardIds: new Set<string>(), kills: 0, misses: 0 }]));
  for (const a of attemptsAsc) {
    const dateKey = localDateKey(a.createdAt);
    const bucket = buckets.get(dateKey);
    if (!bucket) continue; // older than the trend window
    bucket.cardIds.add(a.cardId);
    if (a.outcome === 'kill') bucket.kills += 1;
    else bucket.misses += 1;
  }
  const trend = dates.map((date) => {
    const b = buckets.get(date)!;
    const total = b.kills + b.misses;
    return { date, words: b.cardIds.size, accuracy: total > 0 ? b.kills / total : 0 };
  });
  const streakDates = dates.filter((date) => buckets.get(date)!.cardIds.size > 0);
  return { trend, streakDates };
}

export interface LeechRow {
  cardId: string;
  kanji: string | null;
  kana: string;
  gloss: string;
  strength: number;
  encounters: number;
}

/** Ascending by strength (weakest first) — encounters gate + top-K limit both come from statsConfig. */
export function computeLeeches(
  cardStats: ReadonlyMap<string, CardComputed>,
  cardsById: ReadonlyMap<string, CardRow>,
): LeechRow[] {
  const candidates: LeechRow[] = [];
  for (const [cardId, stats] of cardStats) {
    if (stats.encounters < STATS.leechMinEncounters) continue;
    const card = cardsById.get(cardId);
    // Defense in depth: computeOverview's only caller already pre-filters cardStats to known card
    // ids (see stats.ts), so this never fires today — kept in case a future caller passes an
    // unfiltered map directly, same reasoning as the guards in windowedAccuracy/cardStrength above.
    if (!card) continue;
    candidates.push({
      cardId,
      kanji: card.kanji,
      kana: card.kana[0],
      gloss: card.gloss,
      strength: stats.strength,
      encounters: stats.encounters,
    });
  }
  candidates.sort((a, b) => a.strength - b.strength);
  return candidates.slice(0, STATS.leechLimit);
}
