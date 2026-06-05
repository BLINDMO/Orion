/**
 * Deterministic synthetic OHLCV generator. Produces realistic-looking bars from
 * a geometric-Brownian-motion price path with intrabar high/low wicks and a
 * volume profile. Used as the bundled seed dataset and across the test-suite so
 * the engine is runnable offline and reproducible (§5, §13.2/§13.6).
 *
 * Real historical packs load into the very same `BarSeries`; nothing downstream
 * can tell the difference, which is the point — the engine is data-source-agnostic.
 */

import { Rng } from "../money/random.ts";
import { type Bar, type Millis, type Resolution, RESOLUTION_MS } from "./types.ts";
import { BarSeries, InstrumentData } from "./series.ts";
import { getCalendar, type CalendarId } from "../time/calendar.ts";

export interface SyntheticSpec {
  symbol: string;
  seed: number;
  startPrice: number;
  /** Annualized drift (e.g. 0.08 = 8%/yr). */
  driftAnnual: number;
  /** Annualized volatility (e.g. 0.6 = 60%/yr — crypto-like). */
  volAnnual: number;
  calendar: CalendarId;
  /** Number of 1-minute bars to generate from `start`. */
  minutes: number;
  start: Millis;
  /** Base per-minute volume. */
  baseVolume: number;
  tickSize: number;
}

const YEAR_MIN = 365 * 24 * 60; // crypto: minutes per year (continuous)
const BARS_PER_YEAR: Record<Resolution, number> = {
  "1m": 365 * 24 * 60,
  "1h": 365 * 24,
  "1d": 365,
};

function roundTick(p: number, tick: number): number {
  return Math.round(p / tick) * tick;
}

/**
 * Generate `count` bars at an arbitrary base resolution over a GBM path,
 * honoring the trading calendar. The diffusion scales with the resolution so
 * hourly bars look like hourly bars and minute bars like minute bars.
 */
export function generateBars(spec: SyntheticSpec, res: Resolution, count: number): Bar[] {
  const rng = new Rng(spec.seed);
  const cal = getCalendar(spec.calendar);
  const dt = 1 / BARS_PER_YEAR[res];
  const drift = (spec.driftAnnual - 0.5 * spec.volAnnual * spec.volAnnual) * dt;
  const diffusion = spec.volAnnual * Math.sqrt(dt);
  const stepMs = RESOLUTION_MS[res];
  // baseVolume is per-minute; a coarser bar accumulates proportionally more.
  const volScale = stepMs / RESOLUTION_MS["1m"];

  const bars: Bar[] = [];
  let price = spec.startPrice;
  let t = spec.start;
  let produced = 0;
  let guard = 0;
  const maxGuard = count * 5 + 1000;

  while (produced < count && guard++ < maxGuard) {
    if (!cal.isOpen(t)) {
      t = cal.nextOpen(t);
      if (!Number.isFinite(t)) break;
      continue;
    }
    const open = price;
    const shock = Math.exp(drift + diffusion * rng.gaussian());
    const close = open * shock;
    const span = Math.abs(close - open);
    const wickUp = span * rng.range(0.1, 0.9) + open * diffusion * rng.range(0, 0.4);
    const wickDn = span * rng.range(0.1, 0.9) + open * diffusion * rng.range(0, 0.4);
    const high = Math.max(open, close) + wickUp;
    const low = Math.max(spec.tickSize, Math.min(open, close) - wickDn);
    const vol = Math.round(spec.baseVolume * volScale * rng.range(0.5, 1.8) * (1 + 4 * Math.abs(shock - 1)));

    bars.push({
      t,
      o: roundTick(open, spec.tickSize),
      h: roundTick(high, spec.tickSize),
      l: roundTick(low, spec.tickSize),
      c: roundTick(close, spec.tickSize),
      v: vol,
    });
    price = close;
    t += stepMs;
    produced++;
  }
  return bars;
}

/** Generate 1-minute bars over a GBM path, honoring the trading calendar. */
export function generateMinuteBars(spec: SyntheticSpec): Bar[] {
  return generateBars(spec, "1m", spec.minutes);
}

/**
 * Refine one closed 1-hour bar into 60 internally-consistent 1-minute bars via a
 * pinned Brownian bridge. The minutes open at the hour's open, close at the
 * hour's close, and their aggregate high/low equal the hour's — so the 1m series
 * aggregates EXACTLY back to the 1h bar (no resolution discontinuity).
 */
function refineHourToMinutes(hour: Bar, tick: number, rng: Rng): Bar[] {
  const N = 60;
  const cum: number[] = [];
  let s = 0;
  for (let i = 0; i < N; i++) { s += rng.gaussian(); cum.push(s); }
  const endCum = cum[N - 1] || 0;
  const range = Math.max(hour.h - hour.l, Math.abs(hour.o) * 1e-6, tick);

  let maxAbs = 1e-9;
  const bridged: number[] = [];
  for (let i = 0; i < N; i++) {
    const frac = (i + 1) / N;
    const b = cum[i]! - frac * endCum; // ~0 at the final step
    bridged.push(b);
    if (Math.abs(b) > maxAbs) maxAbs = Math.abs(b);
  }

  const amp = range * 0.4;
  const closes: number[] = [];
  for (let i = 0; i < N; i++) {
    const frac = (i + 1) / N;
    const base = hour.o + (hour.c - hour.o) * frac;
    let p = base + (bridged[i]! / maxAbs) * amp;
    p = Math.min(hour.h, Math.max(hour.l, p));
    closes.push(p);
  }
  closes[N - 1] = hour.c; // pin exact close

  // Decide where the hour's extremes land so aggregation reproduces them exactly.
  let maxI = 0, minI = 0;
  for (let i = 0; i < N; i++) {
    if (closes[i]! > closes[maxI]!) maxI = i;
    if (closes[i]! < closes[minI]!) minI = i;
  }

  const out: Bar[] = [];
  let prev = hour.o;
  const v = Math.max(1, Math.round(hour.v / N));
  for (let i = 0; i < N; i++) {
    const o = i === 0 ? hour.o : prev;
    const c = i === N - 1 ? hour.c : closes[i]!;
    const w = range * 0.06 * rng.range(0, 1);
    let hi = Math.min(hour.h, Math.max(o, c) + w);
    let lo = Math.max(hour.l, Math.min(o, c) - w);
    if (i === maxI) hi = hour.h;
    if (i === minI) lo = hour.l;
    out.push({
      t: hour.t + i * RESOLUTION_MS["1m"],
      o: roundTick(o, tick), h: roundTick(hi, tick), l: roundTick(lo, tick), c: roundTick(c, tick), v,
    });
    prev = c;
  }
  return out;
}

/** Aggregate finer bars up to a coarser resolution by fixed time buckets. */
export function aggregate(bars: readonly Bar[], target: Resolution): Bar[] {
  const bucket = RESOLUTION_MS[target];
  const out: Bar[] = [];
  let cur: { t: number; o: number; h: number; l: number; c: number; v: number } | null = null;
  for (const b of bars) {
    const bt = Math.floor(b.t / bucket) * bucket;
    if (!cur || cur.t !== bt) {
      if (cur) out.push({ ...cur });
      cur = { t: bt, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
    }
  }
  if (cur) out.push({ ...cur });
  return out;
}

/** Build a full multi-resolution InstrumentData from a single synthetic spec. */
export function buildSyntheticInstrument(spec: SyntheticSpec): InstrumentData {
  const minute = generateMinuteBars(spec);
  return new InstrumentData(spec.symbol, {
    "1m": new BarSeries("1m", minute),
    "1h": new BarSeries("1h", aggregate(minute, "1h")),
    "1d": new BarSeries("1d", aggregate(minute, "1d")),
  });
}

/**
 * Build a long-horizon instrument economically: generate the full span at HOURLY
 * resolution (cheap), derive daily bars from it, and refine only the first
 * `minuteWindowHours` hours down to 1-minute granularity. This gives effectively
 * unlimited future to trade into without generating millions of minute bars,
 * while keeping all three resolutions mutually consistent.
 */
export function buildLongInstrument(
  spec: SyntheticSpec,
  hours: number,
  minuteWindowHours: number,
): InstrumentData {
  const hourBars = generateBars(spec, "1h", hours);
  const dayBars = aggregate(hourBars, "1d");

  const rng = new Rng((spec.seed ^ 0x5bd1e995) >>> 0);
  const minute: Bar[] = [];
  const window = Math.min(minuteWindowHours, hourBars.length);
  for (let i = 0; i < window; i++) {
    for (const mb of refineHourToMinutes(hourBars[i]!, spec.tickSize, rng)) minute.push(mb);
  }

  return new InstrumentData(spec.symbol, {
    "1m": new BarSeries("1m", minute),
    "1h": new BarSeries("1h", hourBars),
    "1d": new BarSeries("1d", dayBars),
  });
}
