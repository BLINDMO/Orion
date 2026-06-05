import { test } from "node:test";
import assert from "node:assert/strict";
import { bsmPrice, bsmGreeks, impliedVol, normCdf, type BsmInputs, type OptionRight } from "../src/options/bsm.ts";

const approx = (a: number, b: number, eps = 1e-3) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b} (±${eps})`);

test("normCdf known values", () => {
  approx(normCdf(0), 0.5, 1e-9);
  approx(normCdf(1.96), 0.975, 1e-4);
  approx(normCdf(-1.96), 0.025, 1e-4);
  approx(normCdf(3), 0.99865, 1e-4);
});

test("BSM call/put match textbook values (S=K=100,T=1,r=5%,σ=20%)", () => {
  const i: BsmInputs = { S: 100, K: 100, T: 1, r: 0.05, q: 0, sigma: 0.2 };
  approx(bsmPrice("call", i), 10.4506, 1e-3);
  approx(bsmPrice("put", i), 5.5735, 1e-3);
});

test("put-call parity holds: C - P = S e^-qT - K e^-rT", () => {
  const i: BsmInputs = { S: 120, K: 110, T: 0.75, r: 0.03, q: 0.01, sigma: 0.35 };
  const c = bsmPrice("call", i);
  const p = bsmPrice("put", i);
  const lhs = c - p;
  const rhs = i.S * Math.exp(-i.q * i.T) - i.K * Math.exp(-i.r * i.T);
  approx(lhs, rhs, 1e-6);
});

test("price decreases to intrinsic as T -> 0", () => {
  const base = { S: 105, K: 100, r: 0.05, q: 0, sigma: 0.3 };
  approx(bsmPrice("call", { ...base, T: 1e-9 }), 5, 1e-3);
  approx(bsmPrice("put", { ...base, T: 1e-9 }), 0, 1e-3);
});

// Finite-difference Greek checks (§13.7)
function fdGreeks(right: OptionRight, i: BsmInputs) {
  const hS = i.S * 1e-4;
  const hSig = 1e-5;
  const hT = 1e-5;
  const hR = 1e-6;
  const p = (x: BsmInputs) => bsmPrice(right, x);
  const delta = (p({ ...i, S: i.S + hS }) - p({ ...i, S: i.S - hS })) / (2 * hS);
  const gamma = (p({ ...i, S: i.S + hS }) - 2 * p(i) + p({ ...i, S: i.S - hS })) / (hS * hS);
  const vega = (p({ ...i, sigma: i.sigma + hSig }) - p({ ...i, sigma: i.sigma - hSig })) / (2 * hSig);
  // theta per year: price change as T decreases -> dP/dT then negate
  const dPdT = (p({ ...i, T: i.T + hT }) - p({ ...i, T: i.T - hT })) / (2 * hT);
  const theta = -dPdT;
  const rho = (p({ ...i, r: i.r + hR }) - p({ ...i, r: i.r - hR })) / (2 * hR);
  return { delta, gamma, vega, theta, rho };
}

test("analytic Greeks match finite differences (call)", () => {
  const i: BsmInputs = { S: 100, K: 95, T: 0.5, r: 0.04, q: 0.02, sigma: 0.4 };
  const g = bsmGreeks("call", i);
  const fd = fdGreeks("call", i);
  approx(g.delta, fd.delta, 1e-4);
  approx(g.gamma, fd.gamma, 1e-3);
  approx(g.vega, fd.vega, 1e-2);
  approx(g.theta, fd.theta, 1e-2);
  approx(g.rho, fd.rho, 1e-2);
});

test("analytic Greeks match finite differences (put)", () => {
  const i: BsmInputs = { S: 90, K: 100, T: 0.3, r: 0.05, q: 0, sigma: 0.6 };
  const g = bsmGreeks("put", i);
  const fd = fdGreeks("put", i);
  approx(g.delta, fd.delta, 1e-4);
  approx(g.gamma, fd.gamma, 1e-3);
  approx(g.vega, fd.vega, 1e-2);
  approx(g.theta, fd.theta, 1e-2);
  approx(g.rho, fd.rho, 1e-2);
});

test("call delta in [0,1], put delta in [-1,0]", () => {
  const i: BsmInputs = { S: 100, K: 100, T: 1, r: 0.05, q: 0, sigma: 0.25 };
  const c = bsmGreeks("call", i);
  const p = bsmGreeks("put", i);
  assert.ok(c.delta > 0 && c.delta < 1);
  assert.ok(p.delta < 0 && p.delta > -1);
  approx(c.delta - p.delta, 1, 1e-9); // e^-qT (q=0) => 1
});

test("implied vol recovers the input vol", () => {
  const i: BsmInputs = { S: 100, K: 110, T: 0.5, r: 0.03, q: 0.01, sigma: 0.45 };
  const price = bsmPrice("call", i);
  const iv = impliedVol("call", price, { S: i.S, K: i.K, T: i.T, r: i.r, q: i.q });
  approx(iv!, 0.45, 1e-4);
});

test("implied vol recovers across a range of strikes", () => {
  for (const K of [80, 90, 100, 110, 120]) {
    for (const sig of [0.15, 0.3, 0.8]) {
      const i: BsmInputs = { S: 100, K, T: 0.4, r: 0.02, q: 0, sigma: sig };
      for (const right of ["call", "put"] as const) {
        const price = bsmPrice(right, i);
        const iv = impliedVol(right, price, { S: i.S, K, T: i.T, r: i.r, q: i.q });
        approx(iv!, sig, 1e-3);
      }
    }
  }
});

test("implied vol returns undefined below intrinsic", () => {
  const iv = impliedVol("call", 0.5, { S: 100, K: 90, T: 0.5, r: 0, q: 0 });
  assert.equal(iv, undefined);
});
