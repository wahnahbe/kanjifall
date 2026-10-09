/** Mirrors `--duration-*` (as `<name>Ms`) and `--ease-*` from
 *  `src/ui/tokens.css` (second-pass spec §4.2). Pixi tweens and React timers
 *  need numbers, not custom properties — same reason `palette.ts` exists.
 *  `tokenParity.test.ts` fails if either side drifts. */
export const MOTION = Object.freeze({
  fastMs: 120,
  baseMs: 220,
  slowMs: 600,
  bleedMs: 260,
  snapMs: 90,
  slashMs: 120,
  flareMs: 420,
  burstMs: 480,
  transitionMs: 360,
  beatMs: 1200,
});

export const EASE = Object.freeze({
  /** Forms arriving: decelerating. */
  ink: 'cubic-bezier(0.15, 0.85, 0.35, 1)',
  /** Forms leaving: accelerating. */
  drain: 'cubic-bezier(0.6, 0, 0.9, 0.6)',
});
