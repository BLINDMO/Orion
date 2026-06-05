import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sma,
  ema,
  vwap,
  bollinger,
  rsi,
  macd,
  atr,
  obv,
  stochastic,
  supportResistance,
  lastDefined,
} from "../src/indicators/index.ts";
import type { Bar } from "../src/data/types.ts";

function bar(o: number, h: number, l: number, c: number, v = 100, t = 0): Bar {
  return { t, o, h, l, c, v };
}

test("sma basic", () => {
  const s = sma([1, 2, 3, 4, 5], 3);
  assert.deepEqual(s, [undefined, undefined, 2, 3, 4]);
});

test("ema seeds with sma then recurses", () => {
  const e = ema([1, 2, 3, 4, 5], 3);
  assert.equal(e[0], undefined);
  assert.equal(e[1], undefined);
  assert.equal(e[2], 2); // sma seed (1+2+3)/3
  // k = 2/4 = 0.5; e3 = 4*0.5 + 2*0.5 = 3
  assert.equal(e[3], 3);
  // e4 = 5*0.5 + 3*0.5 = 4
  assert.equal(e[4], 4);
});

test("rsi of a pure uptrend is 100", () => {
  const vals = Array.from({ length: 30 }, (_, i) => 100 + i);
  const r = rsi(vals, 14);
  assert.equal(lastDefined(r), 100);
});

test("rsi mid-range for choppy data is between 0 and 100", () => {
  const vals = [44, 44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84,
    46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
  const r = rsi(vals, 14);
  const v = lastDefined(r)!;
  assert.ok(v > 50 && v < 100, `rsi=${v}`);
});

test("vwap weights by volume", () => {
  const bars = [bar(10, 10, 10, 10, 100), bar(20, 20, 20, 20, 300)];
  const v = vwap(bars);
  // typical prices = 10 and 20; weighted = (10*100 + 20*300)/400 = 17.5
  assert.equal(v[1], 17.5);
});

test("bollinger bands center on sma and widen with vol", () => {
  const vals = Array.from({ length: 25 }, (_, i) => 100 + Math.sin(i) * 5);
  const bb = bollinger(vals, 20, 2);
  const i = 24;
  assert.ok(bb.middle[i] !== undefined);
  assert.ok(bb.upper[i]! > bb.middle[i]!);
  assert.ok(bb.lower[i]! < bb.middle[i]!);
  assert.ok(bb.percentB[i]! >= 0 - 1e-9);
});

test("macd histogram = macd - signal", () => {
  const vals = Array.from({ length: 60 }, (_, i) => 100 + i * 0.5 + Math.sin(i) * 2);
  const m = macd(vals);
  for (let i = 0; i < vals.length; i++) {
    if (m.macd[i] !== undefined && m.signal[i] !== undefined) {
      assert.ok(Math.abs(m.histogram[i]! - (m.macd[i]! - m.signal[i]!)) < 1e-9);
    }
  }
});

test("atr is positive and reacts to range", () => {
  const bars = Array.from({ length: 30 }, (_, i) => bar(100, 102, 98, 100 + (i % 3), 100, i));
  const a = atr(bars, 14);
  assert.ok(lastDefined(a)! > 0);
});

test("obv accumulates with direction", () => {
  const bars = [bar(10, 10, 10, 10, 100), bar(10, 11, 10, 11, 50), bar(11, 11, 9, 9, 80)];
  const o = obv(bars);
  assert.deepEqual(o, [0, 50, -30]);
});

test("stochastic stays within 0..100", () => {
  const bars = Array.from({ length: 40 }, (_, i) => bar(100, 100 + (i % 5), 95 + (i % 3), 97 + (i % 4), 100, i));
  const s = stochastic(bars);
  const k = lastDefined(s.k)!;
  const d = lastDefined(s.d)!;
  assert.ok(k >= 0 && k <= 100);
  assert.ok(d >= 0 && d <= 100);
});

test("support/resistance finds clustered pivots", () => {
  // Construct data with an obvious resistance near 110 and support near 90.
  const seq = [100, 110, 100, 90, 100, 110, 100, 90, 100, 110, 100, 90, 100];
  const bars = seq.map((c, i) => bar(c, c + 1, c - 1, c, 100, i));
  const levels = supportResistance(bars, 1, 0.02, 6);
  assert.ok(levels.length > 0);
  assert.ok(levels.some((l) => Math.abs(l.price - 111) < 3 && l.kind === "resistance") ||
    levels.some((l) => Math.abs(l.price - 89) < 3 && l.kind === "support"));
});
