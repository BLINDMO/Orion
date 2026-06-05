import { test } from "node:test";
import assert from "node:assert/strict";
import { BarSeries, InstrumentData, LookaheadError, setLookaheadGuard } from "../src/data/series.ts";
import type { Bar } from "../src/data/types.ts";
import { buildSyntheticInstrument, generateMinuteBars } from "../src/data/synthetic.ts";

const MIN = 60_000;
function mkBars(n: number, start = 0): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < n; i++) {
    out.push({ t: start + i * MIN, o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i, v: 10 });
  }
  return out;
}

test("visible only includes fully-closed bars", () => {
  const s = new BarSeries("1m", mkBars(5));
  // now exactly at close of bar 0 (t=0 closes at 60_000)
  assert.equal(s.visible(MIN).length, 1);
  // now mid bar 0 -> nothing closed
  assert.equal(s.visible(MIN - 1).length, 0);
  // now at close of bar 2
  assert.equal(s.visible(3 * MIN).length, 3);
});

test("lastClosed returns the right bar and never the future", () => {
  const s = new BarSeries("1m", mkBars(5));
  assert.equal(s.lastClosed(2.5 * MIN)?.t, MIN); // bar 1 closed at 2*MIN
  assert.equal(s.lastClosed(0), undefined);
});

test("atGuarded throws on look-ahead", () => {
  const s = new BarSeries("1m", mkBars(5));
  // bar index 3 opens at 3*MIN, closes at 4*MIN. now=2*MIN -> future -> throw
  assert.throws(() => s.atGuarded(3, 2 * MIN), LookaheadError);
  // same bar, now after its close -> ok
  assert.doesNotThrow(() => s.atGuarded(3, 4 * MIN));
});

test("guard can be disabled", () => {
  const s = new BarSeries("1m", mkBars(5));
  setLookaheadGuard(false);
  assert.doesNotThrow(() => s.atGuarded(4, 0));
  setLookaheadGuard(true);
});

test("nextBarAfter streams forward", () => {
  const s = new BarSeries("1m", mkBars(5));
  assert.equal(s.nextBarAfter(0)?.t, MIN);
  assert.equal(s.nextBarAfter(MIN)?.t, 2 * MIN);
  assert.equal(s.nextBarAfter(4 * MIN), undefined);
});

test("series dedupes and sorts", () => {
  const s = new BarSeries("1m", [
    { t: 2 * MIN, o: 1, h: 1, l: 1, c: 1, v: 1 },
    { t: 0, o: 1, h: 1, l: 1, c: 1, v: 1 },
    { t: 0, o: 9, h: 9, l: 9, c: 9, v: 9 }, // dup, later wins
  ]);
  assert.equal(s.length, 2);
  assert.equal(s.rawAll()[0]!.o, 9);
});

test("synthetic generator is deterministic for a seed", () => {
  const spec = {
    symbol: "TST",
    seed: 42,
    startPrice: 100,
    driftAnnual: 0.05,
    volAnnual: 0.5,
    calendar: "24x7" as const,
    minutes: 200,
    start: Date.UTC(2023, 0, 1),
    baseVolume: 1000,
    tickSize: 0.01,
  };
  const a = generateMinuteBars(spec);
  const b = generateMinuteBars(spec);
  assert.equal(a.length, 200);
  assert.deepEqual(a, b);
});

test("OHLC invariants hold on synthetic data", () => {
  const inst = buildSyntheticInstrument({
    symbol: "TST",
    seed: 7,
    startPrice: 50,
    driftAnnual: 0.0,
    volAnnual: 0.8,
    calendar: "24x7",
    minutes: 500,
    start: Date.UTC(2023, 0, 1),
    baseVolume: 500,
    tickSize: 0.01,
  });
  for (const b of inst.get("1m").rawAll()) {
    assert.ok(b.h >= b.o - 1e-9 && b.h >= b.c - 1e-9, "high >= open,close");
    assert.ok(b.l <= b.o + 1e-9 && b.l <= b.c + 1e-9, "low <= open,close");
    assert.ok(b.h >= b.l, "high >= low");
    assert.ok(b.v >= 0, "volume >= 0");
    assert.ok(b.l > 0, "price positive");
  }
});

test("aggregation rolls 1m into 1h correctly", () => {
  const inst = buildSyntheticInstrument({
    symbol: "TST",
    seed: 3,
    startPrice: 100,
    driftAnnual: 0,
    volAnnual: 0.4,
    calendar: "24x7",
    minutes: 180, // 3 hours
    start: Date.UTC(2023, 0, 1),
    baseVolume: 100,
    tickSize: 0.01,
  });
  const h = inst.get("1h");
  assert.equal(h.length, 3);
  // first hourly open == first minute open
  assert.equal(h.rawAll()[0]!.o, inst.get("1m").rawAll()[0]!.o);
});

test("markPrice uses finest resolution and never looks ahead", () => {
  const inst = buildSyntheticInstrument({
    symbol: "TST",
    seed: 11,
    startPrice: 100,
    driftAnnual: 0,
    volAnnual: 0.3,
    calendar: "24x7",
    minutes: 120,
    start: Date.UTC(2023, 0, 1),
    baseVolume: 100,
    tickSize: 0.01,
  });
  const start = Date.UTC(2023, 0, 1);
  // at start, nothing closed yet
  assert.equal(inst.markPrice(start), undefined);
  // after first minute closes, mark = first bar close
  assert.equal(inst.markPrice(start + MIN), inst.get("1m").rawAll()[0]!.c);
});
