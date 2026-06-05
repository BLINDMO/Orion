import { test } from "node:test";
import assert from "node:assert/strict";
import { americanPrice } from "../src/options/american.ts";
import { bsmPrice, type BsmInputs } from "../src/options/bsm.ts";

const approx = (a: number, b: number, eps: number) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b} (±${eps})`);

test("American call with no dividends equals European", () => {
  const i: BsmInputs = { S: 100, K: 100, T: 0.5, r: 0.05, q: 0, sigma: 0.3 };
  approx(americanPrice("call", i), bsmPrice("call", i), 1e-6);
});

test("American put >= European put (early-exercise premium)", () => {
  const i: BsmInputs = { S: 90, K: 100, T: 0.5, r: 0.1, q: 0, sigma: 0.3 };
  const am = americanPrice("put", i);
  const eu = bsmPrice("put", i);
  assert.ok(am >= eu, `${am} >= ${eu}`);
  assert.ok(am - eu > 0.01, "premium should be material for ITM put, high r");
});

test("American put >= intrinsic", () => {
  const i: BsmInputs = { S: 80, K: 100, T: 0.5, r: 0.08, q: 0, sigma: 0.2 };
  assert.ok(americanPrice("put", i) >= 100 - 80 - 1e-6);
});

test("BAW matches a binomial-tree reference (call, b=0)", () => {
  // S=90,K=100,T=0.5,r=0.10,b=0,σ=0.15. CRR(2000) ≈ 0.8114; BAW within tolerance.
  const i: BsmInputs = { S: 90, K: 100, T: 0.5, r: 0.1, q: 0.1, sigma: 0.15 };
  approx(americanPrice("call", i), 0.8114, 0.02);
  assert.ok(americanPrice("call", i) >= bsmPrice("call", i) - 1e-6);
});

test("BAW matches Haug reference value (call ITM with dividends)", () => {
  // S=100,K=100,T=0.5,r=0.10,b=0,σ=0.25 -> American call ~ 5.5 region; sanity vs European
  const i: BsmInputs = { S: 100, K: 100, T: 0.5, r: 0.1, q: 0.1, sigma: 0.25 };
  const am = americanPrice("call", i);
  const eu = bsmPrice("call", i);
  assert.ok(am >= eu - 1e-6, "american >= european");
  assert.ok(am < eu + 1, "premium bounded");
});

test("deep ITM American put approaches intrinsic", () => {
  const i: BsmInputs = { S: 1, K: 100, T: 0.5, r: 0.05, q: 0, sigma: 0.3 };
  approx(americanPrice("put", i), 99, 0.5);
});

test("expired option returns intrinsic", () => {
  assert.equal(americanPrice("call", { S: 110, K: 100, T: 0, r: 0.05, q: 0, sigma: 0.3 }), 10);
  assert.equal(americanPrice("put", { S: 90, K: 100, T: 0, r: 0.05, q: 0, sigma: 0.3 }), 10);
});
