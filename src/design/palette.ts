/** The colour order (visual-identity spec §3.1). Mirrors the hex --color-*
 *  tokens in src/ui/tokens.css; tokenParity.test.ts fails if they diverge.
 *  Pixi cannot read CSS custom properties, which is why this exists. */
export const PALETTE = {
  /** 01 — falling words, score, the kana being typed. Always brightest. */
  ink: 0xf6f1e6,
  inkDim: 0xa8b0c4,
  inkFaint: 0x737d97,
  /** 02 — system chrome and ambient light: floor, panels, reticle, buffer frame. */
  system: 0x00e5ff,
  /** 03 — now-or-never: target underline, pips, deadline, misses. */
  danger: 0xff2a3c,
  /** 04 — accent only: micro-labels, combo, caret, hazard stripe. Never a surface. */
  accent: 0xfcee0a,
  /** 05 — ground. */
  ground: 0x070910,
  groundLift: 0x0a0d16,
  groundDeep: 0x04060b,
} as const;

export type PaletteKey = keyof typeof PALETTE;

/** Converts a `PALETTE` `0xRRGGBB` number into a CSS colour string, for the
 *  render-layer code paths (e.g. brush-stroke textures) that need a colour
 *  as a string rather than a Pixi tint. */
export function cssHex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}

/** Recharts and other string-colour APIs need a CSS colour, not a number.
 *  Reads the live custom property so tokens.css stays the source of truth.
 *  Guarded for non-browser test environments: under Node (this repo's
 *  default vitest environment), `getComputedStyle` doesn't exist at all; under
 *  jsdom (the per-file `@vitest-environment jsdom` opt-in used by component
 *  tests), it exists but nothing has imported tokens.css, so the custom
 *  property resolves to '' — both paths fall through to `fallback`. */
export function tokenColor(name: string, fallback: string): string {
  if (typeof getComputedStyle !== 'function') return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === '' ? fallback : value;
}
