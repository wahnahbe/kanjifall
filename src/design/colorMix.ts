/** Linear per-channel mix of two `0xRRGGBB` colours (second-pass spec §4.3:
 *  the approach tint and the cyan-cast droplets are mixes of two palette
 *  entries, never a third literal). */
export function mixColor(a: number, b: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  let out = 0;
  for (const shift of [16, 8, 0]) {
    const ca = (a >> shift) & 0xff;
    const cb = (b >> shift) & 0xff;
    out |= Math.round(ca + (cb - ca) * k) << shift;
  }
  return out >>> 0;
}
