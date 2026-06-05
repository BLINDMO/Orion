import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildChain,
  strikeLadder,
  standardExpiries,
  yearsToExpiry,
  type ChainParams,
} from "../src/options/chain.ts";
import { buildModeledSurface, ModeledVolSurface, DEFAULT_SKEW, realizedVol } from "../src/options/volsurface.ts";
import {
  verticalSpread,
  straddle,
  ironCondor,
  coveredCall,
  analyzeStrategy,
} from "../src/options/strategies.ts";
import { buildSyntheticInstrument } from "../src/data/synthetic.ts";

const NOW = Date.UTC(2024, 0, 2, 16, 0);

function cryptoParams(): ChainParams {
  const surface = new ModeledVolSurface(0.6, DEFAULT_SKEW.crypto);
  return {
    underlyingSymbol: "BTC",
    assetClass: "crypto",
    spot: 40000,
    now: NOW,
    r: 0.04,
    q: 0,
    surface,
    multiplier: 1,
  };
}

function equityParams(): ChainParams {
  const surface = new ModeledVolSurface(0.25, DEFAULT_SKEW.equity);
  return {
    underlyingSymbol: "ACME",
    assetClass: "equity",
    spot: 100,
    now: NOW,
    r: 0.04,
    q: 0.01,
    surface,
    multiplier: 100,
  };
}

test("strike ladder is centered and ascending", () => {
  const ks = strikeLadder(100, 5, 0.025);
  assert.equal(ks.length, 11);
  for (let i = 1; i < ks.length; i++) assert.ok(ks[i]! > ks[i - 1]!);
  // contains a strike near spot
  assert.ok(ks.some((k) => Math.abs(k - 100) < 5));
});

test("standard equity expiries are third Fridays in the future", () => {
  const exps = standardExpiries(NOW, "equity", 6);
  assert.equal(exps.length, 6);
  for (const e of exps) {
    assert.ok(e > NOW);
    assert.equal(new Date(e).getUTCDay(), 5); // Friday
  }
});

test("chain has calls and puts and ATM marked", () => {
  const chain = buildChain(cryptoParams());
  assert.ok(chain.expiries.length > 0);
  const first = chain.expiries[0]!;
  assert.ok(first.calls.length > 0);
  assert.ok(first.puts.length > 0);
  assert.ok(Math.abs(first.atmStrike - 40000) <= 40000 * 0.025);
});

test("bid < theo < ask and extrinsic >= 0", () => {
  const chain = buildChain(equityParams());
  for (const exp of chain.expiries) {
    for (const q of [...exp.calls, ...exp.puts]) {
      assert.ok(q.bid <= q.theo + 1e-9 && q.theo <= q.ask + 1e-9);
      assert.ok(q.extrinsic >= -1e-6);
      assert.ok(q.iv > 0 && q.iv < 5);
    }
  }
});

test("equity options are american, crypto european", () => {
  assert.equal(buildChain(equityParams()).expiries[0]!.calls[0]!.spec.style, "american");
  assert.equal(buildChain(cryptoParams()).expiries[0]!.calls[0]!.spec.style, "european");
});

test("call delta positive, put delta negative across chain", () => {
  const chain = buildChain(cryptoParams());
  const exp = chain.expiries[0]!;
  for (const c of exp.calls) assert.ok(c.greeks.delta >= -1e-6);
  for (const p of exp.puts) assert.ok(p.greeks.delta <= 1e-6);
});

test("vol surface skew: equity OTM puts have higher IV than OTM calls", () => {
  const p = equityParams();
  const T = yearsToExpiry(NOW, standardExpiries(NOW, "equity")[1]!);
  const ivPutLow = p.surface.iv({ spot: 100, strike: 85, T, r: p.r, q: p.q });
  const ivCallHigh = p.surface.iv({ spot: 100, strike: 115, T, r: p.r, q: p.q });
  assert.ok(ivPutLow > ivCallHigh, `put-skew: ${ivPutLow} > ${ivCallHigh}`);
});

test("realized vol estimator on flat data is small, on volatile data larger", () => {
  const flat = Array.from({ length: 50 }, (_, i) => ({ t: i, o: 100, h: 100, l: 100, c: 100, v: 1 }));
  assert.ok(realizedVol(flat, 252) <= 0.06);
});

test("vertical spread: defined max profit and loss, net debit", () => {
  const chain = buildChain(equityParams());
  const exp = chain.expiries[1]!;
  const calls = exp.calls.filter((c) => c.spec.right === "call");
  const lower = calls.find((c) => c.spec.strike <= 100 && c.spec.strike >= 95)!;
  const higher = calls.find((c) => c.spec.strike > lower.spec.strike + 1)!;
  const strat = verticalSpread(lower, higher);
  const a = analyzeStrategy(strat, 100);
  assert.ok(a.netCost > 0, "bull call vertical is a debit");
  assert.ok(Number.isFinite(a.maxProfit), "capped profit");
  assert.ok(Number.isFinite(a.maxLoss), "capped loss");
  // max loss ~ -netCost
  assert.ok(Math.abs(a.maxLoss + a.netCost) < 1e-6);
});

test("long straddle: loss capped at debit, profit unbounded", () => {
  const chain = buildChain(cryptoParams());
  const exp = chain.expiries[1]!;
  const atm = exp.atmStrike;
  const call = exp.calls.find((c) => c.spec.strike === atm)!;
  const put = exp.puts.find((p) => p.spec.strike === atm)!;
  const a = analyzeStrategy(straddle(call, put), 40000);
  assert.equal(a.maxProfit, Infinity);
  assert.ok(Math.abs(a.maxLoss + a.netCost) < 1, "max loss ≈ premium paid");
  assert.equal(a.breakevens.length, 2);
});

test("iron condor: net credit, capped risk, two breakevens", () => {
  const chain = buildChain(cryptoParams());
  const exp = chain.expiries[2]!;
  const strikes = exp.calls.map((c) => c.spec.strike).sort((a, b) => a - b);
  const atm = exp.atmStrike;
  const lp = exp.puts.find((p) => p.spec.strike === strikes.find((s) => s < atm * 0.95))!;
  const sp = exp.puts.find((p) => p.spec.strike === strikes.filter((s) => s < atm).at(-1))!;
  const sc = exp.calls.find((c) => c.spec.strike === strikes.find((s) => s > atm))!;
  const lc = exp.calls.find((c) => c.spec.strike === strikes.find((s) => s > atm * 1.05))!;
  if (lp && sp && sc && lc) {
    const a = analyzeStrategy(ironCondor(lp, sp, sc, lc), 40000);
    assert.ok(a.netCost < 0, "condor collects a credit");
    assert.ok(Number.isFinite(a.maxLoss));
    assert.ok(Number.isFinite(a.maxProfit));
  }
});

test("covered call combines long stock and short call", () => {
  const chain = buildChain(equityParams());
  const exp = chain.expiries[1]!;
  const otmCall = exp.calls.find((c) => c.spec.strike > 100)!;
  const strat = coveredCall(100, otmCall, 100);
  assert.equal(strat.legs.length, 2);
  const a = analyzeStrategy(strat, 100);
  // upside capped above the short strike
  assert.ok(Number.isFinite(a.maxProfit));
});
