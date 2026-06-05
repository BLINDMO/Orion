import { test } from "node:test";
import assert from "node:assert/strict";
import { Portfolio, bookFill } from "../src/engine/portfolio.ts";
import { Dec, dec } from "../src/money/decimal.ts";
import type { OrderTarget, Position } from "../src/engine/types.ts";

const target: OrderTarget = { kind: "spot", symbol: "X" };
const KEY = "X";

function fill(pf: Portfolio, side: "buy" | "sell", qty: number, price: string, mult = 1) {
  const r = bookFill(pf.get(KEY), target, KEY, side, qty, dec(price), mult, 0);
  pf.apply(r, KEY);
  return r;
}

test("buy then mark: cash and unrealized update 1:1", () => {
  const pf = new Portfolio(dec("10000"));
  fill(pf, "buy", 10, "100");
  assert.equal(pf.cash.toString(), "9000");
  const pos = pf.get(KEY)!;
  assert.equal(pos.qty, 10);
  assert.equal(pos.avgCost.toString(), "100");
  // mark at 110 -> unrealized 100
  const resolve = () => dec("110");
  assert.equal(pf.unrealized(pos, resolve).toString(), "100");
  assert.equal(pf.equity(resolve).toString(), "10100"); // 9000 cash + 1100 value
});

test("average cost on adds", () => {
  const pf = new Portfolio(dec("100000"));
  fill(pf, "buy", 10, "100"); // avg 100
  fill(pf, "buy", 10, "120"); // avg 110
  assert.equal(pf.get(KEY)!.avgCost.toString(), "110");
  assert.equal(pf.get(KEY)!.qty, 20);
});

test("partial close realizes P&L, basis unchanged", () => {
  const pf = new Portfolio(dec("100000"));
  fill(pf, "buy", 10, "100");
  const r = fill(pf, "sell", 4, "130"); // realize (130-100)*4 = 120
  assert.equal(r.realizedDelta.toString(), "120");
  assert.equal(pf.realizedPnl.toString(), "120");
  assert.equal(pf.get(KEY)!.qty, 6);
  assert.equal(pf.get(KEY)!.avgCost.toString(), "100");
});

test("full close removes position", () => {
  const pf = new Portfolio(dec("100000"));
  fill(pf, "buy", 5, "50");
  fill(pf, "sell", 5, "60"); // realize 50
  assert.equal(pf.get(KEY), undefined);
  assert.equal(pf.realizedPnl.toString(), "50");
});

test("short then cover realizes correctly", () => {
  const pf = new Portfolio(dec("100000"));
  fill(pf, "sell", 10, "100"); // open short, cash +1000
  assert.equal(pf.cash.toString(), "101000");
  assert.equal(pf.get(KEY)!.qty, -10);
  const r = fill(pf, "buy", 10, "90"); // cover: (100-90)*10 = 100 profit
  assert.equal(r.realizedDelta.toString(), "100");
  assert.equal(pf.get(KEY), undefined);
  // cash: 101000 - 900 = 100100 = start + 100 profit
  assert.equal(pf.cash.toString(), "100100");
});

test("flip long to short books realized on the closed portion", () => {
  const pf = new Portfolio(dec("100000"));
  fill(pf, "buy", 10, "100");
  const r = fill(pf, "sell", 15, "120"); // close 10 (+200), open 5 short at 120
  assert.equal(r.realizedDelta.toString(), "200");
  const pos = pf.get(KEY)!;
  assert.equal(pos.qty, -5);
  assert.equal(pos.avgCost.toString(), "120");
});

test("short unrealized is positive when price falls", () => {
  const pf = new Portfolio(dec("100000"));
  fill(pf, "sell", 10, "100");
  const pos = pf.get(KEY)!;
  const resolve = () => dec("90");
  assert.equal(pf.unrealized(pos, resolve).toString(), "100");
});

test("buying power with margin model", () => {
  const pf = new Portfolio(dec("10000"));
  const resolve = () => dec("100");
  // no positions, m=1 -> BP = equity = 10000
  assert.equal(pf.buyingPower(resolve, 1).toString(), "10000");
  fill(pf, "buy", 50, "100"); // $5000 long
  // equity still 10000, gross 5000 -> BP = 10000 - 5000 = 5000
  assert.equal(pf.buyingPower(resolve, 1).toString(), "5000");
  // m=2 -> BP = 20000 - 5000 = 15000
  assert.equal(pf.buyingPower(resolve, 2).toString(), "15000");
});

test("option multiplier scales P&L", () => {
  const pf = new Portfolio(dec("100000"));
  const optTarget: OrderTarget = { kind: "option", symbol: "ACME" };
  const r1 = bookFill(undefined, optTarget, "opt", "buy", 2, dec("3.50"), 100, 0);
  pf.apply(r1, "opt");
  // cost = 3.50 * 2 * 100 = 700
  assert.equal(pf.cash.toString(), "99300");
  const r2 = bookFill(pf.get("opt"), optTarget, "opt", "sell", 2, dec("5.00"), 100, 0);
  pf.apply(r2, "opt");
  // realized = (5 - 3.5) * 2 * 100 = 300
  assert.equal(r2.realizedDelta.toString(), "300");
});
