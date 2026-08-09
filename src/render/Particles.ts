import { Container, Graphics } from 'pixi.js';
import { getSettings } from '../data/settings';
import {
  burstCount, killBurstBase, spawnBurst, stepParticles, type SimParticle,
} from './particleSim';

const KILL_COLOR = 0x9dffb0;
const MISS_COLOR = 0xff8f8f;
const MISS_BASE = 8;
const CONFETTI_PALETTE = [0xffd166, 0x9dffb0, 0x7cc7ff, 0xff9de2];
const CONFETTI_BASE = 40;

/** Pixi-facing half of the particle system: owns the live pool and the single
 *  `Graphics` used to draw it every frame. The pool/physics themselves live
 *  in particleSim.ts (pure, unit-tested); this class only spawns bursts (via
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

  /** Kill-green burst at a word's death position; size grows with combo tier. */
  killBurst(x: number, y: number, combo: number): void {
    const count = burstCount(getSettings().effects, killBurstBase(combo));
    spawnBurst(this.pool, x, y, KILL_COLOR, count, Math.random);
  }

  /** Dim red puff where a word landed. */
  missPuff(x: number, y: number): void {
    const count = burstCount(getSettings().effects, MISS_BASE);
    spawnBurst(this.pool, x, y, MISS_COLOR, count, Math.random);
  }

  /** Wave-clear confetti: one particle per staggered x position across the
   *  top edge, cycling through the palette. */
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
      this.graphics.circle(p.x, p.y, p.size).fill({ color: p.color, alpha: 1 - p.ageMs / p.lifeMs });
    }
  }
}
