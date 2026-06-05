import { test } from "node:test";
import assert from "node:assert/strict";
import { Dec, dec, decSum } from "../src/money/decimal.ts";

test("parse and toString round-trip", () => {
  assert.equal(dec("1234.5678").toString(), "1234.5678");
  assert.equal(dec("-0.00000001").toString(), "-0.00000001");
  assert.equal(dec("0").toString(), "0");
  assert.equal(dec(".5").toString(), "0.5");
  assert.equal(dec("100.").toString(), "100");
});

test("from number routes through fixed precision (no float artifacts)", () => {
  // 0.1 + 0.2 must equal 0.3 exactly
  assert.equal(dec(0.1).add(0.2).toString(), "0.3");
  assert.equal(dec(0.1).add(0.2).eq(dec("0.3")), true);
});

test("addition and subtraction", () => {
  assert.equal(dec("1.05").add("2.95").toString(), "4");
  assert.equal(dec("5").sub("7.5").toString(), "-2.5");
});

test("multiplication rounds half-up at SCALE", () => {
  assert.equal(dec("1.5").mul("1.5").toString(), "2.25");
  assert.equal(dec("0.00000001").mul("0.5").toString(), "0.00000001"); // 0.5e-8 -> round half up
  assert.equal(dec("2").mul("0.5").toString(), "1");
});

test("division", () => {
  assert.equal(dec("10").div("4").toString(), "2.5");
  assert.equal(dec("1").div("3").toFixed(8), "0.33333333");
  assert.throws(() => dec("1").div("0"));
});

test("rounding modes", () => {
  assert.equal(dec("2.5").round(0, "half-even").toString(), "2");
  assert.equal(dec("3.5").round(0, "half-even").toString(), "4");
  assert.equal(dec("2.5").round(0, "half-up").toString(), "3");
  assert.equal(dec("-2.5").round(0, "half-up").toString(), "-3");
  assert.equal(dec("1.005").round(2, "half-up").toFixed(2), "1.01");
  assert.equal(dec("1.004").round(2, "half-up").toFixed(2), "1.00");
  assert.equal(dec("1.9").round(0, "floor").toString(), "1");
  assert.equal(dec("-1.1").round(0, "floor").toString(), "-2");
  assert.equal(dec("1.1").round(0, "ceil").toString(), "2");
});

test("comparisons and helpers", () => {
  assert.equal(dec("1").lt("2"), true);
  assert.equal(dec("2").gte("2"), true);
  assert.equal(dec("-3").abs().toString(), "3");
  assert.equal(dec("5").neg().toString(), "-5");
  assert.equal(dec("5").min("3").toString(), "3");
  assert.equal(dec("5").max("3").toString(), "5");
  assert.equal(dec("-1").sign(), -1);
  assert.equal(Dec.ZERO.isZero(), true);
});

test("toFixed pads correctly", () => {
  assert.equal(dec("1.5").toFixed(2), "1.50");
  assert.equal(dec("1").toFixed(0), "1");
  assert.equal(dec("-0.005").toFixed(2), "-0.01");
});

test("decSum", () => {
  assert.equal(decSum(["1.1", "2.2", "3.3"]).toString(), "6.6");
  assert.equal(decSum([]).toString(), "0");
});

test("large bigint precision preserved", () => {
  const big = dec("12345678901234.12345678");
  assert.equal(big.add("0.00000001").toString(), "12345678901234.12345679");
});
