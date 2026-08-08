import { STATS } from './statsConfig';
import type { attempts } from './db/schema';

/**
 * What is known about a card, computed from its attempt history: the
 * grouped per-direction buckets, the learned gate, and the strength score.
 * Extracted from statsHelpers so server/plan.ts and server/stats.ts share
 * one definition of card knowledge without the planner importing stats
 * internals (tiered-vocab spec §5.2). Thresholds stay in statsConfig.
 */

type AttemptRow = typeof attempts.$inferSelect;

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
export function cardStrength(allAttemptsAsc: readonly AttemptRow[]): number {
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
