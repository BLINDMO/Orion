/**
 * Option chain construction. Spec §8.
 *
 * Synthesizes a full chain at clock.now: strike ladder × expirations, each
 * contract priced from BSM (crypto, European) or BAW (equity, American) using
 * an IV pulled from the pluggable vol surface. Produces bid/ask/last/IV/Greeks.
 * Volume/OI are modeled deterministically from moneyness and tenor.
 */

import type { Millis, AssetClass } from "../data/types.ts";
import { bsmPrice, bsmGreeks, type OptionRight, type Greeks, type BsmInputs } from "./bsm.ts";
import { americanPrice, americanGreeks } from "./american.ts";
import type { VolSurface } from "./volsurface.ts";

export type OptionStyle = "european" | "american";

/** Unique identity of a contract — the position/order key. */
export interface OptionSpec {
  underlying: string;
  right: OptionRight;
  strike: number;
  expiry: Millis;
  style: OptionStyle;
  multiplier: number;
  /** "shares" for equity physical delivery, "cash" for cash settlement. */
  settlement: "shares" | "cash";
}

export interface OptionQuote {
  spec: OptionSpec;
  iv: number;
  /** Theoretical mid. */
  theo: number;
  bid: number;
  ask: number;
  last: number;
  intrinsic: number;
  extrinsic: number;
  greeks: Greeks;
  /** Open interest & traded volume (modeled). */
  oi: number;
  volume: number;
  moneyness: "ITM" | "ATM" | "OTM";
}

export interface ChainParams {
  underlyingSymbol: string;
  assetClass: AssetClass;
  spot: number;
  now: Millis;
  r: number;
  q: number;
  surface: VolSurface;
  multiplier: number;
  /** Half the option bid/ask spread as a fraction of theo (e.g. 0.02 = 2%). */
  spreadFrac?: number;
  /** Absolute minimum half-spread in price units. */
  minHalfSpread?: number;
}

const YEAR_MS = 365 * 24 * 3600 * 1000;

export function yearsToExpiry(now: Millis, expiry: Millis): number {
  return Math.max(0, (expiry - now) / YEAR_MS);
}

function priceAndGreeks(
  style: OptionStyle,
  right: OptionRight,
  i: BsmInputs,
): { price: number; greeks: Greeks } {
  if (style === "american") {
    return { price: americanPrice(right, i), greeks: americanGreeks(right, i) };
  }
  return { price: bsmPrice(right, i), greeks: bsmGreeks(right, i) };
}

function moneynessOf(right: OptionRight, spot: number, strike: number): "ITM" | "ATM" | "OTM" {
  const rel = Math.abs(strike - spot) / spot;
  if (rel < 0.0025) return "ATM";
  if (right === "call") return spot > strike ? "ITM" : "OTM";
  return spot < strike ? "ITM" : "OTM";
}

/** Quote a single contract. */
export function quoteOption(p: ChainParams, right: OptionRight, strike: number, expiry: Millis): OptionQuote {
  const T = yearsToExpiry(p.now, expiry);
  const iv = p.surface.iv({ spot: p.spot, strike, T, r: p.r, q: p.q });
  const inputs: BsmInputs = { S: p.spot, K: strike, T, r: p.r, q: p.q, sigma: iv };
  const style: OptionStyle = p.assetClass === "equity" ? "american" : "european";
  const settlement: "shares" | "cash" = p.assetClass === "equity" ? "shares" : "cash";
  const { price, greeks } = priceAndGreeks(style, right, inputs);
  const intrinsic = right === "call" ? Math.max(0, p.spot - strike) : Math.max(0, strike - p.spot);
  const theo = Math.max(price, 0);
  const spreadFrac = p.spreadFrac ?? 0.02;
  const minHalf = p.minHalfSpread ?? 0.01;
  const half = Math.max(theo * spreadFrac, minHalf);
  const bid = Math.max(0, theo - half);
  const ask = theo + half;

  // Modeled liquidity: peak ATM, decays with |moneyness| and very long/short tenor.
  const rel = Math.abs(strike - p.spot) / p.spot;
  const tenorFactor = Math.exp(-Math.abs(Math.log((T * 365 + 1) / 30)));
  const liqBase = Math.exp(-rel * 12) * tenorFactor;
  const oi = Math.round(5000 * liqBase + 5);
  const volume = Math.round(800 * liqBase + 1);

  return {
    spec: {
      underlying: p.underlyingSymbol,
      right,
      strike,
      expiry,
      style,
      multiplier: p.multiplier,
      settlement,
    },
    iv,
    theo,
    bid,
    ask,
    last: theo,
    intrinsic,
    extrinsic: Math.max(0, theo - intrinsic),
    greeks,
    oi,
    volume,
    moneyness: moneynessOf(right, p.spot, strike),
  };
}

export interface ExpiryChain {
  expiry: Millis;
  calls: OptionQuote[];
  puts: OptionQuote[];
  /** Strike nearest spot. */
  atmStrike: number;
}

export interface OptionChain {
  underlying: string;
  spot: number;
  asOf: Millis;
  expiries: ExpiryChain[];
}

/** Generate a strike ladder centered on spot. */
export function strikeLadder(spot: number, count: number, stepFrac: number): number[] {
  // Round the strike interval to a "nice" number near stepFrac*spot.
  const rawStep = spot * stepFrac;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const candidates = [1, 2, 2.5, 5, 10].map((m) => m * mag);
  let step = candidates[0]!;
  for (const c of candidates) if (Math.abs(c - rawStep) < Math.abs(step - rawStep)) step = c;
  const atm = Math.round(spot / step) * step;
  const out: number[] = [];
  for (let k = -count; k <= count; k++) {
    const strike = +(atm + k * step).toFixed(6);
    if (strike > 0) out.push(strike);
  }
  return out;
}

/** The third Friday of (year, month0) at 21:00 UTC (≈16:00 ET close). */
export function thirdFridayUTC(year: number, month0: number): Millis {
  const first = Date.UTC(year, month0, 1);
  const firstDow = new Date(first).getUTCDay();
  const day = 1 + ((5 - firstDow + 7) % 7) + 14; // 3rd Friday
  return Date.UTC(year, month0, day, 21, 0, 0);
}

/** Standard expirations from `now`. Equities: next 6 monthly 3rd-Fridays. Crypto: weekly+monthly. */
export function standardExpiries(now: Millis, assetClass: AssetClass, count = 6): Millis[] {
  const out: Millis[] = [];
  if (assetClass === "equity") {
    const d = new Date(now);
    let y = d.getUTCFullYear();
    let m = d.getUTCMonth();
    while (out.length < count) {
      const tf = thirdFridayUTC(y, m);
      if (tf > now) out.push(tf);
      m++;
      if (m > 11) {
        m = 0;
        y++;
      }
    }
  } else {
    // crypto: weekly Fridays for first 4, then monthly
    const DAY = 86_400_000;
    let t = now;
    const day = new Date(now).getUTCDay();
    const toFriday = (5 - day + 7) % 7 || 7;
    let next = Math.floor(now / DAY) * DAY + toFriday * DAY + 8 * 3600_000; // Fri 08:00 UTC
    for (let i = 0; i < Math.min(4, count); i++) {
      if (next > now) out.push(next);
      next += 7 * DAY;
    }
    const d = new Date(now);
    let y = d.getUTCFullYear();
    let mo = d.getUTCMonth() + 1;
    while (out.length < count) {
      if (mo > 11) {
        mo = 0;
        y++;
      }
      const last = new Date(Date.UTC(y, mo + 1, 0, 8, 0, 0)).getTime();
      if (last > now && !out.includes(last)) out.push(last);
      mo++;
    }
  }
  return out.slice(0, count).sort((a, b) => a - b);
}

export function buildChain(p: ChainParams, opts: { strikes?: number; strikeStepFrac?: number; expiries?: Millis[] } = {}): OptionChain {
  const strikes = strikeLadder(p.spot, opts.strikes ?? 8, opts.strikeStepFrac ?? 0.025);
  const expiries = opts.expiries ?? standardExpiries(p.now, p.assetClass);
  const chains: ExpiryChain[] = expiries.map((expiry) => {
    const calls = strikes.map((k) => quoteOption(p, "call", k, expiry));
    const puts = strikes.map((k) => quoteOption(p, "put", k, expiry));
    let atm = strikes[0]!;
    for (const k of strikes) if (Math.abs(k - p.spot) < Math.abs(atm - p.spot)) atm = k;
    return { expiry, calls, puts, atmStrike: atm };
  });
  return { underlying: p.underlyingSymbol, spot: p.spot, asOf: p.now, expiries: chains };
}
