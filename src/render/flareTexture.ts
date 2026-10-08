import { Texture } from 'pixi.js';
import { cssRgba, PALETTE } from '../design/palette';

const SIZE = 256;
let cached: Texture | null = null;

/** One radial sprite texture shared by the kill flare, the approach swell
 *  and the miss impact glow (second-pass spec §4.3): ink core, cyan edge,
 *  transparent rim. Tint the sprite for the vermillion uses. Built once on
 *  a canvas; must only be called from an instance method, never module
 *  scope (no DOM in node-environment tests). */
export function flareTexture(): Texture {
  if (cached !== null) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (ctx === null) throw new Error('2d canvas unavailable');
  const g = ctx.createRadialGradient(SIZE / 2, SIZE / 2, 0, SIZE / 2, SIZE / 2, SIZE / 2);
  g.addColorStop(0, cssRgba(PALETTE.ink, 0.95));
  g.addColorStop(0.3, cssRgba(PALETTE.system, 0.55));
  g.addColorStop(0.55, cssRgba(PALETTE.system, 0.18));
  g.addColorStop(0.72, cssRgba(PALETTE.system, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, SIZE, SIZE);
  cached = Texture.from(canvas);
  return cached;
}

let warned = false;
/** `flareTexture()` that never throws: a missing 2D context logs one warning
 *  and returns null, and the caller skips its decoration. A failed flare must
 *  never abort the kill or miss event path (juice-pass spec §9 posture). */
export function tryFlareTexture(): Texture | null {
  try {
    return flareTexture();
  } catch (error) {
    if (!warned) {
      warned = true;
      console.warn('[flareTexture] 2D canvas unavailable — running without flare, swell and impact glow', error);
    }
    return null;
  }
}
