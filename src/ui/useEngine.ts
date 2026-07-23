import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { GameEngine } from '../engine/GameEngine';
import type { Card, EngineConfig, EngineSnapshot, GameEvent, GameMode } from '../engine/types';
import { PixiStage } from '../render/PixiStage';

const IDLE_SNAPSHOT: EngineSnapshot = {
  status: 'idle', mode: 'reading', score: 0, lives: 0, wave: 0, combo: 0, maxCombo: 0,
  kills: 0, wrongSubmits: 0,
  bufferKana: '', bufferRomaji: '', lockedIds: [], missed: [], timeMs: 0,
};

export interface GameKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  isComposing: boolean;
}

/** True when the game should consume this keydown (never modifier chords or IME composition). */
export function isGameKey(e: GameKeyEvent): boolean {
  if (e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return false;
  return e.key === 'Enter' || e.key === 'Escape' || e.key === 'Backspace' || /^[a-zA-Z-]$/.test(e.key);
}

function seedFromUrl(): number | null {
  const raw = new URLSearchParams(window.location.search).get('seed');
  const parsed = raw === null ? NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export interface RunOptions {
  mode: GameMode;
  cards: Card[];
  seed?: number;
  introduceWords?: boolean; // default true: pause each wave behind the intro overlay
  config?: Partial<EngineConfig>;
}

export function useEngine() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [runId, setRunId] = useState(0);
  const [introCards, setIntroCards] = useState<Card[]>([]);

  // Snapshot store: replaced on engine events only (words render via Pixi, not React).
  const snapshotRef = useRef<EngineSnapshot>(IDLE_SNAPSHOT);
  const listenersRef = useRef(new Set<() => void>());

  const subscribe = useCallback((cb: () => void) => {
    listenersRef.current.add(cb);
    return () => listenersRef.current.delete(cb);
  }, []);
  const getSnapshot = useCallback(() => snapshotRef.current, []);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);

  const start = useCallback((opts: RunOptions) => {
    engineRef.current = new GameEngine({
      cards: opts.cards,
      mode: opts.mode,
      seed: opts.seed ?? seedFromUrl() ?? Date.now(),
      config: { pauseOnWaveStart: opts.introduceWords ?? true, ...opts.config },
    });
    setIntroCards([]);
    setRunId((n) => n + 1);
  }, []);

  const resume = useCallback(() => {
    engineRef.current?.resume();
  }, []);

  useEffect(() => {
    const engine = engineRef.current;
    const host = hostRef.current;
    if (!engine || !host) return;

    let stage: PixiStage | null = null;
    let rafId = 0;
    let disposed = false;

    const publish = () => {
      snapshotRef.current = engine.getSnapshot(); // new object → useSyncExternalStore re-renders
      for (const cb of listenersRef.current) cb();
    };

    const onEvent = (event: GameEvent) => {
      if (event.type === 'wordKilled') stage?.playKill(event.word);
      if (event.type === 'wordMissed') stage?.playMiss(event.word);
      if (event.type === 'waveStarting') setIntroCards(event.cards);
      publish();
    };

    const onKey = (e: KeyboardEvent) => {
      const status = snapshotRef.current.status;
      if (status !== 'playing' && status !== 'waveIntro') return;
      if (!isGameKey(e)) return;
      e.preventDefault();
      engine.handleKey(e.key);
    };

    // No visibility handler needed: rAF stops in background tabs and the
    // 100ms clamp in tick() absorbs the gap on return.
    const loop = (now: number) => {
      engine.tick(now);
      stage?.sync(engine.getWords(), snapshotRef.current.lockedIds, snapshotRef.current.mode);
      rafId = requestAnimationFrame(loop);
    };

    const unsubscribe = engine.subscribe(onEvent);
    window.addEventListener('keydown', onKey);
    if (import.meta.env.DEV) {
      window.__kotoba = {
        snapshot: () => ({
          ...engine.getSnapshot(),
          firstAirborneReading: engine.getWords()[0]?.card.kana[0] ?? null,
        }),
      };
    }

    PixiStage.create(host).then((created) => {
      if (disposed) return created.destroy();
      stage = created;
      engine.start();
      publish();
      rafId = requestAnimationFrame(loop);
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(rafId);
      unsubscribe();
      window.removeEventListener('keydown', onKey);
      stage?.destroy();
    };
  }, [runId]);

  return { snapshot, hostRef, start, resume, introCards };
}
