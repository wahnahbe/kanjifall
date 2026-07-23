import type { EngineSnapshot } from '../../engine/types';

export function Hud({ snapshot }: { snapshot: EngineSnapshot }) {
  return (
    <div className="hud">
      <div className="hud-top">
        <span data-testid="score">{snapshot.score}</span>
        <span data-testid="wave">wave {snapshot.wave}</span>
        <span data-testid="combo">{snapshot.combo > 0 ? `×${snapshot.combo}` : ''}</span>
        <span data-testid="lives">{'♥'.repeat(Math.max(snapshot.lives, 0))}</span>
      </div>
      <div className="hud-buffer" data-testid="kana-buffer">
        {snapshot.bufferKana || ' '}
      </div>
    </div>
  );
}
