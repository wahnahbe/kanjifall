import { useCallback, useEffect, useRef, useState } from 'react';
import { DataLoadError, loadPool, type PoolId } from './data/loader';
import { drainOutbox } from './data/outbox';
import { fetchRunPlan, toEnginePlan } from './data/planClient';
import { RunRecorder } from './data/recorder';
import type { Card, EnginePlan, GameMode } from './engine/types';
import { noticeFor } from './planNotice';
import { GameScreen } from './ui/screens/GameScreen';
import { SetupScreen } from './ui/screens/SetupScreen';
import { StatsScreen } from './ui/screens/StatsScreen';
import { TitleScreen } from './ui/screens/TitleScreen';
import { useEngine } from './ui/useEngine';

type Screen = 'title' | 'setup' | 'game' | 'stats';

const VALID_MODES: GameMode[] = ['reading', 'recall'];
const VALID_POOLS: PoolId[] = ['n5', 'n4', 'n3', 'n2', 'mixed'];

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
 * seenCards. Spawner keys both its pools off the plan (src/engine/Spawner.ts):
 * newCardIds parks genuinely-unmet cards out of reach (the CRITICAL replay
 * bug M4-A fixed), and seenCards is now the ONLY source of the review pool —
 * cards in neither list are locked (tiered-vocab spec §5.3), so a replay
 * must restate the original seen list or nothing could spawn at all.
 *
 * A null original means the original run itself had no plan (server down):
 * every pool card was review-eligible at uniform weight, and the replay
 * keeps exactly that.
 */
function replayPlan(original: EnginePlan | null, pool: readonly Card[]): EnginePlan {
  if (original === null) {
    return {
      newCardIds: [],
      seenCards: pool.map((c) => ({ id: c.id, weight: 1 })),
      runBudget: 0,
      perWaveNewCap: 0,
    };
  }
  return {
    newCardIds: original.newCardIds,
    seenCards: original.seenCards,
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
  const recorderRef = useRef<RunRecorder | null>(null);
  const [planNotice, setPlanNotice] = useState<string | null>(null);
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
    try {
      const [{ cards, listVersion }, fetched] = await Promise.all([loadPool(pool), fetchRunPlan(pool)]);
      const plan = fetched === null ? null : toEnginePlan(fetched);
      lastPlanRef.current = plan;
      const notice = noticeFor(plan, fetched !== null && fetched.seenCards.length === 0);
      beginRun(mode, cards, listVersion, pool, plan, notice);
    } catch (error: unknown) {
      setLoadError(error instanceof DataLoadError ? error.message : 'unexpected load failure');
    } finally {
      setLoading(false);
    }
  }, [beginRun]);

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
        onIntroduced={(cardId) => recorderRef.current?.recordIntroduction(cardId)}
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
            replayPlan(lastPlanRef.current, missed),
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
            replayPlan(lastPlanRef.current, lastRunRef.current.cards),
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
