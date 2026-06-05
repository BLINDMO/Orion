/**
 * End-to-end engine demo. Run: `node --experimental-strip-types examples/demo.ts`
 *
 * Exercises the full ORION core: create a world on seed data, place spot and
 * option orders, advance the global clock (with bar-by-bar event processing),
 * run the Terminal scanner, and print the analytics report — proving the engine
 * works as an integrated whole, UI-free.
 */

import { createDemoWorld } from "../src/index.ts";
import { analytics } from "../src/engine/stats.ts";
import { scan } from "../src/terminal/scanner.ts";
import { buildChain, standardExpiries } from "../src/options/chain.ts";

const w = createDemoWorld({ settings: { startingCash: 100_000 } });
const t = () => new Date(w.now).toISOString().slice(0, 16).replace("T", " ");

console.log(`\nORION engine demo — start ${t()}  equity $${w.equity().toFixed(2)}\n`);

// 1) Buy spot BTC (fills on next bar, no look-ahead).
w.submit({ target: { kind: "spot", symbol: "BTC-USD" }, side: "buy", qty: 0.5, type: "market" });
w.advanceHour();
console.log(`Bought 0.5 BTC-USD @ ${w.fills.at(-1)!.price.toFixed(2)}  cash $${w.portfolio.cash.toFixed(2)}`);

// 2) Resting limit + protective trailing stop.
const mark = w.market.spotMark("BTC-USD", w.now)!.toNumber();
w.submit({ target: { kind: "spot", symbol: "ETH-USD" }, side: "buy", qty: 3, type: "limit", limitPrice: 99999999, tif: "GTC" });
w.submit({ target: { kind: "spot", symbol: "BTC-USD" }, side: "sell", qty: 0.5, type: "trailing-stop", trailPercent: 0.05, tif: "GTC" });

// 3) Buy an at-the-money BTC call from the live chain.
const chain = buildChain({
  underlyingSymbol: "BTC-USD",
  assetClass: "crypto",
  spot: mark,
  now: w.now,
  r: w.settings.riskFreeRate,
  q: 0,
  surface: w.market.volSurface("BTC-USD", w.now),
  multiplier: 1,
  expiries: standardExpiries(w.now, "crypto"),
});
const exp = chain.expiries[1]!;
const atmCall = exp.calls.find((c) => c.spec.strike === exp.atmStrike)!;
console.log(`ATM call ${exp.atmStrike} exp ${new Date(exp.expiry).toISOString().slice(0, 10)}  ask ${atmCall.ask.toFixed(2)}  Δ${atmCall.greeks.delta.toFixed(2)} Θ/day ${atmCall.greeks.thetaPerDay.toFixed(2)} IV ${(atmCall.iv * 100).toFixed(0)}%`);
w.submit({ target: { kind: "option", symbol: "BTC-USD", option: atmCall.spec }, side: "buy", qty: 2, type: "market" });
w.advanceHour();

// 4) Advance a month — theta decay, expiries, triggers all resolve along the way.
console.log(`\nAdvancing +30 days from ${t()} ...`);
w.advanceMonth();
console.log(`Now ${t()}  equity $${w.equity().toFixed(2)}  positions ${w.portfolio.positions.size}  fills ${w.fills.length}`);

// 5) Terminal scan.
const s = scan(w, "BTC-USD", "1h");
console.log(`\nTerminal — BTC-USD ${s.timeframe}: trend=${s.trend} momentum=${s.momentum} vol=${s.volatility}`);
for (const c of s.callouts.slice(0, 3)) console.log(`  • ${c.title}`);

// 6) Analytics.
const r = analytics(w);
console.log(`\nAnalytics @ ${t()}`);
console.log(`  Equity        $${r.equity}`);
console.log(`  Total P&L     $${r.totalPnl}  (realized $${r.totalRealized}, unrealized $${r.totalUnrealized})`);
console.log(`  Trades        ${r.trade.trades}  win-rate ${(r.trade.winRate * 100).toFixed(0)}%  PF ${r.trade.profitFactor.toFixed(2)}  expectancy $${r.trade.expectancy}`);
console.log(`  Max drawdown  $${r.drawdown.maxDrawdown} (${(r.drawdown.maxDrawdownPct * 100).toFixed(1)}%)`);
console.log(`  Options       entryIV ${(r.options.avgEntryIv * 100).toFixed(0)}%  theta ${r.options.thetaCapturedOrPaid}  exercised ${r.options.exercised}  expired ${r.options.expiredWorthless}`);
console.log(`  Turnover      ${r.turnover.toFixed(2)}x\n`);
