/**
 * OHLCV storage with a HARD no-look-ahead boundary. Spec §4 & §13.1.
 *
 * The engine may only ever observe data at or before `clock.now`. A bar becomes
 * visible only once it has fully closed (t + resolutionMs <= now). Any attempt to
 * read a bar that has not yet closed throws a `LookaheadError` in development —
 * this is the structural guarantee that makes the simulation honest.
 */

import { type Bar, type Millis, type Resolution, RESOLUTION_MS } from "./types.ts";

export class LookaheadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LookaheadError";
  }
}

/** When false, guards are skipped (production builds opt out for speed). */
let GUARD_ENABLED = true;
export function setLookaheadGuard(enabled: boolean): void {
  GUARD_ENABLED = enabled;
}
export function lookaheadGuardEnabled(): boolean {
  return GUARD_ENABLED;
}

/** Binary search: index of the last element with bars[i].t <= t, or -1. */
function lastIndexAtOrBefore(bars: readonly Bar[], t: Millis): number {
  let lo = 0;
  let hi = bars.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid]!.t <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}

export class BarSeries {
  readonly resolution: Resolution;
  private readonly bars: Bar[];

  constructor(resolution: Resolution, bars: readonly Bar[]) {
    this.resolution = resolution;
    // Defensive copy + sort + dedupe by open time.
    const sorted = [...bars].sort((a, b) => a.t - b.t);
    const out: Bar[] = [];
    for (const b of sorted) {
      const prev = out[out.length - 1];
      if (prev && prev.t === b.t) {
        out[out.length - 1] = b; // later wins
      } else {
        out.push(b);
      }
    }
    this.bars = out;
  }

  get length(): number {
    return this.bars.length;
  }

  /** Whole dataset bounds (NOT clock-aware — used for picking start points). */
  get firstTime(): Millis | undefined {
    return this.bars[0]?.t;
  }
  get lastTime(): Millis | undefined {
    return this.bars[this.bars.length - 1]?.t;
  }

  private closeTime(b: Bar): Millis {
    return b.t + RESOLUTION_MS[this.resolution];
  }

  /** Index of the last bar fully closed at or before `now`. -1 if none. */
  lastClosedIndex(now: Millis): number {
    const res = RESOLUTION_MS[this.resolution];
    // last bar whose OPEN time <= now - res  (so its close <= now)
    return lastIndexAtOrBefore(this.bars, now - res);
  }

  /** All bars fully closed at or before `now`. Never includes future data. */
  visible(now: Millis): readonly Bar[] {
    const idx = this.lastClosedIndex(now);
    return idx < 0 ? [] : this.bars.slice(0, idx + 1);
  }

  /** The most recent fully-closed bar at `now`, or undefined. */
  lastClosed(now: Millis): Bar | undefined {
    const idx = this.lastClosedIndex(now);
    return idx < 0 ? undefined : this.bars[idx];
  }

  /**
   * The next bar that OPENS strictly after `afterOpen`. Used by the clock to
   * stream bars forward. Returns undefined past the end of data.
   */
  nextBarAfter(afterOpen: Millis): Bar | undefined {
    const idx = lastIndexAtOrBefore(this.bars, afterOpen);
    return this.bars[idx + 1];
  }

  /** The bar whose OPEN time is exactly `open`, if any. */
  barOpeningAt(open: Millis): Bar | undefined {
    const idx = lastIndexAtOrBefore(this.bars, open);
    const b = this.bars[idx];
    return b && b.t === open ? b : undefined;
  }

  /**
   * Raw access to a bar by absolute index, GUARDED against look-ahead relative
   * to `now`. Throws if the bar has not yet closed.
   */
  atGuarded(index: number, now: Millis): Bar | undefined {
    const b = this.bars[index];
    if (!b) return undefined;
    if (GUARD_ENABLED && this.closeTime(b) > now) {
      throw new LookaheadError(
        `Look-ahead: ${this.resolution} bar @${new Date(b.t).toISOString()} closes after now=${new Date(now).toISOString()}`,
      );
    }
    return b;
  }

  /** Unguarded full view — ONLY for data preparation, never for engine logic. */
  rawAll(): readonly Bar[] {
    return this.bars;
  }

  /** Merge live candles in-place. Newer bars are appended; the most recent bar
   *  (still-forming) is replaced so live ticks update the last candle. */
  appendLive(newBars: readonly Bar[]): void {
    const incoming = [...newBars].sort((a, b) => a.t - b.t);
    for (const b of incoming) {
      const last = this.bars[this.bars.length - 1];
      if (!last || b.t > last.t) this.bars.push(b);
      else if (b.t === last.t) this.bars[this.bars.length - 1] = b;
    }
  }
}

/** All resolutions for a single instrument. */
export class InstrumentData {
  readonly symbol: string;
  private readonly series: Partial<Record<Resolution, BarSeries>>;

  constructor(symbol: string, series: Partial<Record<Resolution, BarSeries>>) {
    this.symbol = symbol;
    this.series = series;
  }

  has(res: Resolution): boolean {
    return this.series[res] !== undefined;
  }

  get(res: Resolution): BarSeries {
    const s = this.series[res];
    if (!s) throw new Error(`InstrumentData ${this.symbol}: no ${res} series`);
    return s;
  }

  /** Finest available resolution, preferred for marking. */
  finest(): BarSeries {
    return this.series["1m"] ?? this.series["1h"] ?? this.get("1d");
  }

  /**
   * Canonical mark price at `now`: the close of the most recent fully-closed bar
   * at the finest available resolution. Never looks ahead. Undefined if the clock
   * predates all data.
   */
  markPrice(now: Millis): number | undefined {
    return this.finest().lastClosed(now)?.c;
  }

  /** Merge live candles into the named resolution series. */
  appendLive(res: Resolution, bars: readonly Bar[]): void {
    const s = this.series[res];
    if (s) s.appendLive(bars);
    else this.series[res] = new BarSeries(res, bars);
  }
}
