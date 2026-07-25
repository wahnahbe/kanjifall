import type { RefObject } from 'react';
import type { Card, EngineSnapshot } from '../../engine/types';
import { Hud } from '../hud/Hud';
import { AcquisitionCeremony } from './AcquisitionCeremony';
import { ResultsScreen } from './ResultsScreen';

interface GameScreenProps {
  snapshot: EngineSnapshot;
  hostRef: RefObject<HTMLDivElement | null>;
  introCards: Card[]; // this wave's newly introduced cards (waveStarting.newCards)
  planNotice: string | null;
  onIntroduced: (cardId: string) => void;
  onIntroComplete: () => void;
  onRevenge: (missed: Card[]) => void;
  onPlayAgain: () => void;
  onTitle: () => void;
}

export function GameScreen({
  snapshot, hostRef, introCards, planNotice, onIntroduced, onIntroComplete, onRevenge, onPlayAgain, onTitle,
}: GameScreenProps) {
  return (
    <div className="game-screen">
      <div className="pixi-host" ref={hostRef} />
      <Hud snapshot={snapshot} />
      {planNotice !== null && <p className="plan-notice" data-testid="plan-notice">{planNotice}</p>}
      {snapshot.status === 'waveIntro' && (
        <AcquisitionCeremony
          cards={introCards}
          onIntroduced={onIntroduced}
          onComplete={onIntroComplete}
        />
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
