import { DEFAULT_CONFIG, LANES, STEP_MS } from './constants';
import { InputBuffer } from './InputBuffer';
import { findExactMatches, findPrefixMatches, selectTarget } from './matcher';
import { mulberry32 } from './rng';
import { pointsFor } from './scoring';
import { Spawner, type WavePlan } from './Spawner';
import type {
  AirborneWord, Card, EngineConfig, EngineSnapshot, GameEvent, GameMode, GameStatus,
} from './types';

export interface EngineOptions {
  cards: Card[];
  mode: GameMode;
  seed: number;
  config?: Partial<EngineConfig>;
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
  private timeMs = 0;
  private readonly mode: GameMode;
  private kills = 0;
  private wrongSubmits = 0;

  private wavePlan: WavePlan | null = null;
  private waveQueue: Card[] = [];
  private nextSpawnAt = 0;
  private nextWaveAt = 0;
  private nextInstanceId = 1;
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
    this.spawner = new Spawner(pool, mulberry32(opts.seed), this.config);
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
    this.wavePlan = this.spawner.planWave(wave);
    this.waveQueue = [...this.wavePlan.cards];
    this.emit({ type: 'waveStarting', wave, cards: [...this.wavePlan.cards] });
    if (this.config.pauseOnWaveStart) {
      this.status = 'waveIntro';
      return;
    }
    this.nextSpawnAt = this.timeMs; // first word spawns on the next step
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
    };
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
    this.emit({ type: 'wordMissed', word });
    if (this.lives <= 0) {
      this.status = 'gameOver';
      this.emit({ type: 'gameOver', score: this.score, wave: this.wave });
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
    this.kills += 1;
    this.score += points;
    this.buffer.clear();
    this.refreshLocks();
    this.emit({ type: 'wordKilled', word, msToKill, points, combo: this.combo });
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
