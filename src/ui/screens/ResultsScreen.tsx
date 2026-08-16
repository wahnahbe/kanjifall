import { useEffect, useRef } from 'react';
import { sfx } from '../../audio/sfx';
import { cssHex, PALETTE } from '../../design/palette';
import type { Card, EngineSnapshot } from '../../engine/types';
import { useSettings } from '../useSettings';

/** Spec §3.1: confetti draws from ink/cyan/accent only — the three colours the identity keeps, not
 *  a bespoke pink/blue/amber mix (and not the retired kill-green that mix used to include). Sourced
 *  from PALETTE rather than retyped as literals so this can't drift from tokens.css. */
const CONFETTI_COLORS = [cssHex(PALETTE.ink), cssHex(PALETTE.system), cssHex(PALETTE.accent)];

interface ResultsScreenProps {
  snapshot: EngineSnapshot;
  /** Plain line naming the tier this run advanced, or null (tiered spec
   *  §5.4). The celebration (banner/confetti/fanfare) built around it is
   *  juice-pass spec §6. */
  tierAdvance: string | null;
  onRevenge: (missed: Card[]) => void;
  onPlayAgain: () => void;
  onTitle: () => void;
}

function dedupeById(cards: Card[]): Card[] {
  const seen = new Set<string>();
  const out: Card[] = [];
  for (const card of cards) {
    if (!seen.has(card.id)) {
      seen.add(card.id);
      out.push(card);
    }
  }
  return out;
}

export function ResultsScreen({
  snapshot, tierAdvance, onRevenge, onPlayAgain, onTitle,
}: ResultsScreenProps) {
  const missed = dedupeById(snapshot.missed);
  const attempts = snapshot.kills + snapshot.missed.length + snapshot.wrongSubmits;
  const accuracy = attempts === 0 ? 0 : Math.round((snapshot.kills / attempts) * 100);

  const settings = useSettings();
  const playedRef = useRef(false);
  useEffect(() => {
    // Deliberately NOT reset on effect re-run: StrictMode's double-invocation
    // must not double-play, and a fresh results screen is a fresh component
    // instance with a fresh ref (the OPPOSITE of ImportScreen's disposedRef
    // pattern — see the juice-pass plan's Global Constraints).
    if (tierAdvance === null || playedRef.current) return;
    playedRef.current = true;
    sfx.tierFanfare();
  }, [tierAdvance]);

  return (
    <div className="overlay" data-testid="results">
      <h2>Run over</h2>
      <p>
        <span data-testid="final-score">{snapshot.score}</span> pts · Wave {snapshot.wave} ·{' '}
        <span data-testid="accuracy">{accuracy}%</span> accuracy
      </p>
      {tierAdvance !== null && settings.effects !== 'off' && (
        <div className="tier-celebration" data-testid="tier-celebration">
          <p className="tier-advance tier-banner" data-testid="tier-advance">{tierAdvance}</p>
          {settings.effects === 'full' && (
            <div className="confetti" data-testid="confetti" aria-hidden="true">
              {Array.from({ length: 24 }, (_, i) => (
                <span
                  key={i}
                  className="confetti-dot"
                  style={{
                    left: `${(i * 41) % 100}%`,
                    animationDelay: `${(i % 8) * 90}ms`,
                    backgroundColor: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}
      {tierAdvance !== null && settings.effects === 'off' && (
        <p className="tier-advance" data-testid="tier-advance">{tierAdvance}</p>
      )}
      {missed.length > 0 && (
        <table className="missed">
          <tbody>
            {missed.map((card) => (
              <tr key={card.id}>
                <td>{card.kanji ?? '—'}</td>
                <td>{card.kana[0]}</td>
                <td>{card.gloss}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="results-buttons">
        <button
          data-testid="revenge-button"
          disabled={missed.length === 0}
          autoFocus={missed.length > 0}
          onClick={() => onRevenge(missed)}
        >
          Revenge round ({missed.length})
        </button>
        <button className="primary" autoFocus={missed.length === 0} onClick={onPlayAgain}>Play again</button>
        <button onClick={onTitle}>Title</button>
      </div>
    </div>
  );
}
