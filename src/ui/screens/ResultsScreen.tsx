import type { Card, EngineSnapshot } from '../../engine/types';

interface ResultsScreenProps {
  snapshot: EngineSnapshot;
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

export function ResultsScreen({ snapshot, onRevenge, onPlayAgain, onTitle }: ResultsScreenProps) {
  const missed = dedupeById(snapshot.missed);
  const attempts = snapshot.kills + snapshot.missed.length + snapshot.wrongSubmits;
  const accuracy = attempts === 0 ? 0 : Math.round((snapshot.kills / attempts) * 100);

  return (
    <div className="overlay" data-testid="results">
      <h2>Run over</h2>
      <p>
        <span data-testid="final-score">{snapshot.score}</span> pts · Wave {snapshot.wave} ·{' '}
        <span data-testid="accuracy">{accuracy}%</span> accuracy
      </p>
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
          onClick={() => onRevenge(missed)}
        >
          Revenge round ({missed.length})
        </button>
        <button onClick={onPlayAgain}>Play again</button>
        <button onClick={onTitle}>Title</button>
      </div>
    </div>
  );
}
