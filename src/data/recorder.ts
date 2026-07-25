import { normalizeReading } from '../engine/matcher';
import type { AirborneWord, Card, EngineSnapshot, GameEvent, GameMode } from '../engine/types';
import type {
  AttemptEvent, CreateRun, EventsBatch, FinalizeRun, IntroductionEvent, WrongSubmitEvent,
} from '../shared/api';
import { api } from './apiClient';
import { pushOutbox } from './outbox';

export interface RecorderContext {
  runId: string; // crypto.randomUUID() from App
  mode: GameMode;
  pool: string;
  cards: Card[]; // the run's pool (for matchedOtherCardId)
  listVersion: string;
}

type EventView = { words: readonly AirborneWord[]; snapshot: EngineSnapshot };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Buffers engine events into attempt/wrong-submit rows and flushes them as
 * idempotent batches at wave/run boundaries. Gameplay never blocks on the
 * network: every send is fire-and-forget from onEvent's perspective, chained
 * through a private `pipeline` promise so operations for this run always
 * settle in the order they occurred. That ordering matters because the
 * server can't accept events for a run it was never told about: if
 * `createRun` failed, every later flush must also go straight to the outbox
 * rather than risk racing ahead of a still-pending createRun retry.
 */
export class RunRecorder {
  private readonly ctx: RecorderContext;
  private readonly startedWallMs: number;
  private pipeline: Promise<void> = Promise.resolve();
  private createRunFailed = false;
  private attempts: AttemptEvent[] = [];
  private wrongSubmits: WrongSubmitEvent[] = [];
  private introductions: IntroductionEvent[] = [];

  constructor(ctx: RecorderContext) {
    this.ctx = ctx;
    this.startedWallMs = Date.now();
    const payload: CreateRun = {
      id: ctx.runId,
      startedAt: this.startedWallMs,
      mode: ctx.mode,
      pool: ctx.pool,
      appVersion: __APP_VERSION__,
      listVersion: ctx.listVersion,
    };
    this.pipeline = this.pipeline.then(() => this.sendCreateRun(payload));
  }

  /** Wire into useEngine's onEvent. Reads words/snapshot at event time. */
  onEvent(event: GameEvent, view: EventView): void {
    switch (event.type) {
      case 'wordKilled':
        this.attempts.push(this.attemptRow(event.word, 'kill', event.msToKill, view));
        return;
      case 'wordMissed':
        this.attempts.push(this.attemptRow(event.word, 'miss', null, view));
        return;
      case 'wrongSubmit':
        this.wrongSubmits.push(this.wrongSubmitRow(event.submittedKana, view.words));
        return;
      case 'waveCleared':
        this.flush();
        return;
      case 'gameOver':
        this.flush();
        this.finalize(view.snapshot);
        return;
      default:
        return; // wordSpawned/bufferChanged/waveStarting/resumed: nothing to record
    }
  }

  /** Called by the ceremony when a word has been introduced (typed or skipped). */
  recordIntroduction(cardId: string): void {
    this.introductions.push({ cardId, introducedAt: Date.now() });
  }

  private attemptRow(
    word: AirborneWord,
    outcome: 'kill' | 'miss',
    msToKill: number | null,
    view: EventView,
  ): AttemptEvent {
    return {
      cardId: word.card.id,
      mode: this.ctx.mode,
      outcome,
      msToFirstKey: word.firstKeyAt === null ? null : Math.round(word.firstKeyAt - word.spawnedAt),
      // Rounded like msToFirstKey: both are differences of engine timeMs values
      // (stepCount * STEP_MS, STEP_MS = 1000/60), which are rarely whole
      // numbers — but attemptSchema.msToKill requires an integer.
      msToKill: msToKill === null ? null : Math.round(msToKill),
      backspaceCount: word.backspaceCount,
      hintShown: word.hintShown,
      wasTargeted: word.wasTargeted,
      airborneCount: view.words.length,
      speedLevel: view.snapshot.wave,
      createdAt: Date.now(),
    };
  }

  private wrongSubmitRow(submittedKana: string, words: readonly AirborneWord[]): WrongSubmitEvent {
    return {
      submittedKana,
      airborneCardIds: words.map((w) => w.card.id),
      matchedOtherCardId: this.findConfusion(submittedKana, words),
      createdAt: Date.now(),
    };
  }

  /**
   * A DIFFERENT pool card whose reading matches what was typed, excluding
   * cards currently airborne: submit() already tried an exact match against
   * them, so if wrongSubmit fired at all, none of them matched. First hit
   * (in pool order) wins; else null.
   */
  private findConfusion(submittedKana: string, words: readonly AirborneWord[]): string | null {
    const target = normalizeReading(submittedKana);
    const airborneIds = new Set(words.map((w) => w.card.id));
    for (const card of this.ctx.cards) {
      if (airborneIds.has(card.id)) continue;
      if (card.kana.some((reading) => normalizeReading(reading) === target)) return card.id;
    }
    return null;
  }

  /** Flushes buffered rows as one batch. Buffer clears optimistically either way. */
  private flush(): void {
    if (
      this.attempts.length === 0 &&
      this.wrongSubmits.length === 0 &&
      this.introductions.length === 0
    ) {
      return;
    }
    const batch: EventsBatch = {
      batchId: crypto.randomUUID(),
      attempts: this.attempts,
      wrongSubmits: this.wrongSubmits,
      introductions: this.introductions,
    };
    this.attempts = [];
    this.wrongSubmits = [];
    this.introductions = [];
    this.pipeline = this.pipeline.then(() => this.sendEvents(batch));
  }

  private async sendCreateRun(payload: CreateRun): Promise<void> {
    try {
      await api.createRun(payload);
    } catch {
      this.createRunFailed = true;
      pushOutbox({ kind: 'createRun', runId: this.ctx.runId, payload });
    }
  }

  private async sendEvents(batch: EventsBatch): Promise<void> {
    if (this.createRunFailed) {
      pushOutbox({ kind: 'events', runId: this.ctx.runId, payload: batch });
      return;
    }
    try {
      await api.postEvents(this.ctx.runId, batch);
    } catch {
      await delay(500);
      try {
        await api.postEvents(this.ctx.runId, batch);
      } catch {
        pushOutbox({ kind: 'events', runId: this.ctx.runId, payload: batch });
      }
    }
  }

  private finalize(snapshot: EngineSnapshot): void {
    const endedAt = Date.now();
    const totalAttempts = snapshot.kills + snapshot.missed.length + snapshot.wrongSubmits;
    const body: FinalizeRun = {
      endedAt,
      score: snapshot.score,
      // snapshot.wave is the wave in progress at death; cleared = one less
      wavesCleared: Math.max(0, snapshot.wave - 1),
      durationMs: Math.round(snapshot.timeMs),
      pausedMs: Math.max(0, Math.round(endedAt - this.startedWallMs - snapshot.timeMs)),
      maxCombo: snapshot.maxCombo,
      accuracy: totalAttempts === 0 ? 0 : snapshot.kills / totalAttempts,
    };
    this.pipeline = this.pipeline.then(() => this.sendFinalize(body));
  }

  private async sendFinalize(body: FinalizeRun): Promise<void> {
    if (this.createRunFailed) {
      pushOutbox({ kind: 'finalize', runId: this.ctx.runId, payload: body });
      return;
    }
    try {
      await api.finalizeRun(this.ctx.runId, body);
    } catch {
      pushOutbox({ kind: 'finalize', runId: this.ctx.runId, payload: body });
    }
  }
}
