/**
 * American option pricing via the Barone–Adesi–Whaley (1987) quadratic
 * approximation. Spec §8 — "American-style equity options: account for
 * early-exercise value ... rather than pretending they're European."
 *
 * Uses the generalized BSM with cost-of-carry b = r - q. The early-exercise
 * premium is added to the European value; when carry makes early exercise
 * never optimal (calls with b >= r), it degrades exactly to European.
 *
 * Reference: Haug, "The Complete Guide to Option Pricing Formulas".
 */

import { bsmPrice, normCdf, normPdf, type OptionRight, type BsmInputs } from "./bsm.ts";

function gbs(right: OptionRight, S: number, K: number, T: number, r: number, b: number, sigma: number): number {
  // generalized BS with carry b == BSM with q = r - b
  const i: BsmInputs = { S, K, T, r, q: r - b, sigma };
  return bsmPrice(right, i);
}

function d1of(S: number, K: number, T: number, b: number, sigma: number): number {
  return (Math.log(S / K) + (b + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
}

/** Critical underlying price above which an American call is exercised. */
function criticalCall(K: number, T: number, r: number, b: number, sigma: number): number {
  const sig2 = sigma * sigma;
  const N = (2 * b) / sig2;
  const m = (2 * r) / sig2;
  const q2u = (-(N - 1) + Math.sqrt((N - 1) * (N - 1) + 4 * m)) / 2;
  const su = K / (1 - 1 / q2u);
  const h2 = -(b * T + 2 * sigma * Math.sqrt(T)) * (K / (su - K));
  let Si = K + (su - K) * (1 - Math.exp(h2));
  const k = (2 * r) / (sig2 * (1 - Math.exp(-r * T)));
  const Q2 = (-(N - 1) + Math.sqrt((N - 1) * (N - 1) + 4 * k)) / 2;
  const sqrtT = Math.sqrt(T);

  for (let iter = 0; iter < 100; iter++) {
    const d1 = d1of(Si, K, T, b, sigma);
    const eb = Math.exp((b - r) * T);
    const c = gbs("call", Si, K, T, r, b, sigma);
    const RHS = c + ((1 - eb * normCdf(d1)) * Si) / Q2;
    const LHS = Si - K;
    const bi =
      eb * normCdf(d1) * (1 - 1 / Q2) + ((1 - (eb * normPdf(d1)) / (sigma * sqrtT)) / Q2);
    const next = (K + RHS - bi * Si) / (1 - bi);
    if (Math.abs(LHS - RHS) / K < 1e-8 || !Number.isFinite(next)) return Si;
    Si = next;
  }
  return Si;
}

/** Critical underlying price below which an American put is exercised. */
function criticalPut(K: number, T: number, r: number, b: number, sigma: number): number {
  const sig2 = sigma * sigma;
  const N = (2 * b) / sig2;
  const m = (2 * r) / sig2;
  const q1u = (-(N - 1) - Math.sqrt((N - 1) * (N - 1) + 4 * m)) / 2;
  const su = K / (1 - 1 / q1u);
  const h1 = (b * T - 2 * sigma * Math.sqrt(T)) * (K / (K - su));
  let Si = su + (K - su) * Math.exp(h1);
  const k = (2 * r) / (sig2 * (1 - Math.exp(-r * T)));
  const Q1 = (-(N - 1) - Math.sqrt((N - 1) * (N - 1) + 4 * k)) / 2;
  const sqrtT = Math.sqrt(T);

  for (let iter = 0; iter < 100; iter++) {
    const d1 = d1of(Si, K, T, b, sigma);
    const eb = Math.exp((b - r) * T);
    const p = gbs("put", Si, K, T, r, b, sigma);
    const RHS = p - ((1 - eb * normCdf(-d1)) * Si) / Q1;
    const LHS = K - Si;
    const bi =
      -eb * normCdf(-d1) * (1 - 1 / Q1) - ((1 + (eb * normPdf(-d1)) / (sigma * sqrtT)) / Q1);
    const next = (K - RHS + bi * Si) / (1 + bi);
    if (Math.abs(LHS - RHS) / K < 1e-8 || !Number.isFinite(next)) return Si;
    Si = next;
  }
  return Si;
}

/**
 * American option price. `i` uses the BSM input convention (r, q, sigma);
 * internally carry b = r - q.
 */
export function americanPrice(right: OptionRight, i: BsmInputs): number {
  const { S, K, T, r, q, sigma } = i;
  if (T <= 0 || sigma <= 0) {
    return right === "call" ? Math.max(0, S - K) : Math.max(0, K - S);
  }
  const b = r - q;

  if (right === "call") {
    // No early-exercise premium when carry >= rate (e.g. non-dividend call).
    if (b >= r) return gbs("call", S, K, T, r, b, sigma);
    const Sk = criticalCall(K, T, r, b, sigma);
    if (S >= Sk) return S - K;
    const sig2 = sigma * sigma;
    const N = (2 * b) / sig2;
    const k = (2 * r) / (sig2 * (1 - Math.exp(-r * T)));
    const Q2 = (-(N - 1) + Math.sqrt((N - 1) * (N - 1) + 4 * k)) / 2;
    const d1 = d1of(Sk, K, T, b, sigma);
    const a2 = (Sk / Q2) * (1 - Math.exp((b - r) * T) * normCdf(d1));
    return gbs("call", S, K, T, r, b, sigma) + a2 * Math.pow(S / Sk, Q2);
  } else {
    const Sk = criticalPut(K, T, r, b, sigma);
    if (S <= Sk) return K - S;
    const sig2 = sigma * sigma;
    const N = (2 * b) / sig2;
    const k = (2 * r) / (sig2 * (1 - Math.exp(-r * T)));
    const Q1 = (-(N - 1) - Math.sqrt((N - 1) * (N - 1) + 4 * k)) / 2;
    const d1 = d1of(Sk, K, T, b, sigma);
    const a1 = -(Sk / Q1) * (1 - Math.exp((b - r) * T) * normCdf(-d1));
    return gbs("put", S, K, T, r, b, sigma) + a1 * Math.pow(S / Sk, Q1);
  }
}

/** American Greeks via central finite differences over `americanPrice`. */
export function americanGreeks(right: OptionRight, i: BsmInputs) {
  const hS = i.S * 1e-4;
  const hSig = 1e-4;
  const hT = Math.min(i.T * 1e-3, 1 / 365 / 10);
  const hR = 1e-5;
  const p = (x: BsmInputs) => americanPrice(right, x);
  const delta = (p({ ...i, S: i.S + hS }) - p({ ...i, S: i.S - hS })) / (2 * hS);
  const gamma = (p({ ...i, S: i.S + hS }) - 2 * p(i) + p({ ...i, S: i.S - hS })) / (hS * hS);
  const vega = (p({ ...i, sigma: i.sigma + hSig }) - p({ ...i, sigma: i.sigma - hSig })) / (2 * hSig);
  const theta = -(p({ ...i, T: i.T + hT }) - p({ ...i, T: Math.max(1e-9, i.T - hT) })) / (2 * hT);
  const rho = (p({ ...i, r: i.r + hR }) - p({ ...i, r: i.r - hR })) / (2 * hR);
  return { delta, gamma, vega, theta, rho, thetaPerDay: theta / 365, vegaPerPct: vega / 100 };
}
