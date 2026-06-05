/**
 * The ORION world — global clock + execution + accounting + settlement.
 * Spec §5, §6, §7, §8.
 *
 * `advance()` steps the single global clock forward bar-by-bar, and on EVERY
 * step (in spec §5 order): update marks → trigger/fill resting orders → reprice
 * & decay options → settle expiries/assignments → accrue borrow → sample stats.
 * Nothing is batch-skipped on multi-day jumps. No data past `clock.now` is ever
 * read — fills use the next available bar, never the last close.
 */

import { Dec, dec } from "../money/decimal.ts";
import { Rng } from "../money/random.ts";
import type { Bar, Millis, Resolution } from "../data/types.ts";
import { RESOLUTION_MS } from "../data/types.ts";
import { Universe } from "../data/universe.ts";
import { InstrumentData } from "../data/series.ts";
import { getCalendar } from "../time/calendar.ts";
import { Market, type MarketConfig } from "./market.ts";
import { Portfolio, bookFill, type MarkResolver } from "./portfolio.ts";
import type { OptionSpec } from "../options/chain.ts";
import type {
  AccountSettings,
  Fill,
  Order,
  OrderRequest,
  OrderTarget,
  Position,
  SimMode,
  Side,
  WorldSnapshot,
} from "./types.ts";

const YEAR_MS = 365 * 24 * 3600 * 1000;

export function optionKey(spec: OptionSpec): string {
  return `OPT:${spec.underlying}:${spec.right}:${spec.strike}:${spec.expiry}`;
}
function targetKey(t: OrderTarget): string {
  return t.kind === "option" && t.option ? optionKey(t.option) : t.symbol;
}

export interface AdvanceOptions {
  /** Stepping resolution for the walk. Defaults per step size. */
  stepRes?: Resolution;
  /** Per-step callback for UI scrubbing animation. */
  onTick?: (snap: WorldSnapshot) => void;
}

export interface SubmitResult {
  ok: boolean;
  order?: Order;
  reason?: string;
}

const DEFAULT_SETTINGS: AccountSettings = {
  startingCash: 25_000,
  riskFreeRate: 0.04,
  dividendYield: 0.01,
  feeRealism: true,
  marginMultiplier: 2,
  helpEnabled: true,
  maintenanceMargin: 0.25,
};

export class World {
  readonly universe: Universe;
  readonly data: Map<string, InstrumentData>;
  readonly market: Market;
  portfolio: Portfolio;
  settings: AccountSettings;
  mode: SimMode = "historical";
  now: Millis;
  readonly startNow: Millis;

  readonly orders = new Map<string, Order>();
  readonly fills: Fill[] = [];
  /** Equity-curve samples in sim-time. */
  readonly equityCurve: { t: Millis; equity: string }[] = [];
  /** Closed-trade records for analytics (§12). */
  readonly closedTrades: ClosedTrade[] = [];
  /** Realized stats: theta captured/paid, assignments. */
  optionStats = { thetaPaid: dec(0), assignments: 0, expiredWorthless: 0, exercised: 0 };

  private rng: Rng;
  private idSeq = 0;

  constructor(opts: {
    universe: Universe;
    data: Map<string, InstrumentData>;
    startNow: Millis;
    settings?: Partial<AccountSettings>;
    seed?: number;
  }) {
    this.universe = opts.universe;
    this.data = opts.data;
    this.settings = { ...DEFAULT_SETTINGS, ...opts.settings };
    this.now = opts.startNow;
    this.startNow = opts.startNow;
    this.portfolio = new Portfolio(dec(this.settings.startingCash));
    this.market = new Market(opts.universe, opts.data, this.marketCfg());
    this.rng = new Rng(opts.seed ?? 0x0710_2024);
    this.sampleEquity();
  }

  private marketCfg(): MarketConfig {
    return {
      riskFreeRate: this.settings.riskFreeRate,
      dividendYield: this.settings.dividendYield,
      feeRealism: this.settings.feeRealism,
    };
  }

  private id(prefix: string): string {
    return `${prefix}${(++this.idSeq).toString(36)}`;
  }

  // --- Marking -------------------------------------------------------------

  /** Resolve the current mark for any position (spot or option) at `now`. */
  markResolver(): MarkResolver {
    return (pos: Position): Dec | undefined => {
      if (pos.target.kind === "option" && pos.option) {
        return this.market.optionMark(pos.option, this.now);
      }
      return this.market.spotMark(pos.target.symbol, this.now);
    };
  }

  equity(): Dec {
    return this.portfolio.equity(this.markResolver());
  }
  buyingPower(): Dec {
    return this.portfolio.buyingPower(this.markResolver(), this.settings.marginMultiplier);
  }
  unrealized(): Dec {
    return this.portfolio.totalUnrealized(this.markResolver());
  }

  snapshot(): WorldSnapshot {
    const resolve = this.markResolver();
    return {
      now: this.now,
      cash: this.portfolio.cash.toFixed(2),
      equity: this.portfolio.equity(resolve).toFixed(2),
      buyingPower: this.portfolio.buyingPower(resolve, this.settings.marginMultiplier).toFixed(2),
      positions: this.portfolio.positions.size,
      workingOrders: this.workingOrders().length,
    };
  }

  workingOrders(): Order[] {
    return [...this.orders.values()].filter((o) => o.status === "working" || o.status === "partial");
  }

  // --- Order submission ----------------------------------------------------

  submit(req: OrderRequest): SubmitResult {
    const inst = req.target.kind === "spot" ? req.target.symbol : req.target.option?.underlying;
    if (!inst || !this.universe.has(inst)) return { ok: false, reason: "Unknown instrument" };
    if (!(req.qty > 0)) return { ok: false, reason: "Quantity must be positive" };

    const instrument = this.universe.get(inst);
    if (req.target.kind === "spot") {
      const lot = instrument.lotSize;
      const rounded = Math.round(req.qty / lot) * lot;
      if (Math.abs(rounded - req.qty) > lot * 1e-6 && rounded > 0) {
        // snap silently to lot size
        req = { ...req, qty: rounded };
      }
    }
    if (req.side === "sell" && this.isOpeningShort(req) && !instrument.shortable) {
      return { ok: false, reason: "Instrument is not shortable" };
    }
    if ((req.type === "limit" || req.type === "stop-limit") && req.limitPrice === undefined)
      return { ok: false, reason: "Limit price required" };
    if ((req.type === "stop" || req.type === "stop-limit") && req.stopPrice === undefined)
      return { ok: false, reason: "Stop price required" };
    if (req.type === "trailing-stop" && req.trailAmount === undefined && req.trailPercent === undefined)
      return { ok: false, reason: "Trail amount or percent required" };

    // Soft buying-power preview for opening market orders.
    if (req.type === "market" && this.isOpening(req)) {
      const est = this.estimateNotional(req);
      if (est && est.gt(this.buyingPower())) {
        return {
          ok: false,
          reason: "Insufficient buying power to open this position. Reduce size, close other positions, or top up from the menu.",
        };
      }
    }

    const order: Order = {
      id: this.id("O"),
      target: req.target,
      side: req.side,
      qty: req.qty,
      type: req.type,
      limitPrice: req.limitPrice,
      stopPrice: req.stopPrice,
      trailAmount: req.trailAmount,
      trailPercent: req.trailPercent,
      tif: req.tif ?? "DAY",
      tag: req.tag,
      status: "working",
      filledQty: 0,
      avgFillPrice: Dec.ZERO,
      feesPaid: Dec.ZERO,
      createdAt: this.now,
      updatedAt: this.now,
      triggered: req.type === "market" || req.type === "limit",
    };
    this.orders.set(order.id, order);

    // In Live mode, market orders fill immediately against the current price.
    if (this.mode === "live" && req.type === "market") {
      this.fillLiveMarket(order);
    }
    return { ok: true, order };
  }

  cancel(orderId: string): boolean {
    const o = this.orders.get(orderId);
    if (!o || (o.status !== "working" && o.status !== "partial")) return false;
    o.status = "cancelled";
    o.updatedAt = this.now;
    return true;
  }

  private isOpening(req: OrderRequest): boolean {
    const pos = this.portfolio.get(targetKey(req.target));
    if (!pos) return true;
    const sameDir = (req.side === "buy" && pos.qty > 0) || (req.side === "sell" && pos.qty < 0);
    return sameDir; // adding in the same direction is "opening/increasing"
  }
  private isOpeningShort(req: OrderRequest): boolean {
    const pos = this.portfolio.get(targetKey(req.target));
    return (!pos || pos.qty <= 0) && req.side === "sell";
  }

  private estimateNotional(req: OrderRequest): Dec | undefined {
    if (req.target.kind === "option" && req.target.option) {
      const m = this.market.optionMark(req.target.option, this.now);
      return m ? m.mul(req.qty).mul(req.target.option.multiplier) : undefined;
    }
    const m = this.market.spotMark(req.target.symbol, this.now);
    return m ? m.mul(req.qty) : undefined;
  }

  // --- Time advancement ----------------------------------------------------

  advanceHour(opts?: AdvanceOptions): void {
    const target = alignUp(this.now + RESOLUTION_MS["1h"], RESOLUTION_MS["1h"]);
    this.advanceTo(target, { stepRes: "1m", ...opts });
  }

  /** Advance to the next trading-day open of the *primary* calendar (crypto = next UTC day). */
  advanceDay(opts?: AdvanceOptions): void {
    // Use the union: advance one calendar day's worth, landing at next day boundary.
    const target = this.now + RESOLUTION_MS["1d"];
    this.advanceTo(target, { stepRes: "1m", ...opts });
  }

  advanceMonth(opts?: AdvanceOptions): void {
    const target = this.now + 30 * RESOLUTION_MS["1d"];
    // coarser stepping for the long jump, still bar-by-bar (hourly) so decay,
    // expiries and triggers all resolve along the way.
    this.advanceTo(target, { stepRes: "1h", ...opts });
  }

  /** Generic advance to an absolute timestamp. */
  advanceTo(target: Millis, opts: AdvanceOptions = {}): void {
    if (target <= this.now) return;
    const stepRes = opts.stepRes ?? "1m";
    const step = RESOLUTION_MS[stepRes];
    let t = this.now;
    let guard = 0;
    const maxSteps = Math.ceil((target - this.now) / step) + 4;
    while (t < target && guard++ <= maxSteps) {
      const next = Math.min(target, alignUp(t + 1, step));
      this.processStep(t, next, stepRes);
      t = next;
    }
    this.now = target;
    this.market.setConfig(this.marketCfg()); // clear surface cache for new now
    this.processStep(t, target, stepRes); // final marking pass at exact target
    this.sampleEquity();
    opts.onTick?.(this.snapshot());
  }

  /** Process one bar-step covering (prevNow, newNow]. */
  private processStep(prevNow: Millis, newNow: Millis, stepRes: Resolution): void {
    this.now = newNow;
    const step = RESOLUTION_MS[stepRes];
    const barOpen = newNow - step;

    // 1) For each instrument that has a working order or position, process its bar.
    const symbols = this.activeSymbols();
    for (const symbol of symbols) {
      const id = this.data.get(symbol);
      if (!id || !id.has(stepRes)) continue;
      const bar = id.get(stepRes).barOpeningAt(barOpen);
      if (!bar) continue; // market closed / no data this step
      this.processSpotOrders(symbol, bar);
    }

    // 2) Option orders fill against synthesized quotes at the new clock.
    this.processOptionOrders();

    // 3) Settle expiring options and handle assignment.
    this.settleExpiries();

    // 4) Accrue borrow cost on short positions for the elapsed time.
    this.accrueBorrow(prevNow, newNow);

    // 5) Expire DAY orders that have crossed their session/day boundary.
    this.expireDayOrders();

    this.market.setConfig(this.marketCfg());
    this.onTickSample(newNow);
  }

  private activeSymbols(): Set<string> {
    const s = new Set<string>();
    for (const o of this.orders.values()) {
      if (o.status === "working" || o.status === "partial") s.add(symbolOf(o.target));
    }
    for (const p of this.portfolio.positions.values()) s.add(symbolOf(p.target));
    return s;
  }

  // --- Spot order execution ------------------------------------------------

  private processSpotOrders(symbol: string, bar: Bar): void {
    for (const o of this.orders.values()) {
      if (o.status !== "working" && o.status !== "partial") continue;
      if (o.target.kind !== "spot" || o.target.symbol !== symbol) continue;
      this.tryFillSpot(o, bar);
    }
  }

  private remaining(o: Order): number {
    return o.qty - o.filledQty;
  }

  private tryFillSpot(o: Order, bar: Bar): void {
    const side = o.side;
    // Determine trigger/marketability against this bar.
    let marketable = false;
    let limitCap: number | undefined;

    switch (o.type) {
      case "market":
        marketable = true;
        break;
      case "limit": {
        const lp = o.limitPrice!;
        if (side === "buy" && bar.l <= lp) {
          marketable = true;
          limitCap = lp;
        } else if (side === "sell" && bar.h >= lp) {
          marketable = true;
          limitCap = lp;
        }
        break;
      }
      case "stop": {
        const sp = o.stopPrice!;
        if (!o.triggered) {
          if (side === "buy" && bar.h >= sp) o.triggered = true;
          else if (side === "sell" && bar.l <= sp) o.triggered = true;
        }
        marketable = o.triggered;
        break;
      }
      case "stop-limit": {
        const sp = o.stopPrice!;
        if (!o.triggered) {
          if (side === "buy" && bar.h >= sp) o.triggered = true;
          else if (side === "sell" && bar.l <= sp) o.triggered = true;
        }
        if (o.triggered) {
          const lp = o.limitPrice!;
          if (side === "buy" && bar.l <= lp) {
            marketable = true;
            limitCap = lp;
          } else if (side === "sell" && bar.h >= lp) {
            marketable = true;
            limitCap = lp;
          }
        }
        break;
      }
      case "trailing-stop": {
        // Update the dynamic stop using this bar's extreme, then test trigger.
        const trail = (price: number) =>
          o.trailAmount !== undefined ? o.trailAmount : price * (o.trailPercent ?? 0);
        if (side === "sell") {
          // protect a long: trail below the highest price
          const candidate = bar.h - trail(bar.h);
          o.dynamicStop = o.dynamicStop === undefined ? candidate : Math.max(o.dynamicStop, candidate);
          if (!o.triggered && bar.l <= o.dynamicStop) o.triggered = true;
        } else {
          // protect a short: trail above the lowest price
          const candidate = bar.l + trail(bar.l);
          o.dynamicStop = o.dynamicStop === undefined ? candidate : Math.min(o.dynamicStop, candidate);
          if (!o.triggered && bar.h >= o.dynamicStop) o.triggered = true;
        }
        marketable = o.triggered;
        break;
      }
    }
    if (!marketable) return;

    const sym = o.target.symbol;
    const exec = this.market.executeAgainstBar(sym, side, this.remaining(o), bar);
    if (exec.fillQty <= 0) return;
    let price = exec.price;
    if (limitCap !== undefined) {
      // never fill worse than the limit
      price = side === "buy" ? price.min(limitCap) : price.max(limitCap);
    }
    this.bookOrderFill(o, exec.fillQty, price, "taker", bar.t);
  }

  // --- Option order execution ---------------------------------------------

  private processOptionOrders(): void {
    for (const o of this.orders.values()) {
      if (o.status !== "working" && o.status !== "partial") continue;
      if (o.target.kind !== "option" || !o.target.option) continue;
      const q = this.market.optionQuote(o.target.option, this.now);
      if (!q) continue;
      const side = o.side;
      let fillPrice: number | undefined;
      switch (o.type) {
        case "market":
          fillPrice = side === "buy" ? q.ask : q.bid;
          break;
        case "limit": {
          const lp = o.limitPrice!;
          if (side === "buy" && q.ask <= lp) fillPrice = Math.min(q.ask, lp);
          else if (side === "sell" && q.bid >= lp) fillPrice = Math.max(q.bid, lp);
          break;
        }
        case "stop":
        case "stop-limit": {
          const sp = o.stopPrice!;
          if (!o.triggered) {
            if (side === "buy" && q.theo >= sp) o.triggered = true;
            else if (side === "sell" && q.theo <= sp) o.triggered = true;
          }
          if (o.triggered) {
            if (o.type === "stop") fillPrice = side === "buy" ? q.ask : q.bid;
            else {
              const lp = o.limitPrice!;
              if (side === "buy" && q.ask <= lp) fillPrice = Math.min(q.ask, lp);
              else if (side === "sell" && q.bid >= lp) fillPrice = Math.max(q.bid, lp);
            }
          }
          break;
        }
        case "trailing-stop": {
          const trail = o.trailAmount ?? q.theo * (o.trailPercent ?? 0);
          if (side === "sell") {
            const cand = q.theo - trail;
            o.dynamicStop = o.dynamicStop === undefined ? cand : Math.max(o.dynamicStop, cand);
            if (!o.triggered && q.theo <= o.dynamicStop) o.triggered = true;
          } else {
            const cand = q.theo + trail;
            o.dynamicStop = o.dynamicStop === undefined ? cand : Math.min(o.dynamicStop, cand);
            if (!o.triggered && q.theo >= o.dynamicStop) o.triggered = true;
          }
          if (o.triggered) fillPrice = side === "buy" ? q.ask : q.bid;
          break;
        }
      }
      if (fillPrice === undefined) continue;
      this.bookOrderFill(o, this.remaining(o), dec(Math.max(0, fillPrice)), "taker", this.now);
    }
  }

  // --- Fill booking --------------------------------------------------------

  private fillLiveMarket(o: Order): void {
    if (o.target.kind === "option" && o.target.option) {
      const q = this.market.optionQuote(o.target.option, this.now);
      if (!q) return;
      this.bookOrderFill(o, o.qty, dec(o.side === "buy" ? q.ask : q.bid), "taker", this.now);
    } else {
      const ba = this.market.spotBidAsk(o.target.symbol, this.now);
      if (!ba) return;
      this.bookOrderFill(o, o.qty, o.side === "buy" ? ba.ask : ba.bid, "taker", this.now);
    }
  }

  private bookOrderFill(o: Order, qty: number, price: Dec, liquidity: "maker" | "taker", at: Millis): void {
    const key = targetKey(o.target);
    const mult = o.target.kind === "option" && o.target.option ? o.target.option.multiplier : 1;
    const symbol = symbolOf(o.target);

    // Buying-power gate at fill time for opening/increasing trades.
    if (this.isOpeningFill(o, key)) {
      const notional = price.mul(qty).mul(mult);
      const bp = this.buyingPower();
      if (notional.gt(bp.add("0.01"))) {
        o.status = "rejected";
        o.rejectReason = "Insufficient buying power at fill time";
        o.updatedAt = this.now;
        return;
      }
    }

    const notional = price.mul(qty).mul(mult);
    const fee = this.market.fee(symbol, notional, liquidity);
    const existing = this.portfolio.get(key);
    const booked = bookFill(existing, o.target, key, o.side, qty, price, mult, at);
    const realized = this.portfolio.apply(booked, key);
    this.portfolio.cash = this.portfolio.cash.sub(fee);

    // Update order aggregates (VWAP fill price).
    const prevNotional = o.avgFillPrice.mul(o.filledQty);
    o.filledQty = +(o.filledQty + qty).toFixed(10);
    o.avgFillPrice = o.filledQty > 0 ? prevNotional.add(price.mul(qty)).div(o.filledQty) : Dec.ZERO;
    o.feesPaid = o.feesPaid.add(fee);
    o.status = o.filledQty >= o.qty - 1e-9 ? "filled" : "partial";
    o.updatedAt = at;

    const fill: Fill = {
      id: this.id("F"),
      orderId: o.id,
      target: o.target,
      side: o.side,
      qty,
      price,
      fee,
      at,
      realized,
      liquidity,
    };
    this.fills.push(fill);
    if (!realized.isZero()) {
      this.recordClosedTrade(o.target, realized, at);
    }
  }

  private isOpeningFill(o: Order, key: string): boolean {
    const pos = this.portfolio.get(key);
    if (!pos) return true;
    return (o.side === "buy" && pos.qty >= 0) || (o.side === "sell" && pos.qty <= 0);
  }

  // --- Option expiry & assignment -----------------------------------------

  private settleExpiries(): void {
    for (const pos of [...this.portfolio.positions.values()]) {
      if (pos.target.kind !== "option" || !pos.option) continue;
      if (pos.option.expiry > this.now) continue;
      this.settleOption(pos);
    }
  }

  private settleOption(pos: Position): void {
    const spec = pos.option!;
    const spot = this.market.spotMark(spec.underlying, this.now);
    const key = optionKey(spec);
    const right = spec.right;
    const strike = spec.strike;
    const mult = spec.multiplier;
    const intrinsic = spot
      ? right === "call"
        ? Math.max(0, spot.toNumber() - strike)
        : Math.max(0, strike - spot.toNumber())
      : 0;

    if (intrinsic <= 0) {
      // OTM → expire worthless: close at 0, realizing the remaining premium.
      const booked = bookFill(pos, pos.target, key, pos.qty > 0 ? "sell" : "buy", Math.abs(pos.qty), Dec.ZERO, mult, this.now);
      const realized = this.portfolio.apply(booked, key);
      this.recordClosedTrade(pos.target, realized, this.now);
      this.optionStats.expiredWorthless++;
      return;
    }

    if (spec.settlement === "cash") {
      // Cash-settle the intrinsic value.
      const booked = bookFill(pos, pos.target, key, pos.qty > 0 ? "sell" : "buy", Math.abs(pos.qty), dec(intrinsic), mult, this.now);
      const realized = this.portfolio.apply(booked, key);
      this.recordClosedTrade(pos.target, realized, this.now);
      if (pos.qty < 0) this.optionStats.assignments++;
      else this.optionStats.exercised++;
      return;
    }

    // Physical (shares) settlement: exercise / assignment.
    this.exerciseToShares(pos);
  }

  /** Convert an in-the-money equity option into the resulting stock position. */
  private exerciseToShares(pos: Position): void {
    const spec = pos.option!;
    const key = optionKey(spec);
    const contracts = Math.abs(pos.qty);
    const shares = contracts * spec.multiplier;
    const isLong = pos.qty > 0;
    const isCall = spec.right === "call";
    // shares direction: long call / short put -> acquire; short call / long put -> deliver
    const sharesDir = isCall === isLong ? 1 : -1; // +1 long stock, -1 short stock
    const basisPerShare = isCall ? spec.strike + pos.avgCost.toNumber() : spec.strike - pos.avgCost.toNumber();
    const cashDelta = dec(-sharesDir * spec.strike * shares); // pay strike to acquire, receive to deliver

    // Remove the option position (premium rolls into stock basis — no realized here).
    this.portfolio.positions.delete(key);
    this.portfolio.cash = this.portfolio.cash.add(cashDelta);

    // Merge the stock lot at the computed basis (booking realized if it offsets).
    const stockTarget: OrderTarget = { kind: "spot", symbol: spec.underlying };
    const existing = this.portfolio.get(spec.underlying);
    const side: Side = sharesDir > 0 ? "buy" : "sell";
    const booked = bookFill(existing, stockTarget, spec.underlying, side, shares, dec(Math.max(0, basisPerShare)), 1, this.now);
    // Apply WITHOUT the bookFill cashDelta (cash already handled above): adjust.
    this.portfolio.realizedPnl = this.portfolio.realizedPnl.add(booked.realizedDelta);
    if (booked.position) this.portfolio.positions.set(spec.underlying, booked.position);
    else this.portfolio.positions.delete(spec.underlying);
    if (!booked.realizedDelta.isZero()) this.recordClosedTrade(stockTarget, booked.realizedDelta, this.now);

    if (isLong) this.optionStats.exercised++;
    else this.optionStats.assignments++;
  }

  // --- Borrow cost ---------------------------------------------------------

  private accrueBorrow(prevNow: Millis, newNow: Millis): void {
    const dtYears = (newNow - prevNow) / YEAR_MS;
    if (dtYears <= 0) return;
    const resolve = this.markResolver();
    let cost = Dec.ZERO;
    for (const pos of this.portfolio.positions.values()) {
      if (pos.target.kind !== "spot" || pos.qty >= 0) continue;
      const inst = this.universe.get(pos.target.symbol);
      const value = this.portfolio.positionValue(pos, resolve).abs();
      cost = cost.add(value.mul((inst.borrowBps / 10000) * dtYears));
    }
    if (cost.isPos()) this.portfolio.cash = this.portfolio.cash.sub(cost.toCents());
  }

  // --- DAY order expiry ----------------------------------------------------

  private expireDayOrders(): void {
    for (const o of this.orders.values()) {
      if ((o.status !== "working" && o.status !== "partial") || o.tif !== "DAY") continue;
      const sym = symbolOf(o.target);
      const cal = getCalendar(this.universe.get(sym).calendar);
      // DAY order dies once the clock passes the close of the session it was created in.
      const sessionClose = cal.nextClose(o.createdAt);
      if (this.now >= sessionClose) {
        o.status = o.filledQty > 0 ? "filled" : "expired";
        o.updatedAt = this.now;
      }
    }
  }

  // --- Stats sampling ------------------------------------------------------

  private lastSample = -1;
  private onTickSample(t: Millis): void {
    // Sample at most ~daily to bound memory on long advances.
    if (this.lastSample < 0 || t - this.lastSample >= RESOLUTION_MS["1d"]) {
      this.sampleEquity();
      this.lastSample = t;
    }
  }
  private sampleEquity(): void {
    this.equityCurve.push({ t: this.now, equity: this.equity().toFixed(2) });
  }

  private recordClosedTrade(target: OrderTarget, realized: Dec, at: Millis): void {
    this.closedTrades.push({
      symbol: symbolOf(target),
      kind: target.kind,
      realized: realized.toFixed(2),
      at,
    });
  }

  // --- Mode / settings -----------------------------------------------------

  setMode(mode: SimMode): void {
    this.mode = mode;
  }

  updateSettings(patch: Partial<AccountSettings>): void {
    this.settings = { ...this.settings, ...patch };
    this.market.setConfig(this.marketCfg());
  }

  /** Top up the bankroll (§11). */
  deposit(amount: number): void {
    this.portfolio.cash = this.portfolio.cash.add(amount);
  }

  /** Reset the simulator to a fresh start state (§11). */
  reset(opts?: { startNow?: Millis; startingCash?: number }): void {
    if (opts?.startingCash !== undefined) this.settings.startingCash = opts.startingCash;
    this.now = opts?.startNow ?? this.startNow;
    this.portfolio = new Portfolio(dec(this.settings.startingCash));
    this.orders.clear();
    this.fills.length = 0;
    this.equityCurve.length = 0;
    this.closedTrades.length = 0;
    this.optionStats = { thetaPaid: dec(0), assignments: 0, expiredWorthless: 0, exercised: 0 };
    this.idSeq = 0;
    this.lastSample = -1;
    this.market.setConfig(this.marketCfg());
    this.sampleEquity();
  }
}

export interface ClosedTrade {
  symbol: string;
  kind: "spot" | "option";
  realized: string;
  at: Millis;
}

function symbolOf(t: OrderTarget): string {
  return t.kind === "option" && t.option ? t.option.underlying : t.symbol;
}

function alignUp(t: Millis, step: number): Millis {
  return Math.ceil(t / step) * step;
}
