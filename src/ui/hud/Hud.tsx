import type { EngineSnapshot } from '../../engine/types';
import { pipStates } from './pips';

export function Hud({ snapshot }: { snapshot: EngineSnapshot }) {
  return (
    <div className="hud">
      <div className="hud-stripe" />
      <div className="hud-top">
        <div className="hud-block">
          <span className="hud-tab">SCORE</span>
          <span className="hud-value hud-value-word" data-testid="score">{snapshot.score}</span>
        </div>
        <div className="hud-wave">
          <span className="hud-wave-jp">第{snapshot.wave}波</span>
          <span className="hud-wave-lat" data-testid="wave">wave {snapshot.wave}</span>
        </div>
        <div className="hud-right">
          <div className={`hud-block${snapshot.combo > 0 ? '' : ' hud-block-empty'}`}>
            <span className="hud-tab">COMBO</span>
            <span
              className={`hud-value hud-value-accent${snapshot.combo > 0 ? ' combo-pop' : ''}`}
              key={snapshot.combo}
              data-testid="combo"
            >
              {snapshot.combo > 0 ? `×${snapshot.combo}` : ''}
            </span>
          </div>
          <div className="hud-pips" data-testid="lives">
            {pipStates(snapshot.lives).map((state, i) => (
              <span key={i} className={`hud-pip hud-pip-${state}`} />
            ))}
          </div>
        </div>
      </div>
      <div className="hud-buffer" data-testid="kana-buffer">
        <span className="hud-buffer-tick">IN</span>
        <span className="hud-buffer-kana">{snapshot.bufferKana || ' '}</span>
        <span className="hud-buffer-caret" aria-hidden="true" />
      </div>
    </div>
  );
}
