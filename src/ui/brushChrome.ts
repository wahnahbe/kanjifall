import { brushFrameDataUri } from '../render/brushStroke';

// Seeds: the wide frame shares the title rule's 7 on purpose (same stroke
// family as the mark it sits under); 3 is distinct from the floor (11) and
// the underline (4).
const FRAMES = [
  ['--brush-frame-wide', 7, { width: 200, height: 40 }],
  ['--brush-frame-tall', 3, { width: 260, height: 70, displacementScale: 4 }],
  ['--brush-frame-sign', 3, { width: 520, height: 220, displacementScale: 5, strokeWidth: 2 }],
] as const;

/** Second-pass spec §3.2: every 1px chrome border becomes a dry-brush stroke.
 *  The strokes are masks (colour-free SVG), applied in index.css as
 *  `mask-image: var(--brush-frame-*)` on a pseudo-element whose
 *  background-color is the token. Generated once at boot; pure, synchronous. */
export function installBrushChrome(root: HTMLElement): void {
  for (const [name, seed, options] of FRAMES) {
    root.style.setProperty(name, `url("${brushFrameDataUri(seed, options)}")`);
  }
}
