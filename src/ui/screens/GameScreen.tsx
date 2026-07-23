import type { RefObject } from 'react';
import type { EngineSnapshot } from '../../engine/types';
import { Hud } from '../hud/Hud';
import { GameOverOverlay } from './GameOverOverlay';

export function GameScreen({ snapshot, hostRef, onRestart }: {
  snapshot: EngineSnapshot;
  hostRef: RefObject<HTMLDivElement | null>;
  onRestart: () => void;
}) {
  return (
    <div className="game-screen">
      <div className="pixi-host" ref={hostRef} />
      <Hud snapshot={snapshot} />
      {snapshot.status === 'gameOver' && (
        <GameOverOverlay snapshot={snapshot} onRestart={onRestart} />
      )}
    </div>
  );
}
