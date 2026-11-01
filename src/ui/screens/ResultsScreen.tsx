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
  /** Every word dropped this sitting and not cleared since, newest first —
   *  App's session-wide pool (src/revengePool.ts), NOT this run's
   *  `snapshot.missed`: a word dropped two runs ago and still owed belongs
   *  on this results screen too, and one cleared since (in any run) does
   *  not. The table and the Revenge round both read it. */
  revengePool: readonly Card[];
  /** Plain line naming the tier this run advanced, or null (tiered spec
   *  §5.4). The celebration (banner/confetti/fanfare) built around it is
   *  juice-pass spec §6. */
  tierAdvance: string | null;
  onRevenge: (pool: Card[]) => void;
  onPlayAgain: () => void;
  onTitle: () => void;
}

export function ResultsScreen({
  snapshot, revengePool, tierAdvance, onRevenge, onPlayAgain, onTitle,
}: ResultsScreenProps) {
  const missed = revengePool;
  // Accuracy stays this run's own numbers: the pool spans runs.
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
      {/* Revenge is the only capped run today, so `cleared` means a revenge clear; a second capped mode would need to key this copy on the pool instead. */}
      <h2>{snapshot.cleared ? 'Revenge complete' : 'Run over'}</h2>
      <p>
        <span data-testid="final-score">{snapshot.score}</span> pts · Wave {snapshot.wave}{snapshot.maxWaves > 0 ? ` / ${snapshot.maxWaves}` : ''} ·{' '}
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
          onClick={() => onRevenge([...missed])}
        >
          Revenge round ({missed.length})
        </button>
        {/* .primary and the keyboard default must agree (fix wave M6) — a
            primary that moves depending on state (was: revenge round when
            words were missed, the common case) is worse than one that
            doesn't, so autoFocus now always targets the visually-primary
            action instead of tracking `missed.length`. */}
        <button className="primary" autoFocus onClick={onPlayAgain}>Play again</button>
        <button onClick={onTitle}>Title</button>
      </div>
    </div>
  );
}
