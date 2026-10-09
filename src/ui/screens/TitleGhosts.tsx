import type { CSSProperties } from 'react';
import { visualParams } from '../../design/visualParams';
import { useSettings } from '../useSettings';

/** Second-pass spec §5.1: a fixed ambient list, never the live deck. */
// oxlint-disable-next-line react/only-export-components
export const TITLE_GHOST_WORDS = ['雨', '勉強', '光', '図書館', '女', '犬'] as const;
/** Outer lanes only (percent of width), so a ghost never passes behind the
 *  sign or the controls; spread so no two can overlap at one height. */
// oxlint-disable-next-line react/only-export-components
export const TITLE_GHOST_LANES_PCT = [6, 21, 79, 94, 13, 85] as const;
/** Where each ghost holds still (percent of height) when ambient layers do
 *  not drift (reduced, the prefers-reduced-motion default): staggered in
 *  their lanes, all above the floor's dissolve band. */
// oxlint-disable-next-line react/only-export-components
export const REST_TOP_PCT = [14, 46, 24, 56, 36, 50] as const;
const FALL_SECONDS = [14, 17, 15, 19, 16, 18] as const;
const OFFSET_SECONDS = [-3, -11, -7, -14, -9, -1] as const;

interface TitleGhostsProps {
  /** Halves the opacity for the run chooser (§5.2). */
  dim?: boolean;
}

/** The game, already happening behind the title. `dim` halves the opacity
 *  for the run chooser (§5.2). Decoration: absent at effects off. At reduced
 *  (`drift` 0) the ghosts hold still at their `--rest-top` instead of
 *  falling, so a reduced-motion first run carries no continuous motion. */
export function TitleGhosts({ dim = false }: TitleGhostsProps) {
  const { atmosphereAlpha, drift } = visualParams(useSettings().effects);
  if (atmosphereAlpha === 0) return null;
  const style = { '--ghost-alpha': String(atmosphereAlpha * (dim ? 0.5 : 1)) } as CSSProperties;
  return (
    <div className="title-ghosts" data-testid="title-ghosts" data-drift={drift} aria-hidden="true" style={style}>
      {TITLE_GHOST_WORDS.map((word, i) => (
        <span
          key={word}
          className="title-ghost"
          lang="ja"
          style={{
            left: `${TITLE_GHOST_LANES_PCT[i]}%`,
            animationDuration: `${FALL_SECONDS[i]}s`,
            animationDelay: `${OFFSET_SECONDS[i]}s`,
            '--rest-top': `${REST_TOP_PCT[i]}%`,
          } as CSSProperties}
        >
          {word}
        </span>
      ))}
    </div>
  );
}
