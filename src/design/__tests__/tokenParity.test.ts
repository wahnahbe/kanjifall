import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PALETTE } from '../palette';
import { FONT_STACK } from '../typography';

/** `--color-ink-dim` → `inkDim`. */
function toCamel(cssName: string): string {
  return cssName
    .replace(/^--color-/, '')
    .replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

/** Only hex-valued --color-* tokens participate; rgba() tokens like
 *  --color-surface are CSS-only surfaces Pixi never needs. */
function readCssPalette(): Map<string, number> {
  const css = readFileSync(join(process.cwd(), 'src/ui/tokens.css'), 'utf8');
  const found = new Map<string, number>();
  for (const [, name, hex] of css.matchAll(/(--color-[a-z-]+):\s*#([0-9a-fA-F]{6})\s*;/g)) {
    found.set(toCamel(name), Number.parseInt(hex, 16));
  }
  return found;
}

/** Reads `--font-word`'s declared value verbatim (not colour-shaped, so it
 *  can't reuse readCssPalette's hex regex). */
function readCssFontWord(): string {
  const css = readFileSync(join(process.cwd(), 'src/ui/tokens.css'), 'utf8');
  const match = /--font-word:\s*([^;]+);/.exec(css);
  if (match === null) throw new Error('tokens.css has no --font-word declaration');
  return match[1].trim();
}

describe('token parity (visual-identity spec §3.3)', () => {
  it('every hex --color-* token in tokens.css has an equal PALETTE entry', () => {
    for (const [key, value] of readCssPalette()) {
      expect(PALETTE, `tokens.css declares --color-${key} but PALETTE does not`).toHaveProperty(key);
      expect(PALETTE[key as keyof typeof PALETTE]).toBe(value);
    }
  });

  it('every PALETTE entry has a matching token in tokens.css', () => {
    const css = readCssPalette();
    for (const key of Object.keys(PALETTE)) {
      expect(css.has(key), `PALETTE.${key} has no --color-* token in tokens.css`).toBe(true);
    }
  });

  it('declares the five ranked colours of the colour order', () => {
    expect(PALETTE.ink).toBe(0xf6f1e6);
    expect(PALETTE.system).toBe(0x00e5ff);
    expect(PALETTE.danger).toBe(0xff2a3c);
    expect(PALETTE.accent).toBe(0xfcee0a);
    expect(PALETTE.ground).toBe(0x070910);
  });

  // Render-layer fix wave: FONT_STACK (src/design/typography.ts) was a copy
  // re-typed in both WordSprite.ts and PixiStage.ts with nothing catching
  // drift from tokens.css's own --font-word — this pins all three together.
  it('typography.ts FONT_STACK equals tokens.css --font-word', () => {
    expect(FONT_STACK).toBe(readCssFontWord());
  });
});
