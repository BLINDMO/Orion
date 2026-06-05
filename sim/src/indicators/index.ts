/**
 * Technical indicators. Spec §9.
 *
 * Every indicator is a pure function of a bar array. Callers pass the
 * clock-visible slice (`series.visible(now)`), so causality is guaranteed by
 * construction — an indicator literally cannot see a bar that hasn't closed.
 *
 * Outputs are aligned to the input length; values that cannot yet be computed
 * (insufficient look-back) are `undefined`.
 */

import type { Bar } from "../data/types.ts";

export type Series = readonly (number | undefined)[];

const closes = (bars: readonly Bar[]) => bars.map((b) => b.c);

/** Simple moving average. */
export function sma(values: readonly number[], period: number): Series {
  const out: (number | undefined)[] = new Array(values.length).fill(undefined);
  if (period <= 0) throw new Error("sma: period must be > 0");
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i]!;
    if (i >= period) sum -= values[i - period]!;
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Exponential moving average (Wilder-style seed = SMA of first `period`). */
export function ema(values: readonly number[], period: number): Series {
  const out: (number | undefined)[] = new Array(values.length).fill(undefined);
  if (period <= 0) throw new Error("ema: period must be > 0");
  const k = 2 / (period + 1);
  let prev: number | undefined;
  let seedSum = 0;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      seedSum += values[i]!;
    } else if (i === period - 1) {
      seedSum += values[i]!;
      prev = seedSum / period;
      out[i] = prev;
    } else {
      prev = values[i]! * k + (prev as number) * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}

/** Volume-weighted average price, cumulative from the first bar of the slice. */
export function vwap(bars: readonly Bar[]): Series {
  const out: (number | undefined)[] = new Array(bars.length).fill(undefined);
  let pv = 0;
  let vol = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!;
    const typical = (b.h + b.l + b.c) / 3;
    pv += typical * b.v;
    vol += b.v;
    out[i] = vol > 0 ? pv / vol : undefined;
  }
  return out;
}

export interface BollingerBands {
  middle: Series;
  upper: Series;
  lower: Series;
  /** %B: position within the bands (0 = lower, 1 = upper). */
  percentB: Series;
  /** Bandwidth: (upper - lower) / middle. */
  bandwidth: Series;
}

export function bollinger(values: readonly number[], period = 20, mult = 2): BollingerBands {
  const mid = sma(values, period);
  const upper: (number | undefined)[] = new Array(values.length).fill(undefined);
  const lower: (number | undefined)[] = new Array(values.length).fill(undefined);
  const pctB: (number | undefined)[] = new Array(values.length).fill(undefined);
  const bw: (number | undefined)[] = new Array(values.length).fill(undefined);
  for (let i = period - 1; i < values.length; i++) {
    const m = mid[i]!;
    let acc = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = values[j]! - m;
      acc += d * d;
    }
    const sd = Math.sqrt(acc / period);
    const u = m + mult * sd;
    const l = m - mult * sd;
    upper[i] = u;
    lower[i] = l;
    pctB[i] = u === l ? 0.5 : (values[i]! - l) / (u - l);
    bw[i] = m !== 0 ? (u - l) / m : 0;
  }
  return { middle: mid, upper, lower, percentB: pctB, bandwidth: bw };
}

/** Wilder's RSI. */
export function rsi(values: readonly number[], period = 14): Series {
  const out: (number | undefined)[] = new Array(values.length).fill(undefined);
  if (values.length <= period) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = values[i]! - values[i - 1]!;
    if (ch >= 0) avgGain += ch;
    else avgLoss -= ch;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const ch = values[i]! - values[i - 1]!;
    const gain = ch > 0 ? ch : 0;
    const loss = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export interface MacdResult {
  macd: Series;
  signal: Series;
  histogram: Series;
}

export function macd(values: readonly number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine: (number | undefined)[] = values.map((_, i) =>
    emaFast[i] !== undefined && emaSlow[i] !== undefined ? emaFast[i]! - emaSlow[i]! : undefined,
  );
  // signal = EMA of the defined macd values; align indices.
  const defined: number[] = [];
  const idxMap: number[] = [];
  macdLine.forEach((v, i) => {
    if (v !== undefined) {
      defined.push(v);
      idxMap.push(i);
    }
  });
  const sig = ema(defined, signalPeriod);
  const signal: (number | undefined)[] = new Array(values.length).fill(undefined);
  sig.forEach((v, j) => {
    if (v !== undefined) signal[idxMap[j]!] = v;
  });
  const histogram = macdLine.map((v, i) =>
    v !== undefined && signal[i] !== undefined ? v - signal[i]! : undefined,
  );
  return { macd: macdLine, signal, histogram };
}

export interface StochasticResult {
  k: Series;
  d: Series;
}

/** Stochastic oscillator (%K smoothed, %D = SMA of %K). */
export function stochastic(bars: readonly Bar[], kPeriod = 14, kSmooth = 3, dPeriod = 3): StochasticResult {
  const rawK: (number | undefined)[] = new Array(bars.length).fill(undefined);
  for (let i = kPeriod - 1; i < bars.length; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      hh = Math.max(hh, bars[j]!.h);
      ll = Math.min(ll, bars[j]!.l);
    }
    rawK[i] = hh === ll ? 50 : ((bars[i]!.c - ll) / (hh - ll)) * 100;
  }
  const kVals = rawK.map((v) => (v === undefined ? NaN : v));
  const k = smaSparse(kVals, kSmooth);
  const d = smaSparse(k.map((v) => (v === undefined ? NaN : v)), dPeriod);
  return { k, d };
}

/** SMA that treats NaN as "not yet available" (keeps alignment). */
function smaSparse(values: readonly number[], period: number): Series {
  const out: (number | undefined)[] = new Array(values.length).fill(undefined);
  const buf: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (Number.isNaN(values[i]!)) {
      buf.length = 0;
      continue;
    }
    buf.push(values[i]!);
    if (buf.length > period) buf.shift();
    if (buf.length === period) out[i] = buf.reduce((a, b) => a + b, 0) / period;
  }
  return out;
}

/** Average True Range (Wilder). */
export function atr(bars: readonly Bar[], period = 14): Series {
  const out: (number | undefined)[] = new Array(bars.length).fill(undefined);
  if (bars.length === 0) return out;
  const tr: number[] = new Array(bars.length);
  tr[0] = bars[0]!.h - bars[0]!.l;
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i]!;
    const pc = bars[i - 1]!.c;
    tr[i] = Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
  }
  if (bars.length <= period) return out;
  let prev = 0;
  for (let i = 1; i <= period; i++) prev += tr[i]!;
  prev /= period;
  out[period] = prev;
  for (let i = period + 1; i < bars.length; i++) {
    prev = (prev * (period - 1) + tr[i]!) / period;
    out[i] = prev;
  }
  return out;
}

/** On-Balance Volume. */
export function obv(bars: readonly Bar[]): Series {
  const out: (number | undefined)[] = new Array(bars.length).fill(undefined);
  if (bars.length === 0) return out;
  let acc = 0;
  out[0] = 0;
  for (let i = 1; i < bars.length; i++) {
    const ch = bars[i]!.c - bars[i - 1]!.c;
    if (ch > 0) acc += bars[i]!.v;
    else if (ch < 0) acc -= bars[i]!.v;
    out[i] = acc;
  }
  return out;
}

export interface Level {
  price: number;
  /** How many pivots cluster at this level. */
  strength: number;
  kind: "support" | "resistance";
}

/**
 * Support/resistance via fractal pivot detection + clustering. Looks back over
 * the visible window only. `lookback` is the half-window for a pivot; `tol` is
 * the relative clustering tolerance.
 */
export function supportResistance(
  bars: readonly Bar[],
  lookback = 3,
  tol = 0.004,
  maxLevels = 6,
): Level[] {
  const pivHi: number[] = [];
  const pivLo: number[] = [];
  for (let i = lookback; i < bars.length - lookback; i++) {
    let isHi = true;
    let isLo = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (bars[j]!.h >= bars[i]!.h) isHi = false;
      if (bars[j]!.l <= bars[i]!.l) isLo = false;
    }
    if (isHi) pivHi.push(bars[i]!.h);
    if (isLo) pivLo.push(bars[i]!.l);
  }
  const cluster = (pts: number[], kind: "support" | "resistance"): Level[] => {
    const sorted = [...pts].sort((a, b) => a - b);
    const groups: number[][] = [];
    for (const p of sorted) {
      const g = groups[groups.length - 1];
      if (g && Math.abs(p - g[g.length - 1]!) / g[g.length - 1]! <= tol) g.push(p);
      else groups.push([p]);
    }
    return groups.map((g) => ({
      price: g.reduce((a, b) => a + b, 0) / g.length,
      strength: g.length,
      kind,
    }));
  };
  const levels = [...cluster(pivHi, "resistance"), ...cluster(pivLo, "support")];
  levels.sort((a, b) => b.strength - a.strength);
  return levels.slice(0, maxLevels);
}

/** Convenience: pull closes and run a battery used by the Terminal scanner. */
export function lastDefined(s: Series): number | undefined {
  for (let i = s.length - 1; i >= 0; i--) if (s[i] !== undefined) return s[i];
  return undefined;
}

export { closes };
