import { useState } from 'react';
import { POOL_LABELS, type PoolId } from '../../data/loader';
import type { GameMode } from '../../engine/types';

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
