import { useEffect, useRef } from 'react';
import { MOTION } from '../design/motion';
import { visualParams } from '../design/visualParams';
import { useSettings } from './useSettings';

interface WaveStartProps {
  wave: number;
  /** Called exactly once when the beat is over (or at once at effects off). */
  onDone: () => void;
}

/** Second-pass spec §4.5: 第N波 bleeds in large at the centre while a band of
 *  light rises from the floor, then drains as the HUD label bleeds in. Owns
 *  the last --duration-beat of the waveIntro pause, after any ceremony
 *  (ordering amendment, plan Task 11). The number itself is state: at
 *  `waveBeat === 'slot'` nothing renders here and the HUD label simply
 *  appears, because onDone fires immediately. */
export function WaveStart({ wave, onDone }: WaveStartProps) {
  const { waveBeat } = visualParams(useSettings().effects);
  const doneRef = useRef(false);
  useEffect(() => {
    const finish = (): void => {
      if (doneRef.current) return;
      doneRef.current = true;
      onDone();
    };
    if (waveBeat === 'slot') {
      finish();
      return;
    }
    const timer = window.setTimeout(finish, MOTION.beatMs);
    return () => window.clearTimeout(timer);
  }, [onDone, waveBeat]);

  if (waveBeat === 'slot') return null;
  return (
    <div className="wave-start" data-testid="wave-start" data-beat={waveBeat} aria-live="polite">
      <p className="wave-start-jp" lang="ja">第{wave}波</p>
      <p className="wave-start-lat">wave {wave}</p>
      <div className="wave-start-sweep" aria-hidden="true" />
    </div>
  );
}
