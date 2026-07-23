export interface Card {
  id: string;
  kanji: string | null; // null = kana-only word (excluded from reading mode)
  kana: string[]; // accepted readings; kana[0] is canonical
  gloss: string;
  pos: string;
  jlpt: 5 | 4 | 3 | 2 | null; // null for custom cards (M2+)
  source: 'jlpt' | 'custom';
}

export type GameMode = 'reading' | 'recall';

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
  | { type: 'waveStarting'; wave: number; cards: Card[] }
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
