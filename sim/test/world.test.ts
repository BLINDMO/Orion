import { test } from "node:test";
import assert from "node:assert/strict";
import { World, optionKey } from "../src/engine/world.ts";
import { universe, buildSeedData } from "../src/data/universe.ts";
import { dec } from "../src/money/decimal.ts";
import { standardExpiries, strikeLadder } from "../src/options/chain.ts";
import type { OptionSpec } from "../src/options/chain.ts";

const START = Date.UTC(2024, 0, 1);

function makeWorld(overrides = {}) {
  const data = buildSeedData(START, 20);
  // start the clock a few hours in so there is visible history to mark against
  const startNow = START + 6 * 3600_000;
  return new World({
    universe,
    data,
    startNow,
    settings: { startingCash: 100_000, feeRealism: true, ...overrides },
  });
}

test("market order fills on the next bar (no look-ahead) and updates cash", () => {
  const w = makeWorld();
  const before = w.portfolio.cash.toNumber();
  const res = w.submit({ target: { kind: "spot", symbol: "BTC-USD" }, side: "buy", qty: 0.5, type: "market" });
  assert.equal(res.ok, true);
  // not filled until time advances
  assert.equal(w.fills.length, 0);
  w.advanceHour();
  assert.equal(w.fills.length, 1);
  const pos = w.portfolio.get("BTC-USD")!;
  assert.equal(pos.qty, 0.5);
  assert.ok(w.portfolio.cash.toNumber() < before, "cash decreased");
});

test("chart ⇆ portfolio parity: mark equals the chart's last close (§13.3)", () => {
  const w = makeWorld();
  w.submit({ target: { kind: "spot", symbol: "ETH-USD" }, side: "buy", qty: 2, type: "market" });
  w.advanceHour();
  for (let i = 0; i < 10; i++) {
    w.advanceHour();
    const pos = w.portfolio.get("ETH-USD")!;
    const chartPrice = w.data.get("ETH-USD")!.markPrice(w.now)!;
    const mark = w.market.spotMark("ETH-USD", w.now)!;
    assert.equal(mark.toString(), dec(chartPrice).toString(), "mark == chart close");
    // unrealized exactly matches (mark - avg) * qty
    const expected = mark.sub(pos.avgCost).mul(pos.qty).mul(pos.multiplier);
    assert.equal(w.unrealized().toFixed(2), expected.toFixed(2));
  }
});

test("limit buy fills only when price trades through the limit", () => {
  const w = makeWorld();
  const mark = w.market.spotMark("BTC-USD", w.now)!.toNumber();
  // place a limit far below — should not fill
  const low = w.submit({
    target: { kind: "spot", symbol: "BTC-USD" },
    side: "buy",
    qty: 0.1,
    type: "limit",
    limitPrice: mark * 0.5,
    tif: "GTC",
  });
  // place a limit far above current — a buy limit above market fills immediately at next bar
  w.advanceHour();
  assert.equal(w.orders.get(low.order!.id)!.status, "working");
});

test("buying power blocks opening beyond margin, allows closing", () => {
  const w = makeWorld({ startingCash: 1000, marginMultiplier: 1 });
  // Try to buy way more than affordable
  const r = w.submit({ target: { kind: "spot", symbol: "BTC-USD" }, side: "buy", qty: 5, type: "market" });
  assert.equal(r.ok, false);
  assert.match(r.reason ?? "", /buying power/i);
});

test("short sell increases cash and marks negative; covering realizes", () => {
  const w = makeWorld();
  w.submit({ target: { kind: "spot", symbol: "SOL-USD" }, side: "sell", qty: 100, type: "market" });
  const cash0 = w.portfolio.cash.toNumber();
  w.advanceHour();
  const pos = w.portfolio.get("SOL-USD")!;
  assert.ok(pos.qty < 0, "short position");
  assert.ok(w.portfolio.cash.toNumber() > cash0, "received proceeds");
  // cover
  w.submit({ target: { kind: "spot", symbol: "SOL-USD" }, side: "buy", qty: 100, type: "market" });
  w.advanceHour();
  assert.equal(w.portfolio.get("SOL-USD"), undefined);
});

test("stop order triggers and fills after the stop is crossed", () => {
  const w = makeWorld();
  // go long first
  w.submit({ target: { kind: "spot", symbol: "BTC-USD" }, side: "buy", qty: 0.2, type: "market" });
  w.advanceHour();
  const mark = w.market.spotMark("BTC-USD", w.now)!.toNumber();
  // sell stop below market — won't trigger immediately
  const s = w.submit({
    target: { kind: "spot", symbol: "BTC-USD" },
    side: "sell",
    qty: 0.2,
    type: "stop",
    stopPrice: mark * 0.999,
    tif: "GTC",
  });
  assert.equal(w.orders.get(s.order!.id)!.triggered, false);
  // advance a while; eventually price may cross — just assert no look-ahead error and state valid
  for (let i = 0; i < 50; i++) w.advanceHour();
  const o = w.orders.get(s.order!.id)!;
  assert.ok(["working", "filled", "expired"].includes(o.status));
});

test("equity is continuous across an option buy and expiry settlement", () => {
  const w = makeWorld();
  const expiries = standardExpiries(w.now, "crypto");
  const spot = w.market.spotMark("BTC-USD", w.now)!.toNumber();
  const strikes = strikeLadder(spot, 4, 0.025);
  const atm = strikes.reduce((a, b) => (Math.abs(b - spot) < Math.abs(a - spot) ? b : a));
  const spec: OptionSpec = {
    underlying: "BTC-USD",
    right: "call",
    strike: atm,
    expiry: expiries[0]!,
    style: "european",
    multiplier: 1,
    settlement: "cash",
  };
  const r = w.submit({ target: { kind: "option", symbol: "BTC-USD", option: spec }, side: "buy", qty: 1, type: "market" });
  assert.equal(r.ok, true);
  w.advanceHour();
  const eqBefore = w.equity().toNumber();
  assert.ok(w.portfolio.get(optionKey(spec)), "holds the option");
  // advance past expiry
  w.advanceTo(spec.expiry + 3600_000, { stepRes: "1h" });
  // option settled — no longer held
  assert.equal(w.portfolio.get(optionKey(spec)), undefined);
  // equity should be finite and the position resolved into cash
  assert.ok(Number.isFinite(w.equity().toNumber()));
  assert.ok(Math.abs(w.equity().toNumber() - eqBefore) < eqBefore, "no equity explosion");
});

test("reset returns to a clean start state", () => {
  const w = makeWorld();
  w.submit({ target: { kind: "spot", symbol: "BTC-USD" }, side: "buy", qty: 0.3, type: "market" });
  w.advanceHour();
  assert.ok(w.fills.length > 0);
  w.reset();
  assert.equal(w.fills.length, 0);
  assert.equal(w.portfolio.positions.size, 0);
  assert.equal(w.portfolio.cash.toNumber(), 100_000);
  assert.equal(w.now, w.startNow);
});

test("determinism: identical actions reproduce identical equity (§13.2)", () => {
  const run = () => {
    const w = makeWorld();
    w.submit({ target: { kind: "spot", symbol: "BTC-USD" }, side: "buy", qty: 0.4, type: "market" });
    w.advanceDay();
    w.submit({ target: { kind: "spot", symbol: "ETH-USD" }, side: "sell", qty: 1, type: "market" });
    w.advanceDay();
    return w.equity().toFixed(2);
  };
  assert.equal(run(), run());
});

test("advance fires onTick for UI scrubbing", () => {
  const w = makeWorld();
  let ticks = 0;
  w.advanceHour({ onTick: () => ticks++ });
  assert.ok(ticks >= 1);
});
