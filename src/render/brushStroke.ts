import { Texture } from 'pixi.js';

const WIDTH = 1200;
const HEIGHT = 26;
const BASE_FREQUENCY = '0.018 0.55';
const NUM_OCTAVES = 3;
const DISPLACEMENT_SCALE = 17;

/** Tuning knobs for `brushStrokeDataUri`/`loadBrushTexture`. All default to
 *  the floor's original values (visual-identity spec §5.2), so existing
 *  callers — and the floor itself (`PixiStage.ts`) — are untouched. A caller
 *  rendering a much shorter stroke (e.g. the word underline, `WordSprite.ts`)
 *  should shrink `width` to something close to its final on-screen size:
 *  `Sprite.width` only sets `scale.x`, so reusing the floor's 1200-wide
 *  texture at underline scale (~50-90px) squeezes the noise ~15-25x, past
 *  where it can be represented — that aliasing is what reads as speckle
 *  instead of a stroke (visual-identity review, fix round 1). */
export interface BrushStrokeOptions {
  /** SVG canvas width, in local units. Keep close to the stroke's final
   *  on-screen width so the noise doesn't get squeezed into sub-pixel
   *  aliasing. */
  width?: number;
  /** SVG canvas height, in local units. */
  height?: number;
  /** `feTurbulence`'s `baseFrequency`, `'x y'`. Lower x = longer noise
   *  wavelength relative to `width` = fewer, broader bristle gaps. */
  baseFrequency?: string;
  /** `feTurbulence`'s `numOctaves`. */
  numOctaves?: number;
  /** `feDisplacementMap`'s `scale`. Governs both the vertical raggedness of
   *  the stroke's edges and, at small `width`, how much the ends smear
   *  horizontally — turn this down together with `width`. */
  displacementScale?: number;
}

/** A dry-brush stroke: a tapered bar pushed through fractal-noise
 *  displacement, so bristle gaps and ragged edges are genuinely irregular
 *  rather than a repeating pattern (visual-identity spec §5.2). Returned as
 *  an SVG data URI so it needs no asset file. */
export function brushStrokeDataUri(cssColor: string, seed: number, options: BrushStrokeOptions = {}): string {
  const width = options.width ?? WIDTH;
  const height = options.height ?? HEIGHT;
  const baseFrequency = options.baseFrequency ?? BASE_FREQUENCY;
  const numOctaves = options.numOctaves ?? NUM_OCTAVES;
  const displacementScale = options.displacementScale ?? DISPLACEMENT_SCALE;
  // The drawn stroke keeps the floor's proportions (5-unit-thick bar,
  // vertically centred in a 26-unit canvas) at whatever `height` is passed.
  // Rounded so the default (height === HEIGHT) reproduces the floor's
  // original literal y=11 exactly, not 10.5 — the floor must render
  // identically to before this function grew options.
  const strokeHeight = height * (5 / HEIGHT);
  const strokeY = Math.round((height - strokeHeight) / 2);
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${width}' height='${height}' preserveAspectRatio='none'>` +
    `<defs>` +
    `<filter id='r' x='-5%' y='-300%' width='110%' height='700%'>` +
    `<feTurbulence type='fractalNoise' baseFrequency='${baseFrequency}' numOctaves='${numOctaves}' seed='${seed}' result='t'/>` +
    `<feDisplacementMap in='SourceGraphic' in2='t' scale='${displacementScale}' xChannelSelector='R' yChannelSelector='G'/>` +
    `</filter>` +
    `<linearGradient id='g' x1='0' x2='1'>` +
    `<stop offset='0' stop-color='${cssColor}' stop-opacity='0'/>` +
    `<stop offset='0.1' stop-color='${cssColor}' stop-opacity='0.88'/>` +
    `<stop offset='0.42' stop-color='${cssColor}' stop-opacity='0.42'/>` +
    `<stop offset='0.68' stop-color='${cssColor}' stop-opacity='0.82'/>` +
    `<stop offset='0.9' stop-color='${cssColor}' stop-opacity='0.3'/>` +
    `<stop offset='1' stop-color='${cssColor}' stop-opacity='0'/>` +
    `</linearGradient>` +
    `</defs>` +
    `<rect x='0' y='${strokeY}' width='${width}' height='${strokeHeight}' fill='url(#g)' filter='url(#r)'/>` +
    `</svg>`;
  // Percent-encode the characters that are illegal unescaped in a data URI.
  const encoded = svg
    .replaceAll('<', '%3C')
    .replaceAll('>', '%3E')
    .replaceAll('#', '%23')
    .replaceAll('"', '%22');
  return `data:image/svg+xml,${encoded}`;
}

/** Decodes the stroke into a Pixi texture. Kept separate from the pure
 *  generator so the generator stays unit-testable in a node environment.
 *  Must only ever be called from an instance method (never module scope) —
 *  `new Image()` throws outside a DOM environment, and this file is pulled
 *  in transitively by node-environment tests. */
export async function loadBrushTexture(cssColor: string, seed: number, options: BrushStrokeOptions = {}): Promise<Texture> {
  const image = new Image();
  image.src = brushStrokeDataUri(cssColor, seed, options);
  await image.decode();
  return Texture.from(image);
}
