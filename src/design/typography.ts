/** Mirrors `--font-word` from `src/ui/tokens.css` (visual-identity spec §3.3).
 *  Pixi's `TextStyle.fontFamily` needs a plain string, not a CSS custom
 *  property, so this exists for the same reason `palette.ts` mirrors
 *  `--color-*` — parity enforced by `tokenParity.test.ts`. Falling words, the
 *  HUD score value, and the kana buffer all render in this face; a copy
 *  re-typed in each render file could drift silently (falling words in a
 *  different face from the HUD score) with nothing to catch it. */
export const FONT_STACK = "'Shippori Mincho B1', 'Yu Gothic UI', 'Meiryo', serif";
