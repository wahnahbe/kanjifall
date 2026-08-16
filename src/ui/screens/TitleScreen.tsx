import { cssHex, PALETTE } from '../../design/palette';
import { brushStrokeDataUri } from '../../render/brushStroke';

// Spec §8: the wordmark sits "over a single cyan brush stroke" — Task 6
// built brushStrokeDataUri() (a pure, unit-tested generator returning a
// CSS-usable data URI) for exactly this kind of use, and it was never
// reached for; .title-rule shipped as a plain linear-gradient bar instead
// (fix wave M4). Seed 7 is distinct from the floor's 11 (PixiStage.ts) and
// the target underline's 4 (WordSprite.ts) so the title rule isn't a scaled
// copy of either. Computed once at module scope: brushStrokeDataUri is a
// pure, synchronous string generator (no texture decode), so there's no
// reason to recompute it per render.
const TITLE_RULE_SEED = 7;
const TITLE_RULE_WIDTH = 192; // matches .title-rule's 12rem width (index.css) at the default 16px root
const TITLE_RULE_HEIGHT = 14;
// Tuned by the same "keep width/height/displacementScale in proportion"
// lesson WordSprite's underline learned (brushStroke.ts's own doc comment):
// the floor's displacementScale (17) is ~1.4% of its 1200px width; reusing
// it here at 192px would be ~9% — enough to smear the short stroke's ends
// past recognition. 3 keeps the ragged-edge character readable at wordmark
// scale without collapsing into speckle.
const titleRuleUrl = brushStrokeDataUri(cssHex(PALETTE.system), TITLE_RULE_SEED, {
  width: TITLE_RULE_WIDTH,
  height: TITLE_RULE_HEIGHT,
  displacementScale: 3,
});

interface TitleScreenProps {
  onStart: () => void;
  onStats: () => void;
  onSettings: () => void;
}

export function TitleScreen({ onStart, onStats, onSettings }: TitleScreenProps) {
  return (
    <div className="screen-center">
      <div className="title-mark">
        <h1 className="title-word">KanjiFall</h1>
        {/* Quoted url(): brushStrokeDataUri() only percent-encodes < > # " —
            the SVG's own attribute spaces stay literal, which breaks an
            unquoted CSS url() token (space terminates it early). Quoting
            makes it a CSS string instead, where spaces are fine. */}
        <div className="title-rule" style={{ backgroundImage: `url("${titleRuleUrl}")` }} />
      </div>
      <p className="title-tagline">Type the reading. Press Enter. Don&apos;t let words hit the floor.</p>
      <p className="hint">Keyboard: a–z romaji · Enter submit · Backspace edit · Esc clear</p>
      <button className="primary" data-testid="start-button" onClick={onStart}>Start — Reading mode (N5)</button>
      <button data-testid="stats-button" onClick={onStats}>Stats</button>
      <button data-testid="settings-button" onClick={onSettings}>Settings</button>
    </div>
  );
}
