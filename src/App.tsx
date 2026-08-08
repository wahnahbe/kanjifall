import { useCallback, useEffect, useRef, useState } from 'react';
import { DataLoadError, loadPool, type PoolId } from './data/loader';
import { drainOutbox } from './data/outbox';
import { fetchRunPlan, toEnginePlan } from './data/planClient';
import { RunRecorder } from './data/recorder';
import type { Card, EnginePlan, GameMode } from './engine/types';
import { noticeFor } from './planNotice';
import type { TierProgress } from './shared/api';
import { tierAdvanceLine } from './tierAdvance';
import { GameScreen } from './ui/screens/GameScreen';
import { SetupScreen } from './ui/screens/SetupScreen';
import { StatsScreen } from './ui/screens/StatsScreen';
import { TitleScreen } from './ui/screens/TitleScreen';
import { useEngine } from './ui/useEngine';

type Screen = 'title' | 'setup' | 'game' | 'stats';

const VALID_MODES: GameMode[] = ['reading', 'recall'];
const VALID_POOLS: PoolId[] = ['n5', 'n4', 'n3', 'n2', 'mixed'];

/** 'revenge' isn't a plannable pool (it bypasses planning entirely, spec
 *  §5.5) — this narrows lastRunRef's plain `pool: string` down to something
 *  fetchRunPlan's tier-advance refetch can actually ask the server about. */
function isPoolId(pool: string): pool is PoolId {
  return (VALID_POOLS as readonly string[]).includes(pool);
}

/**
 * Replays never introduce anything, so this always replaces whatever notice
 * the original run was showing (item 4: planNotice must never go stale
 * across a replay by silently inheriting the previous run's message).
 */
const REPLAY_NOTICE = 'Replay — review only, no new words this run.';

function runFromUrl(): { mode: GameMode; pool: PoolId } | null {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode') as GameMode | null;
  const pool = params.get('pool') as PoolId | null;
  if (mode !== null && pool !== null && VALID_MODES.includes(mode) && VALID_POOLS.includes(pool)) {
    return { mode, pool };
  }
  return null;
}

/**
 * A zero-budget plan preserving the ORIGINAL run's newCardIds AND weighted
 * seenCards, unioned with whatever this run itself introduced. Spawner keys
 * both its pools off the plan (src/engine/Spawner.ts): newCardIds parks
 * genuinely-unmet cards out of reach (the CRITICAL replay bug M4-A fixed),
 * and seenCards is now the ONLY source of the review pool — cards in neither
 * list are locked (tiered-vocab spec §5.3), so a replay must restate the
 * original seen list or nothing could spawn at all.
 *
 * The union with introducedThisRun matters even beyond that: the run-START
 * snapshot (lastPlanRef) predates every ceremony this run actually ran. A
 * first-ever run starts with an empty seenCards, and once it introduces a
 * few cards, replaying with just that stale snapshot would leave the seen
 * pool empty - the starved fallback would then draw uniformly from ALL of
 * newCardIds, including cards this run never reached, burning their
 * acquisition ceremony forever the instant they fall and get an attempt
 * (spec §4.2).
 *
 * A null original means the original run itself had no plan (server down):
 * every pool card was review-eligible at uniform weight, and the replay
 * keeps exactly that - introducedThisRun is moot there, since nothing was
 * ever locked to begin with.
 */
function replayPlan(
  original: EnginePlan | null,
  pool: readonly Card[],
  introducedThisRun: ReadonlySet<string>,
): EnginePlan {
  if (original === null) {
    return {
      newCardIds: [],
      seenCards: pool.map((c) => ({ id: c.id, weight: 1 })),
      runBudget: 0,
      perWaveNewCap: 0,
    };
  }
  // Cards introduced DURING the run are genuinely met — the run-start
  // snapshot predates them, and without this union a first-ever run's
  // replay has an empty seen pool and the starved fallback burns the
  // ceremonies of the cards it never reached. Weight 1: a fresh plan
  // reweights them properly server-side; here they just need to be
  // ordinarily drawable.
  const alreadySeen = new Set(original.seenCards.map((s) => s.id));
  const introduced = [...introducedThisRun]
    .filter((id) => !alreadySeen.has(id))
    .map((id) => ({ id, weight: 1 }));
  return {
    newCardIds: original.newCardIds,
    seenCards: [...original.seenCards, ...introduced],
    runBudget: 0,
    perWaveNewCap: 0,
  };
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('title');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const lastRunRef =
    useRef<{ mode: GameMode; cards: Card[]; listVersion: string; pool: string } | null>(null);
  // The plan the CURRENT run was actually started with (fresh fetch only -
  // replays never overwrite this), so a replay can still name the original
  // run's genuinely-unmet cards even though it hands the engine zero budget.
  const lastPlanRef = useRef<EnginePlan | null>(null);
  // The tier snapshot the CURRENT run started with (fresh fetch only - same
  // lifecycle as introducedIdsRef below: replays never overwrite this), so
  // every results screen in a replay chain measures progress against the
  // ORIGINAL run's baseline, not a stale mid-chain snapshot. Compared
  // against a fresh re-fetch on gameOver to compute tierAdvance (tiered
  // spec §5.4).
  const lastTiersRef = useRef<readonly TierProgress[] | null>(null);
  // Cards introduced (ceremony completed OR skipped - both count, spec §3.1)
  // during the CURRENT fresh run. Reset only when a fresh run actually
  // begins (beginFromPool) - replays never touch it, so replaying a replay
  // still remembers everything introduced across the whole chain. Folded
  // into replayPlan's seen list so a replay never starves cards this run
  // itself introduced (see replayPlan's doc comment).
  const introducedIdsRef = useRef<Set<string>>(new Set());
  const recorderRef = useRef<RunRecorder | null>(null);
  const [planNotice, setPlanNotice] = useState<string | null>(null);
  // The plain results-screen line for this run, or null (tiered spec §5.4).
  // Reset alongside planNotice so a replay never shows a stale prior run's
  // achievement before its own gameOver has had a chance to recompute it.
  const [tierAdvance, setTierAdvance] = useState<string | null>(null);
  const { snapshot, hostRef, start, resume, introCards } = useEngine();

  // The sole place planNotice is set, for fresh starts and both replay paths
  // alike - so it's always recomputed for what's actually happening now and
  // can never keep showing a previous run's stale notice (item 4).
  const beginRun = useCallback(
    (
      mode: GameMode,
      cards: Card[],
      listVersion: string,
      pool: string,
      plan: EnginePlan | null,
      notice: string | null,
    ) => {
      lastRunRef.current = { mode, cards, listVersion, pool };
      setPlanNotice(notice);
      setTierAdvance(null);
      const recorder = new RunRecorder({ runId: crypto.randomUUID(), mode, pool, cards, listVersion });
      recorderRef.current = recorder;
      start({
        mode, cards, plan: plan ?? undefined, onEvent: (event, view) => recorder.onEvent(event, view),
      });
      setScreen('game');
    },
    [start],
  );

  const beginFromPool = useCallback(async (mode: GameMode, pool: PoolId) => {
    setLoading(true);
    setLoadError(null);
    // A genuinely fresh run: nothing has been introduced yet, and anything
    // recorded by a PRIOR run/replay chain must not leak into this one.
    introducedIdsRef.current = new Set();
    try {
      const [{ cards, listVersion }, fetched] =
        await Promise.all([loadPool(pool), fetchRunPlan(pool, mode)]);
      const plan = fetched === null ? null : toEnginePlan(fetched);
      lastPlanRef.current = plan;
      lastTiersRef.current = fetched?.tiers ?? null;
      const notice = noticeFor(fetched);
      beginRun(mode, cards, listVersion, pool, plan, notice);
    } catch (error: unknown) {
      setLoadError(error instanceof DataLoadError ? error.message : 'unexpected load failure');
    } finally {
      setLoading(false);
    }
  }, [beginRun]);

  // Once a run ends, compare the tier snapshot it started with (lastTiersRef)
  // against a fresh re-fetch to see whether THIS run pushed a level's active
  // tier forward (tiered spec §5.4 — plain results-screen line only; the
  // celebration itself is sub-project C's scope). An effect, not something
  // computed inline at gameOver time, because the "after" side needs a fresh
  // network round-trip that doesn't exist until the run has actually ended.
  useEffect(() => {
    if (snapshot.status !== 'gameOver') return;
    const run = lastRunRef.current;
    if (run === null || !isPoolId(run.pool)) return; // 'revenge' skips the round-trip entirely
    let cancelled = false;
    void fetchRunPlan(run.pool, run.mode).then((fetched) => {
      if (!cancelled) setTierAdvance(tierAdvanceLine(lastTiersRef.current, fetched?.tiers ?? null));
    });
    return () => {
      cancelled = true;
    };
  }, [snapshot.status]);

  // Dev/e2e determinism: ?mode=&pool= auto-starts a run, skipping title/setup.
  const autoRun = useRef(runFromUrl());
  useEffect(() => {
    if (autoRun.current !== null) {
      const { mode, pool } = autoRun.current;
      autoRun.current = null;
      void beginFromPool(mode, pool);
    }
  }, [beginFromPool]);

  // Replays any offline-queued run/event/finalize payloads from a prior
  // session, once at boot. Never blocks: fire-and-forget, failures stay queued.
  useEffect(() => {
    drainOutbox()
      .then(({ remaining }) => {
        if (remaining > 0) console.warn(`kotoba outbox: ${remaining} entries still pending`);
      })
      .catch((error: unknown) => console.warn('kotoba outbox drain failed', error));
  }, []);

  if (screen === 'game') {
    return (
      <GameScreen
        snapshot={snapshot}
        hostRef={hostRef}
        introCards={introCards}
        planNotice={planNotice}
        tierAdvance={tierAdvance}
        onIntroduced={(cardId) => {
          introducedIdsRef.current.add(cardId);
          recorderRef.current?.recordIntroduction(cardId);
        }}
        onIntroComplete={resume}
        onRevenge={(missed) => lastRunRef.current
          && beginRun(
            lastRunRef.current.mode,
            missed,
            lastRunRef.current.listVersion,
            'revenge',
            // Revenge's cards are always previously-missed, hence attempted,
            // hence already seen server-side - so in practice this is a
            // no-op. Applied anyway so both replay paths are identical and
            // neither can silently un-introduce a fresh card if that
            // invariant about missed cards ever stops holding (see
            // replayPlan's doc comment for the failure this guards against).
            replayPlan(lastPlanRef.current, missed, introducedIdsRef.current),
            REPLAY_NOTICE,
          )}
        onPlayAgain={() => lastRunRef.current
          && beginRun(
            lastRunRef.current.mode,
            lastRunRef.current.cards,
            lastRunRef.current.listVersion,
            lastRunRef.current.pool,
            // lastRunRef.current.cards is the ENTIRE loaded pool (hundreds
            // of cards), most never attempted server-side. See replayPlan's
            // doc comment: this is the fix for the CRITICAL "Play again"
            // bug, where a null plan let un-introduced cards spawn and burn
            // their acquisition moment forever.
            replayPlan(lastPlanRef.current, lastRunRef.current.cards, introducedIdsRef.current),
            REPLAY_NOTICE,
          )}
        onTitle={() => setScreen('title')}
      />
    );
  }
  if (screen === 'setup') {
    return (
      <SetupScreen
        loading={loading}
        error={loadError}
        onBegin={(mode, pool) => void beginFromPool(mode, pool)}
        onBack={() => setScreen('title')}
      />
    );
  }
  if (screen === 'stats') {
    return <StatsScreen onBack={() => setScreen('title')} />;
  }
  return <TitleScreen onStart={() => setScreen('setup')} onStats={() => setScreen('stats')} />;
}
