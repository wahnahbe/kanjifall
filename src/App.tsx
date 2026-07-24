import { useCallback, useEffect, useRef, useState } from 'react';
import { DataLoadError, loadPool, type PoolId } from './data/loader';
import { drainOutbox } from './data/outbox';
import { RunRecorder } from './data/recorder';
import type { Card, GameMode } from './engine/types';
import { GameScreen } from './ui/screens/GameScreen';
import { SetupScreen } from './ui/screens/SetupScreen';
import { TitleScreen } from './ui/screens/TitleScreen';
import { useEngine } from './ui/useEngine';

type Screen = 'title' | 'setup' | 'game';

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

export default function App() {
  const [screen, setScreen] = useState<Screen>('title');
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const lastRunRef =
    useRef<{ mode: GameMode; cards: Card[]; listVersion: string; pool: string } | null>(null);
  const seenIdsRef = useRef(new Set<string>()); // session-scoped across runs (spec §3.6)
  const { snapshot, hostRef, start, resume, introCards } = useEngine();

  const beginRun = useCallback((mode: GameMode, cards: Card[], listVersion: string, pool: string) => {
    lastRunRef.current = { mode, cards, listVersion, pool };
    const recorder = new RunRecorder({ runId: crypto.randomUUID(), mode, pool, cards, listVersion });
    start({ mode, cards, onEvent: (event, view) => recorder.onEvent(event, view) });
    setScreen('game');
  }, [start]);

  const beginFromPool = useCallback(async (mode: GameMode, pool: PoolId) => {
    setLoading(true);
    setLoadError(null);
    try {
      const { cards, listVersion } = await loadPool(pool);
      beginRun(mode, cards, listVersion, pool);
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

  const unseenIntro = introCards.filter((c) => !seenIdsRef.current.has(c.id));

  const dismissIntro = useCallback(() => {
    for (const card of introCards) seenIdsRef.current.add(card.id);
    resume();
  }, [introCards, resume]);

  const prevStatus = useRef(snapshot.status);
  useEffect(() => {
    if (prevStatus.current === 'waveIntro' && snapshot.status === 'playing') {
      for (const card of introCards) seenIdsRef.current.add(card.id);
    }
    prevStatus.current = snapshot.status;
  }, [snapshot.status, introCards]);

  if (screen === 'game') {
    return (
      <GameScreen
        snapshot={snapshot}
        hostRef={hostRef}
        introCards={unseenIntro}
        onDismissIntro={dismissIntro}
        onRevenge={(missed) => lastRunRef.current
          && beginRun(lastRunRef.current.mode, missed, lastRunRef.current.listVersion, 'revenge')}
        onPlayAgain={() => lastRunRef.current
          && beginRun(
            lastRunRef.current.mode,
            lastRunRef.current.cards,
            lastRunRef.current.listVersion,
            lastRunRef.current.pool,
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
  return <TitleScreen onStart={() => setScreen('setup')} />;
}
