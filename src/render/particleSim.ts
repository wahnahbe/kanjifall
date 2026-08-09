// Mutates its pools in place — a deliberate 60fps hot-path exception to the
// repo's immutability norm; the pool never escapes the render layer.
import type { Settings } from '../data/settings';

export interface SimParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ageMs: number;
  lifeMs: number;
  color: number;
  size: number;
}

export const PARTICLE_CAP = 200;

const GRAVITY_PX_PER_S2 = 240;
const SPEED_MIN = 40;
const SPEED_RANGE = 120;
const UPWARD_BIAS = 60;
const LIFE_MIN_MS = 400;
const LIFE_RANGE_MS = 500;
const SIZE_MIN = 2;
const SIZE_RANGE = 3;

/** off→0, reduced→ceil(base/2), full→base (juice-pass spec §5.1 scaling column). */
export function burstCount(effects: Settings['effects'], base: number): number {
  if (effects === 'off') return 0;
  if (effects === 'reduced') return Math.ceil(base / 2);
  return base;
}

/** 10 + min(floor(combo/5),4)*6 → 10..34: the base burst size for a kill at this combo tier. */
export function killBurstBase(combo: number): number {
  return 10 + Math.min(Math.floor(combo / 5), 4) * 6;
}

/** Spawns `count` particles at (x, y). Cap-recycles the oldest (pool[0], the
 *  earliest still-alive spawn — insertion order is never otherwise disturbed). */
export function spawnBurst(
  pool: SimParticle[],
  x: number,
  y: number,
  color: number,
  count: number,
  rng: () => number,
): void {
  for (let i = 0; i < count; i += 1) {
    if (pool.length >= PARTICLE_CAP) pool.shift();
    const angle = rng() * Math.PI * 2;
    const speed = SPEED_MIN + rng() * SPEED_RANGE;
    pool.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - UPWARD_BIAS,
      ageMs: 0,
      lifeMs: LIFE_MIN_MS + rng() * LIFE_RANGE_MS,
      color,
      size: SIZE_MIN + rng() * SIZE_RANGE,
    });
  }
}

/** Integrates gravity + velocity, ages every particle, then removes expired
 *  ones in place (reverse-indexed splice — no allocation on the hot path). */
export function stepParticles(pool: SimParticle[], deltaMs: number): void {
  const dt = deltaMs / 1000;
  for (const p of pool) {
    p.vy += GRAVITY_PX_PER_S2 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.ageMs += deltaMs;
  }
  for (let i = pool.length - 1; i >= 0; i -= 1) {
    if (pool[i].ageMs >= pool[i].lifeMs) pool.splice(i, 1);
  }
}
