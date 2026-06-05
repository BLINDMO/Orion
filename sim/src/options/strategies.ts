/**
 * Multi-leg option strategies. Spec §8.
 *
 * A strategy is a bag of legs (options and/or the underlying). The analyzer
 * builds the at-expiry payoff diagram and derives net debit/credit, max profit,
 * max loss and breakevens. Named constructors assemble the common structures
 * (verticals, straddles/strangles, condors, butterflies, covered calls,
 * cash-secured puts, collars) from live chain quotes — buys lift the ask, sells
 * hit the bid, exactly as a real fill would.
 */

import type { OptionQuote, OptionSpec } from "./chain.ts";
import { intrinsic } from "./bsm.ts";

export type LegKind = "option" | "underlying";

export interface StrategyLeg {
  kind: LegKind;
  /** +1 long, -1 short. */
  side: 1 | -1;
  qty: number;
  /** Premium (option, per share) or entry price (underlying), per unit. */
  entryPrice: number;
  /** Present for option legs. */
  spec?: OptionSpec;
  /** Multiplier (option contract size; 1 for underlying). */
  multiplier: number;
}

export interface Strategy {
  name: string;
  legs: StrategyLeg[];
}

export interface PayoffPoint {
  price: number;
  pnl: number;
}

export interface StrategyAnalysis {
  /** Positive => net debit paid; negative => net credit received. */
  netCost: number;
  maxProfit: number; // +Infinity if unbounded
  maxLoss: number; // -Infinity if unbounded
  breakevens: number[];
  payoff: PayoffPoint[];
  /** True if all option legs share one expiry (clean at-expiry diagram). */
  singleExpiry: boolean;
}

function legCost(leg: StrategyLeg): number {
  return leg.side * leg.qty * leg.entryPrice * leg.multiplier;
}

/** Net cost to open: + = debit, - = credit. */
export function netCost(legs: readonly StrategyLeg[]): number {
  return legs.reduce((a, l) => a + legCost(l), 0);
}

/** Value of the whole position if the underlying settles at `S_T` (all legs at expiry). */
function valueAtExpiry(legs: readonly StrategyLeg[], S_T: number): number {
  let v = 0;
  for (const l of legs) {
    if (l.kind === "option" && l.spec) {
      v += l.side * l.qty * l.multiplier * intrinsic(l.spec.right, S_T, l.spec.strike);
    } else {
      v += l.side * l.qty * l.multiplier * S_T;
    }
  }
  return v;
}

export function analyzeStrategy(strategy: Strategy, spot: number, opts: { span?: number; steps?: number } = {}): StrategyAnalysis {
  const legs = strategy.legs;
  const cost = netCost(legs);
  const span = opts.span ?? 0.6; // ±60% of spot
  const steps = opts.steps ?? 400;
  const lo = Math.max(0, spot * (1 - span));
  const hi = spot * (1 + span);
  const expiries = new Set(legs.filter((l) => l.kind === "option" && l.spec).map((l) => l.spec!.expiry));
  const singleExpiry = expiries.size <= 1;

  const payoff: PayoffPoint[] = [];
  let maxProfit = -Infinity;
  let maxLoss = Infinity;
  for (let i = 0; i <= steps; i++) {
    const price = lo + ((hi - lo) * i) / steps;
    const pnl = valueAtExpiry(legs, price) - cost;
    payoff.push({ price, pnl });
    if (pnl > maxProfit) maxProfit = pnl;
    if (pnl < maxLoss) maxLoss = pnl;
  }

  // Unbounded detection: look at slope at the extreme ends.
  const n = payoff.length;
  const slopeHi = payoff[n - 1]!.pnl - payoff[n - 2]!.pnl;
  const slopeLo = payoff[1]!.pnl - payoff[0]!.pnl;
  if (slopeHi > 1e-6) maxProfit = Infinity;
  if (slopeLo < -1e-6) maxProfit = Infinity; // profit grows as price falls
  if (slopeHi < -1e-6) maxLoss = -Infinity;
  if (slopeLo > 1e-6) maxLoss = -Infinity;

  // Breakevens: linear interpolation at sign changes.
  const breakevens: number[] = [];
  for (let i = 1; i < payoff.length; i++) {
    const a = payoff[i - 1]!;
    const b = payoff[i]!;
    if ((a.pnl <= 0 && b.pnl > 0) || (a.pnl >= 0 && b.pnl < 0)) {
      const t = a.pnl / (a.pnl - b.pnl);
      breakevens.push(+(a.price + t * (b.price - a.price)).toFixed(4));
    }
  }

  return { netCost: cost, maxProfit, maxLoss, breakevens, payoff, singleExpiry };
}

// --- Named constructors -----------------------------------------------------

const buy = (q: OptionQuote, qty = 1): StrategyLeg => ({
  kind: "option",
  side: 1,
  qty,
  entryPrice: q.ask,
  spec: q.spec,
  multiplier: q.spec.multiplier,
});
const sell = (q: OptionQuote, qty = 1): StrategyLeg => ({
  kind: "option",
  side: -1,
  qty,
  entryPrice: q.bid,
  spec: q.spec,
  multiplier: q.spec.multiplier,
});

/** Bull call / bear put style vertical: long the nearer-the-money, short the further. */
export function verticalSpread(longLeg: OptionQuote, shortLeg: OptionQuote, qty = 1): Strategy {
  const dir = longLeg.spec.right === "call" ? "Call" : "Put";
  return { name: `${dir} Vertical`, legs: [buy(longLeg, qty), sell(shortLeg, qty)] };
}

export function straddle(call: OptionQuote, put: OptionQuote, qty = 1): Strategy {
  return { name: "Long Straddle", legs: [buy(call, qty), buy(put, qty)] };
}

export function strangle(callOTM: OptionQuote, putOTM: OptionQuote, qty = 1): Strategy {
  return { name: "Long Strangle", legs: [buy(callOTM, qty), buy(putOTM, qty)] };
}

export function ironCondor(
  longPut: OptionQuote,
  shortPut: OptionQuote,
  shortCall: OptionQuote,
  longCall: OptionQuote,
  qty = 1,
): Strategy {
  return {
    name: "Iron Condor",
    legs: [buy(longPut, qty), sell(shortPut, qty), sell(shortCall, qty), buy(longCall, qty)],
  };
}

export function butterfly(lower: OptionQuote, body: OptionQuote, upper: OptionQuote, qty = 1): Strategy {
  return { name: "Butterfly", legs: [buy(lower, qty), sell(body, 2 * qty), buy(upper, qty)] };
}

export function calendarSpread(nearShort: OptionQuote, farLong: OptionQuote, qty = 1): Strategy {
  return { name: "Calendar Spread", legs: [sell(nearShort, qty), buy(farLong, qty)] };
}

export function coveredCall(underlyingPrice: number, shortCall: OptionQuote, shares = 100): Strategy {
  return {
    name: "Covered Call",
    legs: [
      { kind: "underlying", side: 1, qty: shares, entryPrice: underlyingPrice, multiplier: 1 },
      sell(shortCall, shares / shortCall.spec.multiplier),
    ],
  };
}

export function cashSecuredPut(shortPut: OptionQuote, qty = 1): Strategy {
  return { name: "Cash-Secured Put", legs: [sell(shortPut, qty)] };
}

export function collar(underlyingPrice: number, longPut: OptionQuote, shortCall: OptionQuote, shares = 100): Strategy {
  return {
    name: "Collar",
    legs: [
      { kind: "underlying", side: 1, qty: shares, entryPrice: underlyingPrice, multiplier: 1 },
      buy(longPut, shares / longPut.spec.multiplier),
      sell(shortCall, shares / shortCall.spec.multiplier),
    ],
  };
}
