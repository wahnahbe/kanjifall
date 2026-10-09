import { describe, expect, it } from 'vitest';
import {
  burstCount, killBurstBase, PARTICLE_CAP, spawnBurst, stepParticles, type SimParticle,
} from '../particleSim';

const rng = () => 0.5;

describe('particle sim (pure)', () => {
  it('burstCount scales by effects level', () => {
    expect(burstCount('full', 10)).toBe(10);
    expect(burstCount('reduced', 10)).toBe(5);
    expect(burstCount('reduced', 9)).toBe(5);
    expect(burstCount('off', 10)).toBe(0);
  });

  it('killBurstBase grows with combo tier and caps', () => {
    expect(killBurstBase(0)).toBe(10);
    expect(killBurstBase(4)).toBe(10);
    expect(killBurstBase(5)).toBe(16);
    expect(killBurstBase(20)).toBe(34);
    expect(killBurstBase(99)).toBe(34);
  });

  it('spawnBurst enforces the cap by recycling the oldest', () => {
    const pool: SimParticle[] = [];
    spawnBurst(pool, 0, 0, 0xffffff, PARTICLE_CAP + 50, rng);
    expect(pool.length).toBe(PARTICLE_CAP);
  });

  it('defaults to dots with the standard upward bias, and takes droplets with a custom one', () => {
    const dots: SimParticle[] = [];
    spawnBurst(dots, 0, 0, 0xffffff, 1, rng);
    expect(dots[0].shape).toBe('dot');
    expect(dots[0].seed).toBe(0.5);
    const drops: SimParticle[] = [];
    spawnBurst(drops, 0, 0, 0xffffff, 1, rng, { shape: 'droplet', upwardBias: 220 });
    expect(drops[0].shape).toBe('droplet');
    expect(drops[0].vy).toBe(dots[0].vy - 160); // 220 − 60 more upward
  });

  it('stepParticles integrates and expires in place', () => {
    const pool: SimParticle[] = [];
    spawnBurst(pool, 100, 100, 0xffffff, 5, rng);
    const before = pool[0].y;
    stepParticles(pool, 16);
    expect(pool[0].ageMs).toBe(16);
    expect(pool[0].y).not.toBe(before);
    stepParticles(pool, 10_000);
    expect(pool.length).toBe(0);
  });
});
