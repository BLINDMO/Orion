/**
 * Engine domain types — orders, fills, positions, world state. Spec §5–§7.
 * All monetary fields are `Dec` (exact). All timestamps are epoch ms UTC.
 */

import type { Dec } from "../money/decimal.ts";
import type { Millis } from "../data/types.ts";
import type { OptionSpec } from "../options/chain.ts";

export type Side = "buy" | "sell";
export type OrderType = "market" | "limit" | "stop" | "stop-limit" | "trailing-stop";
export type TimeInForce = "DAY" | "GTC";
export type OrderStatus = "working" | "partial" | "filled" | "cancelled" | "rejected" | "expired";
export type SimMode = "historical" | "live";

/** An order references either a spot instrument (by symbol) or an option (by spec). */
export interface OrderTarget {
  kind: "spot" | "option";
  symbol: string; // underlying or instrument symbol
  option?: OptionSpec;
}

export interface OrderRequest {
  target: OrderTarget;
  side: Side;
  qty: number;
  type: OrderType;
  limitPrice?: number;
  stopPrice?: number;
  /** Trailing stop: absolute trail distance in price units (XOR trailPercent). */
  trailAmount?: number;
  /** Trailing stop: trail distance as a fraction of price (e.g. 0.05 = 5%). */
  trailPercent?: number;
  tif?: TimeInForce;
  /** Optional client tag / strategy grouping id. */
  tag?: string;
}

export interface Order {
  id: string;
  target: OrderTarget;
  side: Side;
  qty: number;
  type: OrderType;
  limitPrice?: number;
  stopPrice?: number;
  trailAmount?: number;
  trailPercent?: number;
  tif: TimeInForce;
  tag?: string;
  status: OrderStatus;
  filledQty: number;
  avgFillPrice: Dec;
  feesPaid: Dec;
  createdAt: Millis;
  updatedAt: Millis;
  /** Has the stop been triggered (for stop/stop-limit/trailing)? */
  triggered: boolean;
  /** Dynamic stop level for trailing stops (tracks the extreme). */
  dynamicStop?: number;
  rejectReason?: string;
}

export interface Fill {
  id: string;
  orderId: string;
  target: OrderTarget;
  side: Side;
  qty: number;
  price: Dec;
  fee: Dec;
  at: Millis;
  /** Realized P&L booked by this fill (closing trades only). */
  realized: Dec;
  liquidity: "maker" | "taker";
}

export interface Position {
  /** Map key — symbol for spot, optionKey(spec) for options. */
  key: string;
  target: OrderTarget;
  /** Signed quantity: positive long, negative short. */
  qty: number;
  /** Average cost per unit (per share for options, pre-multiplier). */
  avgCost: Dec;
  /** Realized P&L accumulated on this position. */
  realized: Dec;
  /** Multiplier (1 spot; 100 equity option, etc.). */
  multiplier: number;
  openedAt: Millis;
  /** For options: cached spec. */
  option?: OptionSpec;
}

export interface AccountSettings {
  startingCash: number;
  riskFreeRate: number;
  /** Continuous dividend yield assumption for equities (chain pricing). */
  dividendYield: number;
  /** Realistic fees/spread/slippage on (true) or idealized fills (false). */
  feeRealism: boolean;
  /** Margin multiplier on buying power (1 = cash account, 2 = Reg-T-ish). */
  marginMultiplier: number;
  /** §user-request: when false, ALL help/learning/teaching is hidden app-wide. */
  helpEnabled: boolean;
  /** Equity maintenance margin requirement (fraction of position value). */
  maintenanceMargin: number;
}

export interface WorldSnapshot {
  now: Millis;
  cash: string;
  equity: string;
  buyingPower: string;
  positions: number;
  workingOrders: number;
}
