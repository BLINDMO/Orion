/**
 * Market context: marks, quotes, and execution pricing. Spec §4, §6, §8.
 *
 * The single source of "what price can I get right now" — and it is rigorously
 * causal: every read is bounded by `now`. Execution pricing models bid/ask
 * spread, size-based slippage and partial fills against a specific bar's volume.
 */

import { Dec, dec } from "../money/decimal.ts";
import type { Bar, Millis, Resolution } from "../data/types.ts";
import type { Instrument } from "../data/types.ts";
import { InstrumentData } from "../data/series.ts";
import { Universe, barsPerYear } from "../data/universe.ts";
import { buildModeledSurface, type VolSurface } from "../options/volsurface.ts";
import { quoteOption, type OptionSpec, type OptionQuote, type ChainParams } from "../options/chain.ts";
import type { Side } from "./types.ts";

export interface ExecResult {
  /** Quantity actually fillable in this bar (>= 0, may be partial). */
  fillQty: number;
  /** Fill price per unit, tick-rounded. */
  price: Dec;
}

export interface MarketConfig {
  riskFreeRate: number;
  dividendYield: number;
  feeRealism: boolean;
}

function roundToTick(price: number, tick: number, side: Side): number {
  // round against the trader (buys up, sells down) to the tick grid
  const n = price / tick;
  const r = side === "buy" ? Math.ceil(n - 1e-9) : Math.floor(n + 1e-9);
  return +(r * tick).toFixed(10);
}

export class Market {
  private readonly universe: Universe;
  private readonly data: Map<string, InstrumentData>;
  private cfg: MarketConfig;
  private surfaceCache = new Map<string, { now: Millis; surface: VolSurface }>();

  constructor(universe: Universe, data: Map<string, InstrumentData>, cfg: MarketConfig) {
    this.universe = universe;
    this.data = data;
    this.cfg = cfg;
  }

  setConfig(cfg: MarketConfig): void {
    this.cfg = cfg;
    this.surfaceCache.clear();
  }

  instrument(symbol: string): Instrument {
    return this.universe.get(symbol);
  }

  instrumentData(symbol: string): InstrumentData {
    const d = this.data.get(symbol);
    if (!d) throw new Error(`No data for ${symbol}`);
    return d;
  }

  /** Mid mark for a spot instrument at `now`. Undefined before data starts. */
  spotMark(symbol: string, now: Millis): Dec | undefined {
    const p = this.instrumentData(symbol).markPrice(now);
    return p === undefined ? undefined : dec(p);
  }

  /** Bid/ask around the mid for a spot instrument. */
  spotBidAsk(symbol: string, now: Millis): { bid: Dec; ask: Dec } | undefined {
    const mid = this.spotMark(symbol, now);
    if (!mid) return undefined;
    const inst = this.instrument(symbol);
    const half = this.cfg.feeRealism ? inst.micro.halfSpreadBps / 10000 : 0;
    return {
      bid: mid.mul(1 - half),
      ask: mid.mul(1 + half),
    };
  }

  /** The next bar that opens strictly after `afterOpen`, at the given resolution. */
  nextBar(symbol: string, afterOpen: Millis, resolution: Resolution): Bar | undefined {
    const id = this.instrumentData(symbol);
    if (!id.has(resolution)) return undefined;
    return id.get(resolution).nextBarAfter(afterOpen);
  }

  /** Finest resolution available for an instrument (for stepping). */
  steppingResolution(symbol: string): Resolution {
    const id = this.instrumentData(symbol);
    if (id.has("1m")) return "1m";
    if (id.has("1h")) return "1h";
    return "1d";
  }

  /**
   * Compute the execution against a specific bar for a market-style fill.
   * Applies half-spread + size slippage and caps fill at the bar's participation
   * limit (partial fills for large orders). `reference` is the bar open (the
   * "next available price"). Returns 0 fillQty if the bar has no volume.
   */
  executeAgainstBar(symbol: string, side: Side, qty: number, bar: Bar): ExecResult {
    const inst = this.instrument(symbol);
    const micro = inst.micro;
    const realism = this.cfg.feeRealism;
    const maxFill = realism ? Math.max(0, bar.v * micro.maxParticipation) : qty;
    const fillQty = realism ? Math.min(qty, maxFill) : qty;
    if (fillQty <= 0) return { fillQty: 0, price: dec(bar.o) };

    const participation = realism && bar.v > 0 ? fillQty / bar.v : 0;
    const halfSpread = realism ? micro.halfSpreadBps / 10000 : 0;
    const impact = realism ? (micro.slippageK * participation) / 10000 : 0;
    const sign = side === "buy" ? 1 : -1;
    let px = bar.o * (1 + sign * (halfSpread + impact));
    // Can't fill better than the bar's range allows for a marketable order.
    px = side === "buy" ? Math.min(Math.max(px, bar.l), bar.h * 1.05) : Math.max(Math.min(px, bar.h), bar.l * 0.95);
    return { fillQty, price: dec(roundToTick(px, inst.tickSize, side)) };
  }

  /** Fee for a fill: bps of notional + per-order, with a minimum, by liquidity. */
  fee(symbol: string, notional: Dec, liquidity: "maker" | "taker"): Dec {
    if (!this.cfg.feeRealism) return Dec.ZERO;
    const inst = this.instrument(symbol);
    const bps = liquidity === "maker" ? inst.fees.makerBps : inst.fees.takerBps;
    const variable = notional.abs().mul(bps / 10000);
    const total = variable.add(inst.fees.perOrder);
    return total.max(inst.fees.minFee).toCents();
  }

  // --- Options -------------------------------------------------------------

  volSurface(underlying: string, now: Millis): VolSurface {
    const cached = this.surfaceCache.get(underlying);
    if (cached && cached.now === now) return cached.surface;
    const id = this.instrumentData(underlying);
    const res: Resolution = id.has("1d") ? "1d" : id.has("1h") ? "1h" : "1m";
    const visible = id.get(res).visible(now);
    const inst = this.instrument(underlying);
    const minutes = res === "1d" ? 1440 : res === "1h" ? 60 : 1;
    const surface = buildModeledSurface(visible, inst.assetClass, barsPerYear(inst.calendar, minutes));
    this.surfaceCache.set(underlying, { now, surface });
    return surface;
  }

  /** Quote a single option contract at `now`. Undefined if no underlying mark. */
  optionQuote(spec: OptionSpec, now: Millis): OptionQuote | undefined {
    const spotDec = this.spotMark(spec.underlying, now);
    if (!spotDec) return undefined;
    const inst = this.instrument(spec.underlying);
    const params: ChainParams = {
      underlyingSymbol: spec.underlying,
      assetClass: inst.assetClass,
      spot: spotDec.toNumber(),
      now,
      r: this.cfg.riskFreeRate,
      q: inst.assetClass === "equity" ? this.cfg.dividendYield : 0,
      surface: this.volSurface(spec.underlying, now),
      multiplier: spec.multiplier,
    };
    return quoteOption(params, spec.right, spec.strike, spec.expiry);
  }

  /** Mid mark for an option contract (per share, pre-multiplier). */
  optionMark(spec: OptionSpec, now: Millis): Dec | undefined {
    const q = this.optionQuote(spec, now);
    return q ? dec(q.theo) : undefined;
  }
}
