/**
 * Core market-data types. Spec §4 (Data Layer).
 *
 * Timestamps are epoch milliseconds in UTC throughout the engine — a single,
 * unambiguous instant for the global clock to compare against.
 */

export type Millis = number; // epoch milliseconds, UTC

export type AssetClass = "equity" | "crypto";

export type Resolution = "1m" | "1h" | "1d";

export const RESOLUTION_MS: Record<Resolution, number> = {
  "1m": 60_000,
  "1h": 3_600_000,
  "1d": 86_400_000,
};

/** One OHLCV bar. `t` is the bar's OPEN time (the instant the bar begins). */
export interface Bar {
  readonly t: Millis;
  readonly o: number;
  readonly h: number;
  readonly l: number;
  readonly c: number;
  readonly v: number;
}

/** A bar is "closed" — fully formed — at t + resolutionMs. */
export function barCloseTime(bar: Bar, res: Resolution): Millis {
  return bar.t + RESOLUTION_MS[res];
}

export interface FeeSchedule {
  /** Taker fee in basis points (1 bp = 0.01%). */
  readonly takerBps: number;
  /** Maker fee in basis points (resting orders that add liquidity). */
  readonly makerBps: number;
  /** Flat per-order commission in account currency (e.g. equities often 0). */
  readonly perOrder: number;
  /** Minimum fee charged on any fill. */
  readonly minFee: number;
}

/** Half-spread expressed in basis points of mid price, plus slippage tuning. */
export interface Microstructure {
  /** Half the bid/ask spread, in bps of price. Full spread = 2 * halfSpreadBps. */
  readonly halfSpreadBps: number;
  /**
   * Slippage impact coefficient. Marginal price impact grows with the order's
   * participation rate (orderQty / barVolume). impactBps ≈ slippageK * participation.
   */
  readonly slippageK: number;
  /** Max fraction of a single bar's volume fillable in one step (0..1]. */
  readonly maxParticipation: number;
}

export interface Instrument {
  readonly symbol: string;
  readonly name: string;
  readonly assetClass: AssetClass;
  /** Minimum price increment. */
  readonly tickSize: number;
  /** Minimum tradeable quantity increment (e.g. 1 share, 0.00000001 BTC). */
  readonly lotSize: number;
  /** Contract/position multiplier (1 for spot; 100 for standard equity options). */
  readonly multiplier: number;
  /** Trading calendar id (see calendar.ts). */
  readonly calendar: "24x7" | "us-equity";
  readonly fees: FeeSchedule;
  readonly micro: Microstructure;
  /** Quote currency code, for display. */
  readonly currency: string;
  /** Whether short selling is permitted. */
  readonly shortable: boolean;
  /** Annual borrow cost in bps for shorting (applied on short notional). */
  readonly borrowBps: number;
}
