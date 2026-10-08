import { useLayoutEffect, useRef, type RefObject } from 'react';
import { playScale } from '../../design/scale';
import type { Card, EngineSnapshot } from '../../engine/types';
import { Hud } from '../hud/Hud';
import { ImeWarning } from '../hud/ImeWarning';
import { AcquisitionCeremony } from './AcquisitionCeremony';
import { ResultsScreen } from './ResultsScreen';

interface GameScreenProps {
  snapshot: EngineSnapshot;
  hostRef: RefObject<HTMLDivElement | null>;
  introCards: Card[]; // this wave's newly introduced cards (waveStarting.newCards)
  planNotice: string | null;
  /** Forwarded straight to ResultsScreen (tiered spec §5.4). */
  tierAdvance: string | null;
  onIntroduced: (cardId: string) => void;
  onIntroComplete: () => void;
  onRevenge: (missed: Card[]) => void;
  onPlayAgain: () => void;
  onTitle: () => void;
}

export function GameScreen({
  snapshot, hostRef, introCards, planNotice, tierAdvance, onIntroduced, onIntroComplete, onRevenge,
  onPlayAgain, onTitle,
}: GameScreenProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Second-pass spec §3.3: the buffer kana and the HUD ramp scale with the
  // Pixi word size from the one pure function, keyed on the playfield's
  // height (the screen minus the machine band). Re-run on resize so the
  // CSS side never lags Pixi's. jsdom reports 0 → playScale clamps to 44.
  // `||` (not `??`): a mounted host never reports 0 in a browser, but in
  // jsdom the host's 0 must fall through to the root's height.
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) return;
    const apply = (): void => {
      const host = root.querySelector<HTMLElement>('.pixi-host');
      const { wordPx, hudScale } = playScale(host?.clientHeight || root.clientHeight);
      root.style.setProperty('--size-word-play', `${wordPx}px`);
      root.style.setProperty('--hud-scale', String(hudScale));
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);

  return (
    <div className="game-screen" ref={rootRef} data-testid="game-screen">
      <div className="pixi-host" ref={hostRef} />
      <Hud snapshot={snapshot} />
      <ImeWarning />
      {snapshot.status === 'playing' && planNotice !== null && (
        <p className="plan-notice" data-testid="plan-notice">{planNotice}</p>
      )}
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
          tierAdvance={tierAdvance}
          onRevenge={onRevenge}
          onPlayAgain={onPlayAgain}
          onTitle={onTitle}
        />
      )}
    </div>
  );
}
