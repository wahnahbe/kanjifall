import { Container, Graphics } from 'pixi.js';
import { getSettings } from '../data/settings';
import { mixColor } from '../design/colorMix';
import { PALETTE } from '../design/palette';
import { dropletPolygon } from './killFx';
import {
  burstCount, killBurstBase, spawnBurst, stepParticles, type SimParticle,
} from './particleSim';

const KILL_COLOR = PALETTE.ink;
// Second-pass spec §4.3: every second droplet is tinted toward cyan — a mix
// of two palette entries, not a third colour.
const KILL_CAST_COLOR = mixColor(PALETTE.ink, PALETTE.system, 0.35);
const MISS_COLOR = PALETTE.danger;
const MISS_BASE = 8;
const SPLASH_BASE = 7;
const SPLASH_UPWARD_BIAS = 220; // rises, then gravity (240px/s²) brings it back within --duration-burst
const CONFETTI_PALETTE = [PALETTE.ink, PALETTE.system, PALETTE.accent];
const CONFETTI_BASE = 40;

/** Pixi-facing half of the particle system: owns the live pool and the single
 *  `Graphics` used to draw it every frame. The pool/physics live in
 *  particleSim.ts (pure, unit-tested); this class only spawns bursts (via
 *  the current effects level) and redraws. */
export class Particles {
  readonly view: Container;
  private readonly graphics: Graphics;
  private readonly pool: SimParticle[] = [];

  constructor() {
    this.graphics = new Graphics();
    this.view = new Container();
    this.view.addChild(this.graphics);
  }

  /** Kill splatter at a word's death position; size grows with combo tier.
   *  Half ink, half ink-with-a-cyan-cast, all droplets (spec §4.3). */
  killBurst(x: number, y: number, combo: number): void {
    const count = burstCount(getSettings().effects, killBurstBase(combo));
    const cast = Math.floor(count / 2);
    spawnBurst(this.pool, x, y, KILL_COLOR, count - cast, Math.random, { shape: 'droplet' });
    spawnBurst(this.pool, x, y, KILL_CAST_COLOR, cast, Math.random, { shape: 'droplet' });
  }

  /** Particle puff where a word landed (kept for the juice pass's contract). */
  missPuff(x: number, y: number): void {
    const count = burstCount(getSettings().effects, MISS_BASE);
    spawnBurst(this.pool, x, y, MISS_COLOR, count, Math.random, { shape: 'droplet' });
  }

  /** Miss splash (spec §4.3): vermillion droplets thrown up from the impact
   *  point; the sim's gravity brings them back down. */
  splash(x: number, y: number): void {
    const count = burstCount(getSettings().effects, SPLASH_BASE);
    spawnBurst(this.pool, x, y, MISS_COLOR, count, Math.random, { shape: 'droplet', upwardBias: SPLASH_UPWARD_BIAS });
  }

  /** Wave-clear confetti: one particle per staggered x position across the
   *  top edge, cycling through the palette. Dots, unchanged. */
  confettiSweep(width: number): void {
    const count = burstCount(getSettings().effects, CONFETTI_BASE);
    for (let i = 0; i < count; i += 1) {
      const x = ((i + 0.5) / count) * width;
      const color = CONFETTI_PALETTE[i % CONFETTI_PALETTE.length];
      spawnBurst(this.pool, x, 0, color, 1, Math.random);
    }
  }

  /** Per-frame: advance the sim, then fully redraw from the live pool. */
  update(deltaMs: number): void {
    stepParticles(this.pool, deltaMs);
    this.graphics.clear();
    for (const p of this.pool) {
      const alpha = 1 - p.ageMs / p.lifeMs;
      if (p.shape === 'droplet') {
        const pts = dropletPolygon(p.seed, p.size);
        for (let i = 0; i < pts.length; i += 2) {
          pts[i] += p.x;
          pts[i + 1] += p.y;
        }
        this.graphics.poly(pts, true).fill({ color: p.color, alpha });
      } else {
        this.graphics.circle(p.x, p.y, p.size).fill({ color: p.color, alpha });
      }
    }
  }
}
