import { Texture } from 'pixi.js';

const WIDTH = 1200;
const HEIGHT = 26;

/** A dry-brush stroke: a tapered bar pushed through fractal-noise
 *  displacement, so bristle gaps and ragged edges are genuinely irregular
 *  rather than a repeating pattern (visual-identity spec §5.2). Returned as
 *  an SVG data URI so it needs no asset file. */
export function brushStrokeDataUri(cssColor: string, seed: number): string {
  const svg =
    `<svg xmlns='http://www.w3.org/2000/svg' width='${WIDTH}' height='${HEIGHT}' preserveAspectRatio='none'>` +
    `<defs>` +
    `<filter id='r' x='-5%' y='-300%' width='110%' height='700%'>` +
    `<feTurbulence type='fractalNoise' baseFrequency='0.018 0.55' numOctaves='3' seed='${seed}' result='t'/>` +
    `<feDisplacementMap in='SourceGraphic' in2='t' scale='17' xChannelSelector='R' yChannelSelector='G'/>` +
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
    `<rect x='0' y='11' width='${WIDTH}' height='5' fill='url(#g)' filter='url(#r)'/>` +
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
export async function loadBrushTexture(cssColor: string, seed: number): Promise<Texture> {
  const image = new Image();
  image.src = brushStrokeDataUri(cssColor, seed);
  await image.decode();
  return Texture.from(image);
}
