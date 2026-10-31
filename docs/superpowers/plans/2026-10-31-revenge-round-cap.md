# Revenge Round Cap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A revenge round ends after 5 waves of 10–15 drops instead of running until the player dies.

**Architecture:** The engine gains one config knob, `maxWaves` (0 = endless, the default). When the last capped wave clears, `tryAdvanceWave` ends the run instead of beginning the next wave, and the snapshot reports `cleared: true`. App passes a `REVENGE_CONFIG` for the `revenge` pool only; the HUD, results screen and run recorder read the two new snapshot fields.

**Tech Stack:** TypeScript, React 19, Vitest (+ jsdom / Testing Library for UI), oxlint. `npm run check` = `tsc -b && oxlint && vitest run`.

**Spec:** No separate design doc — sized as a small change and agreed in chat on 2026-10-31. The agreed design is the next section; executors read it as the spec.

## Agreed design (the spec)

- The engine gets a `maxWaves` setting. Zero means endless, which stays the default for every normal run and for play again of a normal run.
- Revenge runs start with a cap of 5 waves and bigger waves: **10, 11, 12, 14, 15** drops. Everything else stays as today: 3 hearts, the usual speed/spawn ramp, the same 1–3 missed words drawn with repeats.
- When the last word of wave 5 is cleared, the usual wave-clear beat plays (the `waveCleared` event and the inter-wave delay), and then the run ends instead of wave 6 starting. Dropping 3 words still ends it early, as before, and that is a death, not a clear.
- The results screen reads **"Revenge complete"** when you clear it, **"Run over"** when you die. Score, accuracy and the missed table stay. The revenge button offers only the words this run missed, disabled when there are none (already the behavior). Play again from a revenge results screen replays the revenge round with the same cap.
- The HUD wave label reads **"wave 2 / 5"** in a capped run and stays "wave 2" everywhere else. The Japanese label (第2波) and the WaveStart beat are unchanged.
- The run record sent to the server (`wavesCleared`) counts all 5 waves as cleared on a clear. Today it assumes you died mid-wave (`wave - 1`).

## Global Constraints

- Working copy is CRLF. Edit tracked files with the Edit tool, never `sed -i`.
- In an app-made worktree the git guard refuses chained or scripted git: one plain git command per Bash call. Never stage `.claude/settings.local.json`.
- `EngineSnapshot` gains two **required** fields (`maxWaves`, `cleared`). Every snapshot literal in the repo must gain `maxWaves: 0, cleared: false` or `tsc -b` fails (Task 1 lists them all).
- The `gameOver` event's shape (`{ type, score, wave, ownedIds }`) is unchanged; consumers read `cleared` from the snapshot, never the event.
- `DEFAULT_CONFIG` behavior is unchanged: every existing engine/spawner test must still pass without edits other than the fixture fields above.
- Copy is exactly: `Revenge complete`, `Run over`, `wave 2 / 5` (lower-case "wave", spaces around the slash).

## Review Focus

1. A revenge pool of a single word: wave 1 must hold 10 drops of that one card, not fewer. (Task 2 pins it.)
2. The player drops the final word of wave 5 with one heart left: that is a clear, not a death, and the run must not try to start wave 6 for the comeback it now owes. (Task 3 pins it.)
3. The player's third miss is the final word of wave 5: that is a death (`cleared: false`), with exactly one `gameOver`. (Task 3 pins it.)
4. Play again from a **normal** run must stay endless: `start()` receives no config. (Task 7 pins it.)
5. A capped run that dies mid-wave still reports `wave - 1` cleared, not `wave`. (Task 4 pins it.)

---

### Task 1: Snapshot fields `maxWaves` and `cleared`

**Files:**
- Modify: `src/engine/types.ts` (EngineConfig ~line 103, EngineSnapshot ~line 86)
- Modify: `src/engine/constants.ts:14-30` (DEFAULT_CONFIG)
- Modify: `src/engine/GameEngine.ts` (field + `getSnapshot` ~line 158)
- Modify: `src/ui/useEngine.ts:13-17` (IDLE_SNAPSHOT)
- Modify (fixtures, add `maxWaves: 0, cleared: false` to each snapshot literal): `src/data/__tests__/recorder.test.ts:48`, `src/ui/__tests__/App.atmosphere.test.tsx:9`, `src/ui/__tests__/App.introFlow.test.tsx:26`, `src/ui/__tests__/App.listPool.test.tsx:21`, `src/ui/__tests__/App.replayPlan.test.tsx:36`, `src/ui/__tests__/App.tierAdvance.test.tsx:27`, `src/ui/__tests__/GameScreen.planNotice.test.tsx:10`, `src/ui/__tests__/GameScreen.scale.test.tsx:9`, `src/ui/__tests__/GameScreen.waveStart.test.tsx:11`, `src/ui/__tests__/Hud.test.tsx:11`, `src/ui/__tests__/ResultsScreen.test.tsx:23`
- Test: `src/engine/__tests__/GameEngine.test.ts`

**Interfaces:**
- Produces: `EngineConfig.maxWaves: number` (0 = endless; `DEFAULT_CONFIG.maxWaves = 0`); `EngineSnapshot.maxWaves: number` (mirrors config); `EngineSnapshot.cleared: boolean` (false until Task 3 sets it).

- [ ] **Step 1: Write the failing test** — in the `'wave intro, hints, counters (M2)'` describe block of `GameEngine.test.ts`:

```ts
it('snapshot carries maxWaves from config (0 = endless by default) and cleared=false', () => {
  expect(makeEngine().engine.getSnapshot()).toMatchObject({ maxWaves: 0, cleared: false });
  const capped = new GameEngine({ cards, mode: 'reading', seed: 1, config: { ...config, maxWaves: 5 } });
  expect(capped.getSnapshot().maxWaves).toBe(5);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/engine/__tests__/GameEngine.test.ts -t "carries maxWaves"`
Expected: FAIL (tsc error on `maxWaves` in config, or `maxWaves` undefined in the snapshot).

- [ ] **Step 3: Add the fields**

`types.ts`: `maxWaves: number; // waves before the run ends cleared; 0 = endless` on `EngineConfig`; `maxWaves: number; cleared: boolean;` on `EngineSnapshot` (document: "cleared: the run ended by clearing wave `maxWaves`, not by losing every life"). `constants.ts`: `maxWaves: 0,` in `DEFAULT_CONFIG`. `GameEngine.ts`: `private cleared = false;` and `getSnapshot()` returns `maxWaves: this.config.maxWaves, cleared: this.cleared`. `useEngine.ts` IDLE_SNAPSHOT and every fixture in the list above: `maxWaves: 0, cleared: false`.

- [ ] **Step 4: Verify the test passes and the whole check is green**

Run: `npm run check`
Expected: tsc clean, oxlint clean, all tests pass (fixtures updated everywhere).

- [ ] **Step 5: Commit**

```bash
git add src/engine/types.ts src/engine/constants.ts src/engine/GameEngine.ts src/ui/useEngine.ts src/engine/__tests__/GameEngine.test.ts src/data/__tests__/recorder.test.ts src/ui/__tests__
git commit -m "feat(engine): maxWaves config and cleared/maxWaves snapshot fields (default endless)"
```

---

### Task 2: `REVENGE_CONFIG` and whole-number wave sizes

**Files:**
- Modify: `src/engine/constants.ts` (append after DEFAULT_CONFIG)
- Modify: `src/engine/Spawner.ts:72` (the `size` line in `planWave`)
- Test: `src/engine/__tests__/Spawner.test.ts`

**Interfaces:**
- Consumes: `EngineConfig.maxWaves` (Task 1).
- Produces: `export const REVENGE_CONFIG: Partial<EngineConfig> = { maxWaves: 5, baseWaveSize: 10, waveSizeGrowth: 1.2, maxWaveSize: 15 }` in `src/engine/constants.ts`. `Spawner.planWave` wave size is `Math.round(...)` of the linear ramp, so the five revenge waves are 10, 11, 12, 14, 15.

- [ ] **Step 1: Write the failing tests** — new describe block in `Spawner.test.ts` (it already has `pool`, `planOf`, `mulberry32`; see the `withPlan` helper at line ~31):

```ts
describe('REVENGE_CONFIG wave sizes', () => {
  const revenge = { ...DEFAULT_CONFIG, ...REVENGE_CONFIG };
  const seenAll = planOf([], 0); // the existing helper: every pool card seen at weight 1, no budget

  it('ramps 10, 11, 12, 14, 15 across the five capped waves', () => {
    const s = new Spawner(pool, mulberry32(1), revenge, seenAll);
    expect([1, 2, 3, 4, 5].map((w) => s.planWave(w).cards.length)).toEqual([10, 11, 12, 14, 15]);
  });

  it('a one-word revenge pool still fills wave 1 with 10 drops of that word (Review Focus 1)', () => {
    const only = pool[0];
    const s = new Spawner([only], mulberry32(1), revenge, { newCardIds: [], seenCards: [{ id: only.id, weight: 1 }], runBudget: 0, perWaveNewCap: 0 });
    const wave = s.planWave(1);
    expect(wave.cards).toHaveLength(10);
    expect(wave.cards.every((c) => c.id === only.id)).toBe(true);
  });
});
```

`planOf(newIds, runBudget, perWaveNewCap = 2, seen = every pool card not in newIds at weight 1)` is defined at the top of `Spawner.test.ts`; `planOf([], 0)` is the 20-card pool, all seen. Import `REVENGE_CONFIG` next to `DEFAULT_CONFIG` from `'../constants'`. Repeats within a wave are expected here; only lengths are asserted.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/engine/__tests__/Spawner.test.ts -t "REVENGE_CONFIG"`
Expected: FAIL — `REVENGE_CONFIG` is not exported.

- [ ] **Step 3: Implement**

`constants.ts`: export `REVENGE_CONFIG` with the exact values above and a comment: revenge pools hold 1–3 words, so the cap is what makes the round finite; sizes 10, 11, 12, 14, 15 after rounding. `Spawner.ts` line 72: `const size = Math.round(Math.min(c.baseWaveSize + c.waveSizeGrowth * (wave - 1), c.maxWaveSize));` (integer configs are unchanged by the rounding).

- [ ] **Step 4: Run the engine suite**

Run: `npx vitest run src/engine`
Expected: PASS, including the pre-existing `grows wave size and caps it` test.

- [ ] **Step 5: Commit**

```bash
git add src/engine/constants.ts src/engine/Spawner.ts src/engine/__tests__/Spawner.test.ts
git commit -m "feat(engine): REVENGE_CONFIG (5 waves of 10-15) and whole-number wave sizes"
```

---

### Task 3: The engine ends a capped run after its last wave clears

**Files:**
- Modify: `src/engine/GameEngine.ts:286-298` (`tryAdvanceWave`)
- Test: `src/engine/__tests__/GameEngine.test.ts`

**Interfaces:**
- Consumes: `config.maxWaves`, `this.cleared` (Task 1).
- Produces: after the inter-wave delay following `waveCleared` for wave `maxWaves`, status becomes `'gameOver'`, `cleared = true`, `wave` stays `maxWaves`, and one `gameOver` event (unchanged shape) is emitted. `tryAdvanceWave` returns at once when status is not `'playing'`.

- [ ] **Step 1: Write the failing tests** — new describe block `'wave cap (revenge round)'` in `GameEngine.test.ts`. Use the file's `cards` (ids equal their romaji: `neko`, `inu`, `hon`), `config` (2-word waves, 500 ms inter-wave delay, no wave-start pause), `advance`, `typeWord`.

```ts
describe('wave cap (revenge round)', () => {
  const capped = { ...config, maxWaves: 2 };
  const makeCapped = (over: Partial<EngineConfig> = {}) => {
    const engine = new GameEngine({ cards, mode: 'reading', seed: 1, config: { ...capped, ...over } });
    const events: GameEvent[] = [];
    engine.subscribe((e) => events.push(e));
    engine.start();
    return { engine, events };
  };
  /** Kills each word of the wave in progress as it spawns and returns the moment
   *  waveCleared fires for it - BEFORE the inter-wave delay elapses. */
  const killWave = (engine: GameEngine, events: GameEvent[], now: number): number => {
    const wave = engine.getSnapshot().wave;
    for (let guard = 0; guard < 400; guard++) {
      const word = engine.getWords()[0];
      if (word) typeWord(engine, word.card.id);
      now = advance(engine, 50, now);
      if (events.some((e) => e.type === 'waveCleared' && e.wave === wave)) return now;
    }
    throw new Error(`wave ${wave} never cleared`);
  };
  const delay = config.interWaveDelayMs + 100;

  it('ends the run cleared after the last capped wave, after the wave-clear delay, with one gameOver', () => {
    const { engine, events } = makeCapped();
    let now = killWave(engine, events, advance(engine, 20));
    now = advance(engine, delay, now);
    expect(engine.getSnapshot().wave).toBe(2);
    now = killWave(engine, events, now);
    expect(engine.getSnapshot().status).toBe('playing'); // the wave-clear beat still plays first
    advance(engine, delay, now);
    expect(engine.getSnapshot()).toMatchObject({ status: 'gameOver', cleared: true, wave: 2, lives: 3 });
    expect(events.filter((e) => e.type === 'gameOver')).toHaveLength(1);
    expect(events.some((e) => e.type === 'waveStarting' && e.wave === 3)).toBe(false);
  });

  it('maxWaves 0 is endless: wave 3 starts as before', () => {
    const { engine, events } = makeCapped({ maxWaves: 0 });
    let now = killWave(engine, events, advance(engine, 20));
    now = advance(engine, delay, now);
    now = killWave(engine, events, now);
    advance(engine, delay, now);
    expect(engine.getSnapshot()).toMatchObject({ status: 'playing', wave: 3, cleared: false });
  });

  it('dying in a capped run is a death: cleared stays false', () => {
    const { engine } = makeCapped();
    advance(engine, 60_000);
    expect(engine.getSnapshot()).toMatchObject({ status: 'gameOver', cleared: false, lives: 0 });
  });

  it('dropping the final word of the last wave with hearts left is a clear and owes no wave 3 (Review Focus 2)', () => {
    // Both cards owned: every word falls lit, so the drop is a lapse that queues a comeback.
    const plan: EnginePlan = {
      newCardIds: [], seenCards: cards.map((c) => ({ id: c.id, weight: 1, owned: true })), runBudget: 0, perWaveNewCap: 0,
    };
    const { engine, events } = makeEngineWithPlan(plan, 1, { maxWaves: 2 });
    let now = killWave(engine, events, advance(engine, 20));
    now = advance(engine, delay + 20, now); // wave 2 has begun and its first word is airborne
    typeWord(engine, engine.getWords()[0].card.id); // kill one; let the other land
    advance(engine, 30_000, now);
    expect(engine.getSnapshot()).toMatchObject({ status: 'gameOver', cleared: true, wave: 2, lives: 2 });
    expect(events.some((e) => e.type === 'wordMissed' && e.lapse)).toBe(true);
    expect(events.some((e) => e.type === 'waveStarting' && e.wave === 3)).toBe(false);
  });

  it('a last-heart miss on the only word of the last wave is a death: one gameOver, no stray waveCleared (Review Focus 3)', () => {
    const { engine, events } = makeCapped({ lives: 1, baseWaveSize: 1, maxWaveSize: 1 });
    let now = killWave(engine, events, advance(engine, 20));
    now = advance(engine, delay, now);
    advance(engine, 60_000, now); // wave 2: type nothing; its single word lands and kills the run
    expect(engine.getSnapshot()).toMatchObject({ status: 'gameOver', cleared: false, lives: 0, wave: 2 });
    expect(events.filter((e) => e.type === 'gameOver')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'waveCleared' && e.wave === 2)).toHaveLength(0);
  });
});
```

`makeEngineWithPlan(plan, seed, configOverride)` already exists at the top of the file. In the fourth test, if seed 1 has the second word land before the first is typed, kill whichever word `getWords()[0]` is; the outcome, not the order, is what is asserted.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/engine/__tests__/GameEngine.test.ts -t "wave cap"`
Expected: the first, fourth and fifth tests FAIL (wave 3 starts / `cleared` false / stray `waveCleared` after death); the endless and death tests may already pass.

- [ ] **Step 3: Implement in `tryAdvanceWave`**

Add `if (this.status !== 'playing') return;` as the first line (a death in `moveWords` must not be followed by a stray `waveCleared` or a cap end in the same step). In the `timeMs >= nextWaveAt` branch, before `beginWave(this.wave + 1)`: if `this.config.maxWaves > 0 && this.wave >= this.config.maxWaves`, set `cleared = true`, `status = 'gameOver'`, emit `{ type: 'gameOver', score, wave: this.wave, ownedIds: [...this.lightById.keys()] }` and return. Comment: the comeback queue is deliberately abandoned here — the results screen lists the drop.

- [ ] **Step 4: Run the whole engine suite**

Run: `npx vitest run src/engine`
Expected: PASS (every pre-existing wave/lapse test unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/engine/GameEngine.ts src/engine/__tests__/GameEngine.test.ts
git commit -m "feat(engine): a capped run ends cleared after its last wave"
```

---

### Task 4: Recorder reports every wave cleared on a clear

**Files:**
- Modify: `src/data/recorder.ts:182-196` (`finalize`)
- Test: `src/data/__tests__/recorder.test.ts` (`'gameOver (rule 6)'` block)

**Interfaces:**
- Consumes: `EngineSnapshot.cleared` (Task 1).
- Produces: `wavesCleared = snapshot.cleared ? snapshot.wave : Math.max(0, snapshot.wave - 1)`.

- [ ] **Step 1: Write the failing test** — after the existing finalize test, using that file's `ok()`, `ctx`, `makeSnapshot`, `flush`, `finalizeBodyOf`:

```ts
it('a cleared run counts its final wave as cleared; a death still counts wave - 1 (Review Focus 5)', async () => {
  fetchMock.mockResolvedValue(ok());
  const recorder = new RunRecorder(ctx);
  await flush();
  const snapshot = makeSnapshot({ wave: 5, maxWaves: 5, cleared: true, lives: 3 });
  recorder.onEvent({ type: 'gameOver', score: 0, wave: 5, ownedIds: [] }, { words: [], snapshot });
  await flush();
  expect(finalizeBodyOf().wavesCleared).toBe(5);

  fetchMock.mockClear();
  const dead = new RunRecorder(ctx);
  await flush();
  dead.onEvent(
    { type: 'gameOver', score: 0, wave: 3, ownedIds: [] },
    { words: [], snapshot: makeSnapshot({ wave: 3, maxWaves: 5, cleared: false, lives: 0 }) },
  );
  await flush();
  expect(finalizeBodyOf().wavesCleared).toBe(2);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/data/__tests__/recorder.test.ts -t "cleared run counts"`
Expected: FAIL — `wavesCleared` is 4.

- [ ] **Step 3: Implement** the one-line change in `finalize` and update its comment ("the wave in progress at death; cleared = one less — unless the run ended by clearing it").

- [ ] **Step 4: Run the recorder suite**

Run: `npx vitest run src/data/__tests__/recorder.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/data/recorder.ts src/data/__tests__/recorder.test.ts
git commit -m "fix(recorder): a cleared run reports its last wave as cleared"
```

---

### Task 5: HUD label "wave 2 / 5"

**Files:**
- Modify: `src/ui/hud/Hud.tsx:29` (`hud-wave-lat` span)
- Test: `src/ui/__tests__/Hud.test.tsx`

**Interfaces:**
- Consumes: `EngineSnapshot.maxWaves` (Task 1).
- Produces: the `data-testid="wave"` span reads `wave {wave} / {maxWaves}` when `maxWaves > 0`, else `wave {wave}`. `hud-wave-jp` stays `第{wave}波`.

- [ ] **Step 1: Write the failing test** — in the `'Hud'` describe block, using the file's `snapshot` fixture:

```ts
it('reads "wave N / max" in a capped run and plain "wave N" otherwise', () => {
  const { rerender } = render(<Hud snapshot={{ ...snapshot, wave: 2, maxWaves: 5 }} />);
  expect(screen.getByTestId('wave')).toHaveTextContent(/^wave 2 \/ 5$/);
  expect(screen.getByText('第2波')).toBeInTheDocument();
  rerender(<Hud snapshot={{ ...snapshot, wave: 2, maxWaves: 0 }} />);
  expect(screen.getByTestId('wave')).toHaveTextContent(/^wave 2$/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/ui/__tests__/Hud.test.tsx -t "capped run"`
Expected: FAIL on the first assertion.

- [ ] **Step 3: Implement** in `Hud.tsx`: `wave {snapshot.wave}{snapshot.maxWaves > 0 ? ` / ${snapshot.maxWaves}` : ''}`.

- [ ] **Step 4: Run the HUD and GameScreen suites**

Run: `npx vitest run src/ui/__tests__/Hud.test.tsx src/ui/__tests__/GameScreen.waveStart.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/hud/Hud.tsx src/ui/__tests__/Hud.test.tsx
git commit -m "feat(hud): wave label shows the cap in a capped run"
```

---

### Task 6: Results screen says "Revenge complete"

**Files:**
- Modify: `src/ui/screens/ResultsScreen.tsx:56-60` (the `<h2>` and the score line)
- Test: `src/ui/__tests__/ResultsScreen.test.tsx`

**Interfaces:**
- Consumes: `EngineSnapshot.cleared`, `EngineSnapshot.maxWaves` (Task 1).
- Produces: `<h2>` reads `Revenge complete` when `snapshot.cleared`, else `Run over`; the score line reads `Wave 5 / 5` when `maxWaves > 0`, else `Wave 5`.

- [ ] **Step 1: Write the failing test** — in the `'ResultsScreen'` describe block, using `base`, `snap`, `noop`:

```ts
it('header reads "Revenge complete" on a clear and "Run over" on a death; the wave line shows the cap', () => {
  const { rerender } = render(
    <ResultsScreen snapshot={snap({ cleared: true, maxWaves: 5, lives: 2, missed: [] })} tierAdvance={null} onRevenge={noop} onPlayAgain={noop} onTitle={noop} />,
  );
  expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Revenge complete');
  expect(screen.getByText(/Wave 5 \/ 5/)).toBeInTheDocument();
  expect(screen.getByTestId('revenge-button')).toBeDisabled();
  rerender(
    <ResultsScreen snapshot={snap({ cleared: false, maxWaves: 5 })} tierAdvance={null} onRevenge={noop} onPlayAgain={noop} onTitle={noop} />,
  );
  expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Run over');
  expect(screen.getByTestId('revenge-button')).toBeEnabled();
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/ui/__tests__/ResultsScreen.test.tsx -t "Revenge complete"`
Expected: FAIL — heading reads "Run over".

- [ ] **Step 3: Implement** the two conditionals in `ResultsScreen.tsx`.

- [ ] **Step 4: Run the suite**

Run: `npx vitest run src/ui/__tests__/ResultsScreen.test.tsx`
Expected: PASS (the pre-existing `shows score, wave, and accuracy` test still matches `Wave 5`).

- [ ] **Step 5: Commit**

```bash
git add src/ui/screens/ResultsScreen.tsx src/ui/__tests__/ResultsScreen.test.tsx
git commit -m "feat(results): Revenge complete header and wave cap on the score line"
```

---

### Task 7: App starts revenge (and its play-again) with `REVENGE_CONFIG`

**Files:**
- Modify: `src/App.tsx:166-191` (`beginRun`)
- Create: `src/ui/__tests__/App.revengeCap.test.tsx`

**Interfaces:**
- Consumes: `REVENGE_CONFIG` (Task 2); `RunOptions.config` in `src/ui/useEngine.ts` (already exists).
- Produces: `beginRun` calls `start({ ..., config: pool === 'revenge' ? REVENGE_CONFIG : undefined })`. Because `lastRunRef.current.pool` is `'revenge'` after a revenge run, play again from a revenge results screen gets the same config; play again from a normal run gets `undefined`.

- [ ] **Step 1: Write the failing test** — copy the `useEngine` mock, `card`, `snap` and `stubFetch` helpers verbatim from `App.replayPlan.test.tsx` lines 1–95 (the `start` mock is the hook under test). Tests drive the real App via `?mode=reading&pool=n5` exactly as that file's `'onPlayAgain'` test does (lines ~130–150):

```ts
describe('App passes REVENGE_CONFIG to revenge runs only', () => {
  it('fresh run: no config; revenge: REVENGE_CONFIG; play again after revenge: REVENGE_CONFIG', async () => {
    const pool = [card('a'), card('b'), card('c')];
    window.history.pushState({}, '', '/?mode=reading&pool=n5');
    stubFetch(pool, { newCardIds: [], seenCards: pool.map((c) => ({ id: c.id, weight: 1 })), tiers: [], runBudget: 0 });
    mockSnapshot = snap({ status: 'playing' });
    const { rerender } = render(<App />);
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect((start.mock.calls[0][0] as RunOptions).config).toBeUndefined();

    mockSnapshot = snap({ status: 'gameOver', missed: [pool[0], pool[1]] });
    rerender(<App />);
    await userEvent.click(await screen.findByTestId('revenge-button'));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
    const revenge = start.mock.calls[1][0] as RunOptions;
    expect(revenge.config).toEqual(REVENGE_CONFIG);
    expect(revenge.cards.map((c) => c.id)).toEqual(['a', 'b']);

    mockSnapshot = snap({ status: 'gameOver', cleared: true, maxWaves: 5, missed: [] });
    rerender(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /play again/i }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(3));
    expect((start.mock.calls[2][0] as RunOptions).config).toEqual(REVENGE_CONFIG);
  });

  it('play again from a normal run stays endless: no config (Review Focus 4)', async () => {
    const pool = [card('a'), card('b')];
    window.history.pushState({}, '', '/?mode=reading&pool=n5');
    stubFetch(pool, { newCardIds: [], seenCards: pool.map((c) => ({ id: c.id, weight: 1 })), tiers: [], runBudget: 0 });
    mockSnapshot = snap({ status: 'playing' });
    const { rerender } = render(<App />);
    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    mockSnapshot = snap({ status: 'gameOver', missed: [] });
    rerender(<App />);
    await userEvent.click(await screen.findByRole('button', { name: /play again/i }));
    await waitFor(() => expect(start).toHaveBeenCalledTimes(2));
    expect((start.mock.calls[1][0] as RunOptions).config).toBeUndefined();
  });
});
```

The results screen only mounts when `screen === 'game'` and `snapshot.status === 'gameOver'`, which the auto-run URL plus the rerendered snapshot gives you, as in the replayPlan tests. If `stubFetch`'s `tiers` type rejects `[]`, pass the single-tier literal that file uses.

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/ui/__tests__/App.revengeCap.test.tsx`
Expected: the first test FAILS at `expect(revenge.config).toEqual(REVENGE_CONFIG)` (config undefined); the second passes.

- [ ] **Step 3: Implement** in `beginRun` (`src/App.tsx`): import `REVENGE_CONFIG` from `./engine/constants`; add `config: pool === 'revenge' ? REVENGE_CONFIG : undefined,` to the `start({...})` call, with a one-line comment pointing at the plan.

- [ ] **Step 4: Run every App test**

Run: `npx vitest run src/ui/__tests__`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/ui/__tests__/App.revengeCap.test.tsx
git commit -m "feat(app): revenge runs and their replays use REVENGE_CONFIG"
```

---

### Task 8: Docs and the full check

**Files:**
- Modify: `README.md:37` (the "Revenge runs" feature bullet)

- [ ] **Step 1: Update the README bullet** to: `**Revenge runs** — replay exactly the words you missed last run: five waves of 10–15 drops, then a "Revenge complete" screen.`

- [ ] **Step 2: Run the full check**

Run: `npm run check`
Expected: tsc clean, oxlint clean, every test green.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: revenge runs are capped at five waves"
```
