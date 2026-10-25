import { describe, expect, it } from 'vitest';
import { GameEngine } from '../GameEngine';
import { STEP_MS } from '../constants';
import type { Card, EngineConfig, EnginePlan, GameEvent } from '../types';

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

function makeEngineWithPlan(plan: EnginePlan, seed = 1, configOverride: Partial<EngineConfig> = {}) {
  const engine = new GameEngine({
    cards, mode: 'reading', seed, config: { ...config, ...configOverride }, plan,
  });
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

  it('includes kana-only cards in recall mode', () => {
    const kanaOnly = cards.filter((c) => c.id === 'kana-only');
    const engine = new GameEngine({ cards: kanaOnly, mode: 'recall', seed: 1, config });
    engine.start();
    advance(engine, 20);
    expect(engine.getWords().map((w) => w.card.id)).toEqual(['kana-only']);
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

describe('key handling', () => {
  const makeNekoEngine = () => {
    const neko = cards.filter((c) => c.id === 'neko');
    const engine = new GameEngine({ cards: neko, mode: 'reading', seed: 1, config });
    const events: GameEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();
    advance(engine, 20);
    return { engine, events, word: engine.getWords()[0] };
  };

  it('Escape clears the buffer and releases locks', () => {
    const { engine, word } = makeNekoEngine();
    engine.handleKey('n');
    engine.handleKey('e');
    expect(engine.getSnapshot().lockedIds).toEqual([word.instanceId]);
    engine.handleKey('Escape');
    const snap = engine.getSnapshot();
    expect(snap.bufferKana).toBe('');
    expect(snap.bufferRomaji).toBe('');
    expect(snap.lockedIds).toEqual([]);
  });

  it('Backspace edits the buffer and counts against locked words', () => {
    const { engine, word } = makeNekoEngine();
    engine.handleKey('n');
    engine.handleKey('e');
    engine.handleKey('Backspace'); // ね → n
    expect(word.backspaceCount).toBe(1);
    const snap = engine.getSnapshot();
    expect(snap.bufferRomaji).toBe('n');
    expect(snap.lockedIds).toEqual([]); // bare romaji tail locks nothing
  });

  it('Backspace on an empty buffer is a no-op', () => {
    const { engine, events, word } = makeNekoEngine();
    const bufferEvents = events.filter((e) => e.type === 'bufferChanged').length;
    engine.handleKey('Backspace');
    expect(events.filter((e) => e.type === 'bufferChanged')).toHaveLength(bufferEvents);
    expect(word.backspaceCount).toBe(0);
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

  it('two words landing in the same step emit gameOver once', () => {
    const engine = new GameEngine({
      cards, mode: 'reading', seed: 1,
      config: { ...config, lives: 1, baseSpawnIntervalMs: 500 },
    });
    const events: GameEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();
    advance(engine, 700);
    expect(engine.getWords()).toHaveLength(2);
    // Force both onto the floor for the same step — unreachable through normal
    // pacing (equal speeds, staggered spawns), but the guard must hold if it
    // ever happens.
    for (const w of engine.getWords()) w.y = 0.999;
    advance(engine, 100, 700);
    expect(events.filter((e) => e.type === 'gameOver')).toHaveLength(1);
    expect(engine.getSnapshot().lives).toBe(0);
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

describe('wave intro, hints, counters (M2)', () => {
  const introConfig = { ...config, pauseOnWaveStart: true };

  function makeIntroEngine(mode: 'reading' | 'recall' = 'reading') {
    const engine = new GameEngine({ cards, mode, seed: 1, config: introConfig });
    const events: GameEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();
    return { engine, events };
  }

  it('start() with pauseOnWaveStart holds in waveIntro and emits waveStarting with the wave cards', () => {
    const { engine, events } = makeIntroEngine();
    expect(engine.getSnapshot().status).toBe('waveIntro');
    const starting = events.find((e) => e.type === 'waveStarting');
    expect(starting && starting.type === 'waveStarting' && starting.cards.length).toBe(2);
    expect(events.some((e) => e.type === 'wordSpawned')).toBe(false);
  });

  it('tick() is inert during waveIntro (no time, no spawns)', () => {
    const { engine, events } = makeIntroEngine();
    advance(engine, 5000);
    expect(engine.getSnapshot().timeMs).toBe(0);
    expect(events.some((e) => e.type === 'wordSpawned')).toBe(false);
  });

  it('resume() starts play; Enter during intro resumes; letters are ignored', () => {
    const { engine, events } = makeIntroEngine();
    engine.handleKey('a');
    expect(engine.getSnapshot().status).toBe('waveIntro');
    engine.handleKey('Escape');
    engine.handleKey('Backspace');
    expect(engine.getSnapshot().status).toBe('waveIntro');
    engine.handleKey('Enter');
    expect(engine.getSnapshot().status).toBe('playing');
    expect(events.some((e) => e.type === 'resumed')).toBe(true);
    advance(engine, 50);
    expect(events.some((e) => e.type === 'wordSpawned')).toBe(true);
  });

  it('resume() is a no-op while playing', () => {
    const { engine, events } = makeIntroEngine();
    engine.handleKey('Enter');
    const resumedCount = events.filter((e) => e.type === 'resumed').length;
    const before = engine.getSnapshot();
    engine.resume();
    expect(engine.getSnapshot().status).toBe('playing');
    expect(engine.getSnapshot().timeMs).toBe(before.timeMs);
    expect(events.filter((e) => e.type === 'resumed')).toHaveLength(resumedCount);
  });

  it('the next wave pauses again with its own cards', () => {
    const { engine, events } = makeIntroEngine();
    engine.handleKey('Enter');
    let now = advance(engine, 20);
    for (let i = 0; i < 2; i++) {
      const word = engine.getWords()[0];
      if (word) {
        const romaji = word.card.id === 'neko' ? 'neko' : word.card.id === 'inu' ? 'inu' : 'hon';
        typeWord(engine, romaji);
      }
      now = advance(engine, 1100, now);
    }
    now = advance(engine, 2000, now);
    expect(engine.getSnapshot().status).toBe('waveIntro');
    const startings = events.filter((e) => e.type === 'waveStarting');
    expect(startings).toHaveLength(2);
    expect(engine.getSnapshot().wave).toBe(2);
  });

  it('without pauseOnWaveStart, waveStarting is still emitted but play begins immediately', () => {
    const { engine, events } = makeEngine();
    expect(engine.getSnapshot().status).toBe('playing');
    expect(events.some((e) => e.type === 'waveStarting')).toBe(true);
  });

  it('recall mode marks hintShown when a word crosses hintAtY; reading mode never does', () => {
    const recall = new GameEngine({ cards, mode: 'recall', seed: 1, config: { ...config, hintAtY: 0.3 } });
    recall.start();
    advance(recall, 4000); // 0.1 y/s → y≈0.4 > 0.3
    expect(recall.getWords().some((w) => w.hintShown)).toBe(true);

    const reading = new GameEngine({ cards, mode: 'reading', seed: 1, config: { ...config, hintAtY: 0.3 } });
    reading.start();
    advance(reading, 4000);
    expect(reading.getWords().every((w) => !w.hintShown)).toBe(true);
  });

  it('snapshot carries mode, kills, and wrongSubmits', () => {
    const { engine } = makeEngine();
    advance(engine, 20);
    typeWord(engine, 'zzz'); // wrong submit
    const word = engine.getWords()[0];
    const romaji = word.card.id === 'neko' ? 'neko' : word.card.id === 'inu' ? 'inu' : 'hon';
    typeWord(engine, romaji);
    const snap = engine.getSnapshot();
    expect(snap.mode).toBe('reading');
    expect(snap.kills).toBe(1);
    expect(snap.wrongSubmits).toBe(1);
  });

  it('maxCombo tracks the peak combo and survives a reset by a wrong submit', () => {
    const engine = new GameEngine({
      cards, mode: 'reading', seed: 1,
      config: { ...config, baseWaveSize: 3, maxWaveSize: 3 },
    });
    engine.start();

    const killNextWord = () => {
      const word = engine.getWords()[0];
      const romaji = word.card.id === 'neko' ? 'neko' : word.card.id === 'inu' ? 'inu' : 'hon';
      typeWord(engine, romaji);
    };

    let now = advance(engine, 20);
    killNextWord(); // kill 1: combo 1
    now = advance(engine, 1000, now);
    killNextWord(); // kill 2: combo 2 (peak)
    now = advance(engine, 1000, now);
    typeWord(engine, 'zzz'); // wrong submit: combo resets to 0
    killNextWord(); // kill 3: combo 1

    const snap = engine.getSnapshot();
    expect(snap.combo).toBe(1);
    expect(snap.maxCombo).toBe(2);
  });

  it('resume() discards paused-tick backlog (no step burst after mid-drain wave transition)', () => {
    const engine = new GameEngine({ cards, mode: 'reading', seed: 1, config: introConfig });
    let clearedAt: number | null = null;
    engine.subscribe((e) => {
      if (e.type === 'waveCleared') clearedAt = engine.getSnapshot().timeMs;
    });
    engine.start();
    engine.handleKey('Enter'); // dismiss wave-1 intro
    let now = advance(engine, 20);
    const killFirst = () => {
      const word = engine.getWords()[0]!;
      const romaji = word.card.id === 'neko' ? 'neko' : word.card.id === 'inu' ? 'inu' : 'hon';
      typeWord(engine, romaji);
    };
    killFirst(); // word 1 dies ~t=20
    now = advance(engine, 1000, now); // word 2 spawns ~t=1017
    killFirst(); // word 2 dies
    now = advance(engine, 32, now); // let waveCleared fire (1-2 steps)
    expect(clearedAt).not.toBeNull();
    const boundary = clearedAt! + introConfig.interWaveDelayMs;
    expect(engine.getSnapshot().status).toBe('playing'); // wave 2 must NOT have begun yet

    // Walk in small real-time ticks to just before the boundary, still playing.
    while (engine.getSnapshot().timeMs < boundary - 20) {
      now += 16;
      engine.tick(now);
    }
    expect(engine.getSnapshot().status).toBe('playing');

    // One clamped mega-tick (dt→100ms): the wave-2 pause lands mid-drain,
    // leaving ~4 steps of undrained backlog in the accumulator.
    now += 5000;
    engine.tick(now);
    expect(engine.getSnapshot().status).toBe('waveIntro');

    engine.resume();
    const before = engine.getSnapshot().timeMs;
    now += 16;
    engine.tick(now);
    const after = engine.getSnapshot().timeMs;
    expect(after - before).toBeCloseTo(STEP_MS, 3); // exactly one step, no burst
  });

  it('waveStarting is observed in post-transition state (snapshot reads waveIntro), every wave', () => {
    const engine = new GameEngine({ cards, mode: 'reading', seed: 1, config: introConfig });
    const statusAtEmit: string[] = [];
    engine.subscribe((e) => {
      if (e.type === 'waveStarting') statusAtEmit.push(engine.getSnapshot().status);
    });
    engine.start();
    engine.handleKey('Enter'); // wave 1 live
    let now = advance(engine, 20);
    for (let i = 0; i < 2; i++) {
      const word = engine.getWords()[0];
      if (word) {
        const romaji = word.card.id === 'neko' ? 'neko' : word.card.id === 'inu' ? 'inu' : 'hon';
        typeWord(engine, romaji);
      }
      now = advance(engine, 1100, now);
    }
    now = advance(engine, 2000, now); // cross interWaveDelay into wave 2
    expect(statusAtEmit.length).toBeGreaterThanOrEqual(2); // waves 1 and 2
    for (const status of statusAtEmit) expect(status).toBe('waveIntro');
  });

  it('waveStarting carries the wave’s newly introduced cards', () => {
    const engine = new GameEngine({
      cards,
      mode: 'reading',
      seed: 1,
      config: introConfig,
      plan: { newCardIds: cards.map((c) => c.id), seenCards: [], runBudget: 1, perWaveNewCap: 1 },
    });
    const starts: { wave: number; newCards: number }[] = [];
    engine.subscribe((e) => {
      if (e.type === 'waveStarting') starts.push({ wave: e.wave, newCards: e.newCards.length });
    });
    engine.start();
    expect(starts[0]).toEqual({ wave: 1, newCards: 1 });
  });

  it('without a plan nothing is ever introduced', () => {
    const { events } = makeIntroEngine();
    const starting = events.find((e) => e.type === 'waveStarting');
    expect(starting && starting.type === 'waveStarting' && starting.newCards).toEqual([]);
  });
});

/**
 * A plan whose reviewable set is exactly `inPlay` (cards in neither list never
 * spawn, §5.3) with `ownedIds` marked owned. Two cards fill a 2-word wave
 * without repeats, and one card fills it with itself, so which card falls
 * when never depends on the seed.
 */
const ownedPlan = (ownedIds: string[], inPlay: string[] = ['neko', 'inu']): EnginePlan => ({
  newCardIds: [], runBudget: 0, perWaveNewCap: 0,
  seenCards: inPlay.map((id) => ({ id, weight: 1, owned: ownedIds.includes(id) })),
});

const spawned = (events: GameEvent[]) =>
  events.flatMap((e) => (e.type === 'wordSpawned' ? [e.word] : []));

const missedOf = (events: GameEvent[], id: string) =>
  events.flatMap((e) => (e.type === 'wordMissed' && e.word.card.id === id ? [e] : []));

const airborne = (engine: GameEngine, id: string) =>
  engine.getWords().find((w) => w.card.id === id);

/**
 * Step the clock (16ms at a time, like `advance`) until `done()` holds and
 * return the new clock. Bounded, so an engine that never gets there fails the
 * test instead of hanging it.
 */
function advanceUntil(engine: GameEngine, from: number, done: () => boolean, limitMs = 30_000): number {
  let now = from;
  while (!done()) {
    if (now - from >= limitMs) throw new Error(`condition not met within ${limitMs}ms of engine time`);
    now += 16;
    engine.tick(now);
  }
  return now;
}

describe('light state (lapse spec §3, §5)', () => {
  it('spawns owned cards lit and the rest plain', () => {
    const { engine, events } = makeEngineWithPlan(ownedPlan(['neko']));
    advance(engine, 1_100);
    const lights = Object.fromEntries(spawned(events).map((w) => [w.card.id, w.light]));
    expect(lights).toEqual({ neko: 'lit', inu: 'plain' });
    expect(spawned(events).every((w) => w.comeback === false)).toBe(true);
  });

  it('a first kill lights the card for its later spawns', () => {
    const { engine, events } = makeEngineWithPlan(ownedPlan([]));
    const now = advanceUntil(engine, 0, () => airborne(engine, 'neko') !== undefined);
    typeWord(engine, 'neko');
    expect(events.find((e) => e.type === 'wordKilled')).toMatchObject({ relit: false });
    // across the wave boundary, until neko falls again
    advanceUntil(engine, now, () => spawned(events).filter((w) => w.card.id === 'neko').length >= 2);
    const nekos = spawned(events).filter((w) => w.card.id === 'neko');
    expect(nekos[0].light).toBe('plain');
    expect(nekos.at(-1)?.light).toBe('lit');
  });

  it('a lit word reaching the floor is a lapse; a plain one is a lesson', () => {
    const { engine, events } = makeEngineWithPlan(ownedPlan(['neko']), 1, { lives: 10 });
    advance(engine, 12_000); // wave 1 has fallen; wave 2 is only just starting
    expect(missedOf(events, 'neko')).toHaveLength(1);
    expect(missedOf(events, 'inu')).toHaveLength(1);
    expect(missedOf(events, 'neko')[0]).toMatchObject({ lapse: true, light: 'lit' });
    expect(missedOf(events, 'inu')[0]).toMatchObject({ lapse: false, light: 'plain' });
  });

  it('a lapsed card leads the next wave, dark, marked comeback, and relights on the kill', () => {
    const { engine, events } = makeEngineWithPlan(ownedPlan(['neko']), 1, { lives: 10 });
    // wave 1 falls (neko lapses), then wave 2 opens with its first spawn
    let now = advanceUntil(engine, 0, () => spawned(events).length >= 3);
    expect(spawned(events)[2]).toMatchObject({ card: { id: 'neko' }, light: 'dark', comeback: true });

    typeWord(engine, 'neko');
    const killed = events.find((e) => e.type === 'wordKilled');
    expect(killed).toMatchObject({ word: { card: { id: 'neko' }, light: 'dark' }, relit: true });

    // the wave's remaining slot is an ordinary review draw, never a second comeback
    now = advanceUntil(engine, now, () => spawned(events).length >= 4);
    expect(spawned(events)[3]).toMatchObject({ card: { id: 'inu' }, light: 'plain', comeback: false });

    // the kill relit the card: its spawn after the comeback (neko's third) is lit, no longer a comeback
    advanceUntil(engine, now, () => spawned(events).filter((w) => w.card.id === 'neko').length >= 3);
    expect(spawned(events).filter((w) => w.card.id === 'neko').at(-1)).toMatchObject({
      light: 'lit', comeback: false,
    });
  });

  it('a second drop is not a lapse and does not re-queue', () => {
    const { engine, events } = makeEngineWithPlan(ownedPlan(['neko']), 1, { lives: 10 });
    // wave 1 lapses neko, wave 2 brings it back dark and lets it fall, wave 3 spawns both words
    advanceUntil(engine, 0, () => spawned(events).length >= 6);
    expect(spawned(events)[2]).toMatchObject({ card: { id: 'neko' }, light: 'dark', comeback: true });
    expect(missedOf(events, 'neko')).toHaveLength(2);
    expect(missedOf(events, 'neko')[0]).toMatchObject({ lapse: true, light: 'lit' });
    expect(missedOf(events, 'neko')[1]).toMatchObject({ lapse: false, light: 'dark' });

    const wave3 = spawned(events).slice(4, 6);
    expect(wave3.every((w) => w.comeback === false)).toBe(true);
    // still dark until it is cleared
    expect(wave3.find((w) => w.card.id === 'neko')?.light).toBe('dark');
  });

  it('a plain twin landing after the lit twin was killed is a lesson and the map stays lit', () => {
    // one reading card, 2-word waves: both instances of the wave are neko
    const { engine, events } = makeEngineWithPlan(ownedPlan([], ['neko']), 1, { lives: 10 });
    let now = advanceUntil(engine, 0, () => spawned(events).length >= 2);
    expect(spawned(events).map((w) => w.light)).toEqual(['plain', 'plain']);

    typeWord(engine, 'neko'); // kills one instance; the other was spawned plain
    const killed = events.find((e) => e.type === 'wordKilled');
    expect(killed).toMatchObject({ relit: false });

    now = advanceUntil(engine, now, () => missedOf(events, 'neko').length >= 1);
    const missed = missedOf(events, 'neko')[0];
    expect(missed).toMatchObject({ lapse: false, light: 'plain' });
    expect(killed && killed.type === 'wordKilled' && killed.word.instanceId).not.toBe(missed.word.instanceId);

    // the landing left the map lit and queued nothing: the next spawn is lit, not a comeback
    advanceUntil(engine, now, () => spawned(events).length >= 3);
    expect(spawned(events)[2]).toMatchObject({ light: 'lit', comeback: false });
  });

  it('a lit twin killed after the other lapsed is not a relit kill', () => {
    // one owned card, 2-word waves: both instances fall lit
    const { engine, events } = makeEngineWithPlan(ownedPlan(['neko'], ['neko']), 1, { lives: 10 });
    advanceUntil(engine, 0, () => missedOf(events, 'neko').length >= 1);
    expect(missedOf(events, 'neko')[0]).toMatchObject({ lapse: true, light: 'lit' });

    // the map says dark now, but the instance still airborne fell lit: that is what the player saw
    expect(airborne(engine, 'neko')?.light).toBe('lit');
    typeWord(engine, 'neko');
    expect(events.find((e) => e.type === 'wordKilled')).toMatchObject({
      word: { light: 'lit' }, relit: false,
    });
  });

  it('a card lapses again after its comeback is cleared but is only queued once per run', () => {
    const { engine, events } = makeEngineWithPlan(ownedPlan(['neko']), 1, { lives: 10 });
    // wave 1 lapses neko; wave 2 brings it back dark and the player clears it
    const now = advanceUntil(engine, 0, () => spawned(events).length >= 3);
    typeWord(engine, 'neko');
    expect(events.find((e) => e.type === 'wordKilled')).toMatchObject({ relit: true });

    // wave 3 spawns neko lit, and this time it falls: a second lapse...
    advanceUntil(engine, now, () => spawned(events).length >= 8);
    const wave3 = spawned(events).slice(4, 6);
    expect(wave3.find((w) => w.card.id === 'neko')).toMatchObject({ light: 'lit', comeback: false });
    expect(missedOf(events, 'neko')).toHaveLength(2);
    expect(missedOf(events, 'neko')[1]).toMatchObject({ lapse: true, light: 'lit' });

    // ...that is not owed a second comeback: wave 4 leads with an ordinary draw
    expect(spawned(events).slice(6, 8).every((w) => w.comeback === false)).toBe(true);
  });

  it('gameOver carries ownedIds and a lapse that ends the run queues nothing', () => {
    // both owned cards fall lit; the first to land lapses (dark) and ends the run
    const { engine, events } = makeEngineWithPlan(ownedPlan(['neko', 'inu']), 1, { lives: 1 });
    const now = advance(engine, 12_000);
    const over = events.findIndex((e) => e.type === 'gameOver');
    expect(over).toBeGreaterThan(-1);
    const gameOver = events[over];
    expect(gameOver.type === 'gameOver' && [...gameOver.ownedIds].sort()).toEqual(['inu', 'neko']); // dark and lit alike
    expect(events.find((e) => e.type === 'wordMissed')).toMatchObject({ lapse: true, light: 'lit' });

    advance(engine, 20_000, now); // a dead run spawns nothing, comeback or not
    expect(events.slice(over).some((e) => e.type === 'wordSpawned')).toBe(false);
  });

  it('gameOver carries a card killed this run even though the plan owned nothing', () => {
    // nothing is owned at the start; the player kills neko, then inu lands and ends the run
    const { engine, events } = makeEngineWithPlan(ownedPlan([]), 1, { lives: 1 });
    const now = advanceUntil(engine, 0, () => airborne(engine, 'neko') !== undefined);
    typeWord(engine, 'neko');
    expect(events.find((e) => e.type === 'wordKilled')).toMatchObject({ word: { card: { id: 'neko' } } });

    advanceUntil(engine, now, () => events.some((e) => e.type === 'gameOver'));
    const gameOver = events.find((e) => e.type === 'gameOver');
    // the kill, not the plan, put neko here; inu was never killed or owned, so it is absent
    expect(gameOver && gameOver.type === 'gameOver' && [...gameOver.ownedIds]).toEqual(['neko']);
  });

  it('without a plan nothing spawns lit, but a kill then a drop is still a lapse', () => {
    const engine = new GameEngine({
      cards: cards.filter((c) => c.id === 'neko'), mode: 'reading', seed: 1,
      config: { ...config, lives: 10 },
    });
    const events: GameEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();
    const now = advance(engine, 20);
    expect(spawned(events).map((w) => w.light)).toEqual(['plain']);

    typeWord(engine, 'neko'); // no plan, but a kill still promotes the card
    expect(events.find((e) => e.type === 'wordKilled')).toMatchObject({ relit: false });

    advanceUntil(engine, now, () => missedOf(events, 'neko').length >= 1);
    expect(spawned(events)[1]).toMatchObject({ light: 'lit', comeback: false });
    expect(missedOf(events, 'neko')[0]).toMatchObject({ lapse: true, light: 'lit' });
  });

  it('is deterministic: same seed, same plan, same spawn order and lights', () => {
    const run = () => {
      const { engine, events } = makeEngineWithPlan(
        ownedPlan(['neko', 'inu'], ['neko', 'inu', 'hon']), 7, { lives: 10 },
      );
      advance(engine, 40_000);
      return spawned(events).map((w) => [w.card.id, w.light, w.comeback]);
    };
    const first = run();
    expect(first.length).toBeGreaterThanOrEqual(6);
    // any two of three cards include an owned one, so wave 1 lapses and wave 2 leads with a comeback
    expect(first.some(([, light, comeback]) => light === 'dark' && comeback === true)).toBe(true);
    expect(run()).toEqual(first);
  });
});
