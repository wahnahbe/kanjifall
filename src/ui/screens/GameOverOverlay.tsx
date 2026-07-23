import type { EngineSnapshot } from '../../engine/types';

export function GameOverOverlay({ snapshot, onRestart }: {
  snapshot: EngineSnapshot;
  onRestart: () => void;
}) {
  return (
    <div className="overlay" data-testid="game-over">
      <h2>Game Over</h2>
      <p>Score {snapshot.score} · Wave {snapshot.wave}</p>
      {snapshot.missed.length > 0 && (
        <table className="missed">
          <tbody>
            {snapshot.missed.map((card, i) => (
              <tr key={`${card.id}-${i}`}>
                <td>{card.kanji}</td>
                <td>{card.kana[0]}</td>
                <td>{card.gloss}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button onClick={onRestart}>Play again</button>
    </div>
  );
}
