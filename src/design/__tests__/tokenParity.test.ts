import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EASE, MOTION } from '../motion';
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

  /** `--duration-bleed` → `bleedMs`; `--ease-ink` → `ink`. */
  function readCssMotion(): { durations: Map<string, number>; eases: Map<string, string> } {
    const css = readFileSync(join(process.cwd(), 'src/ui/tokens.css'), 'utf8');
    const durations = new Map<string, number>();
    for (const [, name, ms] of css.matchAll(/--duration-([a-z]+):\s*(\d+)ms\s*;/g)) {
      durations.set(`${name}Ms`, Number(ms));
    }
    const eases = new Map<string, string>();
    for (const [, name, value] of css.matchAll(/--ease-([a-z]+):\s*([^;]+);/g)) {
      eases.set(name, value.trim());
    }
    return { durations, eases };
  }

  // Second-pass spec §4.2: motion tokens get the same CSS↔TS parity as colours.
  it('every --duration-* token has an equal MOTION entry, and vice versa', () => {
    const { durations } = readCssMotion();
    for (const [key, ms] of durations) {
      expect(MOTION, `tokens.css declares --duration-${key} but MOTION does not`).toHaveProperty(key);
      expect(MOTION[key as keyof typeof MOTION]).toBe(ms);
    }
    for (const key of Object.keys(MOTION)) {
      expect(durations.has(key), `MOTION.${key} has no --duration-* token`).toBe(true);
    }
  });

  it('every --ease-* token has an equal EASE entry, and vice versa', () => {
    const { eases } = readCssMotion();
    for (const [key, value] of eases) {
      expect(EASE, `tokens.css declares --ease-${key} but EASE does not`).toHaveProperty(key);
      expect(EASE[key as keyof typeof EASE]).toBe(value);
    }
    for (const key of Object.keys(EASE)) {
      expect(eases.has(key), `EASE.${key} has no --ease-* token`).toBe(true);
    }
  });
});
