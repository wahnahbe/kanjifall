// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AirborneWord, Card, EngineSnapshot } from '../../engine/types';

// Isolate the recorder from the outbox's localStorage mechanics: these tests
// only need to observe the *decision* to route a payload to the outbox, not
// persist it. Real persistence is covered by outbox.test.ts.
vi.mock('../outbox', () => ({ pushOutbox: vi.fn() }));

import { pushOutbox } from '../outbox';
import { RunRecorder, type RecorderContext } from '../recorder';

const pushOutboxMock = vi.mocked(pushOutbox);

const NOW = 1_700_000_000_000;

const ok = (body: unknown = {}) =>
  ({ ok: true, status: 200, json: () => Promise.resolve(body) }) as Response;
const fail = (status: number) =>
  ({ ok: false, status, json: () => Promise.reject(new Error('no body')) }) as Response;

function makeCard(id: string, kana: string[]): Card {
  return { id, kanji: '字', kana, gloss: 'g', pos: 'n', jlpt: 5, source: 'jlpt' };
}

function makeWord(overrides: Partial<AirborneWord> = {}): AirborneWord {
  return {
    instanceId: 1,
    card: makeCard('neko', ['ねこ']),
    lane: 0,
    x: 0.5,
    y: 0.5,
    speed: 0.1,
    spawnedAt: 1_000,
    firstKeyAt: null,
    backspaceCount: 0,
    hintShown: false,
    wasTargeted: false,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<EngineSnapshot> = {}): EngineSnapshot {
  return {
    status: 'playing', mode: 'reading', score: 0, lives: 3, wave: 1, combo: 0, maxCombo: 0,
    kills: 0, wrongSubmits: 0, bufferKana: '', bufferRomaji: '', lockedIds: [], missed: [], timeMs: 0,
    ...overrides,
  };
}

const ctx: RecorderContext = {
  runId: 'run-1',
  mode: 'reading',
  pool: 'n5',
  cards: [makeCard('neko', ['ねこ'])],
  listVersion: 'v1',
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  pushOutboxMock.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Drains the microtask queue (and any due zero-delay timers) after a stubbed fetch resolves. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

function eventsBodyOf(): {
  attempts: unknown[];
  wrongSubmits: unknown[];
  introductions: unknown[];
  batchId: string;
} {
  const call = fetchMock.mock.calls.find((args) => (args[0] as string).endsWith('/events'));
  if (!call) throw new Error('no /events call was made');
  return JSON.parse((call[1] as RequestInit).body as string);
}

function finalizeBodyOf(): Record<string, unknown> {
  const call = fetchMock.mock.calls.find((args) => (args[1] as RequestInit).method === 'PATCH');
  if (!call) throw new Error('no PATCH call was made');
  return JSON.parse((call[1] as RequestInit).body as string);
}

describe('RunRecorder construction (rule 1)', () => {
  it('fires api.createRun immediately with startedAt/appVersion/listVersion/pool/mode', async () => {
    fetchMock.mockResolvedValueOnce(ok());

    new RunRecorder(ctx);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/runs');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      id: 'run-1',
      startedAt: NOW,
      mode: 'reading',
      pool: 'n5',
      appVersion: __APP_VERSION__,
      listVersion: 'v1',
    });
    expect(pushOutboxMock).not.toHaveBeenCalled();
  });

  it('is constructible synchronously (no throw) and, on createRun failure, pushes it to the outbox', async () => {
    fetchMock.mockResolvedValueOnce(fail(500));

    expect(() => new RunRecorder(ctx)).not.toThrow();
    await flush();

    expect(pushOutboxMock).toHaveBeenCalledTimes(1);
    expect(pushOutboxMock).toHaveBeenCalledWith({
      kind: 'createRun',
      runId: 'run-1',
      payload: {
        id: 'run-1', startedAt: NOW, mode: 'reading', pool: 'n5',
        appVersion: __APP_VERSION__, listVersion: 'v1',
      },
    });
  });
});

describe('wordKilled (rule 2)', () => {
  it('buffers a kill attempt row with derived timing/context fields, sent at the next flush', async () => {
    fetchMock.mockResolvedValue(ok());
    const recorder = new RunRecorder(ctx);
    await flush();

    const word = makeWord({
      instanceId: 7,
      card: makeCard('neko', ['ねこ']),
      spawnedAt: 1_000,
      firstKeyAt: 1_200,
      backspaceCount: 2,
      hintShown: true,
      wasTargeted: true,
    });
    const otherWord = makeWord({ instanceId: 8, card: makeCard('inu', ['いぬ']) });
    const view = { words: [otherWord], snapshot: makeSnapshot({ wave: 3 }) };

    recorder.onEvent({ type: 'wordKilled', word, msToKill: 1_499.6, points: 100, combo: 1 }, view);
    recorder.onEvent({ type: 'waveCleared', wave: 3 }, view);
    await flush();

    const body = eventsBodyOf();
    expect(body.attempts).toEqual([{
      cardId: 'neko',
      mode: 'reading',
      outcome: 'kill',
      msToFirstKey: 200,
      msToKill: 1_500, // rounded: the schema requires an integer (STEP_MS-derived values aren't)
      backspaceCount: 2,
      hintShown: true,
      wasTargeted: true,
      airborneCount: 1, // view.words.length at event time (the killed word already removed)
      speedLevel: 3, // view.snapshot.wave
      createdAt: NOW,
    }]);
    expect(body.wrongSubmits).toEqual([]);
    expect(typeof body.batchId).toBe('string');
  });

  it('msToFirstKey is null when the word was never targeted', async () => {
    fetchMock.mockResolvedValue(ok());
    const recorder = new RunRecorder(ctx);
    await flush();

    const word = makeWord({ firstKeyAt: null });
    const view = { words: [], snapshot: makeSnapshot() };
    recorder.onEvent({ type: 'wordKilled', word, msToKill: 50, points: 10, combo: 1 }, view);
    recorder.onEvent({ type: 'waveCleared', wave: 1 }, view);
    await flush();

    expect(eventsBodyOf().attempts[0]).toMatchObject({ msToFirstKey: null });
  });
});

describe('wordMissed (rule 3)', () => {
  it('buffers a miss attempt row with msToKill null', async () => {
    fetchMock.mockResolvedValue(ok());
    const recorder = new RunRecorder(ctx);
    await flush();

    const word = makeWord({ card: makeCard('inu', ['いぬ']), spawnedAt: 2_000, firstKeyAt: null });
    const view = { words: [], snapshot: makeSnapshot({ wave: 2 }) };

    recorder.onEvent({ type: 'wordMissed', word }, view);
    recorder.onEvent({ type: 'waveCleared', wave: 2 }, view);
    await flush();

    expect(eventsBodyOf().attempts).toEqual([{
      cardId: 'inu',
      mode: 'reading',
      outcome: 'miss',
      msToFirstKey: null,
      msToKill: null,
      backspaceCount: 0,
      hintShown: false,
      wasTargeted: false,
      airborneCount: 0,
      speedLevel: 2,
      createdAt: NOW,
    }]);
  });
});

describe('wrongSubmit (rule 4)', () => {
  const nekoA = makeCard('neko-a', ['ねこ']);
  const nekoB = makeCard('neko-b', ['ねこ']); // same reading, a different pool card: the "confusion"
  const inu = makeCard('inu', ['いぬ']);
  const wrongSubmitCtx: RecorderContext = { ...ctx, cards: [nekoA, nekoB, inu] };

  it('finds a DIFFERENT non-airborne pool card sharing the submitted reading (first hit wins)', async () => {
    fetchMock.mockResolvedValue(ok());
    const recorder = new RunRecorder(wrongSubmitCtx);
    await flush();

    const airborneNekoA = makeWord({ instanceId: 1, card: nekoA });
    const view = { words: [airborneNekoA], snapshot: makeSnapshot() };

    recorder.onEvent({ type: 'wrongSubmit', submittedKana: 'ネコ' }, view);
    recorder.onEvent({ type: 'waveCleared', wave: 1 }, view);
    await flush();

    expect(eventsBodyOf().wrongSubmits).toEqual([{
      submittedKana: 'ネコ',
      airborneCardIds: ['neko-a'],
      matchedOtherCardId: 'neko-b', // neko-a excluded because it's airborne; neko-b is the confusion
      createdAt: NOW,
    }]);
  });

  it('is null when no non-airborne pool card matches the submission', async () => {
    fetchMock.mockResolvedValue(ok());
    const recorder = new RunRecorder(wrongSubmitCtx);
    await flush();

    const view = { words: [], snapshot: makeSnapshot() };
    recorder.onEvent({ type: 'wrongSubmit', submittedKana: 'ふふ' }, view);
    recorder.onEvent({ type: 'waveCleared', wave: 1 }, view);
    await flush();

    expect(eventsBodyOf().wrongSubmits[0]).toMatchObject({ matchedOtherCardId: null });
  });
});

describe('waveCleared flush (rule 5)', () => {
  it('flushes buffered rows as one batch; on failure retries once after 500ms; on 2nd failure pushes {kind:"events"} to the outbox', async () => {
    fetchMock
      .mockResolvedValueOnce(ok()) // createRun
      .mockResolvedValueOnce(fail(500)) // first postEvents attempt
      .mockResolvedValueOnce(fail(500)); // retried postEvents attempt
    const recorder = new RunRecorder(ctx);
    await flush();

    const word = makeWord();
    const view = { words: [], snapshot: makeSnapshot({ wave: 1 }) };
    recorder.onEvent({ type: 'wordKilled', word, msToKill: 500, points: 10, combo: 1 }, view);
    recorder.onEvent({ type: 'waveCleared', wave: 1 }, view);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2); // createRun + first attempt; retry not due yet
    expect(pushOutboxMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);

    expect(fetchMock).toHaveBeenCalledTimes(3); // + the retried attempt
    expect(pushOutboxMock).toHaveBeenCalledTimes(1);
    const [entry] = pushOutboxMock.mock.calls[0] as [{ kind: string; runId: string; payload: { attempts: unknown[] } }];
    expect(entry.kind).toBe('events');
    expect(entry.runId).toBe('run-1');
    expect(entry.payload.attempts).toHaveLength(1);
  });

  it('retries once after 500ms and succeeds without touching the outbox', async () => {
    fetchMock
      .mockResolvedValueOnce(ok()) // createRun
      .mockResolvedValueOnce(fail(500)) // first postEvents attempt fails
      .mockResolvedValueOnce(ok()); // retried attempt succeeds
    const recorder = new RunRecorder(ctx);
    await flush();

    const word = makeWord();
    const view = { words: [], snapshot: makeSnapshot({ wave: 1 }) };
    recorder.onEvent({ type: 'wordKilled', word, msToKill: 500, points: 10, combo: 1 }, view);
    recorder.onEvent({ type: 'waveCleared', wave: 1 }, view);
    await flush();
    await vi.advanceTimersByTimeAsync(500);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(pushOutboxMock).not.toHaveBeenCalled();
  });

  it('does not attempt a network call when the buffer is empty', async () => {
    fetchMock.mockResolvedValue(ok());
    new RunRecorder(ctx).onEvent({ type: 'waveCleared', wave: 1 }, { words: [], snapshot: makeSnapshot() });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1); // createRun only
  });
});

describe('gameOver (rule 6)', () => {
  it('flushes the remaining buffer and finalizes with computed duration/pausedMs/accuracy', async () => {
    fetchMock.mockResolvedValue(ok());
    const recorder = new RunRecorder(ctx);
    await flush();

    const word = makeWord();
    recorder.onEvent(
      { type: 'wordKilled', word, msToKill: 500, points: 10, combo: 1 },
      { words: [], snapshot: makeSnapshot({ wave: 1 }) },
    );

    vi.setSystemTime(NOW + 90_000); // 90s of wall-clock time have passed since construction
    const snapshot = makeSnapshot({
      wave: 4, score: 5_000, maxCombo: 7, kills: 10, wrongSubmits: 2,
      missed: [makeCard('a', ['あ']), makeCard('b', ['い'])], timeMs: 80_000,
    });
    recorder.onEvent({ type: 'gameOver', score: 5_000, wave: 4 }, { words: [], snapshot });
    await flush();

    expect(finalizeBodyOf()).toEqual({
      endedAt: NOW + 90_000,
      score: 5_000,
      wavesCleared: 3,
      durationMs: 80_000,
      pausedMs: 10_000, // (90_000 wall elapsed) - 80_000 engine time
      maxCombo: 7,
      accuracy: 10 / 14, // kills / (kills + missed.length + wrongSubmits)
    });
    expect(eventsBodyOf().attempts).toHaveLength(1); // the pre-gameOver kill was flushed too
  });

  it('accuracy is 0 when there were zero kills/misses/wrongSubmits', async () => {
    fetchMock.mockResolvedValue(ok());
    const recorder = new RunRecorder(ctx);
    await flush();

    recorder.onEvent(
      { type: 'gameOver', score: 0, wave: 1 },
      { words: [], snapshot: makeSnapshot({ kills: 0, wrongSubmits: 0, missed: [] }) },
    );
    await flush();

    expect(finalizeBodyOf().accuracy).toBe(0);
  });

  it('pushes to the outbox on finalize failure, with no retry', async () => {
    fetchMock
      .mockResolvedValueOnce(ok()) // createRun
      .mockResolvedValueOnce(fail(500)); // finalize fails
    const recorder = new RunRecorder(ctx);
    await flush();

    recorder.onEvent({ type: 'gameOver', score: 0, wave: 1 }, { words: [], snapshot: makeSnapshot() });
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(2); // createRun + one finalize attempt, no retry
    expect(pushOutboxMock).toHaveBeenCalledTimes(1);
    const [entry] = pushOutboxMock.mock.calls[0] as [{ kind: string; runId: string }];
    expect(entry.kind).toBe('finalize');
    expect(entry.runId).toBe('run-1');
  });
});

describe('createRun-failure ordering', () => {
  it('routes subsequent event/finalize flushes straight to the outbox, in order, with no further network attempts', async () => {
    fetchMock.mockResolvedValueOnce(fail(500)); // createRun fails; nothing else should ever reach fetch
    const recorder = new RunRecorder(ctx);
    await flush();

    expect(pushOutboxMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ kind: 'createRun' }));

    const word = makeWord();
    const view = { words: [], snapshot: makeSnapshot({ wave: 1 }) };
    recorder.onEvent({ type: 'wordKilled', word, msToKill: 100, points: 10, combo: 1 }, view);
    recorder.onEvent({ type: 'waveCleared', wave: 1 }, view);
    await flush();

    expect(pushOutboxMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ kind: 'events' }));

    recorder.onEvent(
      { type: 'gameOver', score: 0, wave: 1 },
      { words: [], snapshot: makeSnapshot({ wave: 1 }) },
    );
    await flush();

    expect(pushOutboxMock).toHaveBeenNthCalledWith(3, expect.objectContaining({ kind: 'finalize' }));
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the failed createRun attempt, ever
  });
});

describe('ignored engine events', () => {
  it('wordSpawned/bufferChanged/waveStarting/resumed are no-ops (nothing buffered, nothing sent)', async () => {
    fetchMock.mockResolvedValue(ok());
    const recorder = new RunRecorder(ctx);
    await flush();

    const view = { words: [], snapshot: makeSnapshot() };
    recorder.onEvent({ type: 'wordSpawned', word: makeWord() }, view);
    recorder.onEvent({ type: 'bufferChanged', kana: '', romaji: '', lockedIds: [] }, view);
    recorder.onEvent({ type: 'waveStarting', wave: 1, cards: [], newCards: [] }, view);
    recorder.onEvent({ type: 'resumed', wave: 1 }, view);
    recorder.onEvent({ type: 'waveCleared', wave: 1 }, view);
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1); // createRun only — the waveCleared flush had nothing to send
  });
});

describe('outbox storage resilience', () => {
  it('with createRun failing and setItem throwing, subsequent waveCleared routes to outbox without poisoning the pipeline', async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    fetchMock.mockResolvedValueOnce(fail(500)); // createRun fails

    // Build a recorder; createRun will fail, triggering pushOutbox (which is mocked)
    const recorder = new RunRecorder(ctx);
    await flush();

    // Verify createRun failed and attempted to push to outbox
    expect(pushOutboxMock).toHaveBeenCalledTimes(1);
    expect(pushOutboxMock).toHaveBeenCalledWith(expect.objectContaining({ kind: 'createRun' }));

    // Now trigger a waveCleared event;
    // since createRunFailed is true, it routes to outbox without attempting the network
    const word = makeWord();
    const view = { words: [], snapshot: makeSnapshot({ wave: 1 }) };
    recorder.onEvent({ type: 'wordKilled', word, msToKill: 100, points: 10, combo: 1 }, view);
    recorder.onEvent({ type: 'waveCleared', wave: 1 }, view);

    // Flush the pipeline; should not throw and should successfully queue to outbox
    await flush();

    // Verify the waveCleared event was routed to outbox (mocked), not attempted via network
    expect(pushOutboxMock).toHaveBeenCalledTimes(2);
    expect(pushOutboxMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ kind: 'events' }));
    // fetch was only called for the failed createRun, never for events (went to outbox instead)
    expect(fetchMock).toHaveBeenCalledTimes(1);

    setItemSpy.mockRestore();
  });
});

describe('introductions (ceremony)', () => {
  it('flushes recorded introductions with the wave batch', async () => {
    fetchMock.mockResolvedValue(ok());
    const recorder = new RunRecorder(ctx);
    await flush();

    const view = { words: [], snapshot: makeSnapshot({ wave: 1 }) };
    recorder.recordIntroduction('neko');
    recorder.onEvent({ type: 'waveCleared', wave: 1 }, view);
    await flush();

    expect(eventsBodyOf().introductions).toEqual([
      { cardId: 'neko', introducedAt: expect.any(Number) },
    ]);
  });

  it('a wave with only introductions still flushes', async () => {
    fetchMock.mockResolvedValue(ok());
    const recorder = new RunRecorder(ctx);
    await flush();

    const view = { words: [], snapshot: makeSnapshot({ wave: 1 }) };
    recorder.recordIntroduction('neko');
    recorder.onEvent({ type: 'waveCleared', wave: 1 }, view);
    await flush();

    expect(eventsBodyOf().attempts).toEqual([]);
    expect(eventsBodyOf().introductions).toHaveLength(1);
  });
});
