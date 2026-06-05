/**
 * Black–Scholes–Merton option pricing and Greeks. Spec §8.
 *
 * Conventions:
 *  - S underlying, K strike, T years to expiry, r cont. risk-free, q cont. yield
 *  - sigma is annualized volatility as a decimal (0.5 = 50%)
 *  - price/intrinsics in the same currency unit as S, K (NOT multiplied by the
 *    contract multiplier — that scaling is applied by the portfolio layer)
 *
 * Greeks are returned in their natural analytic units:
 *  - delta: dPrice/dS
 *  - gamma: d2Price/dS2
 *  - vega:  dPrice/dSigma  (per 1.00 of vol; divide by 100 for "per 1%")
 *  - theta: dPrice/dT made NEGATIVE per-year (calendar decay); see thetaPerDay
 *  - rho:   dPrice/dr      (per 1.00 of rate; divide by 100 for "per 1%")
 */

export type OptionRight = "call" | "put";

export interface BsmInputs {
  S: number;
  K: number;
  T: number; // years
  r: number;
  q: number;
  sigma: number;
}

export interface Greeks {
  delta: number;
  gamma: number;
  vega: number;
  theta: number; // per year (negative for long options as time passes)
  rho: number;
  /** Convenience: theta expressed per calendar day. */
  thetaPerDay: number;
  /** Convenience: vega expressed per 1% vol move. */
  vegaPerPct: number;
}

const SQRT_2PI = Math.sqrt(2 * Math.PI);

/** Standard normal PDF. */
export function normPdf(x: number): number {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}

/**
 * Standard normal CDF via Abramowitz & Stegun 26.2.17 (abs error < 7.5e-8) —
 * ample for pricing to the cent.
 */
export function normCdf(x: number): number {
  const neg = x < 0;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.2316419 * ax);
  const poly =
    t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const cdf = 1 - normPdf(ax) * poly;
  return neg ? 1 - cdf : cdf;
}

function d1d2(i: BsmInputs): { d1: number; d2: number; sqrtT: number } {
  const sqrtT = Math.sqrt(i.T);
  const denom = i.sigma * sqrtT;
  const d1 = (Math.log(i.S / i.K) + (i.r - i.q + 0.5 * i.sigma * i.sigma) * i.T) / denom;
  const d2 = d1 - denom;
  return { d1, d2, sqrtT };
}

/** Intrinsic value at expiry / for degenerate inputs. */
export function intrinsic(right: OptionRight, S: number, K: number): number {
  return right === "call" ? Math.max(0, S - K) : Math.max(0, K - S);
}

/** European option price. Handles T<=0 and sigma<=0 by returning discounted intrinsic. */
export function bsmPrice(right: OptionRight, i: BsmInputs): number {
  if (i.T <= 0 || i.sigma <= 0) {
    // Forward-discounted intrinsic (no time value).
    const fwd = i.S * Math.exp((i.r - i.q) * Math.max(i.T, 0));
    const disc = Math.exp(-i.r * Math.max(i.T, 0));
    return disc * intrinsic(right, fwd, i.K);
  }
  const { d1, d2 } = d1d2(i);
  const dfQ = Math.exp(-i.q * i.T);
  const dfR = Math.exp(-i.r * i.T);
  if (right === "call") {
    return i.S * dfQ * normCdf(d1) - i.K * dfR * normCdf(d2);
  }
  return i.K * dfR * normCdf(-d2) - i.S * dfQ * normCdf(-d1);
}

/** All Greeks for a European option. */
export function bsmGreeks(right: OptionRight, i: BsmInputs): Greeks {
  if (i.T <= 0 || i.sigma <= 0) {
    // Degenerate: delta is a step, others ~0.
    const itm = intrinsic(right, i.S, i.K) > 0;
    const delta = right === "call" ? (itm ? 1 : 0) : itm ? -1 : 0;
    return { delta, gamma: 0, vega: 0, theta: 0, rho: 0, thetaPerDay: 0, vegaPerPct: 0 };
  }
  const { d1, d2, sqrtT } = d1d2(i);
  const dfQ = Math.exp(-i.q * i.T);
  const dfR = Math.exp(-i.r * i.T);
  const pdf = normPdf(d1);
  const gamma = (dfQ * pdf) / (i.S * i.sigma * sqrtT);
  const vega = i.S * dfQ * pdf * sqrtT; // per 1.00 vol
  let delta: number;
  let theta: number;
  let rho: number;
  const termDecay = -(i.S * dfQ * pdf * i.sigma) / (2 * sqrtT);
  if (right === "call") {
    delta = dfQ * normCdf(d1);
    theta = termDecay - i.r * i.K * dfR * normCdf(d2) + i.q * i.S * dfQ * normCdf(d1);
    rho = i.K * i.T * dfR * normCdf(d2);
  } else {
    delta = dfQ * (normCdf(d1) - 1);
    theta = termDecay + i.r * i.K * dfR * normCdf(-d2) - i.q * i.S * dfQ * normCdf(-d1);
    rho = -i.K * i.T * dfR * normCdf(-d2);
  }
  return {
    delta,
    gamma,
    vega,
    theta,
    rho,
    thetaPerDay: theta / 365,
    vegaPerPct: vega / 100,
  };
}

/**
 * Implied volatility from a market price. Newton–Raphson seeded by the
 * Brenner–Subrahmanyam ATM approximation, with a bisection fallback for
 * robustness. Returns undefined if the price is below intrinsic (no solution).
 */
export function impliedVol(
  right: OptionRight,
  price: number,
  i: Omit<BsmInputs, "sigma">,
  opts: { tol?: number; maxIter?: number } = {},
): number | undefined {
  const tol = opts.tol ?? 1e-7;
  const maxIter = opts.maxIter ?? 100;
  if (i.T <= 0) return undefined;
  const intr = Math.exp(-i.r * i.T) * intrinsic(right, i.S * Math.exp((i.r - i.q) * i.T), i.K);
  if (price < intr - 1e-9) return undefined;
  if (price <= intr + 1e-12) return 1e-6;

  // Brenner–Subrahmanyam seed
  let sigma = (price / i.S) * Math.sqrt((2 * Math.PI) / i.T);
  sigma = Math.min(Math.max(sigma, 1e-3), 5);

  for (let n = 0; n < maxIter; n++) {
    const full: BsmInputs = { ...i, sigma };
    const p = bsmPrice(right, full);
    const v = bsmGreeks(right, full).vega;
    const diff = p - price;
    if (Math.abs(diff) < tol) return sigma;
    if (v < 1e-10) break; // vega vanished — switch to bisection
    sigma -= diff / v;
    if (sigma <= 0 || sigma > 10 || !Number.isFinite(sigma)) break;
  }

  // Bisection fallback on [1e-6, 10]
  let lo = 1e-6;
  let hi = 10;
  let flo = bsmPrice(right, { ...i, sigma: lo }) - price;
  for (let n = 0; n < 200; n++) {
    const mid = 0.5 * (lo + hi);
    const fm = bsmPrice(right, { ...i, sigma: mid }) - price;
    if (Math.abs(fm) < tol) return mid;
    if (Math.sign(fm) === Math.sign(flo)) {
      lo = mid;
      flo = fm;
    } else {
      hi = mid;
    }
  }
  return 0.5 * (lo + hi);
}
