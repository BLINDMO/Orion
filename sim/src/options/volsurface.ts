/**
 * Implied-volatility surface. Spec §8.
 *
 * "Design the IV source as a pluggable interface so either path works" — a
 * licensed historical surface (ORATS/CBOE) or the modeled surface below both
 * satisfy `VolSurface`. The modeled surface seeds base vol from the underlying's
 * realized volatility and shapes it with a per-expiry term structure and a
 * per-strike skew/smile appropriate to the asset class.
 */

import type { Bar } from "../data/types.ts";
import type { AssetClass } from "../data/types.ts";

export interface VolQuery {
  /** Underlying spot at clock.now. */
  spot: number;
  /** Strike. */
  strike: number;
  /** Years to expiry. */
  T: number;
  /** Cont. risk-free rate (for forward calc). */
  r: number;
  /** Cont. dividend/convenience yield. */
  q: number;
}

export interface VolSurface {
  iv(query: VolQuery): number;
}

/** Annualized realized volatility from close-to-close log returns. */
export function realizedVol(bars: readonly Bar[], barsPerYear: number, window = 60): number {
  const n = bars.length;
  if (n < 3) return 0.5; // sensible default before enough history
  const start = Math.max(1, n - window);
  const rets: number[] = [];
  for (let i = start; i < n; i++) {
    const prev = bars[i - 1]!.c;
    const cur = bars[i]!.c;
    if (prev > 0 && cur > 0) rets.push(Math.log(cur / prev));
  }
  if (rets.length < 2) return 0.5;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varc = rets.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (rets.length - 1);
  const vol = Math.sqrt(varc * barsPerYear);
  return Math.min(Math.max(vol, 0.05), 4);
}

export interface SkewParams {
  /** Linear skew slope in log-moneyness (negative => equity put-skew). */
  slope: number;
  /** Quadratic smile curvature (>0 => both wings elevated). */
  curvature: number;
  /** Term-structure half-life in years controlling mean reversion toward longVol. */
  termHalfLife: number;
  /** Long-run vol the term structure reverts toward. */
  longVol: number;
}

export const DEFAULT_SKEW: Record<AssetClass, SkewParams> = {
  // Equities: pronounced negative skew (downside puts bid), mild smile.
  equity: { slope: -0.35, curvature: 0.6, termHalfLife: 0.5, longVol: 0.25 },
  // Crypto: near-symmetric smile, both wings up, higher base.
  crypto: { slope: -0.1, curvature: 1.2, termHalfLife: 0.4, longVol: 0.7 },
};

export class ModeledVolSurface implements VolSurface {
  private readonly baseVol: number;
  private readonly params: SkewParams;

  constructor(baseVol: number, params: SkewParams) {
    this.baseVol = baseVol;
    this.params = params;
  }

  iv(query: VolQuery): number {
    const { spot, strike, T, r, q } = query;
    const t = Math.max(T, 1 / 365 / 24); // floor at 1h to keep finite
    // Forward price for moneyness.
    const fwd = spot * Math.exp((r - q) * t);
    const m = Math.log(strike / fwd); // log-moneyness
    const p = this.params;
    // Term structure: revert base vol toward longVol with the given half-life.
    const decay = Math.pow(0.5, t / p.termHalfLife);
    const atmVol = this.baseVol * decay + p.longVol * (1 - decay);
    // Skew/smile shaping. Normalize moneyness by sqrt(T) so the skew is in
    // standard-deviation space (shorter expiries are steeper).
    const z = m / (atmVol * Math.sqrt(t));
    const shaped = atmVol * (1 + p.slope * z * (atmVol * Math.sqrt(t)) + p.curvature * m * m);
    return Math.min(Math.max(shaped, 0.02), 5);
  }
}

/** Build a modeled surface for an instrument from its visible bars. */
export function buildModeledSurface(
  bars: readonly Bar[],
  assetClass: AssetClass,
  barsPerYear: number,
): ModeledVolSurface {
  const rv = realizedVol(bars, barsPerYear);
  return new ModeledVolSurface(rv, DEFAULT_SKEW[assetClass]);
}
