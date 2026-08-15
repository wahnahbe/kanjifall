export interface BracketRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Eight rects forming four corner brackets around a centre-origin box
 *  (visual-identity spec §5.3). Shape is the second signal alongside
 *  colour, per §9.4 — never signal the target with colour alone. */
export function reticleBrackets(
  halfWidth: number,
  halfHeight: number,
  pad: number,
  len: number,
  thickness: number,
): BracketRect[] {
  const l = -halfWidth - pad;
  const r = halfWidth + pad;
  const t = -halfHeight - pad;
  const b = halfHeight + pad;
  return [
    { x: l, y: t, w: len, h: thickness },
    { x: l, y: t, w: thickness, h: len },
    { x: r - len, y: t, w: len, h: thickness },
    { x: r - thickness, y: t, w: thickness, h: len },
    { x: l, y: b - thickness, w: len, h: thickness },
    { x: l, y: b - len, w: thickness, h: len },
    { x: r - len, y: b - thickness, w: len, h: thickness },
    { x: r - thickness, y: b - len, w: thickness, h: len },
  ];
}
