/** Mirrors `--font-word` from `src/ui/tokens.css` (visual-identity spec §3.3).
 *  Pixi's `TextStyle.fontFamily` needs a plain string, not a CSS custom
 *  property, so this exists for the same reason `palette.ts` mirrors
 *  `--color-*` — parity enforced by `tokenParity.test.ts`. Falling words, the
 *  HUD score value, and the kana buffer all render in this face; a copy
 *  re-typed in each render file could drift silently (falling words in a
 *  different face from the HUD score) with nothing to catch it. */
export const FONT_STACK = "'Shippori Mincho B1', 'Yu Gothic UI', 'Meiryo', serif";

/** Mirrors `--font-ui` from `src/ui/tokens.css`, for the same reason
 *  `FONT_STACK` mirrors `--font-word`: Pixi's `TextStyle.fontFamily` needs a
 *  plain string. The reveal's micro-label (lapse spec §6.2) is the one place
 *  the canvas draws in the UI face. Parity is enforced by
 *  `tokenParity.test.ts`. */
export const UI_FONT_STACK = "'Chakra Petch', system-ui, sans-serif";
