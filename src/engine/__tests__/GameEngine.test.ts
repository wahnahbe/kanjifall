import { describe, expect, it } from 'vitest';
import { GameEngine } from '../GameEngine';
import type { Card, GameEvent } from '../types';

const cards: Card[] = [
  { id: 'neko', kanji: '猫', kana: ['ねこ'], gloss: 'cat', pos: 'noun', jlpt: 5, source: 'jlpt' },
  { id: 'inu', kanji: '犬', kana: ['いぬ'], gloss: 'dog', pos: 'noun', jlpt: 5, source: 'jlpt' },
  { id: 'hon', kanji: '本', kana: ['ほん'], gloss: 'book', pos: 'noun', jlpt: 5, source: 'jlpt' },
  { id: 'kana-only', kanji: null, kana: ['それ'], gloss: 'that', pos: 'pron', jlpt: 5, source: 'jlpt' },
];

// 2-word waves, slow spawn, fast fall for test brevity
// (minSpawnIntervalMs must drop below the 1200ms default floor and below
// every baseSpawnIntervalMs override used below, or Spawner's Math.max
// clamp silently overrides the interval a test is trying to set.)
const config = {
  baseWaveSize: 2, waveSizeGrowth: 0, maxWaveSize: 2, maxAirborne: 6,
  baseFallSpeed: 0.1, baseSpawnIntervalMs: 1000, minSpawnIntervalMs: 100,
  interWaveDelayMs: 500,
};

function makeEngine(seed = 1) {
  const engine = new GameEngine({ cards, mode: 'reading', seed, config });
  const events: GameEvent[] = [];
  engine.subscribe((e) => events.push(e));
  engine.start();
  return { engine, events };
}

/** Advance wall-clock; engine steps at its own fixed timestep. */
function advance(engine: GameEngine, ms: number, from = 0): number {
  let now = from;
  const end = from + ms;
  while (now < end) {
    now = Math.min(now + 16, end);
    engine.tick(now);
  }
  return end;
}

const typeWord = (engine: GameEngine, romaji: string) => {
  for (const ch of romaji) engine.handleKey(ch);
  engine.handleKey('Enter');
};

describe('spawning and falling', () => {
  it('excludes kana-only cards in reading mode', () => {
    const { engine } = makeEngine();
    advance(engine, 20_000);
    const seen = new Set(engine.getWords().map((w) => w.card.id));
    expect(seen.has('kana-only')).toBe(false);
  });

  it('spawns the first word immediately and respects spawn interval', () => {
    const { engine, events } = makeEngine();
    advance(engine, 20);
    expect(events.filter((e) => e.type === 'wordSpawned')).toHaveLength(1);
    advance(engine, 1000, 20);
    expect(events.filter((e) => e.type === 'wordSpawned')).toHaveLength(2);
  });

  it('words fall at wave speed', () => {
    const { engine } = makeEngine();
    advance(engine, 1000);
    const word = engine.getWords()[0];
    expect(word.y).toBeCloseTo(0.1, 1);
  });

  it('snapshot is a defensive copy', () => {
    const { engine } = makeEngine();
    advance(engine, 100);
    const snap = engine.getSnapshot();
    snap.missed.push(cards[0]);
    snap.lockedIds.push(999);
    expect(engine.getSnapshot().missed).toHaveLength(0);
    expect(engine.getSnapshot().lockedIds).toHaveLength(0);
  });
});

describe('submit flow', () => {
  it('kills a word on exact reading + Enter, scores, and increments combo', () => {
    const { engine, events } = makeEngine();
    advance(engine, 20);
    const word = engine.getWords()[0];
    const romaji = word.card.id === 'neko' ? 'neko' : word.card.id === 'inu' ? 'inu' : 'hon';
    typeWord(engine, romaji);
    const killed = events.find((e) => e.type === 'wordKilled');
    expect(killed).toBeDefined();
    expect(engine.getSnapshot().score).toBeGreaterThan(0);
    expect(engine.getSnapshot().combo).toBe(1);
    expect(engine.getWords()).toHaveLength(0);
  });

  it('dangling n commits (hon + Enter kills ほん)', () => {
    const hon = cards.filter((c) => c.id === 'hon');
    const engine = new GameEngine({ cards: hon, mode: 'reading', seed: 1, config });
    const events: GameEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();
    advance(engine, 20);
    typeWord(engine, 'hon');
    expect(events.some((e) => e.type === 'wordKilled')).toBe(true);
  });

  it('wrong submit clears buffer, resets combo, costs no life', () => {
    const { engine, events } = makeEngine();
    advance(engine, 20);
    typeWord(engine, 'zzz');
    expect(events.some((e) => e.type === 'wrongSubmit')).toBe(true);
    const snap = engine.getSnapshot();
    expect(snap.lives).toBe(3);
    expect(snap.combo).toBe(0);
    expect(snap.bufferKana).toBe('');
  });

  it('homophones: closest to floor dies', () => {
    const kouen: Card[] = [
      { id: 'park', kanji: '公園', kana: ['こうえん'], gloss: 'park', pos: 'noun', jlpt: 5, source: 'jlpt' },
      { id: 'lecture', kanji: '講演', kana: ['こうえん'], gloss: 'lecture', pos: 'noun', jlpt: 2, source: 'jlpt' },
    ];
    const engine = new GameEngine({
      cards: kouen, mode: 'reading', seed: 1,
      config: { ...config, baseSpawnIntervalMs: 500 },
    });
    const events: GameEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();
    advance(engine, 600); // both airborne; first spawn fell further
    expect(engine.getWords()).toHaveLength(2);
    const lowest = [...engine.getWords()].sort((a, b) => b.y - a.y)[0];
    typeWord(engine, 'kouen');
    const killed = events.find((e) => e.type === 'wordKilled');
    expect(killed && killed.type === 'wordKilled' && killed.word.instanceId).toBe(lowest.instanceId);
  });
});

describe('misses, lives, waves', () => {
  it('a landed word costs a life and is recorded; 3 misses end the game', () => {
    const { engine, events } = makeEngine();
    advance(engine, 60_000); // type nothing; words rain to the floor
    const snap = engine.getSnapshot();
    expect(snap.status).toBe('gameOver');
    expect(snap.lives).toBe(0);
    expect(snap.missed.length).toBeGreaterThanOrEqual(3);
    expect(events.some((e) => e.type === 'gameOver')).toBe(true);
  });

  it('clearing all wave words advances to the next wave after the delay', () => {
    const { engine, events } = makeEngine();
    let now = advance(engine, 20);
    // kill both wave-1 words as they spawn
    for (let i = 0; i < 2; i++) {
      const word = engine.getWords()[0];
      if (!word) { now = advance(engine, 1000, now); continue; }
      const romaji = word.card.id === 'neko' ? 'neko' : word.card.id === 'inu' ? 'inu' : 'hon';
      typeWord(engine, romaji);
      now = advance(engine, 1000, now);
    }
    now = advance(engine, 2000, now);
    expect(events.some((e) => e.type === 'waveCleared' && e.wave === 1)).toBe(true);
    expect(engine.getSnapshot().wave).toBe(2);
  });

  it('lock-on marks wasTargeted and firstKeyAt', () => {
    const { engine } = makeEngine();
    advance(engine, 20);
    const word = engine.getWords()[0];
    const first = word.card.kana[0][0]; // type enough romaji for first kana
    const romajiByKana: Record<string, string> = { ね: 'ne', い: 'i', ほ: 'ho' };
    for (const ch of romajiByKana[first]) engine.handleKey(ch);
    expect(word.wasTargeted).toBe(true);
    expect(word.firstKeyAt).not.toBeNull();
  });
});

describe('determinism', () => {
  it('same seed + same inputs → identical snapshots', () => {
    const run = () => {
      const engine = new GameEngine({ cards, mode: 'reading', seed: 99, config });
      engine.start();
      let now = advance(engine, 500);
      for (const ch of 'neko') engine.handleKey(ch);
      engine.handleKey('Enter');
      now = advance(engine, 3000, now);
      return engine.getSnapshot();
    };
    expect(run()).toEqual(run());
  });
});
