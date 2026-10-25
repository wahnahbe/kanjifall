import { DEFAULT_CONFIG, LANES, STEP_MS } from './constants';
import { InputBuffer } from './InputBuffer';
import { findExactMatches, findPrefixMatches, selectTarget } from './matcher';
import { mulberry32 } from './rng';
import { pointsFor } from './scoring';
import { Spawner, type WavePlan } from './Spawner';
import type {
  AirborneWord, Card, EngineConfig, EnginePlan, EngineSnapshot, GameEvent, GameMode, GameStatus,
} from './types';

export interface EngineOptions {
  cards: Card[];
  mode: GameMode;
  seed: number;
  config?: Partial<EngineConfig>;
  plan?: EnginePlan;
}

export class GameEngine {
  private readonly config: EngineConfig;
  private readonly spawner: Spawner;
  private readonly buffer = new InputBuffer();
  private readonly listeners = new Set<(e: GameEvent) => void>();

  private status: GameStatus = 'idle';
  private words: AirborneWord[] = [];
  private missed: Card[] = [];
  private lockedIds: number[] = [];
  private score = 0;
  private lives: number;
  private wave = 0;
  private combo = 0;
  private maxCombo = 0;
  private timeMs = 0;
  private readonly mode: GameMode;
  private kills = 0;
  private wrongSubmits = 0;

  private wavePlan: WavePlan | null = null;
  private waveQueue: Card[] = [];
  private nextSpawnAt = 0;
  private nextWaveAt = 0;
  private nextInstanceId = 1;

  // The light (lapse spec §5.1). The map is the run's truth about each card
  // ('lit' = owned, 'dark' = lapsed and not yet cleared; absent = plain). A
  // word freezes its own light at spawn, and every event keys on that, never
  // on the live map.
  private readonly lightById = new Map<string, 'lit' | 'dark'>();
  private comebackQueue: Card[] = [];
  private readonly comebackDone = new Set<string>();
  /** How many of the current wave's leading spawns are still comebacks. */
  private comebacksPending = 0;

  private lastNow: number | null = null;
  private accumulator = 0;
  private stepCount = 0;

  constructor(opts: EngineOptions) {
    this.config = { ...DEFAULT_CONFIG, ...opts.config };
    this.lives = this.config.lives;
    this.mode = opts.mode;
    const pool = this.mode === 'reading'
      ? opts.cards.filter((c) => c.kanji !== null)
      : opts.cards;
    // No plan (server unavailable) means nothing counts as new AND nothing is
    // locked: every card is review-eligible at uniform weight — no ceremonies,
    // no budget, no gate, ordinary play. Gameplay never depends on the API (§7).
    // Attempts recorded during such a run don't cost un-taught cards their
    // ceremony: the planner keys seen status on introductions alone, so they
    // stay new until properly introduced (word-intro §3.2, 2026-08-09 fix).
    const plan: EnginePlan = opts.plan ?? {
      newCardIds: [],
      seenCards: pool.map((c) => ({ id: c.id, weight: 1 })),
      runBudget: 0,
      perWaveNewCap: 0,
    };
    this.spawner = new Spawner(pool, mulberry32(opts.seed), this.config, plan);
    // Owned cards fall lit from the first wave (lapse spec §5.1). Without a
    // plan nothing is owned, but kills still promote (§5.2): the light needs
    // no flag, only the map.
    for (const s of plan.seenCards) {
      if (s.owned === true) this.lightById.set(s.id, 'lit');
    }
  }

  subscribe(listener: (e: GameEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.status !== 'idle') return;
    this.status = 'playing';
    this.beginWave(1);
  }

  /** Leave the waveIntro pause and begin (or continue) the wave. */
  resume(): void {
    if (this.status !== 'waveIntro') return;
    this.status = 'playing';
    this.nextSpawnAt = this.timeMs;
    this.lastNow = null; // clean fixed-timestep bootstrap after the pause: discard clock AND backlog
    this.accumulator = 0;
    this.emit({ type: 'resumed', wave: this.wave });
  }

  /** rAF driver entry point. Fixed-timestep with tab-restore clamp. */
  tick(nowMs: number): void {
    if (this.status !== 'playing') return;
    // Bootstrap as if one step already elapsed, so the first real tick always
    // advances the sim by exactly one step instead of a silently-discarded 0.
    if (this.lastNow === null) this.lastNow = nowMs - STEP_MS;
    const dt = Math.min(nowMs - this.lastNow, 100);
    this.lastNow = nowMs;
    this.accumulator += dt;
    while (this.accumulator >= STEP_MS) {
      this.step();
      this.accumulator -= STEP_MS;
      if (this.status !== 'playing') return;
    }
  }

  handleKey(key: string): void {
    // Legitimate engine-level API, pinned by GameEngine.test.ts — but the UI
    // no longer routes keydown here during waveIntro (src/ui/useEngine.ts
    // only forwards keys once status is 'playing'). AcquisitionCeremony owns
    // the paused state and calls resume() directly once every new card has
    // had its ceremony; this branch stays reachable for any non-UI caller.
    if (this.status === 'waveIntro') {
      if (key === 'Enter') this.resume();
      return;
    }
    if (this.status !== 'playing') return;
    if (key === 'Enter') return this.submit();
    if (key === 'Escape') {
      this.buffer.clear();
      return this.refreshLocks();
    }
    if (key === 'Backspace') {
      if (this.buffer.backspace()) {
        for (const w of this.words) {
          if (this.lockedIds.includes(w.instanceId)) w.backspaceCount += 1;
        }
        this.refreshLocks();
      }
      return;
    }
    if (this.buffer.pushKey(key)) this.refreshLocks();
  }

  getWords(): readonly AirborneWord[] {
    return this.words; // render-only; consumers must not mutate
  }

  getSnapshot(): EngineSnapshot {
    return {
      status: this.status,
      mode: this.mode,
      score: this.score,
      lives: this.lives,
      wave: this.wave,
      combo: this.combo,
      maxCombo: this.maxCombo,
      kills: this.kills,
      wrongSubmits: this.wrongSubmits,
      bufferKana: this.buffer.kana,
      bufferRomaji: this.buffer.romaji,
      lockedIds: [...this.lockedIds],
      missed: [...this.missed],
      timeMs: this.timeMs,
    };
  }

  // ---- internals ----

  private emit(event: GameEvent): void {
    for (const l of this.listeners) l(event);
  }

  private beginWave(wave: number): void {
    this.wave = wave;
    // Lapsed cards owed their one comeback lead this wave (lapse spec §5.4).
    this.wavePlan = this.spawner.planWave(wave, this.comebackQueue);
    this.comebackQueue = [];
    this.comebacksPending = this.wavePlan.comebacks.length;
    this.waveQueue = [...this.wavePlan.cards];
    if (this.config.pauseOnWaveStart) {
      this.status = 'waveIntro';
    } else {
      this.nextSpawnAt = this.timeMs; // first word spawns on the next step
    }
    // Emit AFTER the transition: subscribers snapshotting during this event
    // must observe the post-transition state (waveIntro pause included).
    this.emit({ type: 'waveStarting', wave, cards: [...this.wavePlan.cards], newCards: [...this.wavePlan.newCards] });
  }

  private step(): void {
    // Derive from a step counter rather than `timeMs += STEP_MS`: STEP_MS
    // (1000/60) isn't exactly representable, so repeated addition drifts
    // low relative to the single-multiplication values (e.g. nextSpawnAt)
    // it's compared against, occasionally missing an exact-boundary tick.
    this.stepCount += 1;
    this.timeMs = this.stepCount * STEP_MS;
    this.trySpawn();
    this.moveWords();
    this.markHints();
    this.tryAdvanceWave();
  }

  private trySpawn(): void {
    const plan = this.wavePlan;
    if (!plan || this.waveQueue.length === 0) return;
    if (this.timeMs < this.nextSpawnAt) return;
    if (this.words.length >= this.config.maxAirborne) return;
    const card = this.waveQueue.shift()!;
    const lane = this.spawner.pickLane(this.words.filter((w) => w.y < 0.25).map((w) => w.lane));
    const word: AirborneWord = {
      instanceId: this.nextInstanceId++,
      card,
      lane,
      x: LANES[lane],
      y: 0,
      speed: plan.fallSpeed,
      spawnedAt: this.timeMs,
      firstKeyAt: null,
      backspaceCount: 0,
      hintShown: false,
      wasTargeted: false,
      light: this.lightById.get(card.id) ?? 'plain',
      // Only the wave's leading spawns are comebacks; a comeback card drawn
      // again later in the run is an ordinary word.
      comeback: this.comebacksPending > 0,
    };
    if (this.comebacksPending > 0) this.comebacksPending -= 1;
    this.words.push(word);
    this.nextSpawnAt = this.timeMs + plan.spawnIntervalMs;
    this.emit({ type: 'wordSpawned', word });
  }

  private moveWords(): void {
    const landed: AirborneWord[] = [];
    for (const w of this.words) {
      w.y += (w.speed * STEP_MS) / 1000;
      if (w.y >= 1) landed.push(w);
    }
    for (const w of landed) {
      if (this.status !== 'playing') break; // a prior miss may have ended the game
      this.missWord(w);
    }
  }

  private markHints(): void {
    if (this.mode !== 'recall') return;
    for (const w of this.words) {
      if (!w.hintShown && w.y >= this.config.hintAtY) w.hintShown = true;
    }
  }

  private missWord(word: AirborneWord): void {
    this.words = this.words.filter((w) => w.instanceId !== word.instanceId);
    this.missed.push(word.card);
    this.lives -= 1;
    this.combo = 0;
    this.refreshLocks();
    // A lapse is a miss of a word that fell lit (lapse spec §5.3). A dark
    // instance (second drop) and a plain one (a lesson, even if its twin was
    // killed meanwhile and the map says lit) leave the map alone.
    const lapse = word.light === 'lit';
    if (lapse) {
      this.lightById.set(word.card.id, 'dark');
      if (!this.comebackDone.has(word.card.id)) {
        this.comebackDone.add(word.card.id);
        this.comebackQueue.push(word.card);
      }
    }
    this.emit({ type: 'wordMissed', word, lapse, light: word.light });
    if (this.lives <= 0) {
      this.status = 'gameOver';
      this.emit({
        type: 'gameOver', score: this.score, wave: this.wave, ownedIds: [...this.lightById.keys()],
      });
    }
  }

  private tryAdvanceWave(): void {
    if (!this.wavePlan) return;
    if (this.waveQueue.length > 0 || this.words.length > 0) return;
    if (this.nextWaveAt === 0) {
      this.nextWaveAt = this.timeMs + this.config.interWaveDelayMs;
      this.emit({ type: 'waveCleared', wave: this.wave });
      return;
    }
    if (this.timeMs >= this.nextWaveAt) {
      this.nextWaveAt = 0;
      this.beginWave(this.wave + 1);
    }
  }

  private submit(): void {
    const kana = this.buffer.commitKana();
    if (kana.length === 0) return;
    const target = selectTarget(findExactMatches(kana, this.words));
    if (target === null) {
      this.combo = 0;
      this.wrongSubmits += 1;
      this.buffer.clear();
      this.refreshLocks();
      this.emit({ type: 'wrongSubmit', submittedKana: kana });
      return;
    }
    this.killWord(target);
  }

  private killWord(word: AirborneWord): void {
    this.words = this.words.filter((w) => w.instanceId !== word.instanceId);
    const msToKill = this.timeMs - word.spawnedAt;
    const points = pointsFor(word.card, this.wave, this.combo);
    this.combo += 1;
    if (this.combo > this.maxCombo) this.maxCombo = this.combo;
    this.kills += 1;
    this.score += points;
    this.buffer.clear();
    this.refreshLocks();
    // Clearing a dark word is a relit kill; any kill leaves the card lit
    // (lapse spec §5.2).
    const relit = word.light === 'dark';
    this.lightById.set(word.card.id, 'lit');
    this.emit({ type: 'wordKilled', word, msToKill, points, combo: this.combo, relit });
  }

  private refreshLocks(): void {
    const locks = findPrefixMatches(this.buffer.kana, this.words);
    this.lockedIds = locks.map((w) => w.instanceId);
    for (const w of locks) {
      if (w.firstKeyAt === null) {
        w.firstKeyAt = this.timeMs;
        w.wasTargeted = true;
      }
    }
    this.emit({
      type: 'bufferChanged',
      kana: this.buffer.kana,
      romaji: this.buffer.romaji,
      lockedIds: [...this.lockedIds],
    });
  }
}
