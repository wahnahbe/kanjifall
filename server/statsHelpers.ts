import { STATS } from './statsConfig';
import type { attempts, cards } from './db/schema';
import { localDateKey } from './dates';

export type Level = 5 | 4 | 3 | 2;

type AttemptRow = typeof attempts.$inferSelect;
type CardRow = typeof cards.$inferSelect;

/** profile.targetLevel / cards.jlpt are plain `number` columns at the DB layer (validated on write by
 *  zod, not re-validated on read); defensively narrow to the closed level set, falling back to N2
 *  (the app's own default) rather than propagating a corrupt value into pace/level math. */
export function toLevel(n: number): Level {
  return n === 5 || n === 4 || n === 3 || n === 2 ? n : 2;
}

export interface CardAttemptGroup {
  all: AttemptRow[];
  reading: AttemptRow[];
  recall: AttemptRow[];
}

/** Single pass over attempts (already ordered ascending by createdAt) into per-card buckets, each
 *  itself still ascending — one bucket for each direction plus a combined "all" bucket for the
 *  card-level (leech/lastSeenAt) computations that pool both directions. */
export function groupByCard(attemptsAsc: readonly AttemptRow[]): Map<string, CardAttemptGroup> {
  const map = new Map<string, CardAttemptGroup>();
  for (const a of attemptsAsc) {
    let group = map.get(a.cardId);
    if (!group) {
      group = { all: [], reading: [], recall: [] };
      map.set(a.cardId, group);
    }
    group.all.push(a);
    if (a.mode === 'reading') group.reading.push(a);
    else if (a.mode === 'recall') group.recall.push(a);
  }
  return map;
}

export interface DirectionState {
  /** Current status: the LAST min(learnedWindow, encounters) attempts clear the accuracy gate. This
   *  is a live/rolling check — it can go false again after having been true if recent accuracy drops. */
  learned: boolean;
  /** The createdAt of the first attempt at which this direction EVER crossed the learned gate — an
   *  immutable historical event (does not un-set if the direction later regresses), used only to
   *  build the pace ledger (see computePace). Independent of `learned` above by design. */
  learnedAtMs: number | null;
  encounters: number;
  /** Simple kills/total, unwindowed, hinted kills counted as full kills — a plain descriptive stat for
   *  the word table, distinct from the weighted+windowed accuracy the learned-gate uses internally. */
  accuracy: number;
}

function outcomeWeight(a: AttemptRow): number {
  if (a.outcome === 'miss') return 0;
  return a.hintShown ? STATS.hintedKillWeight : 1;
}

function windowedAccuracy(window: readonly AttemptRow[]): number {
  // Guard kept for safety even though evaluateDirection's only call sites always pass windowSize>=1
  // (learnedMinEncounters is >=1) — an empty window is unreachable today, not just untested.
  if (window.length === 0) return 0;
  const sum = window.reduce((s, a) => s + outcomeWeight(a), 0);
  return sum / window.length; // divide by the window count actually present, per the brief
}

export function evaluateDirection(attemptsAsc: readonly AttemptRow[]): DirectionState {
  const n = attemptsAsc.length;

  let learnedAtMs: number | null = null;
  for (let i = 0; i < n; i++) {
    const encounters = i + 1;
    if (encounters < STATS.learnedMinEncounters) continue;
    const windowSize = Math.min(STATS.learnedWindow, encounters);
    const acc = windowedAccuracy(attemptsAsc.slice(i + 1 - windowSize, i + 1));
    if (acc >= STATS.learnedMinAccuracy) {
      learnedAtMs = attemptsAsc[i].createdAt;
      break;
    }
  }

  let learned = false;
  if (n >= STATS.learnedMinEncounters) {
    const windowSize = Math.min(STATS.learnedWindow, n);
    learned = windowedAccuracy(attemptsAsc.slice(n - windowSize)) >= STATS.learnedMinAccuracy;
  }

  const kills = attemptsAsc.filter((a) => a.outcome === 'kill').length;
  return { learned, learnedAtMs, encounters: n, accuracy: n > 0 ? kills / n : 0 };
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** round(100 * (accuracyWeight*recencyAccuracy + speedWeight*speedFactor)) over the last leechWindow
 *  attempts (both directions pooled, most-recent-first, age 0 = most recent). Kills count as a full 1
 *  REGARDLESS of hint status: hintedKillWeight only gates the "learned" rule above, never leech
 *  strength. (Provable from the golden fixture: down-weighting a hinted kill here would rank a
 *  perfect-but-hinted card ahead of a card with a real miss, contradicting the spec's own leech
 *  ordering — see server/__tests__/stats.test.ts's leech comment for the worked numbers.) */
function cardStrength(allAttemptsAsc: readonly AttemptRow[]): number {
  const window = allAttemptsAsc.slice(-STATS.leechWindow);
  let weightedSum = 0;
  let weightSum = 0;
  let killMsSum = 0;
  let killCount = 0;
  for (let age = 0; age < window.length; age++) {
    const a = window[window.length - 1 - age];
    const weight = STATS.leechRecencyDecay ** age;
    weightSum += weight;
    if (a.outcome === 'kill') {
      weightedSum += weight;
      if (a.msToKill !== null) {
        killMsSum += a.msToKill;
        killCount += 1;
      }
    }
  }
  // weightSum is 0 only when window.length is 0, which groupByCard's invariant (never creates an
  // empty CardAttemptGroup) makes unreachable here — guard kept anyway as a division-by-zero safety net.
  const recencyAccuracy = weightSum > 0 ? weightedSum / weightSum : 0;
  const speedFactor = killCount > 0
    ? clamp01(1 - killMsSum / killCount / STATS.leechSpeedCeilingMs)
    : 0; // "speed factor only over kills (if no kills, factor 0)"
  return Math.round(100 * (STATS.leechAccuracyWeight * recencyAccuracy + STATS.leechSpeedWeight * speedFactor));
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
