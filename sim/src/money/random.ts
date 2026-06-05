/**
 * Deterministic, seedable PRNG. Spec §5/§13.2 — every stochastic component
 * (synthetic data, slippage noise) must be reproducible from a seed.
 *
 * Uses mulberry32 for the uniform stream and Box–Muller for gaussians.
 */

export class Rng {
  private s: number;

  constructor(seed: number) {
    // ensure 32-bit non-zero state
    this.s = (seed >>> 0) || 0x9e3779b9;
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Uniform in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  /** Standard normal via Box–Muller (cached pair). */
  private spare: number | null = null;
  gaussian(): number {
    if (this.spare !== null) {
      const v = this.spare;
      this.spare = null;
      return v;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = this.next() * 2 - 1;
      v = this.next() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const mul = Math.sqrt((-2 * Math.log(s)) / s);
    this.spare = v * mul;
    return u * mul;
  }

  /** Fork a child RNG deterministically (for independent streams). */
  fork(salt: number): Rng {
    return new Rng((this.s ^ Math.imul(salt | 1, 0x85ebca6b)) >>> 0);
  }
}
