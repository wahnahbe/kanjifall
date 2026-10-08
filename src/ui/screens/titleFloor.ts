import { cssHex, PALETTE } from '../../design/palette';
import { brushStrokeDataUri } from '../../render/brushStroke';

/** Same seed and defaults as the playfield floor, so the title's and the
 *  run chooser's horizon is the stroke the game burns. */
const TITLE_FLOOR_SEED = 11;

/** The floor-horizon stroke shared by the title and the run chooser. Computed
 *  once at module scope: brushStrokeDataUri is a pure, synchronous string
 *  generator. Apply as a quoted `url("…")` — the generator only
 *  percent-encodes < > # ", so the SVG's own attribute spaces stay literal
 *  and would end an unquoted CSS url() token. */
export const TITLE_FLOOR_URL: string = brushStrokeDataUri(cssHex(PALETTE.system), TITLE_FLOOR_SEED);
