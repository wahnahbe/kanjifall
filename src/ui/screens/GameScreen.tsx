import type { RefObject } from 'react';
import type { Card, EngineSnapshot } from '../../engine/types';
import { Hud } from '../hud/Hud';
import { ResultsScreen } from './ResultsScreen';
import { WaveIntroOverlay } from './WaveIntroOverlay';

interface GameScreenProps {
  snapshot: EngineSnapshot;
  hostRef: RefObject<HTMLDivElement | null>;
  introCards: Card[]; // already filtered to unseen by App
  onDismissIntro: () => void;
  onRevenge: (missed: Card[]) => void;
  onPlayAgain: () => void;
  onTitle: () => void;
}

export function GameScreen({
  snapshot, hostRef, introCards, onDismissIntro, onRevenge, onPlayAgain, onTitle,
}: GameScreenProps) {
  return (
    <div className="game-screen">
      <div className="pixi-host" ref={hostRef} />
      <Hud snapshot={snapshot} />
      {snapshot.status === 'waveIntro' && (
        <WaveIntroOverlay cards={introCards} wave={snapshot.wave} onDismiss={onDismissIntro} />
      )}
      {snapshot.status === 'gameOver' && (
        <ResultsScreen
          snapshot={snapshot}
          onRevenge={onRevenge}
          onPlayAgain={onPlayAgain}
          onTitle={onTitle}
        />
      )}
    </div>
  );
}
