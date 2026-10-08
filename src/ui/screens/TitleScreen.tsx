import { cssHex, PALETTE } from '../../design/palette';
import { visualParams } from '../../design/visualParams';
import { brushStrokeDataUri } from '../../render/brushStroke';
import { useSettings } from '../useSettings';
import { TitleGhosts } from './TitleGhosts';

// The sign's stroke: seed 7 as before (TitleScreen's own seed), now at the
// sign's full width. The title floor reuses the playfield floor's seed 11
// and defaults so the horizon here is the same stroke the game burns.
// Computed once at module scope: brushStrokeDataUri is a pure, synchronous
// string generator (no texture decode). Both are applied as quoted url()
// values — the generator only percent-encodes < > # ", so the SVG's own
// attribute spaces stay literal and would end an unquoted CSS url() token.
const SIGN_RULE_SEED = 7;
const FLOOR_SEED = 11;
const signRuleUrl = brushStrokeDataUri(cssHex(PALETTE.system), SIGN_RULE_SEED, { width: 480, height: 14, displacementScale: 5 });
const floorUrl = brushStrokeDataUri(cssHex(PALETTE.system), FLOOR_SEED);

interface TitleScreenProps {
  onStart: () => void;
  onStats: () => void;
  onSettings: () => void;
}

/** Second-pass spec §5.1: the title is an arcade screen — hazard stripe,
 *  ghost words falling in the outer lanes, a neon sign that flickers on,
 *  the floor raised to a horizon, the controls in the machine band. */
export function TitleScreen({ onStart, onStats, onSettings }: TitleScreenProps) {
  const { effects } = useSettings();
  const { flicker, bleed } = visualParams(effects);
  return (
    <div className="title-screen" data-testid="title" data-motion={bleed} data-flicker={flicker}>
      <div className="hud-stripe" />
      <TitleGhosts />
      <div className="title-stage">
        <div className="title-sign" data-testid="title-sign" data-flicker={flicker}>
          <span className="title-corner title-corner-tl" aria-hidden="true" />
          <span className="title-corner title-corner-tr" aria-hidden="true" />
          <span className="title-corner title-corner-bl" aria-hidden="true" />
          <span className="title-corner title-corner-br" aria-hidden="true" />
          <h1 className="title-word">KanjiFall</h1>
          <div className="title-rule" style={{ backgroundImage: `url("${signRuleUrl}")` }} />
          <p className="title-jp" lang="ja">漢字落</p>
        </div>
        <p className="title-tagline">Type the reading. Press Enter. Don&apos;t let words hit the floor.</p>
        <p className="hint">Keyboard: a–z romaji · Enter submit · Backspace edit · Esc clear</p>
      </div>
      <div className="title-floor" style={{ backgroundImage: `url("${floorUrl}")` }} aria-hidden="true" />
      <div className="machine-band title-band">
        <button className="primary" data-testid="start-button" onClick={onStart}>Start — Reading mode (N5)</button>
        <button data-testid="stats-button" onClick={onStats}>Stats</button>
        <button data-testid="settings-button" onClick={onSettings}>Settings</button>
      </div>
    </div>
  );
}
