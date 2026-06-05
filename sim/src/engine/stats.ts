/**
 * Detailed analytics. Spec §12.
 *
 * Pure functions over `World` state — win rate, average win/loss, profit factor,
 * expectancy, max/current drawdown, hold time, turnover, per-instrument and
 * per-asset-class breakdowns, options-specific metrics, and the equity curve.
 */

import { Dec, dec } from "../money/decimal.ts";
import type { World, ClosedTrade } from "./world.ts";

export interface TradeStats {
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgWin: string;
  avgLoss: string;
  profitFactor: number; // grossProfit / grossLoss
  expectancy: string; // avg realized per trade
  grossProfit: string;
  grossLoss: string;
  avgHoldHours: number;
}

export interface DrawdownStats {
  peakEquity: string;
  currentEquity: string;
  maxDrawdown: string; // absolute
  maxDrawdownPct: number;
  currentDrawdown: string;
  currentDrawdownPct: number;
}

export interface Breakdown {
  key: string;
  realized: string;
  trades: number;
}

export interface OptionStats {
  avgEntryIv: number;
  thetaCapturedOrPaid: string; // signed: + collected, - paid
  assignments: number;
  exercised: number;
  expiredWorthless: number;
}

export interface AnalyticsReport {
  asOf: number;
  cash: string;
  equity: string;
  buyingPower: string;
  totalRealized: string;
  totalUnrealized: string;
  totalPnl: string;
  trade: TradeStats;
  drawdown: DrawdownStats;
  byInstrument: Breakdown[];
  byAssetClass: Breakdown[];
  options: OptionStats;
  turnover: number;
  equityCurve: { t: number; equity: string }[];
}

function tradeStats(trades: ClosedTrade[]): TradeStats {
  let wins = 0;
  let losses = 0;
  let grossProfit = dec(0);
  let grossLoss = dec(0);
  let holdSum = 0;
  for (const t of trades) {
    const r = dec(t.realized);
    if (r.isPos()) {
      wins++;
      grossProfit = grossProfit.add(r);
    } else if (r.isNeg()) {
      losses++;
      grossLoss = grossLoss.add(r.abs());
    }
    holdSum += t.holdMs;
  }
  const n = trades.length;
  const net = grossProfit.sub(grossLoss);
  return {
    trades: n,
    wins,
    losses,
    winRate: n > 0 ? wins / n : 0,
    avgWin: wins > 0 ? grossProfit.div(wins).toFixed(2) : "0.00",
    avgLoss: losses > 0 ? grossLoss.div(losses).neg().toFixed(2) : "0.00",
    profitFactor: grossLoss.isPos() ? grossProfit.div(grossLoss).toNumber() : grossProfit.isPos() ? Infinity : 0,
    expectancy: n > 0 ? net.div(n).toFixed(2) : "0.00",
    grossProfit: grossProfit.toFixed(2),
    grossLoss: grossLoss.neg().toFixed(2),
    avgHoldHours: n > 0 ? holdSum / n / 3_600_000 : 0,
  };
}

function drawdown(curve: { t: number; equity: string }[]): DrawdownStats {
  let peak = curve.length ? dec(curve[0]!.equity) : dec(0);
  let maxDd = dec(0);
  let maxDdPct = 0;
  for (const p of curve) {
    const e = dec(p.equity);
    if (e.gt(peak)) peak = e;
    const dd = peak.sub(e);
    if (dd.gt(maxDd)) maxDd = dd;
    const pct = peak.isPos() ? dd.div(peak).toNumber() : 0;
    if (pct > maxDdPct) maxDdPct = pct;
  }
  const cur = curve.length ? dec(curve[curve.length - 1]!.equity) : dec(0);
  const curDd = peak.sub(cur);
  return {
    peakEquity: peak.toFixed(2),
    currentEquity: cur.toFixed(2),
    maxDrawdown: maxDd.toFixed(2),
    maxDrawdownPct: maxDdPct,
    currentDrawdown: curDd.toFixed(2),
    currentDrawdownPct: peak.isPos() ? curDd.div(peak).toNumber() : 0,
  };
}

function breakdownBy(trades: ClosedTrade[], keyFn: (t: ClosedTrade) => string): Breakdown[] {
  const m = new Map<string, { realized: Dec; trades: number }>();
  for (const t of trades) {
    const k = keyFn(t);
    const cur = m.get(k) ?? { realized: dec(0), trades: 0 };
    cur.realized = cur.realized.add(t.realized);
    cur.trades++;
    m.set(k, cur);
  }
  return [...m.entries()]
    .map(([key, v]) => ({ key, realized: v.realized.toFixed(2), trades: v.trades }))
    .sort((a, b) => dec(b.realized).cmp(dec(a.realized)));
}

export function analytics(world: World): AnalyticsReport {
  const resolve = world.markResolver();
  const realized = world.portfolio.realizedPnl;
  const unrealized = world.portfolio.totalUnrealized(resolve);
  const equity = world.equity();
  const os = world.optionStats;

  const avgEquity = world.equityCurve.length
    ? world.equityCurve.reduce((a, p) => a.add(p.equity), dec(0)).div(world.equityCurve.length)
    : equity;

  return {
    asOf: world.now,
    cash: world.portfolio.cash.toFixed(2),
    equity: equity.toFixed(2),
    buyingPower: world.buyingPower().toFixed(2),
    totalRealized: realized.toFixed(2),
    totalUnrealized: unrealized.toFixed(2),
    totalPnl: realized.add(unrealized).toFixed(2),
    trade: tradeStats(world.closedTrades),
    drawdown: drawdown(world.equityCurve),
    byInstrument: breakdownBy(world.closedTrades, (t) => t.symbol),
    byAssetClass: breakdownBy(world.closedTrades, (t) => t.assetClass),
    options: {
      avgEntryIv: os.ivCount > 0 ? os.ivSum / os.ivCount : 0,
      thetaCapturedOrPaid: os.thetaPaid.toFixed(2),
      assignments: os.assignments,
      exercised: os.exercised,
      expiredWorthless: os.expiredWorthless,
    },
    turnover: avgEquity.isPos() ? world.tradedNotional.div(avgEquity).toNumber() : 0,
    equityCurve: world.equityCurve.map((p) => ({ t: p.t, equity: p.equity })),
  };
}
