import { useEffect } from 'react';
import type { Card } from '../../engine/types';

interface WaveIntroOverlayProps {
  cards: Card[]; // ONLY the not-yet-seen cards; parent filters
  wave: number;
  onDismiss: () => void;
}

/** Pre-wave interstitial (spec §3.6): meaning + spelling before words ever fall. */
export function WaveIntroOverlay({ cards, wave, onDismiss }: WaveIntroOverlayProps) {
  const empty = cards.length === 0;

  useEffect(() => {
    if (empty) onDismiss();
  }, [empty, onDismiss]);

  if (empty) return null;

  return (
    <div className="overlay" data-testid="wave-intro">
      <h2>Wave {wave} — new words</h2>
      <table className="intro-words">
        <tbody>
          {cards.map((card) => (
            <tr key={card.id}>
              <td className="intro-kanji">{card.kanji ?? '—'}</td>
              <td className="intro-kana">{card.kana[0]}</td>
              <td>{card.gloss}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">Press Enter to start the wave</p>
    </div>
  );
}
