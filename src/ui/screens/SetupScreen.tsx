import { useEffect, useState } from 'react';
import { isListPool, POOL_LABELS, type PlayablePool, type PoolId } from '../../data/loader';
import { fetchLists } from '../../data/listsClient';
import { fetchRunPlan } from '../../data/planClient';
import type { GameMode } from '../../engine/types';
import type { ListSummary, TierProgress } from '../../shared/api';

interface SetupScreenProps {
  loading: boolean;
  error: string | null;
  onBegin: (mode: GameMode, pool: PlayablePool) => void;
  onBack: () => void;
  onImport: () => void;
  /** A list just saved by the import screen: preselect it (spec §5.3). */
  initialListSelection: { id: number; name: string } | null;
}

const MODES: { id: GameMode; label: string; blurb: string }[] = [
  { id: 'reading', label: 'Reading', blurb: 'Kanji falls — type its reading' },
  { id: 'recall', label: 'Recall', blurb: 'English falls — type the Japanese' },
];
const POOLS: PoolId[] = ['n5', 'n4', 'n3', 'n2', 'mixed'];

export function SetupScreen(
  { loading, error, onBegin, onBack, onImport, initialListSelection }: SetupScreenProps,
) {
  const [mode, setMode] = useState<GameMode>('reading');
  const [pool, setPool] = useState<PlayablePool>(
    initialListSelection ? `list:${initialListSelection.id}` : 'n5',
  );

  // Display-only tier progress for the highlighted pool AND mode (spec
  // §5.4; final-review Fix 1: reading excludes kana-only cards from the
  // gate, so the preview must track mode too, not just pool). Begin
  // re-fetches the authoritative plan; server-down simply shows nothing.
  const [tiers, setTiers] = useState<readonly TierProgress[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    setTiers(null);
    void fetchRunPlan(pool, mode).then((fetched) => {
      if (!cancelled) setTiers(fetched?.tiers ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [pool, mode]);

  // The player's lists, or null while unknown/unavailable. Server down →
  // row absent, same posture as tier progress (spec §5.3).
  const [listRow, setListRow] = useState<readonly ListSummary[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    void fetchLists().then((lists) => {
      if (!cancelled) setListRow(lists);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // A selected list that no longer exists (deleted elsewhere) falls back to N5.
  useEffect(() => {
    if (listRow === null || !isListPool(pool)) return;
    const id = Number(pool.slice('list:'.length));
    if (!listRow.some((l) => l.id === id)) setPool('n5');
  }, [listRow, pool]);

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
      {listRow !== null && (
        <div className="picker-row" data-testid="list-row">
          {listRow.map((l) => (
            <button
              key={l.id}
              className={pool === `list:${l.id}` ? 'picker selected' : 'picker'}
              data-testid={`pool-list-${l.id}`}
              onClick={() => setPool(`list:${l.id}`)}
            >
              {l.name} <span className="hint">({l.cardCount})</span>
            </button>
          ))}
          <button data-testid="import-button" onClick={onImport}>Import…</button>
        </div>
      )}
      {listRow === null && (
        <div className="picker-row">
          <button data-testid="import-button" onClick={onImport}>Import…</button>
        </div>
      )}
      {tiers !== null && tiers.length > 0 && (
        <div className="tier-progress" data-testid="tier-progress">
          {/* Sorted by level descending (N5 first) so the line order never
              depends on the server's array order — same defensive posture
              noticeFor takes (final-review Fix 3). */}
          {[...tiers].sort((a, b) => b.level - a.level).map((t) => (
            <p key={t.level} className="hint">
              {t.index === null
                ? `N${t.level} · All ${t.totalTiers} tiers cleared`
                : `N${t.level} · Tier ${t.index} of ${t.totalTiers} — `
                  + `${t.solid}/${t.size - t.unreachable} solid`
                  + (t.unreachable > 0 ? ` · ${t.unreachable} kana-only` : '')}
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
