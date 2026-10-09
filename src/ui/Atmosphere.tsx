import type { CSSProperties } from 'react';
import { visualParams } from '../design/visualParams';
import { useSettings } from './useSettings';

export type AtmosphereScene = 'title' | 'chooser' | 'game' | 'calm';

/** Second-pass spec §3.1: a fixed ambient set chosen for the identity.
 *  Never drawn from the deck, so a ghost can never resemble a live card.
 *  A constant tuple, not a component: fast refresh just reloads this module. */
// oxlint-disable-next-line react/only-export-components
export const GHOST_GLYPHS = ['言', '葉', '降'] as const;
// 降 sits left of the light shaft (centred, 28% wide): where it crossed the
// shaft it was the brightest point of the whole depth layer.
const GHOST_PLACEMENT: readonly CSSProperties[] = [
  { left: '6%', top: '10%' }, { left: '62%', top: '6%' }, { left: '18%', top: '62%' },
];

/** The persistent depth layer behind every screen (second-pass spec §3.1).
 *  Mounted once at the app root so the title, chooser and game share one
 *  continuous ground and the blurred layers rasterize once. `scene` only
 *  changes a data attribute; index.css decides what each scene shows. */
export function Atmosphere({ scene }: { scene: AtmosphereScene }) {
  const { effects } = useSettings();
  const { atmosphereAlpha, drift } = visualParams(effects);
  const style = { '--atmosphere-alpha': String(atmosphereAlpha) } as CSSProperties;
  return (
    <div
      className="atmosphere"
      data-scene={scene}
      data-drift={drift}
      data-testid="atmosphere"
      aria-hidden="true"
      style={style}
    >
      <div className="atmosphere-depth">
        <div className="atmosphere-wash atmosphere-wash-system" />
        <div className="atmosphere-wash atmosphere-wash-cool" />
        <div className="atmosphere-wash atmosphere-wash-deep" />
        <div className="atmosphere-sumi" />
        <div className="atmosphere-shaft" />
        {GHOST_GLYPHS.map((glyph, i) => (
          <span key={glyph} className="atmosphere-ghost" style={GHOST_PLACEMENT[i]}>{glyph}</span>
        ))}
        <div className="atmosphere-vignette" />
      </div>
    </div>
  );
}
