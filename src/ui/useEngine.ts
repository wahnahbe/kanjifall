import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { N5_WORDS } from '../data/n5words';
import { GameEngine } from '../engine/GameEngine';
import type { EngineSnapshot, GameEvent } from '../engine/types';
import { PixiStage } from '../render/PixiStage';

const IDLE_SNAPSHOT: EngineSnapshot = {
  status: 'idle', score: 0, lives: 0, wave: 0, combo: 0,
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

declare global {
  interface Window {
    __kotoba?: { snapshot(): EngineSnapshot & { firstAirborneReading?: string | null } };
  }
}

function seedFromUrl(): number | null {
  const raw = new URLSearchParams(window.location.search).get('seed');
  const parsed = raw === null ? NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function useEngine() {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const [runId, setRunId] = useState(0);

  // Snapshot store: replaced on engine events only (words render via Pixi, not React).
  const snapshotRef = useRef<EngineSnapshot>(IDLE_SNAPSHOT);
  const listenersRef = useRef(new Set<() => void>());

  const subscribe = useCallback((cb: () => void) => {
    listenersRef.current.add(cb);
    return () => listenersRef.current.delete(cb);
  }, []);
  const getSnapshot = useCallback(() => snapshotRef.current, []);
  const snapshot = useSyncExternalStore(subscribe, getSnapshot);

  const start = useCallback((seed?: number) => {
    engineRef.current = new GameEngine({
      cards: N5_WORDS,
      mode: 'reading',
      seed: seed ?? seedFromUrl() ?? Date.now(),
    });
    setRunId((n) => n + 1);
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
      publish();
    };

    const onKey = (e: KeyboardEvent) => {
      if (!isGameKey(e)) return;
      e.preventDefault();
      engine.handleKey(e.key);
    };

    // No visibility handler needed: rAF stops in background tabs and the
    // 100ms clamp in tick() absorbs the gap on return.
    const loop = (now: number) => {
      engine.tick(now);
      stage?.sync(engine.getWords(), snapshotRef.current.lockedIds, 'reading');
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

  return { snapshot, hostRef, start };
}
