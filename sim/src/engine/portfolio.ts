/**
 * Portfolio accounting. Spec §7.
 *
 * Mark-to-market is 1:1 with the supplied price resolver — equity, P&L and
 * buying power are derived, never stored stale. Average cost handles adds,
 * partial closes and flips correctly. Buying power uses a documented margin
 * model: buyingPower = max(0, equity*marginMultiplier - grossExposure).
 */

import { Dec, dec } from "../money/decimal.ts";
import type { Position, OrderTarget, Side } from "./types.ts";
import type { Millis } from "../data/types.ts";

/** Resolve the current mark (per unit, pre-multiplier) for a position key. */
export type MarkResolver = (pos: Position) => Dec | undefined;

export interface BookResult {
  position: Position | undefined; // undefined when fully closed to flat
  realizedDelta: Dec;
  /** Cash change from the trade notional (excludes fees). */
  cashDelta: Dec;
}

const sign = (n: number): number => (n > 0 ? 1 : n < 0 ? -1 : 0);

/**
 * Apply a fill to a position. `signedQty` is +qty for a buy, -qty for a sell.
 * Pure: returns the new position and the realized/cash deltas.
 */
export function bookFill(
  existing: Position | undefined,
  target: OrderTarget,
  key: string,
  side: Side,
  qty: number,
  price: Dec,
  multiplier: number,
  at: Millis,
): BookResult {
  const signedQty = side === "buy" ? qty : -qty;
  const oldQty = existing?.qty ?? 0;
  const oldAvg = existing?.avgCost ?? Dec.ZERO;
  const oldRealized = existing?.realized ?? Dec.ZERO;
  const newQty = +(oldQty + signedQty).toFixed(10);

  let realizedDelta = Dec.ZERO;
  let newAvg = oldAvg;

  if (oldQty === 0 || sign(oldQty) === sign(signedQty)) {
    // open or add in same direction → weighted average cost
    const oldNotional = oldAvg.mul(Math.abs(oldQty));
    const addNotional = price.mul(Math.abs(signedQty));
    newAvg = Math.abs(newQty) === 0 ? Dec.ZERO : oldNotional.add(addNotional).div(Math.abs(newQty));
  } else {
    // reduce, close, or flip
    const closingQty = Math.min(Math.abs(signedQty), Math.abs(oldQty));
    if (oldQty > 0) {
      // long closed by a sell
      realizedDelta = price.sub(oldAvg).mul(closingQty).mul(multiplier);
    } else {
      // short closed by a buy
      realizedDelta = oldAvg.sub(price).mul(closingQty).mul(multiplier);
    }
    if (Math.abs(signedQty) <= Math.abs(oldQty)) {
      newAvg = newQty === 0 ? Dec.ZERO : oldAvg; // remaining keeps its basis
    } else {
      newAvg = price; // flipped — remainder opens fresh at fill price
    }
  }

  // cash: buying spends, selling receives
  const cashDelta = price.mul(-signedQty).mul(multiplier);

  if (newQty === 0) {
    return { position: undefined, realizedDelta, cashDelta };
  }

  const position: Position = {
    key,
    target,
    qty: newQty,
    avgCost: newAvg,
    realized: oldRealized.add(realizedDelta),
    multiplier,
    openedAt: existing && sign(oldQty) === sign(newQty) ? existing.openedAt : at,
    option: target.option,
  };
  return { position, realizedDelta, cashDelta };
}

export class Portfolio {
  cash: Dec;
  readonly positions = new Map<string, Position>();
  /** Realized P&L booked across all closed trades (cumulative). */
  realizedPnl: Dec = Dec.ZERO;

  constructor(startingCash: Dec) {
    this.cash = startingCash;
  }

  get(key: string): Position | undefined {
    return this.positions.get(key);
  }

  /** Market value of a single position (signed). */
  positionValue(pos: Position, resolve: MarkResolver): Dec {
    const mark = resolve(pos);
    if (!mark) return Dec.ZERO;
    return mark.mul(pos.qty).mul(pos.multiplier);
  }

  /** Unrealized P&L for a position. */
  unrealized(pos: Position, resolve: MarkResolver): Dec {
    const mark = resolve(pos);
    if (!mark) return Dec.ZERO;
    return mark.sub(pos.avgCost).mul(pos.qty).mul(pos.multiplier);
  }

  totalUnrealized(resolve: MarkResolver): Dec {
    let acc = Dec.ZERO;
    for (const p of this.positions.values()) acc = acc.add(this.unrealized(p, resolve));
    return acc;
  }

  /** Sum of signed position market values. */
  positionsValue(resolve: MarkResolver): Dec {
    let acc = Dec.ZERO;
    for (const p of this.positions.values()) acc = acc.add(this.positionValue(p, resolve));
    return acc;
  }

  /** Gross (absolute) exposure across positions — drives margin. */
  grossExposure(resolve: MarkResolver): Dec {
    let acc = Dec.ZERO;
    for (const p of this.positions.values()) acc = acc.add(this.positionValue(p, resolve).abs());
    return acc;
  }

  /** Total account equity = cash + Σ signed position value. */
  equity(resolve: MarkResolver): Dec {
    return this.cash.add(this.positionsValue(resolve));
  }

  /** Buying power available to OPEN/INCREASE exposure. */
  buyingPower(resolve: MarkResolver, marginMultiplier: number): Dec {
    const eq = this.equity(resolve);
    const gross = this.grossExposure(resolve);
    const bp = eq.mul(marginMultiplier).sub(gross);
    return bp.isNeg() ? Dec.ZERO : bp;
  }

  /** Apply a booked fill: mutate cash + position. Returns realized delta. */
  apply(result: BookResult, key: string): Dec {
    this.cash = this.cash.add(result.cashDelta);
    this.realizedPnl = this.realizedPnl.add(result.realizedDelta);
    if (result.position) this.positions.set(key, result.position);
    else this.positions.delete(key);
    return result.realizedDelta;
  }
}
