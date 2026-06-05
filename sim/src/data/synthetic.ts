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

function roundTick(p: number, tick: number): number {
  return Math.round(p / tick) * tick;
}

/** Generate 1-minute bars over a GBM path, honoring the trading calendar. */
export function generateMinuteBars(spec: SyntheticSpec): Bar[] {
  const rng = new Rng(spec.seed);
  const cal = getCalendar(spec.calendar);
  const dt = 1 / YEAR_MIN; // year fraction per minute
  const drift = (spec.driftAnnual - 0.5 * spec.volAnnual * spec.volAnnual) * dt;
  const diffusion = spec.volAnnual * Math.sqrt(dt);

  const bars: Bar[] = [];
  let price = spec.startPrice;
  let t = spec.start;
  let produced = 0;
  let guard = 0;
  const maxGuard = spec.minutes * 5 + 1000;

  while (produced < spec.minutes && guard++ < maxGuard) {
    if (!cal.isOpen(t)) {
      // jump to next open for calendars with sessions
      t = cal.nextOpen(t);
      if (!Number.isFinite(t)) break;
      continue;
    }
    const open = price;
    const shock = Math.exp(drift + diffusion * rng.gaussian());
    const close = open * shock;
    // intrabar wick: extend beyond open/close by a fraction of the move + noise
    const span = Math.abs(close - open);
    const wickUp = span * rng.range(0.1, 0.9) + open * diffusion * rng.range(0, 0.4);
    const wickDn = span * rng.range(0.1, 0.9) + open * diffusion * rng.range(0, 0.4);
    const high = Math.max(open, close) + wickUp;
    const low = Math.max(spec.tickSize, Math.min(open, close) - wickDn);
    const vol = Math.round(spec.baseVolume * rng.range(0.5, 1.8) * (1 + 4 * Math.abs(shock - 1)));

    bars.push({
      t,
      o: roundTick(open, spec.tickSize),
      h: roundTick(high, spec.tickSize),
      l: roundTick(low, spec.tickSize),
      c: roundTick(close, spec.tickSize),
      v: vol,
    });
    price = close;
    t += RESOLUTION_MS["1m"];
    produced++;
  }
  return bars;
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
