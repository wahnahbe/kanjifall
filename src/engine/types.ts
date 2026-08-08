export interface Card {
  id: string;
  kanji: string | null; // null = kana-only word (excluded from reading mode)
  kana: string[]; // accepted readings; kana[0] is canonical
  gloss: string;
  pos: string;
  jlpt: 5 | 4 | 3 | 2 | null; // null for custom cards (M2+)
  /** Frequency tier within the card's own JLPT level, 1-based (spec §3.1 of
   *  the tiered-vocabulary spec). Stamped by the build pipeline; absent for
   *  custom cards. The engine itself never reads it. */
  tier?: number;
  source: 'jlpt' | 'custom';
  sentence?: { ja: string; en: string };
  kanjiParts?: { char: string; meaning: string }[];
}

export type GameMode = 'reading' | 'recall';

/** A reviewable card and its draw weight, computed by the server (§3.4).
 *  Weights are relative odds; the engine never interprets their scale. */
export interface SeenCardRef {
  id: string;
  weight: number;
}

/** What this run may introduce and review. Injected — the engine never derives it. */
export interface EnginePlan {
  newCardIds: readonly string[];
  /** The complete reviewable set. Pool cards in NEITHER list are locked and
   *  must never spawn (§5.3): with a tier gate, "not new" no longer implies
   *  "met". */
  seenCards: readonly SeenCardRef[];
  runBudget: number;
  perWaveNewCap: number;
}

export interface AirborneWord {
  instanceId: number;
  card: Card;
  lane: number; // index into LANES
  x: number; // 0..1 horizontal center
  y: number; // 0 = top, 1 = floor
  speed: number; // y-units per second
  spawnedAt: number; // engine clock ms
  firstKeyAt: number | null; // engine clock ms of first lock-on keystroke
  backspaceCount: number;
  hintShown: boolean; // recall-mode grace hint (always false in M1)
  wasTargeted: boolean;
}

export type GameEvent =
  | { type: 'wordSpawned'; word: AirborneWord }
  | { type: 'wordKilled'; word: AirborneWord; msToKill: number; points: number; combo: number }
  | { type: 'wordMissed'; word: AirborneWord }
  | { type: 'wrongSubmit'; submittedKana: string }
  | { type: 'bufferChanged'; kana: string; romaji: string; lockedIds: number[] }
  | { type: 'waveStarting'; wave: number; cards: Card[]; newCards: Card[] }
  | { type: 'resumed'; wave: number }
  | { type: 'waveCleared'; wave: number }
  | { type: 'gameOver'; score: number; wave: number };

export type GameStatus = 'idle' | 'waveIntro' | 'playing' | 'gameOver';

export interface EngineSnapshot {
  status: GameStatus;
  mode: GameMode;
  score: number;
  lives: number;
  wave: number;
  combo: number;
  maxCombo: number;
  kills: number;
  wrongSubmits: number;
  bufferKana: string;
  bufferRomaji: string;
  lockedIds: number[];
  missed: Card[];
  timeMs: number;
}

export interface EngineConfig {
  lives: number;
  baseWaveSize: number; // words in wave 1
  waveSizeGrowth: number; // +words per wave
  maxWaveSize: number;
  maxAirborne: number;
  baseFallSpeed: number; // y-units/sec at wave 1
  fallSpeedGrowth: number; // multiplier increment per wave
  maxFallSpeed: number;
  baseSpawnIntervalMs: number;
  spawnIntervalDecay: number; // multiplier per wave
  minSpawnIntervalMs: number;
  interWaveDelayMs: number;
  hintAtY: number; // recall mode: kanji grace hint appears when word.y crosses this
  pauseOnWaveStart: boolean; // emit waveStarting and hold in 'waveIntro' until resume()
}
