import { useCallback, useEffect, useRef, useState } from 'react';
import { DataLoadError, loadPool, type PoolId } from './data/loader';
import { drainOutbox } from './data/outbox';
import { fetchRunPlan } from './data/planClient';
import { RunRecorder } from './data/recorder';
import type { Card, EnginePlan, GameMode } from './engine/types';
import { GameScreen } from './ui/screens/GameScreen';
import { SetupScreen } from './ui/screens/SetupScreen';
import { StatsScreen } from './ui/screens/StatsScreen';
import { TitleScreen } from './ui/screens/TitleScreen';
import { useEngine } from './ui/useEngine';

type Screen = 'title' | 'setup' | 'game' | 'stats';

const VALID_MODES: GameMode[] = ['reading', 'recall'];
const VALID_POOLS: PoolId[] = ['n5', 'n4', 'n3', 'n2', 'mixed'];

function runFromUrl(): { mode: GameMode; pool: PoolId } | null {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode') as GameMode | null;
  const pool = params.get('pool') as PoolId | null;
  if (mode !== null && pool !== null && VALID_MODES.includes(mode) && VALID_POOLS.includes(pool)) {
    return { mode, pool };
  }
  return null;
}

/** What to tell the player about this run's new-word situation (spec §3.2, §7). */
function noticeFor(plan: EnginePlan | null): string | null {
  if (plan === null) return 'Word introductions need the server — playing without them.';
  if (plan.runBudget > 0) return null;
  if (plan.newCardIds.length === 0) return null;
  return "Today's new words are done — this run is review.";
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('title');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const lastRunRef =
    useRef<{ mode: GameMode; cards: Card[]; listVersion: string; pool: string } | null>(null);
  const recorderRef = useRef<RunRecorder | null>(null);
  const [planNotice, setPlanNotice] = useState<string | null>(null);
  const { snapshot, hostRef, start, resume, introCards } = useEngine();

  const beginRun = useCallback(
    (mode: GameMode, cards: Card[], listVersion: string, pool: string, plan: EnginePlan | null) => {
      lastRunRef.current = { mode, cards, listVersion, pool };
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
      const [{ cards, listVersion }, plan] = await Promise.all([loadPool(pool), fetchRunPlan(pool)]);
      setPlanNotice(noticeFor(plan));
      beginRun(mode, cards, listVersion, pool, plan);
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
          && beginRun(lastRunRef.current.mode, missed, lastRunRef.current.listVersion, 'revenge', null)}
        onPlayAgain={() => lastRunRef.current
          && beginRun(
            lastRunRef.current.mode,
            lastRunRef.current.cards,
            lastRunRef.current.listVersion,
            lastRunRef.current.pool,
            null,
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
