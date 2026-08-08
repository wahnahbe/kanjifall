import { useEffect, useState } from 'react';
import { POOL_LABELS, type PoolId } from '../../data/loader';
import { fetchRunPlan } from '../../data/planClient';
import type { GameMode } from '../../engine/types';
import type { TierProgress } from '../../shared/api';

interface SetupScreenProps {
  loading: boolean;
  error: string | null;
  onBegin: (mode: GameMode, pool: PoolId) => void;
  onBack: () => void;
}

const MODES: { id: GameMode; label: string; blurb: string }[] = [
  { id: 'reading', label: 'Reading', blurb: 'Kanji falls — type its reading' },
  { id: 'recall', label: 'Recall', blurb: 'English falls — type the Japanese' },
];
const POOLS: PoolId[] = ['n5', 'n4', 'n3', 'n2', 'mixed'];

export function SetupScreen({ loading, error, onBegin, onBack }: SetupScreenProps) {
  const [mode, setMode] = useState<GameMode>('reading');
  const [pool, setPool] = useState<PoolId>('n5');

  // Display-only tier progress for the highlighted pool (spec §5.4). Begin
  // re-fetches the authoritative plan; server-down simply shows nothing.
  const [tiers, setTiers] = useState<readonly TierProgress[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    setTiers(null);
    void fetchRunPlan(pool).then((fetched) => {
      if (!cancelled) setTiers(fetched?.tiers ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [pool]);

  return (
    <div className="screen-center" data-testid="setup">
      <h2>Choose your run</h2>
      <div className="picker-row">
        {MODES.map((m) => (
          <button
            key={m.id}
            className={mode === m.id ? 'picker selected' : 'picker'}
            data-testid={`mode-${m.id}`}
            onClick={() => setMode(m.id)}
          >
            <strong>{m.label}</strong>
            <span className="hint">{m.blurb}</span>
          </button>
        ))}
      </div>
      <div className="picker-row">
        {POOLS.map((p) => (
          <button
            key={p}
            className={pool === p ? 'picker selected' : 'picker'}
            data-testid={`pool-${p}`}
            onClick={() => setPool(p)}
          >
            {POOL_LABELS[p]}
          </button>
        ))}
      </div>
      {tiers !== null && tiers.length > 0 && (
        <div className="tier-progress" data-testid="tier-progress">
          {tiers.map((t) => (
            <p key={t.level} className="hint">
              {t.index === null
                ? `N${t.level} · All ${t.totalTiers} tiers cleared`
                : `N${t.level} · Tier ${t.index} of ${t.totalTiers} — ${t.solid}/${t.size} solid`}
            </p>
          ))}
        </div>
      )}
      {error !== null && (
        <p className="load-error" data-testid="load-error">
          {error} — is the app serving /data/? Try again.
        </p>
      )}
      <div className="picker-row">
        <button data-testid="begin-button" disabled={loading} onClick={() => onBegin(mode, pool)}>
          {loading ? 'Loading words…' : 'Begin'}
        </button>
        <button onClick={onBack}>Back</button>
      </div>
    </div>
  );
}
