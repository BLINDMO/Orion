var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// ../sim/src/money/decimal.ts
var SCALE = 8;
var SCALE_FACTOR = 10n ** BigInt(SCALE);
var Dec = class _Dec {
  /** Raw scaled integer (value * 10^SCALE). */
  units;
  constructor(units) {
    this.units = units;
  }
  static ZERO = new _Dec(0n);
  static ONE = new _Dec(SCALE_FACTOR);
  static fromUnits(units) {
    return new _Dec(units);
  }
  static from(value) {
    if (value instanceof _Dec) return value;
    if (typeof value === "bigint") return new _Dec(value * SCALE_FACTOR);
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new RangeError(`Dec.from: non-finite number ${value}`);
      }
      return _Dec.parse(value.toFixed(SCALE));
    }
    return _Dec.parse(value);
  }
  /** Parse a decimal string like "-1234.5678" with arbitrary precision input. */
  static parse(s) {
    const str = s.trim();
    const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(str);
    if (!m || m[2] === "" && (m[3] ?? "") === "") {
      throw new SyntaxError(`Dec.parse: invalid decimal "${s}"`);
    }
    const sign2 = m[1] === "-" ? -1n : 1n;
    const intPart = m[2] ?? "";
    let fracPart = m[3] ?? "";
    let roundUp = false;
    if (fracPart.length > SCALE) {
      const nextDigit = fracPart.charCodeAt(SCALE) - 48;
      roundUp = nextDigit >= 5;
      fracPart = fracPart.slice(0, SCALE);
    }
    fracPart = fracPart.padEnd(SCALE, "0");
    let units = BigInt(intPart === "" ? "0" : intPart) * SCALE_FACTOR + BigInt(fracPart);
    if (roundUp) units += 1n;
    return new _Dec(sign2 * units);
  }
  add(o) {
    return new _Dec(this.units + _Dec.from(o).units);
  }
  sub(o) {
    return new _Dec(this.units - _Dec.from(o).units);
  }
  /** Multiply. Product has 2*SCALE units, so divide once by SCALE_FACTOR (round half-up). */
  mul(o) {
    const raw = this.units * _Dec.from(o).units;
    return new _Dec(divRoundHalfUp(raw, SCALE_FACTOR));
  }
  /** Divide. (a/b) where both scaled: (a*SCALE_FACTOR)/b, round half-up. */
  div(o) {
    const d = _Dec.from(o).units;
    if (d === 0n) throw new RangeError("Dec.div: division by zero");
    return new _Dec(divRoundHalfUp(this.units * SCALE_FACTOR, d));
  }
  neg() {
    return new _Dec(-this.units);
  }
  abs() {
    return this.units < 0n ? new _Dec(-this.units) : this;
  }
  min(o) {
    const b = _Dec.from(o);
    return this.units <= b.units ? this : b;
  }
  max(o) {
    const b = _Dec.from(o);
    return this.units >= b.units ? this : b;
  }
  cmp(o) {
    const b = _Dec.from(o).units;
    return this.units < b ? -1 : this.units > b ? 1 : 0;
  }
  eq(o) {
    return this.units === _Dec.from(o).units;
  }
  lt(o) {
    return this.units < _Dec.from(o).units;
  }
  lte(o) {
    return this.units <= _Dec.from(o).units;
  }
  gt(o) {
    return this.units > _Dec.from(o).units;
  }
  gte(o) {
    return this.units >= _Dec.from(o).units;
  }
  isZero() {
    return this.units === 0n;
  }
  isNeg() {
    return this.units < 0n;
  }
  isPos() {
    return this.units > 0n;
  }
  sign() {
    return this.units < 0n ? -1 : this.units > 0n ? 1 : 0;
  }
  /** Quantize to `places` decimal places using the given rounding mode. */
  round(places = 2, mode = "half-up") {
    if (places >= SCALE) return this;
    const factor = 10n ** BigInt(SCALE - places);
    return new _Dec(roundDiv(this.units, factor, mode) * factor);
  }
  /** Round to whole cents (2 dp) — the canonical cash representation. */
  toCents() {
    return this.round(2, "half-even");
  }
  toNumber() {
    return Number(this.units) / Number(SCALE_FACTOR);
  }
  /** Full-precision decimal string, trailing zeros stripped. */
  toString() {
    const neg = this.units < 0n;
    const abs = neg ? -this.units : this.units;
    const intPart = abs / SCALE_FACTOR;
    const frac = (abs % SCALE_FACTOR).toString().padStart(SCALE, "0").replace(/0+$/, "");
    const body = frac === "" ? `${intPart}` : `${intPart}.${frac}`;
    return neg ? `-${body}` : body;
  }
  /** Fixed `places` string, e.g. "1234.50". */
  toFixed(places = 2) {
    const r = this.round(places, "half-up");
    const neg = r.units < 0n;
    const abs = neg ? -r.units : r.units;
    const intPart = abs / SCALE_FACTOR;
    const fracAll = (abs % SCALE_FACTOR).toString().padStart(SCALE, "0");
    const frac = places === 0 ? "" : "." + fracAll.slice(0, places);
    return `${neg ? "-" : ""}${intPart}${frac}`;
  }
  toJSON() {
    return this.toString();
  }
};
function divRoundHalfUp(num, den) {
  return roundDiv(num, den, "half-up");
}
function roundDiv(num, den, mode) {
  if (den < 0n) {
    num = -num;
    den = -den;
  }
  const q = num / den;
  const r = num % den;
  if (r === 0n) return q;
  const neg = num < 0n;
  const twice = (r < 0n ? -r : r) * 2n;
  switch (mode) {
    case "down":
      return q;
    case "up":
      return neg ? q - 1n : q + 1n;
    case "floor":
      return neg ? q - 1n : q;
    case "ceil":
      return neg ? q : q + 1n;
    case "half-up": {
      if (twice >= den) return neg ? q - 1n : q + 1n;
      return q;
    }
    case "half-even": {
      if (twice > den) return neg ? q - 1n : q + 1n;
      if (twice < den) return q;
      const even = q % 2n === 0n;
      if (even) return q;
      return neg ? q - 1n : q + 1n;
    }
  }
}
function dec(value) {
  return Dec.from(value);
}

// ../sim/src/money/random.ts
var Rng = class _Rng {
  s;
  constructor(seed) {
    this.s = seed >>> 0 || 2654435769;
  }
  /** Uniform in [0, 1). */
  next() {
    this.s = this.s + 1831565813 | 0;
    let t = this.s;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  /** Uniform in [min, max). */
  range(min, max) {
    return min + (max - min) * this.next();
  }
  /** Standard normal via Box–Muller (cached pair). */
  spare = null;
  gaussian() {
    if (this.spare !== null) {
      const v2 = this.spare;
      this.spare = null;
      return v2;
    }
    let u = 0;
    let v = 0;
    let s = 0;
    do {
      u = this.next() * 2 - 1;
      v = this.next() * 2 - 1;
      s = u * u + v * v;
    } while (s >= 1 || s === 0);
    const mul = Math.sqrt(-2 * Math.log(s) / s);
    this.spare = v * mul;
    return u * mul;
  }
  /** Fork a child RNG deterministically (for independent streams). */
  fork(salt) {
    return new _Rng((this.s ^ Math.imul(salt | 1, 2246822507)) >>> 0);
  }
};

// ../sim/src/data/types.ts
var RESOLUTION_MS = {
  "1m": 6e4,
  "1h": 36e5,
  "1d": 864e5
};

// ../sim/src/data/series.ts
var LookaheadError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "LookaheadError";
  }
};
var GUARD_ENABLED = true;
function lastIndexAtOrBefore(bars, t) {
  let lo = 0;
  let hi = bars.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = lo + hi >> 1;
    if (bars[mid].t <= t) {
      ans = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return ans;
}
var BarSeries = class {
  resolution;
  bars;
  constructor(resolution, bars) {
    this.resolution = resolution;
    const sorted = [...bars].sort((a, b) => a.t - b.t);
    const out = [];
    for (const b of sorted) {
      const prev = out[out.length - 1];
      if (prev && prev.t === b.t) {
        out[out.length - 1] = b;
      } else {
        out.push(b);
      }
    }
    this.bars = out;
  }
  get length() {
    return this.bars.length;
  }
  /** Whole dataset bounds (NOT clock-aware — used for picking start points). */
  get firstTime() {
    return this.bars[0]?.t;
  }
  get lastTime() {
    return this.bars[this.bars.length - 1]?.t;
  }
  closeTime(b) {
    return b.t + RESOLUTION_MS[this.resolution];
  }
  /** Index of the last bar fully closed at or before `now`. -1 if none. */
  lastClosedIndex(now) {
    const res = RESOLUTION_MS[this.resolution];
    return lastIndexAtOrBefore(this.bars, now - res);
  }
  /** All bars fully closed at or before `now`. Never includes future data. */
  visible(now) {
    const idx = this.lastClosedIndex(now);
    return idx < 0 ? [] : this.bars.slice(0, idx + 1);
  }
  /** The most recent fully-closed bar at `now`, or undefined. */
  lastClosed(now) {
    const idx = this.lastClosedIndex(now);
    return idx < 0 ? void 0 : this.bars[idx];
  }
  /**
   * The next bar that OPENS strictly after `afterOpen`. Used by the clock to
   * stream bars forward. Returns undefined past the end of data.
   */
  nextBarAfter(afterOpen) {
    const idx = lastIndexAtOrBefore(this.bars, afterOpen);
    return this.bars[idx + 1];
  }
  /** The bar whose OPEN time is exactly `open`, if any. */
  barOpeningAt(open) {
    const idx = lastIndexAtOrBefore(this.bars, open);
    const b = this.bars[idx];
    return b && b.t === open ? b : void 0;
  }
  /**
   * Raw access to a bar by absolute index, GUARDED against look-ahead relative
   * to `now`. Throws if the bar has not yet closed.
   */
  atGuarded(index, now) {
    const b = this.bars[index];
    if (!b) return void 0;
    if (GUARD_ENABLED && this.closeTime(b) > now) {
      throw new LookaheadError(
        `Look-ahead: ${this.resolution} bar @${new Date(b.t).toISOString()} closes after now=${new Date(now).toISOString()}`
      );
    }
    return b;
  }
  /** Unguarded full view — ONLY for data preparation, never for engine logic. */
  rawAll() {
    return this.bars;
  }
  /** Merge live candles in-place. Newer bars are appended; the most recent bar
   *  (still-forming) is replaced so live ticks update the last candle. */
  appendLive(newBars) {
    const incoming = [...newBars].sort((a, b) => a.t - b.t);
    for (const b of incoming) {
      const last = this.bars[this.bars.length - 1];
      if (!last || b.t > last.t) this.bars.push(b);
      else if (b.t === last.t) this.bars[this.bars.length - 1] = b;
    }
  }
};
var InstrumentData = class {
  symbol;
  series;
  constructor(symbol, series) {
    this.symbol = symbol;
    this.series = series;
  }
  has(res) {
    return this.series[res] !== void 0;
  }
  get(res) {
    const s = this.series[res];
    if (!s) throw new Error(`InstrumentData ${this.symbol}: no ${res} series`);
    return s;
  }
  /** Finest available resolution, preferred for marking. */
  finest() {
    return this.series["1m"] ?? this.series["1h"] ?? this.get("1d");
  }
  /**
   * Canonical mark price at `now`: the close of the most recent fully-closed bar
   * at the finest available resolution. Never looks ahead. Undefined if the clock
   * predates all data.
   */
  markPrice(now) {
    return this.finest().lastClosed(now)?.c;
  }
  /** Merge live candles into the named resolution series. */
  appendLive(res, bars) {
    const s = this.series[res];
    if (s) s.appendLive(bars);
    else this.series[res] = new BarSeries(res, bars);
  }
};

// ../sim/src/time/calendar.ts
var DAY_MS = 864e5;
var HOUR_MS = 36e5;
var MIN_MS = 6e4;
function utcMidnight(t) {
  return Math.floor(t / DAY_MS) * DAY_MS;
}
function nthWeekdayOfMonthUTC(year, month0, weekday, n) {
  const first = Date.UTC(year, month0, 1);
  const firstDow = new Date(first).getUTCDay();
  let day = 1 + (weekday - firstDow + 7) % 7 + (n - 1) * 7;
  return Date.UTC(year, month0, day);
}
function lastWeekdayOfMonthUTC(year, month0, weekday) {
  const lastDay = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const last = Date.UTC(year, month0, lastDay);
  const lastDow = new Date(last).getUTCDay();
  const day = lastDay - (lastDow - weekday + 7) % 7;
  return Date.UTC(year, month0, day);
}
function easternOffsetMs(t) {
  const year = new Date(t).getUTCFullYear();
  const dstStart = nthWeekdayOfMonthUTC(year, 2, 0, 2) + 7 * HOUR_MS;
  const dstEnd = nthWeekdayOfMonthUTC(year, 10, 0, 1) + 6 * HOUR_MS;
  const isDst = t >= dstStart && t < dstEnd;
  return isDst ? -4 * HOUR_MS : -5 * HOUR_MS;
}
function toEastern(t) {
  const off = easternOffsetMs(t);
  const local = new Date(t + off);
  return {
    y: local.getUTCFullYear(),
    mo: local.getUTCMonth(),
    d: local.getUTCDate(),
    dow: local.getUTCDay(),
    minOfDay: local.getUTCHours() * 60 + local.getUTCMinutes()
  };
}
function usEquityHolidaysET(year) {
  const key = (ms) => {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
  };
  const observed = (ms) => {
    const dow = new Date(ms).getUTCDay();
    if (dow === 6) return ms - DAY_MS;
    if (dow === 0) return ms + DAY_MS;
    return ms;
  };
  const out = /* @__PURE__ */ new Set();
  out.add(key(observed(Date.UTC(year, 0, 1))));
  out.add(key(nthWeekdayOfMonthUTC(year, 0, 1, 3)));
  out.add(key(nthWeekdayOfMonthUTC(year, 1, 1, 3)));
  out.add(key(goodFridayUTC(year)));
  out.add(key(lastWeekdayOfMonthUTC(year, 4, 1)));
  out.add(key(observed(Date.UTC(year, 5, 19))));
  out.add(key(observed(Date.UTC(year, 6, 4))));
  out.add(key(nthWeekdayOfMonthUTC(year, 8, 1, 1)));
  out.add(key(nthWeekdayOfMonthUTC(year, 10, 4, 4)));
  out.add(key(observed(Date.UTC(year, 11, 25))));
  return out;
}
function goodFridayUTC(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = (h + l - 7 * m + 114) % 31 + 1;
  const easter = Date.UTC(year, month - 1, day);
  return easter - 2 * DAY_MS;
}
var EQUITY_OPEN_MIN = 9 * 60 + 30;
var EQUITY_CLOSE_MIN = 16 * 60;
var CryptoCalendar = class {
  id = "24x7";
  isOpen() {
    return true;
  }
  isTradingDay() {
    return true;
  }
  nextOpen(t) {
    return t;
  }
  nextClose(t) {
    return Number.POSITIVE_INFINITY;
  }
  nextTradingDayOpen(t) {
    return utcMidnight(t) + DAY_MS;
  }
};
var UsEquityCalendar = class {
  id = "us-equity";
  holidayCache = /* @__PURE__ */ new Map();
  holidays(year) {
    let h = this.holidayCache.get(year);
    if (!h) {
      h = usEquityHolidaysET(year);
      this.holidayCache.set(year, h);
    }
    return h;
  }
  isTradingDay(t) {
    const e = toEastern(t);
    if (e.dow === 0 || e.dow === 6) return false;
    return !this.holidays(e.y).has(`${e.y}-${e.mo}-${e.d}`);
  }
  isOpen(t) {
    if (!this.isTradingDay(t)) return false;
    const min = toEastern(t).minOfDay;
    return min >= EQUITY_OPEN_MIN && min < EQUITY_CLOSE_MIN;
  }
  /** ET civil-midnight instant for the day containing t, expressed in UTC. */
  etDayStartUTC(t) {
    const off = easternOffsetMs(t);
    const local = new Date(t + off);
    const localMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
    return localMidnight - off;
  }
  sessionOpenUTC(t) {
    return this.etDayStartUTC(t) + EQUITY_OPEN_MIN * MIN_MS;
  }
  sessionCloseUTC(t) {
    return this.etDayStartUTC(t) + EQUITY_CLOSE_MIN * MIN_MS;
  }
  nextOpen(t) {
    let cur = t;
    for (let guard = 0; guard < 4e3; guard++) {
      if (this.isTradingDay(cur)) {
        const open = this.sessionOpenUTC(cur);
        const close = this.sessionCloseUTC(cur);
        if (t < open) return open;
        if (t < close && t >= open) return t;
      }
      cur = this.etDayStartUTC(cur) + DAY_MS + HOUR_MS;
    }
    throw new Error("nextOpen: no trading day found within horizon");
  }
  nextClose(t) {
    let cur = t;
    for (let guard = 0; guard < 4e3; guard++) {
      if (this.isTradingDay(cur)) {
        const close = this.sessionCloseUTC(cur);
        if (t < close) return close;
      }
      cur = this.etDayStartUTC(cur) + DAY_MS + HOUR_MS;
    }
    throw new Error("nextClose: no trading day found within horizon");
  }
  nextTradingDayOpen(t) {
    const nextDay = this.etDayStartUTC(t) + DAY_MS + HOUR_MS;
    return this.nextOpen(nextDay);
  }
};
var CRYPTO = new CryptoCalendar();
var US_EQUITY = new UsEquityCalendar();
function getCalendar(id) {
  return id === "24x7" ? CRYPTO : US_EQUITY;
}

// ../sim/src/data/synthetic.ts
var YEAR_MIN = 365 * 24 * 60;
function roundTick(p, tick) {
  return Math.round(p / tick) * tick;
}
function generateMinuteBars(spec) {
  const rng = new Rng(spec.seed);
  const cal = getCalendar(spec.calendar);
  const dt = 1 / YEAR_MIN;
  const drift = (spec.driftAnnual - 0.5 * spec.volAnnual * spec.volAnnual) * dt;
  const diffusion = spec.volAnnual * Math.sqrt(dt);
  const bars = [];
  let price = spec.startPrice;
  let t = spec.start;
  let produced = 0;
  let guard = 0;
  const maxGuard = spec.minutes * 5 + 1e3;
  while (produced < spec.minutes && guard++ < maxGuard) {
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
    const vol = Math.round(spec.baseVolume * rng.range(0.5, 1.8) * (1 + 4 * Math.abs(shock - 1)));
    bars.push({
      t,
      o: roundTick(open, spec.tickSize),
      h: roundTick(high, spec.tickSize),
      l: roundTick(low, spec.tickSize),
      c: roundTick(close, spec.tickSize),
      v: vol
    });
    price = close;
    t += RESOLUTION_MS["1m"];
    produced++;
  }
  return bars;
}
function aggregate(bars, target) {
  const bucket = RESOLUTION_MS[target];
  const out = [];
  let cur = null;
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
function buildSyntheticInstrument(spec) {
  const minute = generateMinuteBars(spec);
  return new InstrumentData(spec.symbol, {
    "1m": new BarSeries("1m", minute),
    "1h": new BarSeries("1h", aggregate(minute, "1h")),
    "1d": new BarSeries("1d", aggregate(minute, "1d"))
  });
}

// ../sim/src/data/universe.ts
var cryptoFees = { takerBps: 40, makerBps: 20, perOrder: 0, minFee: 0 };
var equityFees = { takerBps: 0, makerBps: 0, perOrder: 0, minFee: 0 };
var cryptoMicro = { halfSpreadBps: 5, slippageK: 80, maxParticipation: 0.25 };
var equityMicro = { halfSpreadBps: 2, slippageK: 40, maxParticipation: 0.1 };
function crypto(symbol, name, tickSize, lotSize) {
  return {
    symbol,
    name,
    assetClass: "crypto",
    tickSize,
    lotSize,
    multiplier: 1,
    calendar: "24x7",
    fees: cryptoFees,
    micro: cryptoMicro,
    currency: "USD",
    shortable: true,
    borrowBps: 1500
  };
}
function equity(symbol, name) {
  return {
    symbol,
    name,
    assetClass: "equity",
    tickSize: 0.01,
    lotSize: 1,
    multiplier: 1,
    calendar: "us-equity",
    fees: equityFees,
    micro: equityMicro,
    currency: "USD",
    shortable: true,
    borrowBps: 300
  };
}
var INSTRUMENTS = [
  crypto("BTC-USD", "Bitcoin", 0.01, 1e-8),
  crypto("ETH-USD", "Ethereum", 0.01, 1e-4),
  crypto("SOL-USD", "Solana", 1e-3, 1e-3),
  equity("ACME", "Acme Corp"),
  equity("NOVA", "Nova Industries"),
  equity("ORN", "Orion Labs")
];
var Universe = class {
  map = /* @__PURE__ */ new Map();
  constructor(instruments) {
    for (const i of instruments) this.map.set(i.symbol, i);
  }
  get(symbol) {
    const i = this.map.get(symbol);
    if (!i) throw new Error(`Unknown instrument: ${symbol}`);
    return i;
  }
  has(symbol) {
    return this.map.has(symbol);
  }
  list(assetClass) {
    const all = [...this.map.values()];
    return assetClass ? all.filter((i) => i.assetClass === assetClass) : all;
  }
};
var universe = new Universe(INSTRUMENTS);
function barsPerYear(calendar, resolutionMinutes) {
  if (calendar === "24x7") return 365 * 24 * 60 / resolutionMinutes;
  return 252 * 6.5 * 60 / resolutionMinutes;
}
var SEED_SPECS = {
  "BTC-USD": { seed: 1001, startPrice: 96e3, driftAnnual: 0.35, volAnnual: 0.55 },
  "ETH-USD": { seed: 1002, startPrice: 3400, driftAnnual: 0.3, volAnnual: 0.7 },
  "SOL-USD": { seed: 1003, startPrice: 165, driftAnnual: 0.5, volAnnual: 0.95 },
  ACME: { seed: 2001, startPrice: 240, driftAnnual: 0.1, volAnnual: 0.28 },
  NOVA: { seed: 2002, startPrice: 420, driftAnnual: 0.12, volAnnual: 0.35 },
  ORN: { seed: 2003, startPrice: 130, driftAnnual: 0.18, volAnnual: 0.45 }
};
function buildSeedData(start, days = 30) {
  const out = /* @__PURE__ */ new Map();
  for (const inst2 of INSTRUMENTS) {
    const base = SEED_SPECS[inst2.symbol];
    const minutes = inst2.calendar === "24x7" ? days * 24 * 60 : days * 24 * 60;
    const spec = {
      symbol: inst2.symbol,
      seed: base.seed,
      startPrice: base.startPrice,
      driftAnnual: base.driftAnnual,
      volAnnual: base.volAnnual,
      calendar: inst2.calendar,
      minutes,
      start,
      baseVolume: inst2.assetClass === "crypto" ? 50 : 5e3,
      tickSize: inst2.tickSize
    };
    out.set(inst2.symbol, buildSyntheticInstrument(spec));
  }
  return out;
}

// ../sim/src/indicators/index.ts
var indicators_exports = {};
__export(indicators_exports, {
  atr: () => atr,
  bollinger: () => bollinger,
  closes: () => closes,
  ema: () => ema,
  lastDefined: () => lastDefined,
  macd: () => macd,
  obv: () => obv,
  rsi: () => rsi,
  sma: () => sma,
  stochastic: () => stochastic,
  supportResistance: () => supportResistance,
  vwap: () => vwap
});
var closes = (bars) => bars.map((b) => b.c);
function sma(values, period) {
  const out = new Array(values.length).fill(void 0);
  if (period <= 0) throw new Error("sma: period must be > 0");
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}
function ema(values, period) {
  const out = new Array(values.length).fill(void 0);
  if (period <= 0) throw new Error("ema: period must be > 0");
  const k = 2 / (period + 1);
  let prev;
  let seedSum = 0;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      seedSum += values[i];
    } else if (i === period - 1) {
      seedSum += values[i];
      prev = seedSum / period;
      out[i] = prev;
    } else {
      prev = values[i] * k + prev * (1 - k);
      out[i] = prev;
    }
  }
  return out;
}
function vwap(bars) {
  const out = new Array(bars.length).fill(void 0);
  let pv = 0;
  let vol = 0;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const typical = (b.h + b.l + b.c) / 3;
    pv += typical * b.v;
    vol += b.v;
    out[i] = vol > 0 ? pv / vol : void 0;
  }
  return out;
}
function bollinger(values, period = 20, mult = 2) {
  const mid = sma(values, period);
  const upper = new Array(values.length).fill(void 0);
  const lower = new Array(values.length).fill(void 0);
  const pctB = new Array(values.length).fill(void 0);
  const bw = new Array(values.length).fill(void 0);
  for (let i = period - 1; i < values.length; i++) {
    const m = mid[i];
    let acc = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = values[j] - m;
      acc += d * d;
    }
    const sd = Math.sqrt(acc / period);
    const u = m + mult * sd;
    const l = m - mult * sd;
    upper[i] = u;
    lower[i] = l;
    pctB[i] = u === l ? 0.5 : (values[i] - l) / (u - l);
    bw[i] = m !== 0 ? (u - l) / m : 0;
  }
  return { middle: mid, upper, lower, percentB: pctB, bandwidth: bw };
}
function rsi(values, period = 14) {
  const out = new Array(values.length).fill(void 0);
  if (values.length <= period) return out;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const ch = values[i] - values[i - 1];
    if (ch >= 0) avgGain += ch;
    else avgLoss -= ch;
  }
  avgGain /= period;
  avgLoss /= period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < values.length; i++) {
    const ch = values[i] - values[i - 1];
    const gain = ch > 0 ? ch : 0;
    const loss = ch < 0 ? -ch : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}
function macd(values, fast = 12, slow = 26, signalPeriod = 9) {
  const emaFast = ema(values, fast);
  const emaSlow = ema(values, slow);
  const macdLine = values.map(
    (_, i) => emaFast[i] !== void 0 && emaSlow[i] !== void 0 ? emaFast[i] - emaSlow[i] : void 0
  );
  const defined = [];
  const idxMap = [];
  macdLine.forEach((v, i) => {
    if (v !== void 0) {
      defined.push(v);
      idxMap.push(i);
    }
  });
  const sig = ema(defined, signalPeriod);
  const signal = new Array(values.length).fill(void 0);
  sig.forEach((v, j) => {
    if (v !== void 0) signal[idxMap[j]] = v;
  });
  const histogram = macdLine.map(
    (v, i) => v !== void 0 && signal[i] !== void 0 ? v - signal[i] : void 0
  );
  return { macd: macdLine, signal, histogram };
}
function stochastic(bars, kPeriod = 14, kSmooth = 3, dPeriod = 3) {
  const rawK = new Array(bars.length).fill(void 0);
  for (let i = kPeriod - 1; i < bars.length; i++) {
    let hh = -Infinity;
    let ll = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      hh = Math.max(hh, bars[j].h);
      ll = Math.min(ll, bars[j].l);
    }
    rawK[i] = hh === ll ? 50 : (bars[i].c - ll) / (hh - ll) * 100;
  }
  const kVals = rawK.map((v) => v === void 0 ? NaN : v);
  const k = smaSparse(kVals, kSmooth);
  const d = smaSparse(k.map((v) => v === void 0 ? NaN : v), dPeriod);
  return { k, d };
}
function smaSparse(values, period) {
  const out = new Array(values.length).fill(void 0);
  const buf = [];
  for (let i = 0; i < values.length; i++) {
    if (Number.isNaN(values[i])) {
      buf.length = 0;
      continue;
    }
    buf.push(values[i]);
    if (buf.length > period) buf.shift();
    if (buf.length === period) out[i] = buf.reduce((a, b) => a + b, 0) / period;
  }
  return out;
}
function atr(bars, period = 14) {
  const out = new Array(bars.length).fill(void 0);
  if (bars.length === 0) return out;
  const tr = new Array(bars.length);
  tr[0] = bars[0].h - bars[0].l;
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    const pc = bars[i - 1].c;
    tr[i] = Math.max(b.h - b.l, Math.abs(b.h - pc), Math.abs(b.l - pc));
  }
  if (bars.length <= period) return out;
  let prev = 0;
  for (let i = 1; i <= period; i++) prev += tr[i];
  prev /= period;
  out[period] = prev;
  for (let i = period + 1; i < bars.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}
function obv(bars) {
  const out = new Array(bars.length).fill(void 0);
  if (bars.length === 0) return out;
  let acc = 0;
  out[0] = 0;
  for (let i = 1; i < bars.length; i++) {
    const ch = bars[i].c - bars[i - 1].c;
    if (ch > 0) acc += bars[i].v;
    else if (ch < 0) acc -= bars[i].v;
    out[i] = acc;
  }
  return out;
}
function supportResistance(bars, lookback = 3, tol = 4e-3, maxLevels = 6) {
  const pivHi = [];
  const pivLo = [];
  for (let i = lookback; i < bars.length - lookback; i++) {
    let isHi = true;
    let isLo = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (bars[j].h >= bars[i].h) isHi = false;
      if (bars[j].l <= bars[i].l) isLo = false;
    }
    if (isHi) pivHi.push(bars[i].h);
    if (isLo) pivLo.push(bars[i].l);
  }
  const cluster = (pts, kind) => {
    const sorted = [...pts].sort((a, b) => a - b);
    const groups = [];
    for (const p of sorted) {
      const g = groups[groups.length - 1];
      if (g && Math.abs(p - g[g.length - 1]) / g[g.length - 1] <= tol) g.push(p);
      else groups.push([p]);
    }
    return groups.map((g) => ({
      price: g.reduce((a, b) => a + b, 0) / g.length,
      strength: g.length,
      kind
    }));
  };
  const levels = [...cluster(pivHi, "resistance"), ...cluster(pivLo, "support")];
  levels.sort((a, b) => b.strength - a.strength);
  return levels.slice(0, maxLevels);
}
function lastDefined(s) {
  for (let i = s.length - 1; i >= 0; i--) if (s[i] !== void 0) return s[i];
  return void 0;
}

// ../sim/src/options/bsm.ts
var SQRT_2PI = Math.sqrt(2 * Math.PI);
function normPdf(x) {
  return Math.exp(-0.5 * x * x) / SQRT_2PI;
}
function normCdf(x) {
  const neg = x < 0;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.2316419 * ax);
  const poly = t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const cdf = 1 - normPdf(ax) * poly;
  return neg ? 1 - cdf : cdf;
}
function d1d2(i) {
  const sqrtT = Math.sqrt(i.T);
  const denom = i.sigma * sqrtT;
  const d1 = (Math.log(i.S / i.K) + (i.r - i.q + 0.5 * i.sigma * i.sigma) * i.T) / denom;
  const d2 = d1 - denom;
  return { d1, d2, sqrtT };
}
function intrinsic(right, S, K) {
  return right === "call" ? Math.max(0, S - K) : Math.max(0, K - S);
}
function bsmPrice(right, i) {
  if (i.T <= 0 || i.sigma <= 0) {
    const fwd = i.S * Math.exp((i.r - i.q) * Math.max(i.T, 0));
    const disc = Math.exp(-i.r * Math.max(i.T, 0));
    return disc * intrinsic(right, fwd, i.K);
  }
  const { d1, d2 } = d1d2(i);
  const dfQ = Math.exp(-i.q * i.T);
  const dfR = Math.exp(-i.r * i.T);
  if (right === "call") {
    return i.S * dfQ * normCdf(d1) - i.K * dfR * normCdf(d2);
  }
  return i.K * dfR * normCdf(-d2) - i.S * dfQ * normCdf(-d1);
}
function bsmGreeks(right, i) {
  if (i.T <= 0 || i.sigma <= 0) {
    const itm = intrinsic(right, i.S, i.K) > 0;
    const delta2 = right === "call" ? itm ? 1 : 0 : itm ? -1 : 0;
    return { delta: delta2, gamma: 0, vega: 0, theta: 0, rho: 0, thetaPerDay: 0, vegaPerPct: 0 };
  }
  const { d1, d2, sqrtT } = d1d2(i);
  const dfQ = Math.exp(-i.q * i.T);
  const dfR = Math.exp(-i.r * i.T);
  const pdf = normPdf(d1);
  const gamma = dfQ * pdf / (i.S * i.sigma * sqrtT);
  const vega = i.S * dfQ * pdf * sqrtT;
  let delta;
  let theta;
  let rho;
  const termDecay = -(i.S * dfQ * pdf * i.sigma) / (2 * sqrtT);
  if (right === "call") {
    delta = dfQ * normCdf(d1);
    theta = termDecay - i.r * i.K * dfR * normCdf(d2) + i.q * i.S * dfQ * normCdf(d1);
    rho = i.K * i.T * dfR * normCdf(d2);
  } else {
    delta = dfQ * (normCdf(d1) - 1);
    theta = termDecay + i.r * i.K * dfR * normCdf(-d2) - i.q * i.S * dfQ * normCdf(-d1);
    rho = -i.K * i.T * dfR * normCdf(-d2);
  }
  return {
    delta,
    gamma,
    vega,
    theta,
    rho,
    thetaPerDay: theta / 365,
    vegaPerPct: vega / 100
  };
}

// ../sim/src/options/american.ts
function gbs(right, S, K, T, r, b, sigma) {
  const i = { S, K, T, r, q: r - b, sigma };
  return bsmPrice(right, i);
}
function d1of(S, K, T, b, sigma) {
  return (Math.log(S / K) + (b + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
}
function criticalCall(K, T, r, b, sigma) {
  const sig2 = sigma * sigma;
  const N = 2 * b / sig2;
  const m = 2 * r / sig2;
  const q2u = (-(N - 1) + Math.sqrt((N - 1) * (N - 1) + 4 * m)) / 2;
  const su = K / (1 - 1 / q2u);
  const h2 = -(b * T + 2 * sigma * Math.sqrt(T)) * (K / (su - K));
  let Si = K + (su - K) * (1 - Math.exp(h2));
  const k = 2 * r / (sig2 * (1 - Math.exp(-r * T)));
  const Q2 = (-(N - 1) + Math.sqrt((N - 1) * (N - 1) + 4 * k)) / 2;
  const sqrtT = Math.sqrt(T);
  for (let iter = 0; iter < 100; iter++) {
    const d1 = d1of(Si, K, T, b, sigma);
    const eb = Math.exp((b - r) * T);
    const c = gbs("call", Si, K, T, r, b, sigma);
    const RHS = c + (1 - eb * normCdf(d1)) * Si / Q2;
    const LHS = Si - K;
    const bi = eb * normCdf(d1) * (1 - 1 / Q2) + (1 - eb * normPdf(d1) / (sigma * sqrtT)) / Q2;
    const next = (K + RHS - bi * Si) / (1 - bi);
    if (Math.abs(LHS - RHS) / K < 1e-8 || !Number.isFinite(next)) return Si;
    Si = next;
  }
  return Si;
}
function criticalPut(K, T, r, b, sigma) {
  const sig2 = sigma * sigma;
  const N = 2 * b / sig2;
  const m = 2 * r / sig2;
  const q1u = (-(N - 1) - Math.sqrt((N - 1) * (N - 1) + 4 * m)) / 2;
  const su = K / (1 - 1 / q1u);
  const h1 = (b * T - 2 * sigma * Math.sqrt(T)) * (K / (K - su));
  let Si = su + (K - su) * Math.exp(h1);
  const k = 2 * r / (sig2 * (1 - Math.exp(-r * T)));
  const Q1 = (-(N - 1) - Math.sqrt((N - 1) * (N - 1) + 4 * k)) / 2;
  const sqrtT = Math.sqrt(T);
  for (let iter = 0; iter < 100; iter++) {
    const d1 = d1of(Si, K, T, b, sigma);
    const eb = Math.exp((b - r) * T);
    const p = gbs("put", Si, K, T, r, b, sigma);
    const RHS = p - (1 - eb * normCdf(-d1)) * Si / Q1;
    const LHS = K - Si;
    const bi = -eb * normCdf(-d1) * (1 - 1 / Q1) - (1 + eb * normPdf(-d1) / (sigma * sqrtT)) / Q1;
    const next = (K - RHS + bi * Si) / (1 + bi);
    if (Math.abs(LHS - RHS) / K < 1e-8 || !Number.isFinite(next)) return Si;
    Si = next;
  }
  return Si;
}
function americanPrice(right, i) {
  const { S, K, T, r, q, sigma } = i;
  if (T <= 0 || sigma <= 0) {
    return right === "call" ? Math.max(0, S - K) : Math.max(0, K - S);
  }
  const b = r - q;
  if (right === "call") {
    if (b >= r) return gbs("call", S, K, T, r, b, sigma);
    const Sk = criticalCall(K, T, r, b, sigma);
    if (S >= Sk) return S - K;
    const sig2 = sigma * sigma;
    const N = 2 * b / sig2;
    const k = 2 * r / (sig2 * (1 - Math.exp(-r * T)));
    const Q2 = (-(N - 1) + Math.sqrt((N - 1) * (N - 1) + 4 * k)) / 2;
    const d1 = d1of(Sk, K, T, b, sigma);
    const a2 = Sk / Q2 * (1 - Math.exp((b - r) * T) * normCdf(d1));
    return gbs("call", S, K, T, r, b, sigma) + a2 * Math.pow(S / Sk, Q2);
  } else {
    const Sk = criticalPut(K, T, r, b, sigma);
    if (S <= Sk) return K - S;
    const sig2 = sigma * sigma;
    const N = 2 * b / sig2;
    const k = 2 * r / (sig2 * (1 - Math.exp(-r * T)));
    const Q1 = (-(N - 1) - Math.sqrt((N - 1) * (N - 1) + 4 * k)) / 2;
    const d1 = d1of(Sk, K, T, b, sigma);
    const a1 = -(Sk / Q1) * (1 - Math.exp((b - r) * T) * normCdf(-d1));
    return gbs("put", S, K, T, r, b, sigma) + a1 * Math.pow(S / Sk, Q1);
  }
}
function americanGreeks(right, i) {
  const hS = i.S * 1e-4;
  const hSig = 1e-4;
  const hT = Math.min(i.T * 1e-3, 1 / 365 / 10);
  const hR = 1e-5;
  const p = (x) => americanPrice(right, x);
  const delta = (p({ ...i, S: i.S + hS }) - p({ ...i, S: i.S - hS })) / (2 * hS);
  const gamma = (p({ ...i, S: i.S + hS }) - 2 * p(i) + p({ ...i, S: i.S - hS })) / (hS * hS);
  const vega = (p({ ...i, sigma: i.sigma + hSig }) - p({ ...i, sigma: i.sigma - hSig })) / (2 * hSig);
  const theta = -(p({ ...i, T: i.T + hT }) - p({ ...i, T: Math.max(1e-9, i.T - hT) })) / (2 * hT);
  const rho = (p({ ...i, r: i.r + hR }) - p({ ...i, r: i.r - hR })) / (2 * hR);
  return { delta, gamma, vega, theta, rho, thetaPerDay: theta / 365, vegaPerPct: vega / 100 };
}

// ../sim/src/options/volsurface.ts
function realizedVol(bars, barsPerYear2, window2 = 60) {
  const n = bars.length;
  if (n < 3) return 0.5;
  const start = Math.max(1, n - window2);
  const rets = [];
  for (let i = start; i < n; i++) {
    const prev = bars[i - 1].c;
    const cur = bars[i].c;
    if (prev > 0 && cur > 0) rets.push(Math.log(cur / prev));
  }
  if (rets.length < 2) return 0.5;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varc = rets.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (rets.length - 1);
  const vol = Math.sqrt(varc * barsPerYear2);
  return Math.min(Math.max(vol, 0.05), 4);
}
var DEFAULT_SKEW = {
  // Equities: pronounced negative skew (downside puts bid), mild smile.
  equity: { slope: -0.35, curvature: 0.6, termHalfLife: 0.5, longVol: 0.25 },
  // Crypto: near-symmetric smile, both wings up, higher base.
  crypto: { slope: -0.1, curvature: 1.2, termHalfLife: 0.4, longVol: 0.7 }
};
var ModeledVolSurface = class {
  baseVol;
  params;
  constructor(baseVol, params) {
    this.baseVol = baseVol;
    this.params = params;
  }
  iv(query) {
    const { spot, strike, T, r, q } = query;
    const t = Math.max(T, 1 / 365 / 24);
    const fwd = spot * Math.exp((r - q) * t);
    const m = Math.log(strike / fwd);
    const p = this.params;
    const decay = Math.pow(0.5, t / p.termHalfLife);
    const atmVol = this.baseVol * decay + p.longVol * (1 - decay);
    const z = m / (atmVol * Math.sqrt(t));
    const shaped = atmVol * (1 + p.slope * z * (atmVol * Math.sqrt(t)) + p.curvature * m * m);
    return Math.min(Math.max(shaped, 0.02), 5);
  }
};
function buildModeledSurface(bars, assetClass, barsPerYear2) {
  const rv = realizedVol(bars, barsPerYear2);
  return new ModeledVolSurface(rv, DEFAULT_SKEW[assetClass]);
}

// ../sim/src/options/chain.ts
var YEAR_MS = 365 * 24 * 3600 * 1e3;
function yearsToExpiry(now, expiry) {
  return Math.max(0, (expiry - now) / YEAR_MS);
}
function priceAndGreeks(style, right, i) {
  if (style === "american") {
    return { price: americanPrice(right, i), greeks: americanGreeks(right, i) };
  }
  return { price: bsmPrice(right, i), greeks: bsmGreeks(right, i) };
}
function moneynessOf(right, spot, strike) {
  const rel = Math.abs(strike - spot) / spot;
  if (rel < 25e-4) return "ATM";
  if (right === "call") return spot > strike ? "ITM" : "OTM";
  return spot < strike ? "ITM" : "OTM";
}
function quoteOption(p, right, strike, expiry) {
  const T = yearsToExpiry(p.now, expiry);
  const iv = p.surface.iv({ spot: p.spot, strike, T, r: p.r, q: p.q });
  const inputs = { S: p.spot, K: strike, T, r: p.r, q: p.q, sigma: iv };
  const style = p.assetClass === "equity" ? "american" : "european";
  const settlement = p.assetClass === "equity" ? "shares" : "cash";
  const { price, greeks } = priceAndGreeks(style, right, inputs);
  const intrinsic2 = right === "call" ? Math.max(0, p.spot - strike) : Math.max(0, strike - p.spot);
  const theo = Math.max(price, 0);
  const spreadFrac = p.spreadFrac ?? 0.02;
  const minHalf = p.minHalfSpread ?? 0.01;
  const half = Math.max(theo * spreadFrac, minHalf);
  const bid = Math.max(0, theo - half);
  const ask = theo + half;
  const rel = Math.abs(strike - p.spot) / p.spot;
  const tenorFactor = Math.exp(-Math.abs(Math.log((T * 365 + 1) / 30)));
  const liqBase = Math.exp(-rel * 12) * tenorFactor;
  const oi = Math.round(5e3 * liqBase + 5);
  const volume = Math.round(800 * liqBase + 1);
  return {
    spec: {
      underlying: p.underlyingSymbol,
      right,
      strike,
      expiry,
      style,
      multiplier: p.multiplier,
      settlement
    },
    iv,
    theo,
    bid,
    ask,
    last: theo,
    intrinsic: intrinsic2,
    extrinsic: Math.max(0, theo - intrinsic2),
    greeks,
    oi,
    volume,
    moneyness: moneynessOf(right, p.spot, strike)
  };
}
function strikeLadder(spot, count, stepFrac) {
  const rawStep = spot * stepFrac;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const candidates = [1, 2, 2.5, 5, 10].map((m) => m * mag);
  let step = candidates[0];
  for (const c of candidates) if (Math.abs(c - rawStep) < Math.abs(step - rawStep)) step = c;
  const atm = Math.round(spot / step) * step;
  const out = [];
  for (let k = -count; k <= count; k++) {
    const strike = +(atm + k * step).toFixed(6);
    if (strike > 0) out.push(strike);
  }
  return out;
}
function thirdFridayUTC(year, month0) {
  const first = Date.UTC(year, month0, 1);
  const firstDow = new Date(first).getUTCDay();
  const day = 1 + (5 - firstDow + 7) % 7 + 14;
  return Date.UTC(year, month0, day, 21, 0, 0);
}
function standardExpiries(now, assetClass, count = 6) {
  const out = [];
  if (assetClass === "equity") {
    const d = new Date(now);
    let y = d.getUTCFullYear();
    let m = d.getUTCMonth();
    while (out.length < count) {
      const tf = thirdFridayUTC(y, m);
      if (tf > now) out.push(tf);
      m++;
      if (m > 11) {
        m = 0;
        y++;
      }
    }
  } else {
    const DAY = 864e5;
    let t = now;
    const day = new Date(now).getUTCDay();
    const toFriday = (5 - day + 7) % 7 || 7;
    let next = Math.floor(now / DAY) * DAY + toFriday * DAY + 8 * 36e5;
    for (let i = 0; i < Math.min(4, count); i++) {
      if (next > now) out.push(next);
      next += 7 * DAY;
    }
    const d = new Date(now);
    let y = d.getUTCFullYear();
    let mo = d.getUTCMonth() + 1;
    while (out.length < count) {
      if (mo > 11) {
        mo = 0;
        y++;
      }
      const last = new Date(Date.UTC(y, mo + 1, 0, 8, 0, 0)).getTime();
      if (last > now && !out.includes(last)) out.push(last);
      mo++;
    }
  }
  return out.slice(0, count).sort((a, b) => a - b);
}
function buildChain(p, opts = {}) {
  const strikes = strikeLadder(p.spot, opts.strikes ?? 8, opts.strikeStepFrac ?? 0.025);
  const expiries = opts.expiries ?? standardExpiries(p.now, p.assetClass);
  const chains = expiries.map((expiry) => {
    const calls = strikes.map((k) => quoteOption(p, "call", k, expiry));
    const puts = strikes.map((k) => quoteOption(p, "put", k, expiry));
    let atm = strikes[0];
    for (const k of strikes) if (Math.abs(k - p.spot) < Math.abs(atm - p.spot)) atm = k;
    return { expiry, calls, puts, atmStrike: atm };
  });
  return { underlying: p.underlyingSymbol, spot: p.spot, asOf: p.now, expiries: chains };
}

// ../sim/src/options/strategies.ts
function legCost(leg) {
  return leg.side * leg.qty * leg.entryPrice * leg.multiplier;
}
function netCost(legs) {
  return legs.reduce((a, l) => a + legCost(l), 0);
}
function valueAtExpiry(legs, S_T) {
  let v = 0;
  for (const l of legs) {
    if (l.kind === "option" && l.spec) {
      v += l.side * l.qty * l.multiplier * intrinsic(l.spec.right, S_T, l.spec.strike);
    } else {
      v += l.side * l.qty * l.multiplier * S_T;
    }
  }
  return v;
}
function analyzeStrategy(strategy, spot, opts = {}) {
  const legs = strategy.legs;
  const cost = netCost(legs);
  const span = opts.span ?? 0.6;
  const steps = opts.steps ?? 400;
  const lo = Math.max(0, spot * (1 - span));
  const hi = spot * (1 + span);
  const expiries = new Set(legs.filter((l) => l.kind === "option" && l.spec).map((l) => l.spec.expiry));
  const singleExpiry = expiries.size <= 1;
  const payoff = [];
  let maxProfit = -Infinity;
  let maxLoss = Infinity;
  for (let i = 0; i <= steps; i++) {
    const price = lo + (hi - lo) * i / steps;
    const pnl = valueAtExpiry(legs, price) - cost;
    payoff.push({ price, pnl });
    if (pnl > maxProfit) maxProfit = pnl;
    if (pnl < maxLoss) maxLoss = pnl;
  }
  const n = payoff.length;
  const slopeHi = payoff[n - 1].pnl - payoff[n - 2].pnl;
  const slopeLo = payoff[1].pnl - payoff[0].pnl;
  if (slopeHi > 1e-6) maxProfit = Infinity;
  if (slopeLo < -1e-6) maxProfit = Infinity;
  if (slopeHi < -1e-6) maxLoss = -Infinity;
  if (slopeLo > 1e-6) maxLoss = -Infinity;
  const breakevens = [];
  for (let i = 1; i < payoff.length; i++) {
    const a = payoff[i - 1];
    const b = payoff[i];
    if (a.pnl <= 0 && b.pnl > 0 || a.pnl >= 0 && b.pnl < 0) {
      const t = a.pnl / (a.pnl - b.pnl);
      breakevens.push(+(a.price + t * (b.price - a.price)).toFixed(4));
    }
  }
  return { netCost: cost, maxProfit, maxLoss, breakevens, payoff, singleExpiry };
}
var buy = (q, qty2 = 1) => ({
  kind: "option",
  side: 1,
  qty: qty2,
  entryPrice: q.ask,
  spec: q.spec,
  multiplier: q.spec.multiplier
});
var sell = (q, qty2 = 1) => ({
  kind: "option",
  side: -1,
  qty: qty2,
  entryPrice: q.bid,
  spec: q.spec,
  multiplier: q.spec.multiplier
});
function verticalSpread(longLeg, shortLeg, qty2 = 1) {
  const dir = longLeg.spec.right === "call" ? "Call" : "Put";
  return { name: `${dir} Vertical`, legs: [buy(longLeg, qty2), sell(shortLeg, qty2)] };
}
function straddle(call, put, qty2 = 1) {
  return { name: "Long Straddle", legs: [buy(call, qty2), buy(put, qty2)] };
}
function strangle(callOTM, putOTM, qty2 = 1) {
  return { name: "Long Strangle", legs: [buy(callOTM, qty2), buy(putOTM, qty2)] };
}
function ironCondor(longPut, shortPut, shortCall, longCall, qty2 = 1) {
  return {
    name: "Iron Condor",
    legs: [buy(longPut, qty2), sell(shortPut, qty2), sell(shortCall, qty2), buy(longCall, qty2)]
  };
}

// ../sim/src/engine/market.ts
function roundToTick(price, tick, side) {
  const n = price / tick;
  const r = side === "buy" ? Math.ceil(n - 1e-9) : Math.floor(n + 1e-9);
  return +(r * tick).toFixed(10);
}
var Market = class {
  universe;
  data;
  cfg;
  surfaceCache = /* @__PURE__ */ new Map();
  constructor(universe2, data, cfg) {
    this.universe = universe2;
    this.data = data;
    this.cfg = cfg;
  }
  setConfig(cfg) {
    this.cfg = cfg;
    this.surfaceCache.clear();
  }
  instrument(symbol) {
    return this.universe.get(symbol);
  }
  instrumentData(symbol) {
    const d = this.data.get(symbol);
    if (!d) throw new Error(`No data for ${symbol}`);
    return d;
  }
  /** Mid mark for a spot instrument at `now`. Undefined before data starts. */
  spotMark(symbol, now) {
    const p = this.instrumentData(symbol).markPrice(now);
    return p === void 0 ? void 0 : dec(p);
  }
  /** Bid/ask around the mid for a spot instrument. */
  spotBidAsk(symbol, now) {
    const mid = this.spotMark(symbol, now);
    if (!mid) return void 0;
    const inst2 = this.instrument(symbol);
    const half = this.cfg.feeRealism ? inst2.micro.halfSpreadBps / 1e4 : 0;
    return {
      bid: mid.mul(1 - half),
      ask: mid.mul(1 + half)
    };
  }
  /** The next bar that opens strictly after `afterOpen`, at the given resolution. */
  nextBar(symbol, afterOpen, resolution) {
    const id = this.instrumentData(symbol);
    if (!id.has(resolution)) return void 0;
    return id.get(resolution).nextBarAfter(afterOpen);
  }
  /** Finest resolution available for an instrument (for stepping). */
  steppingResolution(symbol) {
    const id = this.instrumentData(symbol);
    if (id.has("1m")) return "1m";
    if (id.has("1h")) return "1h";
    return "1d";
  }
  /**
   * Compute the execution against a specific bar for a market-style fill.
   * Applies half-spread + size slippage and caps fill at the bar's participation
   * limit (partial fills for large orders). `reference` is the bar open (the
   * "next available price"). Returns 0 fillQty if the bar has no volume.
   */
  executeAgainstBar(symbol, side, qty2, bar) {
    const inst2 = this.instrument(symbol);
    const micro = inst2.micro;
    const realism = this.cfg.feeRealism;
    const maxFill = realism ? Math.max(0, bar.v * micro.maxParticipation) : qty2;
    const fillQty = realism ? Math.min(qty2, maxFill) : qty2;
    if (fillQty <= 0) return { fillQty: 0, price: dec(bar.o) };
    const participation = realism && bar.v > 0 ? fillQty / bar.v : 0;
    const halfSpread = realism ? micro.halfSpreadBps / 1e4 : 0;
    const impact = realism ? micro.slippageK * participation / 1e4 : 0;
    const sign2 = side === "buy" ? 1 : -1;
    let px = bar.o * (1 + sign2 * (halfSpread + impact));
    px = side === "buy" ? Math.min(Math.max(px, bar.l), bar.h * 1.05) : Math.max(Math.min(px, bar.h), bar.l * 0.95);
    return { fillQty, price: dec(roundToTick(px, inst2.tickSize, side)) };
  }
  /** Fee for a fill: bps of notional + per-order, with a minimum, by liquidity. */
  fee(symbol, notional, liquidity) {
    if (!this.cfg.feeRealism) return Dec.ZERO;
    const inst2 = this.instrument(symbol);
    const bps = liquidity === "maker" ? inst2.fees.makerBps : inst2.fees.takerBps;
    const variable = notional.abs().mul(bps / 1e4);
    const total = variable.add(inst2.fees.perOrder);
    return total.max(inst2.fees.minFee).toCents();
  }
  // --- Options -------------------------------------------------------------
  volSurface(underlying, now) {
    const cached = this.surfaceCache.get(underlying);
    if (cached && cached.now === now) return cached.surface;
    const id = this.instrumentData(underlying);
    const res = id.has("1d") ? "1d" : id.has("1h") ? "1h" : "1m";
    const visible = id.get(res).visible(now);
    const inst2 = this.instrument(underlying);
    const minutes = res === "1d" ? 1440 : res === "1h" ? 60 : 1;
    const surface = buildModeledSurface(visible, inst2.assetClass, barsPerYear(inst2.calendar, minutes));
    this.surfaceCache.set(underlying, { now, surface });
    return surface;
  }
  /** Quote a single option contract at `now`. Undefined if no underlying mark. */
  optionQuote(spec, now) {
    const spotDec = this.spotMark(spec.underlying, now);
    if (!spotDec) return void 0;
    const inst2 = this.instrument(spec.underlying);
    const params = {
      underlyingSymbol: spec.underlying,
      assetClass: inst2.assetClass,
      spot: spotDec.toNumber(),
      now,
      r: this.cfg.riskFreeRate,
      q: inst2.assetClass === "equity" ? this.cfg.dividendYield : 0,
      surface: this.volSurface(spec.underlying, now),
      multiplier: spec.multiplier
    };
    return quoteOption(params, spec.right, spec.strike, spec.expiry);
  }
  /** Mid mark for an option contract (per share, pre-multiplier). */
  optionMark(spec, now) {
    const q = this.optionQuote(spec, now);
    return q ? dec(q.theo) : void 0;
  }
};

// ../sim/src/engine/portfolio.ts
var sign = (n) => n > 0 ? 1 : n < 0 ? -1 : 0;
function bookFill(existing, target, key, side, qty2, price, multiplier, at) {
  const signedQty = side === "buy" ? qty2 : -qty2;
  const oldQty = existing?.qty ?? 0;
  const oldAvg = existing?.avgCost ?? Dec.ZERO;
  const oldRealized = existing?.realized ?? Dec.ZERO;
  const newQty = +(oldQty + signedQty).toFixed(10);
  let realizedDelta = Dec.ZERO;
  let newAvg = oldAvg;
  if (oldQty === 0 || sign(oldQty) === sign(signedQty)) {
    const oldNotional = oldAvg.mul(Math.abs(oldQty));
    const addNotional = price.mul(Math.abs(signedQty));
    newAvg = Math.abs(newQty) === 0 ? Dec.ZERO : oldNotional.add(addNotional).div(Math.abs(newQty));
  } else {
    const closingQty = Math.min(Math.abs(signedQty), Math.abs(oldQty));
    if (oldQty > 0) {
      realizedDelta = price.sub(oldAvg).mul(closingQty).mul(multiplier);
    } else {
      realizedDelta = oldAvg.sub(price).mul(closingQty).mul(multiplier);
    }
    if (Math.abs(signedQty) <= Math.abs(oldQty)) {
      newAvg = newQty === 0 ? Dec.ZERO : oldAvg;
    } else {
      newAvg = price;
    }
  }
  const cashDelta = price.mul(-signedQty).mul(multiplier);
  if (newQty === 0) {
    return { position: void 0, realizedDelta, cashDelta };
  }
  const position = {
    key,
    target,
    qty: newQty,
    avgCost: newAvg,
    realized: oldRealized.add(realizedDelta),
    multiplier,
    openedAt: existing && sign(oldQty) === sign(newQty) ? existing.openedAt : at,
    option: target.option
  };
  return { position, realizedDelta, cashDelta };
}
var Portfolio = class {
  cash;
  positions = /* @__PURE__ */ new Map();
  /** Realized P&L booked across all closed trades (cumulative). */
  realizedPnl = Dec.ZERO;
  constructor(startingCash) {
    this.cash = startingCash;
  }
  get(key) {
    return this.positions.get(key);
  }
  /** Market value of a single position (signed). */
  positionValue(pos, resolve) {
    const mark = resolve(pos);
    if (!mark) return Dec.ZERO;
    return mark.mul(pos.qty).mul(pos.multiplier);
  }
  /** Unrealized P&L for a position. */
  unrealized(pos, resolve) {
    const mark = resolve(pos);
    if (!mark) return Dec.ZERO;
    return mark.sub(pos.avgCost).mul(pos.qty).mul(pos.multiplier);
  }
  totalUnrealized(resolve) {
    let acc = Dec.ZERO;
    for (const p of this.positions.values()) acc = acc.add(this.unrealized(p, resolve));
    return acc;
  }
  /** Sum of signed position market values. */
  positionsValue(resolve) {
    let acc = Dec.ZERO;
    for (const p of this.positions.values()) acc = acc.add(this.positionValue(p, resolve));
    return acc;
  }
  /** Gross (absolute) exposure across positions — drives margin. */
  grossExposure(resolve) {
    let acc = Dec.ZERO;
    for (const p of this.positions.values()) acc = acc.add(this.positionValue(p, resolve).abs());
    return acc;
  }
  /** Total account equity = cash + Σ signed position value. */
  equity(resolve) {
    return this.cash.add(this.positionsValue(resolve));
  }
  /** Buying power available to OPEN/INCREASE exposure. */
  buyingPower(resolve, marginMultiplier) {
    const eq = this.equity(resolve);
    const gross = this.grossExposure(resolve);
    const bp = eq.mul(marginMultiplier).sub(gross);
    return bp.isNeg() ? Dec.ZERO : bp;
  }
  /** Apply a booked fill: mutate cash + position. Returns realized delta. */
  apply(result, key) {
    this.cash = this.cash.add(result.cashDelta);
    this.realizedPnl = this.realizedPnl.add(result.realizedDelta);
    if (result.position) this.positions.set(key, result.position);
    else this.positions.delete(key);
    return result.realizedDelta;
  }
};

// ../sim/src/engine/world.ts
var YEAR_MS2 = 365 * 24 * 3600 * 1e3;
function optionKey(spec) {
  return `OPT:${spec.underlying}:${spec.right}:${spec.strike}:${spec.expiry}`;
}
function targetKey(t) {
  return t.kind === "option" && t.option ? optionKey(t.option) : t.symbol;
}
var DEFAULT_SETTINGS = {
  startingCash: 1e3,
  riskFreeRate: 0.04,
  dividendYield: 0.01,
  feeRealism: true,
  marginMultiplier: 1,
  helpEnabled: true,
  maintenanceMargin: 0.25
};
var World = class {
  universe;
  data;
  market;
  portfolio;
  settings;
  mode = "historical";
  now;
  startNow;
  orders = /* @__PURE__ */ new Map();
  fills = [];
  /** Equity-curve samples in sim-time. */
  equityCurve = [];
  /** Closed-trade records for analytics (§12). */
  closedTrades = [];
  /** Realized stats: theta captured/paid (signed: <0 paid, >0 collected), assignments, entry IV. */
  optionStats = {
    thetaPaid: dec(0),
    assignments: 0,
    expiredWorthless: 0,
    exercised: 0,
    ivSum: 0,
    ivCount: 0
  };
  /** Cumulative traded notional, for turnover (§12). */
  tradedNotional = dec(0);
  rng;
  idSeq = 0;
  constructor(opts) {
    this.universe = opts.universe;
    this.data = opts.data;
    this.settings = { ...DEFAULT_SETTINGS, ...opts.settings };
    this.now = opts.startNow;
    this.startNow = opts.startNow;
    this.portfolio = new Portfolio(dec(this.settings.startingCash));
    this.market = new Market(opts.universe, opts.data, this.marketCfg());
    this.rng = new Rng(opts.seed ?? 118497316);
    this.sampleEquity();
  }
  marketCfg() {
    return {
      riskFreeRate: this.settings.riskFreeRate,
      dividendYield: this.settings.dividendYield,
      feeRealism: this.settings.feeRealism
    };
  }
  id(prefix) {
    return `${prefix}${(++this.idSeq).toString(36)}`;
  }
  // --- Marking -------------------------------------------------------------
  /** Resolve the current mark for any position (spot or option) at `now`. */
  markResolver() {
    return (pos) => {
      if (pos.target.kind === "option" && pos.option) {
        return this.market.optionMark(pos.option, this.now);
      }
      return this.market.spotMark(pos.target.symbol, this.now);
    };
  }
  equity() {
    return this.portfolio.equity(this.markResolver());
  }
  buyingPower() {
    return this.portfolio.buyingPower(this.markResolver(), this.settings.marginMultiplier);
  }
  unrealized() {
    return this.portfolio.totalUnrealized(this.markResolver());
  }
  snapshot() {
    const resolve = this.markResolver();
    return {
      now: this.now,
      cash: this.portfolio.cash.toFixed(2),
      equity: this.portfolio.equity(resolve).toFixed(2),
      buyingPower: this.portfolio.buyingPower(resolve, this.settings.marginMultiplier).toFixed(2),
      positions: this.portfolio.positions.size,
      workingOrders: this.workingOrders().length
    };
  }
  workingOrders() {
    return [...this.orders.values()].filter((o) => o.status === "working" || o.status === "partial");
  }
  // --- Order submission ----------------------------------------------------
  submit(req) {
    const inst2 = req.target.kind === "spot" ? req.target.symbol : req.target.option?.underlying;
    if (!inst2 || !this.universe.has(inst2)) return { ok: false, reason: "Unknown instrument" };
    if (!(req.qty > 0)) return { ok: false, reason: "Quantity must be positive" };
    const instrument = this.universe.get(inst2);
    if (req.target.kind === "spot") {
      const lot = instrument.lotSize;
      const rounded = Math.round(req.qty / lot) * lot;
      if (Math.abs(rounded - req.qty) > lot * 1e-6 && rounded > 0) {
        req = { ...req, qty: rounded };
      }
    }
    if (req.side === "sell" && this.isOpeningShort(req) && !instrument.shortable) {
      return { ok: false, reason: "Instrument is not shortable" };
    }
    if ((req.type === "limit" || req.type === "stop-limit") && req.limitPrice === void 0)
      return { ok: false, reason: "Limit price required" };
    if ((req.type === "stop" || req.type === "stop-limit") && req.stopPrice === void 0)
      return { ok: false, reason: "Stop price required" };
    if (req.type === "trailing-stop" && req.trailAmount === void 0 && req.trailPercent === void 0)
      return { ok: false, reason: "Trail amount or percent required" };
    if (req.type === "market" && this.isOpening(req)) {
      const est = this.estimateNotional(req);
      if (est && est.gt(this.buyingPower())) {
        return {
          ok: false,
          reason: "Insufficient buying power to open this position. Reduce size, close other positions, or top up from the menu."
        };
      }
    }
    const order = {
      id: this.id("O"),
      target: req.target,
      side: req.side,
      qty: req.qty,
      type: req.type,
      limitPrice: req.limitPrice,
      stopPrice: req.stopPrice,
      trailAmount: req.trailAmount,
      trailPercent: req.trailPercent,
      tif: req.tif ?? "DAY",
      tag: req.tag,
      status: "working",
      filledQty: 0,
      avgFillPrice: Dec.ZERO,
      feesPaid: Dec.ZERO,
      createdAt: this.now,
      updatedAt: this.now,
      triggered: req.type === "market" || req.type === "limit"
    };
    this.orders.set(order.id, order);
    if (this.mode === "live" && req.type === "market") {
      this.fillLiveMarket(order);
    }
    return { ok: true, order };
  }
  cancel(orderId) {
    const o = this.orders.get(orderId);
    if (!o || o.status !== "working" && o.status !== "partial") return false;
    o.status = "cancelled";
    o.updatedAt = this.now;
    return true;
  }
  isOpening(req) {
    const pos = this.portfolio.get(targetKey(req.target));
    if (!pos) return true;
    const sameDir = req.side === "buy" && pos.qty > 0 || req.side === "sell" && pos.qty < 0;
    return sameDir;
  }
  isOpeningShort(req) {
    const pos = this.portfolio.get(targetKey(req.target));
    return (!pos || pos.qty <= 0) && req.side === "sell";
  }
  estimateNotional(req) {
    if (req.target.kind === "option" && req.target.option) {
      const m2 = this.market.optionMark(req.target.option, this.now);
      return m2 ? m2.mul(req.qty).mul(req.target.option.multiplier) : void 0;
    }
    const m = this.market.spotMark(req.target.symbol, this.now);
    return m ? m.mul(req.qty) : void 0;
  }
  // --- Time advancement ----------------------------------------------------
  advanceHour(opts) {
    const target = alignUp(this.now + RESOLUTION_MS["1h"], RESOLUTION_MS["1h"]);
    this.advanceTo(target, { stepRes: "1m", ...opts });
  }
  /** Advance to the next trading-day open of the *primary* calendar (crypto = next UTC day). */
  advanceDay(opts) {
    const target = this.now + RESOLUTION_MS["1d"];
    this.advanceTo(target, { stepRes: "1m", ...opts });
  }
  advanceMonth(opts) {
    const target = this.now + 30 * RESOLUTION_MS["1d"];
    this.advanceTo(target, { stepRes: "1h", ...opts });
  }
  /** Generic advance to an absolute timestamp. */
  advanceTo(target, opts = {}) {
    if (target <= this.now) return;
    const stepRes = opts.stepRes ?? "1m";
    const step = RESOLUTION_MS[stepRes];
    let t = this.now;
    let guard = 0;
    const maxSteps = Math.ceil((target - this.now) / step) + 4;
    while (t < target && guard++ <= maxSteps) {
      const next = Math.min(target, alignUp(t + 1, step));
      this.processStep(t, next, stepRes);
      t = next;
    }
    this.now = target;
    this.market.setConfig(this.marketCfg());
    this.processStep(t, target, stepRes);
    this.sampleEquity();
    opts.onTick?.(this.snapshot());
  }
  /** Process one bar-step covering (prevNow, newNow]. */
  processStep(prevNow, newNow, stepRes) {
    this.now = newNow;
    const step = RESOLUTION_MS[stepRes];
    const barOpen = newNow - step;
    const symbols = this.activeSymbols();
    for (const symbol of symbols) {
      const id = this.data.get(symbol);
      if (!id || !id.has(stepRes)) continue;
      const bar = id.get(stepRes).barOpeningAt(barOpen);
      if (!bar) continue;
      this.processSpotOrders(symbol, bar);
    }
    this.processOptionOrders();
    this.accrueOptionTheta(prevNow, newNow);
    this.settleExpiries();
    this.accrueBorrow(prevNow, newNow);
    this.expireDayOrders();
    this.market.setConfig(this.marketCfg());
    this.onTickSample(newNow);
  }
  activeSymbols() {
    const s = /* @__PURE__ */ new Set();
    for (const o of this.orders.values()) {
      if (o.status === "working" || o.status === "partial") s.add(symbolOf(o.target));
    }
    for (const p of this.portfolio.positions.values()) s.add(symbolOf(p.target));
    return s;
  }
  // --- Spot order execution ------------------------------------------------
  processSpotOrders(symbol, bar) {
    for (const o of this.orders.values()) {
      if (o.status !== "working" && o.status !== "partial") continue;
      if (o.target.kind !== "spot" || o.target.symbol !== symbol) continue;
      this.tryFillSpot(o, bar);
    }
  }
  remaining(o) {
    return o.qty - o.filledQty;
  }
  tryFillSpot(o, bar) {
    const side = o.side;
    let marketable = false;
    let limitCap;
    switch (o.type) {
      case "market":
        marketable = true;
        break;
      case "limit": {
        const lp = o.limitPrice;
        if (side === "buy" && bar.l <= lp) {
          marketable = true;
          limitCap = lp;
        } else if (side === "sell" && bar.h >= lp) {
          marketable = true;
          limitCap = lp;
        }
        break;
      }
      case "stop": {
        const sp = o.stopPrice;
        if (!o.triggered) {
          if (side === "buy" && bar.h >= sp) o.triggered = true;
          else if (side === "sell" && bar.l <= sp) o.triggered = true;
        }
        marketable = o.triggered;
        break;
      }
      case "stop-limit": {
        const sp = o.stopPrice;
        if (!o.triggered) {
          if (side === "buy" && bar.h >= sp) o.triggered = true;
          else if (side === "sell" && bar.l <= sp) o.triggered = true;
        }
        if (o.triggered) {
          const lp = o.limitPrice;
          if (side === "buy" && bar.l <= lp) {
            marketable = true;
            limitCap = lp;
          } else if (side === "sell" && bar.h >= lp) {
            marketable = true;
            limitCap = lp;
          }
        }
        break;
      }
      case "trailing-stop": {
        const trail = (price2) => o.trailAmount !== void 0 ? o.trailAmount : price2 * (o.trailPercent ?? 0);
        if (side === "sell") {
          const candidate = bar.h - trail(bar.h);
          o.dynamicStop = o.dynamicStop === void 0 ? candidate : Math.max(o.dynamicStop, candidate);
          if (!o.triggered && bar.l <= o.dynamicStop) o.triggered = true;
        } else {
          const candidate = bar.l + trail(bar.l);
          o.dynamicStop = o.dynamicStop === void 0 ? candidate : Math.min(o.dynamicStop, candidate);
          if (!o.triggered && bar.h >= o.dynamicStop) o.triggered = true;
        }
        marketable = o.triggered;
        break;
      }
    }
    if (!marketable) return;
    const sym2 = o.target.symbol;
    const exec = this.market.executeAgainstBar(sym2, side, this.remaining(o), bar);
    if (exec.fillQty <= 0) return;
    let price = exec.price;
    if (limitCap !== void 0) {
      price = side === "buy" ? price.min(limitCap) : price.max(limitCap);
    }
    this.bookOrderFill(o, exec.fillQty, price, "taker", bar.t);
  }
  // --- Option order execution ---------------------------------------------
  processOptionOrders() {
    for (const o of this.orders.values()) {
      if (o.status !== "working" && o.status !== "partial") continue;
      if (o.target.kind !== "option" || !o.target.option) continue;
      const q = this.market.optionQuote(o.target.option, this.now);
      if (!q) continue;
      const side = o.side;
      let fillPrice;
      switch (o.type) {
        case "market":
          fillPrice = side === "buy" ? q.ask : q.bid;
          break;
        case "limit": {
          const lp = o.limitPrice;
          if (side === "buy" && q.ask <= lp) fillPrice = Math.min(q.ask, lp);
          else if (side === "sell" && q.bid >= lp) fillPrice = Math.max(q.bid, lp);
          break;
        }
        case "stop":
        case "stop-limit": {
          const sp = o.stopPrice;
          if (!o.triggered) {
            if (side === "buy" && q.theo >= sp) o.triggered = true;
            else if (side === "sell" && q.theo <= sp) o.triggered = true;
          }
          if (o.triggered) {
            if (o.type === "stop") fillPrice = side === "buy" ? q.ask : q.bid;
            else {
              const lp = o.limitPrice;
              if (side === "buy" && q.ask <= lp) fillPrice = Math.min(q.ask, lp);
              else if (side === "sell" && q.bid >= lp) fillPrice = Math.max(q.bid, lp);
            }
          }
          break;
        }
        case "trailing-stop": {
          const trail = o.trailAmount ?? q.theo * (o.trailPercent ?? 0);
          if (side === "sell") {
            const cand = q.theo - trail;
            o.dynamicStop = o.dynamicStop === void 0 ? cand : Math.max(o.dynamicStop, cand);
            if (!o.triggered && q.theo <= o.dynamicStop) o.triggered = true;
          } else {
            const cand = q.theo + trail;
            o.dynamicStop = o.dynamicStop === void 0 ? cand : Math.min(o.dynamicStop, cand);
            if (!o.triggered && q.theo >= o.dynamicStop) o.triggered = true;
          }
          if (o.triggered) fillPrice = side === "buy" ? q.ask : q.bid;
          break;
        }
      }
      if (fillPrice === void 0) continue;
      this.bookOrderFill(o, this.remaining(o), dec(Math.max(0, fillPrice)), "taker", this.now);
    }
  }
  // --- Fill booking --------------------------------------------------------
  fillLiveMarket(o) {
    if (o.target.kind === "option" && o.target.option) {
      const q = this.market.optionQuote(o.target.option, this.now);
      if (!q) return;
      this.bookOrderFill(o, o.qty, dec(o.side === "buy" ? q.ask : q.bid), "taker", this.now);
    } else {
      const ba = this.market.spotBidAsk(o.target.symbol, this.now);
      if (!ba) return;
      this.bookOrderFill(o, o.qty, o.side === "buy" ? ba.ask : ba.bid, "taker", this.now);
    }
  }
  bookOrderFill(o, qty2, price, liquidity, at) {
    const key = targetKey(o.target);
    const mult = o.target.kind === "option" && o.target.option ? o.target.option.multiplier : 1;
    const symbol = symbolOf(o.target);
    const opening = this.isOpeningFill(o, key);
    if (opening) {
      const notional2 = price.mul(qty2).mul(mult);
      const bp = this.buyingPower();
      if (notional2.gt(bp.add("0.01"))) {
        o.status = "rejected";
        o.rejectReason = "Insufficient buying power at fill time";
        o.updatedAt = this.now;
        return;
      }
    }
    const notional = price.mul(qty2).mul(mult);
    const fee = this.market.fee(symbol, notional, liquidity);
    const existing = this.portfolio.get(key);
    const entryOpenedAt = existing?.openedAt ?? at;
    const booked = bookFill(existing, o.target, key, o.side, qty2, price, mult, at);
    const realized = this.portfolio.apply(booked, key);
    this.portfolio.cash = this.portfolio.cash.sub(fee);
    this.tradedNotional = this.tradedNotional.add(notional.abs());
    if (opening && o.target.kind === "option" && o.target.option) {
      const q = this.market.optionQuote(o.target.option, this.now);
      if (q) {
        this.optionStats.ivSum += q.iv;
        this.optionStats.ivCount++;
      }
    }
    const prevNotional = o.avgFillPrice.mul(o.filledQty);
    o.filledQty = +(o.filledQty + qty2).toFixed(10);
    o.avgFillPrice = o.filledQty > 0 ? prevNotional.add(price.mul(qty2)).div(o.filledQty) : Dec.ZERO;
    o.feesPaid = o.feesPaid.add(fee);
    o.status = o.filledQty >= o.qty - 1e-9 ? "filled" : "partial";
    o.updatedAt = at;
    const fill = {
      id: this.id("F"),
      orderId: o.id,
      target: o.target,
      side: o.side,
      qty: qty2,
      price,
      fee,
      at,
      realized,
      liquidity
    };
    this.fills.push(fill);
    if (!realized.isZero()) {
      this.recordClosedTrade(o.target, realized, at, at - entryOpenedAt);
    }
  }
  isOpeningFill(o, key) {
    const pos = this.portfolio.get(key);
    if (!pos) return true;
    return o.side === "buy" && pos.qty >= 0 || o.side === "sell" && pos.qty <= 0;
  }
  // --- Option expiry & assignment -----------------------------------------
  settleExpiries() {
    for (const pos of [...this.portfolio.positions.values()]) {
      if (pos.target.kind !== "option" || !pos.option) continue;
      if (pos.option.expiry > this.now) continue;
      this.settleOption(pos);
    }
  }
  settleOption(pos) {
    const spec = pos.option;
    const spot = this.market.spotMark(spec.underlying, this.now);
    const key = optionKey(spec);
    const right = spec.right;
    const strike = spec.strike;
    const mult = spec.multiplier;
    const intrinsic2 = spot ? right === "call" ? Math.max(0, spot.toNumber() - strike) : Math.max(0, strike - spot.toNumber()) : 0;
    if (intrinsic2 <= 0) {
      const booked = bookFill(pos, pos.target, key, pos.qty > 0 ? "sell" : "buy", Math.abs(pos.qty), Dec.ZERO, mult, this.now);
      const realized = this.portfolio.apply(booked, key);
      this.recordClosedTrade(pos.target, realized, this.now, this.now - pos.openedAt);
      this.optionStats.expiredWorthless++;
      return;
    }
    if (spec.settlement === "cash") {
      const booked = bookFill(pos, pos.target, key, pos.qty > 0 ? "sell" : "buy", Math.abs(pos.qty), dec(intrinsic2), mult, this.now);
      const realized = this.portfolio.apply(booked, key);
      this.recordClosedTrade(pos.target, realized, this.now, this.now - pos.openedAt);
      if (pos.qty < 0) this.optionStats.assignments++;
      else this.optionStats.exercised++;
      return;
    }
    this.exerciseToShares(pos);
  }
  /** Convert an in-the-money equity option into the resulting stock position. */
  exerciseToShares(pos) {
    const spec = pos.option;
    const key = optionKey(spec);
    const contracts = Math.abs(pos.qty);
    const shares = contracts * spec.multiplier;
    const isLong = pos.qty > 0;
    const isCall = spec.right === "call";
    const sharesDir = isCall === isLong ? 1 : -1;
    const basisPerShare = isCall ? spec.strike + pos.avgCost.toNumber() : spec.strike - pos.avgCost.toNumber();
    const cashDelta = dec(-sharesDir * spec.strike * shares);
    this.portfolio.positions.delete(key);
    this.portfolio.cash = this.portfolio.cash.add(cashDelta);
    const stockTarget = { kind: "spot", symbol: spec.underlying };
    const existing = this.portfolio.get(spec.underlying);
    const side = sharesDir > 0 ? "buy" : "sell";
    const booked = bookFill(existing, stockTarget, spec.underlying, side, shares, dec(Math.max(0, basisPerShare)), 1, this.now);
    this.portfolio.realizedPnl = this.portfolio.realizedPnl.add(booked.realizedDelta);
    if (booked.position) this.portfolio.positions.set(spec.underlying, booked.position);
    else this.portfolio.positions.delete(spec.underlying);
    if (!booked.realizedDelta.isZero()) this.recordClosedTrade(stockTarget, booked.realizedDelta, this.now, this.now - pos.openedAt);
    if (isLong) this.optionStats.exercised++;
    else this.optionStats.assignments++;
  }
  // --- Borrow cost ---------------------------------------------------------
  /** Accrue realized theta: Σ position.theta × qty × mult × dtYears (signed). */
  accrueOptionTheta(prevNow, newNow) {
    const dtYears = (newNow - prevNow) / YEAR_MS2;
    if (dtYears <= 0) return;
    for (const pos of this.portfolio.positions.values()) {
      if (pos.target.kind !== "option" || !pos.option) continue;
      const q = this.market.optionQuote(pos.option, this.now);
      if (!q) continue;
      const thetaPnl = q.greeks.theta * pos.qty * pos.multiplier * dtYears;
      this.optionStats.thetaPaid = this.optionStats.thetaPaid.add(thetaPnl);
    }
  }
  accrueBorrow(prevNow, newNow) {
    const dtYears = (newNow - prevNow) / YEAR_MS2;
    if (dtYears <= 0) return;
    const resolve = this.markResolver();
    let cost = Dec.ZERO;
    for (const pos of this.portfolio.positions.values()) {
      if (pos.target.kind !== "spot" || pos.qty >= 0) continue;
      const inst2 = this.universe.get(pos.target.symbol);
      const value = this.portfolio.positionValue(pos, resolve).abs();
      cost = cost.add(value.mul(inst2.borrowBps / 1e4 * dtYears));
    }
    if (cost.isPos()) this.portfolio.cash = this.portfolio.cash.sub(cost.toCents());
  }
  // --- DAY order expiry ----------------------------------------------------
  expireDayOrders() {
    for (const o of this.orders.values()) {
      if (o.status !== "working" && o.status !== "partial" || o.tif !== "DAY") continue;
      const sym2 = symbolOf(o.target);
      const cal = getCalendar(this.universe.get(sym2).calendar);
      const sessionClose = cal.nextClose(o.createdAt);
      if (this.now >= sessionClose) {
        o.status = o.filledQty > 0 ? "filled" : "expired";
        o.updatedAt = this.now;
      }
    }
  }
  // --- Stats sampling ------------------------------------------------------
  lastSample = -1;
  onTickSample(t) {
    if (this.lastSample < 0 || t - this.lastSample >= RESOLUTION_MS["1d"]) {
      this.sampleEquity();
      this.lastSample = t;
    }
  }
  sampleEquity() {
    this.equityCurve.push({ t: this.now, equity: this.equity().toFixed(2) });
  }
  recordClosedTrade(target, realized, at, holdMs = 0) {
    const symbol = symbolOf(target);
    this.closedTrades.push({
      symbol,
      kind: target.kind,
      assetClass: this.universe.get(symbol).assetClass,
      realized: realized.toFixed(2),
      at,
      holdMs
    });
  }
  // --- Mode / settings -----------------------------------------------------
  setMode(mode) {
    this.mode = mode;
  }
  updateSettings(patch) {
    this.settings = { ...this.settings, ...patch };
    this.market.setConfig(this.marketCfg());
  }
  /** Top up the bankroll (§11). */
  deposit(amount) {
    this.portfolio.cash = this.portfolio.cash.add(amount);
  }
  /** Reset the simulator to a fresh start state (§11). */
  reset(opts) {
    if (opts?.startingCash !== void 0) this.settings.startingCash = opts.startingCash;
    this.now = opts?.startNow ?? this.startNow;
    this.portfolio = new Portfolio(dec(this.settings.startingCash));
    this.orders.clear();
    this.fills.length = 0;
    this.equityCurve.length = 0;
    this.closedTrades.length = 0;
    this.optionStats = { thetaPaid: dec(0), assignments: 0, expiredWorthless: 0, exercised: 0, ivSum: 0, ivCount: 0 };
    this.tradedNotional = dec(0);
    this.idSeq = 0;
    this.lastSample = -1;
    this.market.setConfig(this.marketCfg());
    this.sampleEquity();
  }
};
function symbolOf(t) {
  return t.kind === "option" && t.option ? t.option.underlying : t.symbol;
}
function alignUp(t, step) {
  return Math.ceil(t / step) * step;
}

// ../sim/src/engine/stats.ts
function tradeStats(trades) {
  let wins = 0;
  let losses = 0;
  let grossProfit = dec(0);
  let grossLoss = dec(0);
  let holdSum = 0;
  for (const t of trades) {
    const r = dec(t.realized);
    if (r.isPos()) {
      wins++;
      grossProfit = grossProfit.add(r);
    } else if (r.isNeg()) {
      losses++;
      grossLoss = grossLoss.add(r.abs());
    }
    holdSum += t.holdMs;
  }
  const n = trades.length;
  const net = grossProfit.sub(grossLoss);
  return {
    trades: n,
    wins,
    losses,
    winRate: n > 0 ? wins / n : 0,
    avgWin: wins > 0 ? grossProfit.div(wins).toFixed(2) : "0.00",
    avgLoss: losses > 0 ? grossLoss.div(losses).neg().toFixed(2) : "0.00",
    profitFactor: grossLoss.isPos() ? grossProfit.div(grossLoss).toNumber() : grossProfit.isPos() ? Infinity : 0,
    expectancy: n > 0 ? net.div(n).toFixed(2) : "0.00",
    grossProfit: grossProfit.toFixed(2),
    grossLoss: grossLoss.neg().toFixed(2),
    avgHoldHours: n > 0 ? holdSum / n / 36e5 : 0
  };
}
function drawdown(curve) {
  let peak = curve.length ? dec(curve[0].equity) : dec(0);
  let maxDd = dec(0);
  let maxDdPct = 0;
  for (const p of curve) {
    const e = dec(p.equity);
    if (e.gt(peak)) peak = e;
    const dd = peak.sub(e);
    if (dd.gt(maxDd)) maxDd = dd;
    const pct2 = peak.isPos() ? dd.div(peak).toNumber() : 0;
    if (pct2 > maxDdPct) maxDdPct = pct2;
  }
  const cur = curve.length ? dec(curve[curve.length - 1].equity) : dec(0);
  const curDd = peak.sub(cur);
  return {
    peakEquity: peak.toFixed(2),
    currentEquity: cur.toFixed(2),
    maxDrawdown: maxDd.toFixed(2),
    maxDrawdownPct: maxDdPct,
    currentDrawdown: curDd.toFixed(2),
    currentDrawdownPct: peak.isPos() ? curDd.div(peak).toNumber() : 0
  };
}
function breakdownBy(trades, keyFn) {
  const m = /* @__PURE__ */ new Map();
  for (const t of trades) {
    const k = keyFn(t);
    const cur = m.get(k) ?? { realized: dec(0), trades: 0 };
    cur.realized = cur.realized.add(t.realized);
    cur.trades++;
    m.set(k, cur);
  }
  return [...m.entries()].map(([key, v]) => ({ key, realized: v.realized.toFixed(2), trades: v.trades })).sort((a, b) => dec(b.realized).cmp(dec(a.realized)));
}
function analytics(world) {
  const resolve = world.markResolver();
  const realized = world.portfolio.realizedPnl;
  const unrealized = world.portfolio.totalUnrealized(resolve);
  const equity2 = world.equity();
  const os = world.optionStats;
  const avgEquity = world.equityCurve.length ? world.equityCurve.reduce((a, p) => a.add(p.equity), dec(0)).div(world.equityCurve.length) : equity2;
  return {
    asOf: world.now,
    cash: world.portfolio.cash.toFixed(2),
    equity: equity2.toFixed(2),
    buyingPower: world.buyingPower().toFixed(2),
    totalRealized: realized.toFixed(2),
    totalUnrealized: unrealized.toFixed(2),
    totalPnl: realized.add(unrealized).toFixed(2),
    trade: tradeStats(world.closedTrades),
    drawdown: drawdown(world.equityCurve),
    byInstrument: breakdownBy(world.closedTrades, (t) => t.symbol),
    byAssetClass: breakdownBy(world.closedTrades, (t) => t.assetClass),
    options: {
      avgEntryIv: os.ivCount > 0 ? os.ivSum / os.ivCount : 0,
      thetaCapturedOrPaid: os.thetaPaid.toFixed(2),
      assignments: os.assignments,
      exercised: os.exercised,
      expiredWorthless: os.expiredWorthless
    },
    turnover: avgEquity.isPos() ? world.tradedNotional.div(avgEquity).toNumber() : 0,
    equityCurve: world.equityCurve.map((p) => ({ t: p.t, equity: p.equity }))
  };
}

// ../sim/src/terminal/scanner.ts
function scan(world, symbol, timeframe = "1h") {
  const id = world.data.get(symbol);
  if (!id) throw new Error(`No data for ${symbol}`);
  const res = id.has(timeframe) ? timeframe : id.has("1h") ? "1h" : "1d";
  const bars = id.get(res).visible(world.now);
  const help = world.settings.helpEnabled;
  const price = bars.length ? bars[bars.length - 1].c : void 0;
  const c = closes(bars);
  const rsiSeries = rsi(c, 14);
  const rsiVal = lastDefined(rsiSeries);
  const macdRes = macd(c);
  const macdVal = lastDefined(macdRes.macd);
  const signalVal = lastDefined(macdRes.signal);
  const histVal = lastDefined(macdRes.histogram);
  const sma50 = lastDefined(sma(c, 50));
  const sma200 = lastDefined(sma(c, 200));
  const ema20 = lastDefined(ema(c, 20));
  const bb = bollinger(c, 20, 2);
  const bbUpper = lastDefined(bb.upper);
  const bbLower = lastDefined(bb.lower);
  const bbWidth = lastDefined(bb.bandwidth);
  const atrVal = lastDefined(atr(bars, 14));
  const stoch = stochastic(bars);
  const stochK = lastDefined(stoch.k);
  const vwapVal = lastDefined(vwap(bars));
  const obvVal = lastDefined(obv(bars));
  const levels = supportResistance(bars).map((l) => ({ price: +l.price.toFixed(4), kind: l.kind, strength: l.strength }));
  let trend = "sideways";
  if (price !== void 0 && ema20 !== void 0) {
    if (sma50 !== void 0 && sma200 !== void 0) {
      trend = sma50 > sma200 && price > sma50 ? "up" : sma50 < sma200 && price < sma50 ? "down" : "sideways";
    } else {
      trend = price > ema20 * 1.002 ? "up" : price < ema20 * 0.998 ? "down" : "sideways";
    }
  }
  let momentum = "neutral";
  if (rsiVal !== void 0) {
    if (rsiVal >= 70) momentum = "overbought";
    else if (rsiVal <= 30) momentum = "oversold";
    else if (histVal !== void 0) momentum = histVal > 0 ? "bullish" : histVal < 0 ? "bearish" : "neutral";
  }
  let volatility = "normal";
  if (bbWidth !== void 0) {
    if (bbWidth > 0.12) volatility = "expanding";
    else if (bbWidth < 0.04) volatility = "contracting";
  }
  const readings = [
    { indicator: "RSI(14)", value: rsiVal, state: momentum },
    {
      indicator: "MACD",
      value: macdVal,
      state: macdVal !== void 0 && signalVal !== void 0 ? macdVal > signalVal ? "above-signal" : "below-signal" : "n/a"
    },
    { indicator: "SMA(50)", value: sma50, state: price !== void 0 && sma50 !== void 0 ? price > sma50 ? "above" : "below" : "n/a" },
    { indicator: "SMA(200)", value: sma200, state: price !== void 0 && sma200 !== void 0 ? price > sma200 ? "above" : "below" : "n/a" },
    { indicator: "EMA(20)", value: ema20, state: price !== void 0 && ema20 !== void 0 ? price > ema20 ? "above" : "below" : "n/a" },
    { indicator: "Bollinger %width", value: bbWidth, state: volatility },
    { indicator: "ATR(14)", value: atrVal, state: "volatility" },
    { indicator: "Stoch %K", value: stochK, state: stochK !== void 0 ? stochK >= 80 ? "overbought" : stochK <= 20 ? "oversold" : "mid" : "n/a" },
    { indicator: "VWAP", value: vwapVal, state: price !== void 0 && vwapVal !== void 0 ? price > vwapVal ? "above" : "below" : "n/a" },
    { indicator: "OBV", value: obvVal, state: "flow" }
  ];
  const callouts = [];
  if (help) {
    if (rsiVal !== void 0 && rsiVal >= 70) {
      callouts.push({
        title: `RSI ${rsiVal.toFixed(0)} \u2014 overbought`,
        detail: "RSI above 70 means recent gains have been large relative to losses. It often precedes a pause or mean-reversion \u2014 but a strong trend can stay overbought for a while. It is a condition, not a sell signal.",
        lessonId: "momentum-rsi",
        severity: "watch"
      });
    }
    if (rsiVal !== void 0 && rsiVal <= 30) {
      callouts.push({
        title: `RSI ${rsiVal.toFixed(0)} \u2014 oversold`,
        detail: "RSI below 30 reflects heavy recent selling. Markets can bounce from here, but oversold can persist in a downtrend. Look for confirmation rather than catching a falling knife.",
        lessonId: "momentum-rsi",
        severity: "watch"
      });
    }
    if (price !== void 0 && bbUpper !== void 0 && price > bbUpper) {
      callouts.push({
        title: "Price above the upper Bollinger band",
        detail: "Price is stretched more than two standard deviations above its 20-period mean. This signals an extended move and elevated odds of reversion or consolidation \u2014 not a guarantee of a top.",
        lessonId: "volatility-bands",
        severity: "watch"
      });
    }
    if (price !== void 0 && bbLower !== void 0 && price < bbLower) {
      callouts.push({
        title: "Price below the lower Bollinger band",
        detail: "Price is stretched below its lower band \u2014 an extended down-move. Reversion is more likely, but in a strong downtrend bands can keep being pierced.",
        lessonId: "volatility-bands",
        severity: "watch"
      });
    }
    if (macdVal !== void 0 && signalVal !== void 0 && histVal !== void 0) {
      const cross = histVal > 0 ? "bullish" : "bearish";
      callouts.push({
        title: `MACD ${cross} (histogram ${histVal >= 0 ? "+" : ""}${histVal.toFixed(3)})`,
        detail: cross === "bullish" ? "The MACD line is above its signal line, indicating upward momentum is building. Watch for the histogram shrinking, which warns momentum is fading." : "The MACD line is below its signal line, indicating downward momentum. A rising histogram toward zero hints momentum may be turning.",
        lessonId: "momentum-macd",
        severity: "info"
      });
    }
    if (sma50 !== void 0 && sma200 !== void 0) {
      const golden = sma50 > sma200;
      callouts.push({
        title: golden ? "50 above 200 \u2014 bullish regime" : "50 below 200 \u2014 bearish regime",
        detail: golden ? "The 50-period average sits above the 200-period (a 'golden cross' regime), a classic longer-term uptrend backdrop." : "The 50-period average sits below the 200-period (a 'death cross' regime), a longer-term downtrend backdrop.",
        lessonId: "trend-moving-averages",
        severity: "info"
      });
    }
    if (volatility === "contracting") {
      callouts.push({
        title: "Volatility squeeze",
        detail: "Bollinger bands have narrowed sharply. Low volatility tends to be followed by expansion \u2014 a 'squeeze' often precedes a larger directional move, though it does not tell you the direction.",
        lessonId: "volatility-bands",
        severity: "watch"
      });
    }
    if (vwapVal !== void 0 && price !== void 0) {
      callouts.push({
        title: price > vwapVal ? "Trading above VWAP" : "Trading below VWAP",
        detail: "VWAP is the volume-weighted average price for the session. Trading above it means buyers have the edge intraday; below it favors sellers. Institutions often use it as a benchmark.",
        lessonId: "vwap",
        severity: "info"
      });
    }
    if (levels.length > 0) {
      const nearest = levels.map((l) => ({ ...l, dist: price !== void 0 ? Math.abs(l.price - price) : Infinity })).sort((a, b) => a.dist - b.dist)[0];
      callouts.push({
        title: `Nearby ${nearest.kind} \u2248 ${nearest.price}`,
        detail: `A clustered ${nearest.kind} level sits close to price (strength ${nearest.strength}). Such levels often act as decision points \u2014 watch how price reacts there.`,
        lessonId: "support-resistance",
        severity: "info"
      });
    }
  }
  return {
    symbol,
    timeframe: res,
    asOf: world.now,
    price,
    trend,
    momentum,
    volatility,
    readings,
    levels,
    callouts,
    helpEnabled: help
  };
}

// ../sim/src/learn/curriculum.ts
var CURRICULUM = [
  {
    id: "basics",
    index: 1,
    title: "What an Option Is",
    summary: "Calls, puts, the contract, and the chain.",
    checkpoint: false,
    passThreshold: 0.7,
    lessons: [
      {
        id: "calls-puts",
        title: "Calls and Puts",
        body: "A call gives the right (not obligation) to BUY 100 shares at the strike before expiry. A put gives the right to SELL at the strike. You pay a premium for that right. Sellers (writers) collect the premium and take on the obligation."
      },
      {
        id: "the-chain",
        title: "Reading the Chain",
        body: "The option chain lists every strike and expiry with bid/ask, last, volume, open interest, IV and Greeks. Calls sit on one side, puts on the other, organized by expiration date.",
        demo: { kind: "chain", underlying: "BTC-USD", note: "Open the live chain and find the at-the-money strike." }
      }
    ],
    quiz: [
      {
        id: "q-call",
        kind: "multiple-choice",
        prompt: "A call option gives the holder the right to\u2026",
        options: ["Sell the underlying at the strike", "Buy the underlying at the strike", "Collect a dividend", "Short the stock for free"],
        answer: 1,
        explanation: "A call is the right to BUY at the strike price."
      },
      {
        id: "q-premium",
        kind: "multiple-choice",
        prompt: "Who receives the premium?",
        options: ["The buyer", "The exchange only", "The seller/writer", "Nobody"],
        answer: 2,
        explanation: "The option seller collects the premium in exchange for taking on the obligation."
      }
    ]
  },
  {
    id: "moneyness",
    index: 2,
    title: "Moneyness & Value",
    summary: "Intrinsic vs. extrinsic value; ITM/ATM/OTM.",
    checkpoint: false,
    passThreshold: 0.7,
    lessons: [
      {
        id: "intrinsic-extrinsic",
        title: "Intrinsic vs Extrinsic",
        body: "Intrinsic value is what the option is worth if exercised now (max(0, spot\u2212strike) for a call). Extrinsic (time) value is everything above intrinsic \u2014 it reflects time and volatility, and decays to zero at expiry."
      }
    ],
    quiz: [
      {
        id: "q-itm",
        kind: "scenario",
        prompt: "Spot is $105, you hold a $100 call. Its intrinsic value is\u2026",
        options: ["$0", "$5", "$100", "$105"],
        answer: 1,
        explanation: "max(0, 105 \u2212 100) = $5 of intrinsic value."
      }
    ]
  },
  {
    id: "greeks",
    index: 3,
    title: "The Greeks",
    summary: "Delta, gamma, theta, vega, rho \u2014 one at a time.",
    checkpoint: true,
    passThreshold: 0.75,
    lessons: [
      {
        id: "delta",
        title: "Delta",
        body: "Delta is how much the option price moves per $1 move in the underlying. Calls: 0\u21921, puts: \u22121\u21920. ATM \u2248 \xB10.5. Delta also approximates the probability of finishing in the money.",
        demo: { kind: "greeks-slider", underlying: "ACME", note: "Drag spot and watch delta change." }
      },
      {
        id: "gamma",
        title: "Gamma",
        body: "Gamma is the rate of change of delta. It's highest at-the-money and near expiry. High gamma means delta \u2014 and your directional exposure \u2014 shifts quickly."
      },
      {
        id: "theta",
        title: "Theta",
        body: "Theta is time decay: how much value the option loses per day, all else equal. Long options pay theta; short options collect it. Decay accelerates into expiry for ATM options."
      },
      {
        id: "vega",
        title: "Vega",
        body: "Vega is sensitivity to implied volatility. When IV rises, long options gain; when IV falls (e.g., after an event), they lose \u2014 the 'vol crush'."
      },
      {
        id: "rho",
        title: "Rho",
        body: "Rho is sensitivity to interest rates \u2014 usually the smallest Greek for short-dated options, more relevant for LEAPS."
      }
    ],
    quiz: [
      {
        id: "q-theta",
        kind: "multiple-choice",
        prompt: "All else equal, as time passes a long option's extrinsic value\u2026",
        options: ["Increases", "Stays flat", "Decays toward zero", "Becomes negative"],
        answer: 2,
        explanation: "Theta decay erodes extrinsic value to zero at expiry."
      },
      {
        id: "q-delta",
        kind: "multiple-choice",
        prompt: "An at-the-money call has a delta closest to\u2026",
        options: ["0.0", "0.5", "1.0", "-0.5"],
        answer: 1,
        explanation: "ATM options have delta near \xB10.5."
      },
      {
        id: "q-vega",
        kind: "scenario",
        prompt: "Implied volatility collapses after an earnings report. Your long straddle\u2026",
        options: ["Gains from vega", "Loses from vega (vol crush)", "Is unaffected", "Doubles"],
        answer: 1,
        explanation: "Long options are long vega; falling IV hurts them \u2014 the classic post-event vol crush."
      }
    ]
  },
  {
    id: "iv",
    index: 4,
    title: "Implied Volatility",
    summary: "IV, skew, and term structure.",
    checkpoint: false,
    passThreshold: 0.7,
    lessons: [
      {
        id: "what-is-iv",
        title: "What IV Means",
        body: "Implied volatility is the volatility the market is pricing into an option. Higher IV = richer premiums. It is forward-looking and often differs from realized (historical) volatility.",
        demo: { kind: "iv-surface", underlying: "ETH-USD", note: "Compare IV across strikes and expiries." }
      },
      {
        id: "skew-term",
        title: "Skew & Term Structure",
        body: "Skew: OTM puts often carry higher IV than OTM calls (crash insurance demand). Term structure: IV varies by expiry, frequently elevated around known events."
      }
    ],
    quiz: [
      {
        id: "q-skew",
        kind: "multiple-choice",
        prompt: "In equity index options, 'skew' typically means\u2026",
        options: ["Calls cost more than puts", "OTM puts have higher IV than OTM calls", "IV is flat across strikes", "Rho dominates"],
        answer: 1,
        explanation: "Downside puts are bid up for protection, lifting their IV \u2014 the equity skew."
      }
    ]
  },
  {
    id: "single-leg",
    index: 5,
    title: "Single-Leg Strategies",
    summary: "Long calls/puts, covered calls, cash-secured puts.",
    checkpoint: false,
    passThreshold: 0.7,
    lessons: [
      {
        id: "long-call-put",
        title: "Long Call / Long Put",
        body: "Defined risk (premium paid), leveraged directional exposure. Long call profits if price rises enough to overcome premium + theta; long put profits if it falls.",
        demo: { kind: "payoff", underlying: "ACME", note: "Plot a long call payoff at expiry." }
      },
      {
        id: "covered-cash",
        title: "Covered Call & Cash-Secured Put",
        body: "A covered call sells a call against 100 owned shares to collect income, capping upside. A cash-secured put sells a put while holding cash to buy if assigned \u2014 income with a willingness to own lower."
      }
    ],
    quiz: [
      {
        id: "q-cc",
        kind: "scenario",
        prompt: "You own 100 shares and sell a covered call. Your upside above the strike is\u2026",
        options: ["Unlimited", "Capped at the strike (plus premium)", "Zero", "Doubled"],
        answer: 1,
        explanation: "Above the strike the shares get called away; gains are capped at strike + premium."
      }
    ]
  },
  {
    id: "verticals",
    index: 6,
    title: "Vertical Spreads",
    summary: "Defined-risk debit and credit spreads.",
    checkpoint: false,
    passThreshold: 0.7,
    lessons: [
      {
        id: "verticals",
        title: "Bull/Bear Verticals",
        body: "Buy one option and sell another of the same type/expiry at a different strike. This caps both cost and payoff, defining your risk. Debit spreads pay to open; credit spreads collect.",
        demo: { kind: "payoff", underlying: "NOVA", note: "Build a bull call spread and read max profit/loss." }
      }
    ],
    quiz: [
      {
        id: "q-vert",
        kind: "multiple-choice",
        prompt: "A bull call (debit) vertical's maximum loss is\u2026",
        options: ["Unlimited", "The net debit paid", "The strike width", "Zero"],
        answer: 1,
        explanation: "Most you can lose is the premium paid to open the spread."
      }
    ]
  },
  {
    id: "volatility",
    index: 7,
    title: "Volatility Strategies",
    summary: "Straddles and strangles.",
    checkpoint: false,
    passThreshold: 0.7,
    lessons: [
      {
        id: "straddle-strangle",
        title: "Straddles & Strangles",
        body: "Buy a call and a put to profit from a big move in EITHER direction (long straddle = same strike, strangle = different strikes). You're long vega and pay theta \u2014 you need movement, and soon.",
        demo: { kind: "payoff", underlying: "BTC-USD", note: "Plot a long straddle; find the two breakevens." }
      }
    ],
    quiz: [
      {
        id: "q-straddle",
        kind: "multiple-choice",
        prompt: "A long straddle profits most when\u2026",
        options: ["Price stays pinned", "Price makes a large move either way", "IV collapses", "Time passes quickly"],
        answer: 1,
        explanation: "It needs a large directional move to overcome the combined premium and decay."
      }
    ]
  },
  {
    id: "advanced",
    index: 8,
    title: "Advanced Multi-Leg",
    summary: "Condors, butterflies, calendars.",
    checkpoint: true,
    passThreshold: 0.75,
    lessons: [
      {
        id: "condor-fly",
        title: "Iron Condors & Butterflies",
        body: "Range-bound, defined-risk income trades. An iron condor sells an OTM put spread and an OTM call spread to collect premium if price stays in a band. A butterfly concentrates the profit zone around one strike."
      },
      {
        id: "calendars",
        title: "Calendar Spreads",
        body: "Sell a near-dated option and buy a longer-dated one at the same strike to harvest faster near-term theta. They're long vega and benefit from rising IV and a pinned underlying."
      }
    ],
    quiz: [
      {
        id: "q-condor",
        kind: "scenario",
        prompt: "An iron condor reaches max profit when, at expiry, price is\u2026",
        options: ["Far above the call spread", "Between the short strikes", "Far below the put spread", "Exactly at a long strike"],
        answer: 1,
        explanation: "Max profit is the net credit, kept when price expires between the two short strikes."
      }
    ]
  },
  {
    id: "risk",
    index: 9,
    title: "Risk Management & Sizing",
    summary: "Position sizing, defined risk, and discipline.",
    checkpoint: false,
    passThreshold: 0.8,
    lessons: [
      {
        id: "sizing",
        title: "Position Sizing",
        body: "Risk a small, fixed fraction of equity per trade so no single loss is catastrophic. Prefer defined-risk structures, know your max loss before entering, and let expectancy \u2014 not any one trade \u2014 compound the account."
      }
    ],
    quiz: [
      {
        id: "q-size",
        kind: "multiple-choice",
        prompt: "A sound rule of thumb is to risk per trade no more than\u2026",
        options: ["50% of equity", "A small fixed % (e.g., 1\u20132%)", "All buying power", "Whatever feels right"],
        answer: 1,
        explanation: "Small fixed fractional risk keeps any single loss survivable."
      }
    ]
  }
];
var LearningProgress = class _LearningProgress {
  results = {};
  static fromJSON(json) {
    const p = new _LearningProgress();
    p.results = json.results ?? {};
    return p;
  }
  /** Grade an attempt. `answers` maps question id → selected option index. */
  grade(moduleId, answers) {
    const mod = CURRICULUM.find((m) => m.id === moduleId);
    if (!mod) throw new Error(`Unknown module ${moduleId}`);
    let correct = 0;
    for (const q of mod.quiz) if (answers[q.id] === q.answer) correct++;
    const score = mod.quiz.length ? correct / mod.quiz.length : 0;
    const prev = this.results[moduleId];
    const result = {
      moduleId,
      bestScore: Math.max(score, prev?.bestScore ?? 0),
      attempts: (prev?.attempts ?? 0) + 1,
      passed: (prev?.passed ?? false) || score >= mod.passThreshold
    };
    this.results[moduleId] = result;
    return result;
  }
  isPassed(moduleId) {
    return this.results[moduleId]?.passed ?? false;
  }
  /**
   * A module is unlocked if all earlier CHECKPOINT modules are passed.
   * (Non-checkpoint modules never block progression.)
   */
  isUnlocked(moduleId) {
    const mod = CURRICULUM.find((m) => m.id === moduleId);
    if (!mod) return false;
    for (const m of CURRICULUM) {
      if (m.index >= mod.index) break;
      if (m.checkpoint && !this.isPassed(m.id)) return false;
    }
    return true;
  }
  /** Completion map for the UI: per-module status. */
  completionMap() {
    return CURRICULUM.map((m) => ({
      id: m.id,
      title: m.title,
      passed: this.isPassed(m.id),
      unlocked: this.isUnlocked(m.id),
      bestScore: this.results[m.id]?.bestScore ?? 0
    }));
  }
  overallProgress() {
    const passed = CURRICULUM.filter((m) => this.isPassed(m.id)).length;
    return passed / CURRICULUM.length;
  }
  toJSON() {
    return { results: this.results };
  }
};
function getCurriculum(world) {
  return world.settings.helpEnabled ? CURRICULUM : null;
}

// src/live.ts
var CB = "https://api.exchange.coinbase.com";
var KR = "https://api.kraken.com";
var KRAKEN_PAIR = {
  "BTC-USD": "XBTUSD",
  "ETH-USD": "ETHUSD",
  "SOL-USD": "SOLUSD"
};
function resToSec(res) {
  return res === "1m" ? 60 : res === "1h" ? 3600 : 86400;
}
async function fromCoinbase(symbol, res, count) {
  const gran = resToSec(res);
  const end = Math.floor(Date.now() / 1e3);
  const start = end - gran * count;
  const url = `${CB}/products/${symbol}/candles?granularity=${gran}&start=${start}&end=${end}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8e3) });
  if (!r.ok) throw new Error(`CB ${r.status}`);
  const data = await r.json();
  return data.reverse().map(([t, l, h, o, c, v]) => ({ t: t * 1e3, o, h, l, c, v }));
}
async function fromKraken(symbol, res, count) {
  const interval = res === "1m" ? 1 : res === "1h" ? 60 : 1440;
  const pair = KRAKEN_PAIR[symbol] ?? symbol;
  const r = await fetch(`${KR}/0/public/OHLC?pair=${pair}&interval=${interval}`, {
    signal: AbortSignal.timeout(8e3)
  });
  if (!r.ok) throw new Error(`KR ${r.status}`);
  const json = await r.json();
  if (json.error?.length) throw new Error(json.error[0]);
  const key = Object.keys(json.result).find((k) => k !== "last");
  const data = json.result[key];
  return data.slice(-count).map(([t, o, h, l, c, , v]) => ({
    t: t * 1e3,
    o: +o,
    h: +h,
    l: +l,
    c: +c,
    v: +v
  }));
}
async function fetchCandles(symbol, res, count = 300) {
  try {
    return await fromCoinbase(symbol, res, count);
  } catch {
    return fromKraken(symbol, res, count);
  }
}
var LIVE_SYMBOLS = ["BTC-USD", "ETH-USD", "SOL-USD"];

// src/store.ts
var PROFILES_KEY = "orion.profiles";
function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function loadPL() {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
  }
  const id = makeId();
  const pl = { active: id, list: [{ id, name: "Default", createdAt: Date.now() }] };
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(pl));
  } catch {
  }
  return pl;
}
function savePL(pl) {
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(pl));
  } catch {
  }
}
var DAYS = 60;
var HISTORY_DAYS = 25;
var START = (() => {
  const d = /* @__PURE__ */ new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - HISTORY_DAYS * 24 * 36e5;
})();
var Store = class {
  world;
  actions = [];
  progress = new LearningProgress();
  ui = { symbol: "BTC-USD", theme: "dark", onboarded: false, livePref: true };
  settings;
  profileId;
  // Live mode state
  live = false;
  onLiveTick = null;
  histWorld = null;
  liveTimer = null;
  constructor() {
    const pl = loadPL();
    this.profileId = pl.active;
    const saved = this.load();
    this.settings = saved?.settings ?? { startingCash: 1e3 };
    if (saved) {
      this.ui = { livePref: true, ...saved.ui };
      this.progress = LearningProgress.fromJSON(saved.progress);
    }
    this.build(saved);
  }
  get key() {
    return `orion.session.v4.${this.profileId}`;
  }
  build(saved) {
    const data = buildSeedData(saved?.start ?? START, saved?.days ?? DAYS);
    this.world = new World({
      universe,
      data,
      startNow: (saved?.start ?? START) + HISTORY_DAYS * 24 * 36e5,
      settings: this.settings
    });
    if (saved) {
      try {
        for (const a of saved.actions) this.apply(a, false);
        this.actions = saved.actions;
      } catch (e) {
        console.warn("Replay failed; starting fresh.", e);
        this.actions = [];
      }
    }
  }
  apply(a, record) {
    const w = this.world;
    switch (a.k) {
      case "submit":
        w.submit(a.req);
        break;
      case "cancel":
        w.cancel(a.id);
        break;
      case "advance":
        w.advanceTo(a.to, { stepRes: a.to - w.now > 2 * 864e5 ? "1h" : "1m" });
        break;
      case "deposit":
        w.deposit(a.amt);
        break;
      case "mode":
        w.setMode(a.mode);
        break;
      case "settings":
        w.updateSettings(a.patch);
        break;
      case "reset":
        w.reset(a.startingCash !== void 0 ? { startingCash: a.startingCash } : void 0);
        break;
    }
    if (record) {
      this.actions.push(a);
      this.save();
    }
  }
  // ── Public mutators ───────────────────────────────────────────────────────
  submit(req) {
    const r = this.world.submit(req);
    if (r.ok && !this.live) {
      this.actions.push({ k: "submit", req });
      this.save();
    }
    return r;
  }
  cancel(id) {
    const ok = this.world.cancel(id);
    if (ok && !this.live) this.record({ k: "cancel", id });
    return ok;
  }
  advanceTo(to) {
    this.world.advanceTo(to, { stepRes: to - this.world.now > 2 * 864e5 ? "1h" : "1m" });
    if (!this.live) this.record({ k: "advance", to });
  }
  deposit(amt) {
    this.world.deposit(amt);
    this.record({ k: "deposit", amt });
  }
  setMode(mode) {
    this.world.setMode(mode);
    this.record({ k: "mode", mode });
  }
  updateSettings(patch) {
    this.world.updateSettings(patch);
    this.settings = { ...this.settings, ...patch };
    this.record({ k: "settings", patch });
  }
  reset(startingCash) {
    this.disableLive();
    this.world.reset(startingCash !== void 0 ? { startingCash } : void 0);
    this.actions = [];
    this.record({ k: "reset", startingCash });
  }
  /** Record an advance the UI already applied to the world (animated scrubbing). */
  noteAdvance(to) {
    if (!this.live) this.record({ k: "advance", to });
  }
  record(a) {
    this.actions.push(a);
    this.save();
  }
  // ── Live mode ─────────────────────────────────────────────────────────────
  async enableLive() {
    if (this.live) return;
    const now = Date.now();
    const liveSeedStart = now - HISTORY_DAYS * 24 * 36e5;
    const liveData = buildSeedData(liveSeedStart, DAYS);
    await Promise.allSettled(
      LIVE_SYMBOLS.map(async (sym2) => {
        try {
          const bars = await fetchCandles(sym2, "1h", 500);
          if (bars.length) liveData.get(sym2)?.appendLive("1h", bars);
        } catch {
        }
      })
    );
    this.histWorld = this.world;
    this.world = new World({
      universe,
      data: liveData,
      startNow: now,
      settings: this.settings
    });
    this.world.setMode("live");
    this.live = true;
    this.liveTimer = setInterval(() => {
      void this.pollLive();
    }, 3e4);
  }
  disableLive() {
    if (!this.live) return;
    if (this.liveTimer) {
      clearInterval(this.liveTimer);
      this.liveTimer = null;
    }
    if (this.histWorld) {
      this.world = this.histWorld;
      this.histWorld = null;
    }
    this.live = false;
  }
  async pollLive() {
    if (!this.live) return;
    await Promise.allSettled(
      LIVE_SYMBOLS.map(async (sym2) => {
        try {
          const bars = await fetchCandles(sym2, "1h", 5);
          if (bars.length) this.world.data.get(sym2)?.appendLive("1h", bars);
        } catch {
        }
      })
    );
    this.world.advanceTo(Date.now(), { stepRes: "1h" });
    this.onLiveTick?.();
  }
  // ── Persistence ───────────────────────────────────────────────────────────
  save() {
    const p = {
      start: START,
      days: DAYS,
      settings: this.world.settings,
      actions: this.actions,
      ui: this.ui,
      progress: this.progress.toJSON()
    };
    try {
      localStorage.setItem(this.key, JSON.stringify(p));
    } catch {
    }
  }
  saveUi() {
    this.save();
  }
  load() {
    try {
      const raw = localStorage.getItem(this.key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  // ── Profile management (static — no world access needed) ──────────────────
  getProfileName() {
    return loadPL().list.find((p) => p.id === this.profileId)?.name ?? "Profile";
  }
  static listProfiles() {
    return loadPL().list;
  }
  static activeProfileId() {
    return loadPL().active;
  }
  static createProfile(name) {
    const pl = loadPL();
    const id = makeId();
    pl.list.push({ id, name: name.trim() || "Profile", createdAt: Date.now() });
    pl.active = id;
    savePL(pl);
    return id;
  }
  static switchProfile(id) {
    const pl = loadPL();
    if (pl.list.find((p) => p.id === id)) {
      pl.active = id;
      savePL(pl);
    }
  }
  static deleteProfile(id) {
    const pl = loadPL();
    if (pl.list.length <= 1) return false;
    pl.list = pl.list.filter((p) => p.id !== id);
    if (pl.active === id) pl.active = pl.list[0].id;
    savePL(pl);
    try {
      localStorage.removeItem(`orion.session.v4.${id}`);
    } catch {
    }
    return true;
  }
  static renameProfile(id, name) {
    const pl = loadPL();
    const p = pl.list.find((x) => x.id === id);
    if (p) {
      p.name = name.trim() || p.name;
      savePL(pl);
    }
  }
};

// src/ui/chart.ts
var css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
var MA_COLORS = ["#4c8dff", "#f5a623", "#22c97a"];
var AX_R = 62;
var AX_B = 22;
var PAD_T = 10;
var Chart = class {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.bindEvents();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
  }
  canvas;
  ctx;
  bars = [];
  cfg = { sma: [50], ema: [20], bollinger: true, vwap: false };
  view = 90;
  offset = 0;
  crosshair = null;
  W = 0;
  H = 0;
  dpr = 1;
  dragging = false;
  lastX = 0;
  ro;
  destroy() {
    this.ro.disconnect();
  }
  setConfig(cfg) {
    this.cfg = { ...this.cfg, ...cfg };
    this.render();
  }
  setData(bars, opts = {}) {
    this.bars = bars;
    if (opts.resetView) {
      this.offset = 0;
      this.view = Math.min(90, Math.max(40, bars.length));
    }
    this.render();
  }
  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const r = this.canvas.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    this.W = r.width;
    this.H = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.render();
  }
  bindEvents() {
    const c = this.canvas;
    c.style.touchAction = "none";
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.12 : 0.89;
      this.view = Math.max(25, Math.min(this.bars.length || 600, Math.round(this.view * factor)));
      this.render();
    }, { passive: false });
    c.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener("pointermove", (e) => {
      const rect = c.getBoundingClientRect();
      this.crosshair = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (this.dragging) {
        const dx = e.clientX - this.lastX;
        const barW = (this.W - AX_R) / this.view;
        const step = Math.round(dx / barW);
        if (step !== 0) {
          this.offset = Math.max(0, Math.min(Math.max(0, this.bars.length - 10), this.offset + step));
          this.lastX = e.clientX;
        }
      }
      this.render();
    });
    const release = (e) => {
      this.dragging = false;
      try {
        c.releasePointerCapture(e.pointerId);
      } catch {
      }
    };
    c.addEventListener("pointerup", release);
    c.addEventListener("pointercancel", release);
    c.addEventListener("pointerleave", () => {
      if (!this.dragging) {
        this.crosshair = null;
        this.render();
      }
    });
  }
  visibleSlice() {
    const end = this.bars.length - this.offset;
    const start = Math.max(0, end - this.view);
    return { slice: this.bars.slice(start, end), startIdx: start };
  }
  render() {
    const ctx = this.ctx;
    if (this.W === 0 || this.H === 0) return;
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.fillStyle = css("--ink");
    ctx.fillRect(0, 0, this.W, this.H);
    if (this.bars.length < 2) {
      ctx.fillStyle = css("--text-3");
      ctx.font = "13px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Awaiting market data\u2026", this.W / 2, this.H / 2);
      return;
    }
    const { slice, startIdx } = this.visibleSlice();
    if (slice.length < 1) return;
    const plotW = this.W - AX_R;
    const plotH = this.H - AX_B - PAD_T;
    const volH = plotH * 0.18;
    const priceH = plotH - volH - 6;
    let hi = -Infinity, lo = Infinity, maxVol = 0;
    for (const b of slice) {
      hi = Math.max(hi, b.h);
      lo = Math.min(lo, b.l);
      maxVol = Math.max(maxVol, b.v);
    }
    const closesAll = this.bars.map((b) => b.c);
    const considerLine = (s) => {
      for (let i = 0; i < slice.length; i++) {
        const v = s[startIdx + i];
        if (v !== void 0) {
          hi = Math.max(hi, v);
          lo = Math.min(lo, v);
        }
      }
    };
    let bb = null;
    if (this.cfg.bollinger) {
      bb = indicators_exports.bollinger(closesAll, 20, 2);
      considerLine(bb.upper);
      considerLine(bb.lower);
    }
    const padV = (hi - lo) * 0.06 || hi * 0.01 || 1;
    hi += padV;
    lo -= padV;
    const span = hi - lo || 1;
    const yOf = (p) => PAD_T + (hi - p) / span * priceH;
    const colW = plotW / slice.length;
    const xOf = (i) => (i + 0.5) * colW;
    const barW = Math.max(1, colW * 0.62);
    ctx.strokeStyle = css("--hairline");
    ctx.fillStyle = css("--text-3");
    ctx.lineWidth = 1;
    ctx.font = "10px 'Roboto Mono', monospace";
    ctx.textAlign = "left";
    const rows = 5;
    for (let i = 0; i <= rows; i++) {
      const p = hi - span * i / rows;
      const y = yOf(p);
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(plotW, y);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillText(fmtAxis(p), plotW + 6, y + 3);
    }
    const drawLine = (series, color, width = 1.4) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < slice.length; i++) {
        const v = series[startIdx + i];
        if (v === void 0) {
          started = false;
          continue;
        }
        const x = xOf(i), y = yOf(v);
        if (!started) {
          ctx.moveTo(x, y);
          started = true;
        } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };
    if (bb) {
      drawLine(bb.upper, "rgba(124,139,160,0.5)", 1);
      drawLine(bb.lower, "rgba(124,139,160,0.5)", 1);
      drawLine(bb.middle, "rgba(124,139,160,0.7)", 1);
    }
    if (this.cfg.vwap) drawLine(indicators_exports.vwap(this.bars), "#c98bff", 1.4);
    const smaSeries = this.cfg.sma.map((p, i) => ({ p, s: indicators_exports.sma(closesAll, p), color: MA_COLORS[i % MA_COLORS.length] }));
    const emaSeries = this.cfg.ema.map((p, i) => ({ p, s: indicators_exports.ema(closesAll, p), color: MA_COLORS[(i + 1) % MA_COLORS.length] }));
    smaSeries.forEach((m) => drawLine(m.s, m.color, 1.5));
    emaSeries.forEach((m) => drawLine(m.s, m.color, 1.2));
    const volTop = PAD_T + priceH + 6;
    for (let i = 0; i < slice.length; i++) {
      const b = slice[i];
      const h = b.v / (maxVol || 1) * volH;
      ctx.fillStyle = b.c >= b.o ? "rgba(34,201,122,0.30)" : "rgba(255,77,94,0.30)";
      ctx.fillRect(xOf(i) - barW / 2, volTop + (volH - h), barW, h);
    }
    for (let i = 0; i < slice.length; i++) {
      const b = slice[i];
      const up = b.c >= b.o;
      const color = up ? css("--gain") : css("--loss");
      const x = xOf(i);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, yOf(b.h));
      ctx.lineTo(x, yOf(b.l));
      ctx.stroke();
      const yO = yOf(b.o), yC = yOf(b.c);
      ctx.fillRect(x - barW / 2, Math.min(yO, yC), barW, Math.max(1, Math.abs(yC - yO)));
    }
    const last = slice[slice.length - 1];
    const yLast = yOf(last.c);
    const lastColor = last.c >= last.o ? css("--gain") : css("--loss");
    ctx.strokeStyle = lastColor;
    ctx.globalAlpha = 0.4;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(0, yLast);
    ctx.lineTo(plotW, yLast);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.fillStyle = lastColor;
    ctx.fillRect(plotW, yLast - 8, AX_R, 16);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "left";
    ctx.font = "10px 'Roboto Mono', monospace";
    ctx.fillText(fmtAxis(last.c), plotW + 5, yLast + 3);
    ctx.fillStyle = css("--text-3");
    ctx.font = "10px 'Roboto Mono', monospace";
    ctx.textAlign = "center";
    const ticks = Math.min(6, slice.length);
    for (let t = 0; t < ticks; t++) {
      const i = Math.floor(t / (ticks - 1 || 1) * (slice.length - 1));
      const b = slice[i];
      const x = Math.max(20, Math.min(plotW - 20, xOf(i)));
      ctx.fillText(fmtTime(b.t), x, this.H - 7);
    }
    const legend = [];
    if (bb) legend.push({ label: "BB(20,2)", color: "rgba(124,139,160,0.9)" });
    smaSeries.forEach((m) => legend.push({ label: `SMA${m.p} ${maybe(m.s[this.bars.length - 1 - this.offset])}`, color: m.color }));
    emaSeries.forEach((m) => legend.push({ label: `EMA${m.p} ${maybe(m.s[this.bars.length - 1 - this.offset])}`, color: m.color }));
    if (this.cfg.vwap) legend.push({ label: `VWAP ${maybe(indicators_exports.vwap(this.bars)[this.bars.length - 1 - this.offset])}`, color: "#c98bff" });
    ctx.textAlign = "left";
    ctx.font = "10px 'Roboto Mono', monospace";
    let lx = 10;
    for (const item of legend) {
      ctx.fillStyle = item.color;
      ctx.fillRect(lx, 4, 8, 8);
      ctx.fillStyle = css("--text-2");
      ctx.fillText(item.label, lx + 12, 12);
      lx += ctx.measureText(item.label).width + 28;
    }
    if (this.crosshair && this.crosshair.x < plotW && this.crosshair.y < PAD_T + plotH) {
      const idx = Math.max(0, Math.min(slice.length - 1, Math.round(this.crosshair.x / colW - 0.5)));
      const b = slice[idx];
      const x = xOf(idx);
      ctx.strokeStyle = "rgba(124,139,160,0.45)";
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, PAD_T);
      ctx.lineTo(x, PAD_T + plotH);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, this.crosshair.y);
      ctx.lineTo(plotW, this.crosshair.y);
      ctx.stroke();
      ctx.setLineDash([]);
      const pAtY = hi - (this.crosshair.y - PAD_T) / priceH * span;
      if (this.crosshair.y <= PAD_T + priceH) {
        ctx.fillStyle = css("--surface-2");
        ctx.fillRect(plotW, this.crosshair.y - 8, AX_R, 16);
        ctx.fillStyle = css("--text-1");
        ctx.textAlign = "left";
        ctx.fillText(fmtAxis(pAtY), plotW + 5, this.crosshair.y + 3);
      }
      const chg = (b.c - b.o) / b.o;
      const cc = b.c >= b.o ? css("--gain") : css("--loss");
      ctx.fillStyle = css("--surface-2");
      ctx.fillRect(8, 18, 282, 20);
      ctx.font = "11px 'Roboto Mono', monospace";
      ctx.textAlign = "left";
      ctx.fillStyle = css("--text-2");
      const txt = `O ${fmtAxis(b.o)}  H ${fmtAxis(b.h)}  L ${fmtAxis(b.l)}  C `;
      ctx.fillText(txt, 14, 32);
      const w = ctx.measureText(txt).width;
      ctx.fillStyle = cc;
      ctx.fillText(`${fmtAxis(b.c)} (${(chg * 100).toFixed(2)}%)`, 14 + w, 32);
    }
  }
};
function maybe(v) {
  return v === void 0 ? "\u2014" : fmtAxis(v);
}
function fmtAxis(p) {
  if (p >= 1e3) return p.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(4);
}
function fmtTime(t) {
  const d = new Date(t);
  return d.toLocaleString("en-US", { month: "short", day: "numeric" });
}

// src/ui/canvas.ts
var css2 = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function setup(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, W: r.width, H: r.height };
}
function drawEquityCurve(canvas, points, baseline) {
  const { ctx, W: W2, H } = setup(canvas);
  ctx.clearRect(0, 0, W2, H);
  if (points.length < 2) return;
  const pad = 8;
  let lo = Infinity, hi = -Infinity;
  for (const p of points) {
    lo = Math.min(lo, p.equity);
    hi = Math.max(hi, p.equity);
  }
  lo = Math.min(lo, baseline);
  hi = Math.max(hi, baseline);
  const span = hi - lo || 1;
  const xOf = (i) => pad + i / (points.length - 1) * (W2 - pad * 2);
  const yOf = (v) => pad + (1 - (v - lo) / span) * (H - pad * 2);
  ctx.strokeStyle = css2("--hairline");
  ctx.setLineDash([4, 4]);
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, yOf(baseline));
  ctx.lineTo(W2 - pad, yOf(baseline));
  ctx.stroke();
  ctx.setLineDash([]);
  const last = points[points.length - 1].equity;
  const color = last >= baseline ? css2("--gain") : css2("--loss");
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, color + "33");
  grad.addColorStop(1, color + "00");
  ctx.beginPath();
  ctx.moveTo(xOf(0), yOf(points[0].equity));
  points.forEach((p, i) => ctx.lineTo(xOf(i), yOf(p.equity)));
  ctx.lineTo(xOf(points.length - 1), H - pad);
  ctx.lineTo(xOf(0), H - pad);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(xOf(0), yOf(points[0].equity));
  points.forEach((p, i) => ctx.lineTo(xOf(i), yOf(p.equity)));
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
}
function drawPayoff(canvas, payoff, spot, breakevens) {
  const { ctx, W: W2, H } = setup(canvas);
  ctx.clearRect(0, 0, W2, H);
  if (payoff.length < 2) return;
  const pad = 10;
  let loP = Infinity, hiP = -Infinity, loX = Infinity, hiX = -Infinity;
  for (const p of payoff) {
    loP = Math.min(loP, p.pnl);
    hiP = Math.max(hiP, p.pnl);
    loX = Math.min(loX, p.price);
    hiX = Math.max(hiX, p.price);
  }
  const spanP = hiP - loP || 1, spanX = hiX - loX || 1;
  const xOf = (px) => pad + (px - loX) / spanX * (W2 - pad * 2);
  const yOf = (v) => pad + (1 - (v - loP) / spanP) * (H - pad * 2);
  ctx.strokeStyle = css2("--hairline");
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pad, yOf(0));
  ctx.lineTo(W2 - pad, yOf(0));
  ctx.stroke();
  for (const sign2 of [1, -1]) {
    ctx.beginPath();
    let started = false;
    ctx.moveTo(xOf(payoff[0].price), yOf(0));
    for (const p of payoff) {
      const v = sign2 > 0 ? Math.max(0, p.pnl) : Math.min(0, p.pnl);
      ctx.lineTo(xOf(p.price), yOf(v));
      started = true;
    }
    ctx.lineTo(xOf(payoff[payoff.length - 1].price), yOf(0));
    ctx.closePath();
    ctx.fillStyle = (sign2 > 0 ? css2("--gain") : css2("--loss")) + "22";
    ctx.fill();
  }
  ctx.beginPath();
  ctx.moveTo(xOf(payoff[0].price), yOf(payoff[0].pnl));
  payoff.forEach((p) => ctx.lineTo(xOf(p.price), yOf(p.pnl)));
  ctx.strokeStyle = css2("--accent");
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.strokeStyle = css2("--text-2");
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(xOf(spot), pad);
  ctx.lineTo(xOf(spot), H - pad);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = css2("--text-3");
  ctx.font = "10px 'Roboto Mono', monospace";
  ctx.textAlign = "center";
  ctx.fillText("spot", xOf(spot), H - 2);
  ctx.fillStyle = css2("--warn");
  for (const be of breakevens) if (be >= loX && be <= hiX) ctx.fillRect(xOf(be) - 1, yOf(0) - 3, 2, 6);
}

// src/ui/format.ts
function money(v, opts = {}) {
  const n = typeof v === "string" ? Number(v) : v;
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign2 = n < 0 ? "\u2212" : opts.sign ? "+" : "";
  return `${sign2}$${s}`;
}
function compact(v) {
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (v / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return v.toFixed(0);
}
function qty(v) {
  if (Number.isInteger(v)) return v.toString();
  return v.toLocaleString("en-US", { maximumFractionDigits: 8 });
}
function pct(v, digits = 2) {
  return `${v >= 0 ? "+" : "\u2212"}${Math.abs(v * 100).toFixed(digits)}%`;
}
function pnlClass(v) {
  return v > 0 ? "gain" : v < 0 ? "loss" : "muted";
}
function glyph(v) {
  return v > 0 ? "\u25B2" : v < 0 ? "\u25BC" : "\u2014";
}
function dateLabel(ms) {
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
}
function dayLabel(ms) {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function priceFmt(p) {
  if (p >= 1e3) return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(4);
}

// src/main.ts
var store = new Store();
var app = document.getElementById("app");
var chart;
var state = {
  screen: "trade",
  tf: "1h",
  form: { side: "buy", type: "market", qty: "", limit: "", stop: "", trail: "" },
  optExpiryIdx: 0,
  ticketOpen: false,
  scanOpen: false,
  scrubbing: false,
  learnModule: null,
  profileOpen: false
};
var ind = { sma: true, ema: true, bb: true, vwap: false };
var W = () => store.world;
var sym = () => store.ui.symbol;
var inst = () => W().universe.get(sym());
function visibleBars() {
  const id = W().data.get(sym());
  const res = id.has(state.tf) ? state.tf : "1h";
  return id.get(res).visible(W().now).slice();
}
function boot() {
  document.documentElement.setAttribute("data-theme", store.ui.theme);
  if (!store.ui.onboarded) {
    renderSplash();
    return;
  }
  renderShell();
  if (store.ui.livePref !== false) {
    void store.enableLive().then(() => {
      if (store.live) {
        store.onLiveTick = () => {
          chart?.setData(visibleBars());
          updateHeader();
        };
        updateHeader();
        renderNav();
        toast("Live prices active", "gain");
      }
    }).catch(() => {
    });
  }
}
function renderSplash() {
  app.innerHTML = `
    <div class="splash">
      <div class="splash-inner">
        ${brandLogoLarge()}
        <h1>ORION</h1>
        <div class="splash-sub">Real charts. Your clock. An unknown future.</div>
        <button class="cta" id="begin">Enter ORION</button>
        <div class="legal-mini">Uses historical and/or delayed market data for practice trading.<br>Not a brokerage. Not financial advice.</div>
      </div>
    </div>`;
  document.getElementById("begin").onclick = () => {
    store.ui.onboarded = true;
    store.saveUi();
    renderShell();
    if (store.ui.livePref !== false) {
      void store.enableLive().then(() => {
        if (store.live) {
          store.onLiveTick = () => {
            chart?.setData(visibleBars());
            updateHeader();
          };
          updateHeader();
          renderNav();
          toast("Live prices active", "gain");
        }
      }).catch(() => {
      });
    }
  };
}
function renderShell() {
  app.innerHTML = `
    <div class="topbar">
      <div class="topbar-brand">${brandMark()}</div>
      <div class="topbar-syms" id="topbarSyms"></div>
      <div class="topbar-price" id="topbarPrice"></div>
      <div class="topbar-right">
        <div class="topbar-acct" id="topbarAcct"></div>
        <button class="profile-btn" id="profileBtn" aria-label="Profile">
          <div class="profile-avatar" id="profileAvatar">${store.getProfileName()[0]?.toUpperCase() ?? "P"}</div>
        </button>
      </div>
    </div>
    <div class="workspace">
      <nav class="sidebar" id="sidebar"></nav>
      <main class="content" id="content">
        ${tradeViewHTML()}
        <div class="screen-overlay" id="overlay"></div>
      </main>
    </div>
    <div class="bottom-nav" id="bottomNav"></div>
    <div class="profile-panel" id="profilePanel"></div>
    <div class="panel-backdrop" id="panelBackdrop"></div>
    <div class="toast" id="toast"></div>`;
  chart = new Chart(document.getElementById("chart"));
  chart.setData(visibleBars(), { resetView: true });
  applyIndicators();
  renderNav();
  renderSymbolTabs();
  renderChartToolbar();
  wireTime();
  document.getElementById("qbBuy").onclick = () => openTicket("buy");
  document.getElementById("qbSell").onclick = () => openTicket("sell");
  document.getElementById("termBtn")?.addEventListener("click", toggleScan);
  document.getElementById("scanClose")?.addEventListener("click", toggleScan);
  document.getElementById("ticketClose").onclick = closeTicket;
  document.getElementById("profileBtn").onclick = openProfile;
  document.getElementById("panelBackdrop").onclick = closeAllPanels;
  store.onLiveTick = () => {
    chart?.setData(visibleBars());
    updateHeader();
  };
  if (state.screen !== "trade") mountScreen(state.screen);
  refresh();
}
function tradeViewHTML() {
  return `<div class="trade-view" id="tradeView">
    <div class="chart-area">
      <div class="chart-toolbar" id="chartToolbar"></div>
      <div class="quickbar">
        <div class="qb-funds">
          <span class="qb-k">Cash</span>
          <span class="qb-v num" id="qbBp">\u2014</span>
        </div>
        <div class="qb-funds qb-eq">
          <span class="qb-k">Equity</span>
          <span class="qb-v num" id="qbEq">\u2014</span>
        </div>
        <div class="qb-actions">
          <button class="qb-btn buy" id="qbBuy">Buy</button>
          <button class="qb-btn sell" id="qbSell">Sell</button>
        </div>
      </div>
      <div class="chart-wrap"><canvas id="chart"></canvas></div>
      <div class="timebar">
        <span class="time-label" id="timeLabel"></span>
        <span class="mode-pill" id="modePill"></span>
        <button class="adv-btn" data-adv="h">+1H</button>
        <button class="adv-btn" data-adv="d">+1D</button>
        <button class="adv-btn" data-adv="m">+30D</button>
      </div>
    </div>
    <!-- Scan panel: slides in from right on desktop, up from bottom on mobile -->
    <div class="scan-panel-wrap" id="scanWrap">
      <div class="scan-panel-inner">
        <div class="scan-panel-head">
          <span>\u25C8 TERMINAL</span>
          <button class="icon-btn" id="scanClose">\u2715</button>
        </div>
        <div class="scan-panel-body" id="scanBody"></div>
      </div>
    </div>
  </div>
  <!-- Order ticket: full-screen sheet on mobile, sidebar on desktop -->
  <div class="ticket-sheet" id="ticketSheet">
    <div class="ticket-head">
      <span class="ticket-title">Order \u2014 <span id="ticketSym"></span></span>
      <button class="icon-btn" id="ticketClose">\u2715</button>
    </div>
    <div class="ticket-body" id="ticketBody"></div>
  </div>`;
}
function navItems() {
  const showLearn = W().settings.helpEnabled;
  const items = [
    ["trade", "Chart", tradeIcon],
    ["book", "Book", bookIcon],
    ["options", "Options", optionsIcon],
    ["stats", "Stats", statsIcon]
  ];
  if (showLearn) items.push(["learn", "Learn", learnIcon]);
  items.push(["settings", "Settings", settingsIcon]);
  return items;
}
function renderNav() {
  renderSidebar();
  renderBottomNav();
}
function renderSidebar() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  const items = navItems();
  sidebar.innerHTML = items.map(([s, tip, icon]) => `
    <button class="nav-btn ${state.screen === s ? "active" : ""}" data-nav="${s}" aria-label="${tip}">
      ${icon()}
      <span class="nav-tip">${tip}</span>
    </button>`).join("") + `<div class="sidebar-spacer"></div>`;
  sidebar.querySelectorAll("[data-nav]").forEach((b) => b.onclick = () => navigate(b.dataset.nav));
}
function renderBottomNav() {
  const bn = document.getElementById("bottomNav");
  if (!bn) return;
  const items = navItems().slice(0, 5);
  bn.innerHTML = items.map(([s, tip, icon]) => `
    <button class="bn-btn ${state.screen === s ? "active" : ""}" data-nav="${s}">
      ${icon()}
      <span class="bn-label">${tip}</span>
    </button>`).join("");
  bn.querySelectorAll("[data-nav]").forEach((b) => b.onclick = () => navigate(b.dataset.nav));
}
function navigate(s) {
  if (s !== "trade") {
    closeTicket();
    closeScan();
  }
  state.screen = s;
  if (s === "trade") {
    document.getElementById("overlay").innerHTML = "";
    chart?.setData(visibleBars());
    renderNav();
    refresh();
    return;
  }
  renderNav();
  mountScreen(s);
}
function mountScreen(s) {
  if (s === "book") renderBookScreen();
  else if (s === "options") renderOptionsScreen();
  else if (s === "stats") renderStatsScreen();
  else if (s === "learn") renderLearnScreen();
  else if (s === "settings") renderSettingsScreen();
}
function closeScreen() {
  navigate("trade");
}
function screenShell(title, body, extraHead = "") {
  return `<div class="screen">
    <div class="shead">
      <button class="back" id="backBtn">\u2039</button>
      <h2>${title}</h2>
      ${extraHead}
    </div>
    <div class="sbody" id="sbody">${body}</div>
  </div>`;
}
function overlayEl() {
  return document.getElementById("overlay");
}
function renderSymbolTabs() {
  const wrap = document.getElementById("topbarSyms");
  if (!wrap) return;
  const bars = visibleBars();
  const last = bars[bars.length - 1];
  const prev = bars.length > 1 ? bars[bars.length - 2].c : last?.o ?? 0;
  const chg = last && prev ? (last.c - prev) / prev : 0;
  wrap.innerHTML = W().universe.list().map((i) => {
    const isSel = i.symbol === sym();
    return `<button class="sym-tab ${isSel ? "active" : ""}" data-sym="${i.symbol}">
      <span class="sym-name">${i.symbol.replace("-USD", "")}</span>
      ${isSel && last ? `<span class="sym-chg ${pnlClass(chg)}">${pct(chg, 1)}</span>` : ""}
    </button>`;
  }).join("");
  wrap.querySelectorAll("[data-sym]").forEach((b) => b.onclick = () => {
    store.ui.symbol = b.dataset.sym;
    store.saveUi();
    renderSymbolTabs();
    renderChartToolbar();
    chart.setData(visibleBars(), { resetView: true });
    document.getElementById("ticketSym").textContent = sym().replace("-USD", "");
    refresh();
  });
}
function renderChartToolbar() {
  const toolbar = document.getElementById("chartToolbar");
  if (!toolbar) return;
  const tfs = ["1m", "1h", "1d"];
  const inds = [["bb", "BB"], ["sma", "SMA"], ["ema", "EMA"], ["vwap", "VWAP"]];
  toolbar.innerHTML = `
    <div class="toolbar-group">
      ${tfs.map((t) => `<button class="toolbar-btn ${state.tf === t ? "active" : ""}" data-tf="${t}">${t.toUpperCase()}</button>`).join("")}
    </div>
    <div class="toolbar-sep"></div>
    <div class="toolbar-group">
      ${inds.map(([k, l]) => `<button class="toolbar-btn ${ind[k] ? "active" : ""}" data-ind="${k}">${l}</button>`).join("")}
    </div>
    <button class="terminal-btn" id="termBtn">\u25C8 SCAN</button>`;
  toolbar.querySelectorAll("[data-tf]").forEach((b) => b.onclick = () => {
    state.tf = b.dataset.tf;
    renderChartToolbar();
    chart.setData(visibleBars(), { resetView: true });
    refresh();
  });
  toolbar.querySelectorAll("[data-ind]").forEach((b) => b.onclick = () => {
    const k = b.dataset.ind;
    ind[k] = !ind[k];
    renderChartToolbar();
    applyIndicators();
  });
  document.getElementById("termBtn")?.addEventListener("click", toggleScan);
}
function applyIndicators() {
  if (!chart) return;
  chart.setConfig({ sma: ind.sma ? [50] : [], ema: ind.ema ? [20] : [], bollinger: ind.bb, vwap: ind.vwap });
}
function toggleScan() {
  state.scanOpen = !state.scanOpen;
  const wrap = document.getElementById("scanWrap");
  if (state.scanOpen) {
    wrap.classList.add("open");
    renderScanBody();
  } else {
    wrap.classList.remove("open");
  }
}
function closeScan() {
  state.scanOpen = false;
  document.getElementById("scanWrap")?.classList.remove("open");
}
function renderScanBody() {
  const body = document.getElementById("scanBody");
  if (!body) return;
  const s = scan(W(), sym(), state.tf);
  const help = W().settings.helpEnabled;
  body.innerHTML = `
    <div class="scan-meta">\u25C8 ${sym()} \xB7 ${s.timeframe}</div>
    <div class="badges">
      <span class="badge ${s.trend === "up" ? "up" : s.trend === "down" ? "down" : ""}">Trend: ${s.trend}</span>
      <span class="badge">Momentum: ${s.momentum}</span>
      <span class="badge">Vol: ${s.volatility}</span>
    </div>
    ${s.readings.filter((r) => r.value !== void 0).slice(0, 7).map((r) => `
      <div class="reading">
        <span class="muted">${r.indicator}</span>
        <span class="num">${typeof r.value === "number" ? Math.abs(r.value) > 100 ? compact(r.value) : r.value.toFixed(2) : "\u2014"} <span class="dim">${r.state}</span></span>
      </div>`).join("")}
    ${help ? s.callouts.slice(0, 4).map((c) => `
      <div class="callout ${c.severity}">
        <div class="t">${c.title}</div>
        <div class="d">${c.detail}</div>
      </div>`).join("") : ""}`;
}
function openTicket(side) {
  if (state.screen !== "trade") navigate("trade");
  state.form.side = side;
  state.ticketOpen = true;
  const sheet = document.getElementById("ticketSheet");
  sheet.classList.add("open");
  document.getElementById("ticketSym").textContent = sym().replace("-USD", "");
  renderTicketBody();
  setTimeout(() => {
    const q = document.getElementById("qty");
    if (q) {
      q.focus();
      q.select();
    }
  }, 50);
}
function closeTicket() {
  state.ticketOpen = false;
  document.getElementById("ticketSheet")?.classList.remove("open");
}
function renderTicketBody() {
  const body = document.getElementById("ticketBody");
  if (!body) return;
  const i = inst();
  body.innerHTML = `
    <div class="ticket">
      <div class="seg ${state.form.side}" id="sideSeg">
        <button data-side="buy" class="${state.form.side === "buy" ? "on" : ""}">Buy</button>
        <button data-side="sell" class="${state.form.side === "sell" ? "on" : ""}">Sell</button>
      </div>
      <div class="field"><label>Order type</label>
        <select class="input" id="typeSel">
          ${["market", "limit", "stop", "stop-limit", "trailing-stop"].map(
    (t) => `<option value="${t}" ${t === state.form.type ? "selected" : ""}>${t}</option>`
  ).join("")}
        </select></div>
      <div class="field"><label>Qty (${i.assetClass === "crypto" ? "units" : "shares"})</label>
        <input class="input num" id="qty" inputmode="decimal" placeholder="0" value="${state.form.qty}"></div>
      <div class="field ${["limit", "stop-limit"].includes(state.form.type) ? "" : "hidden"}" id="limitField">
        <label>Limit price</label>
        <input class="input num" id="limit" inputmode="decimal" value="${state.form.limit}"></div>
      <div class="field ${["stop", "stop-limit"].includes(state.form.type) ? "" : "hidden"}" id="stopField">
        <label>Stop price</label>
        <input class="input num" id="stop" inputmode="decimal" value="${state.form.stop}"></div>
      <div class="field ${state.form.type === "trailing-stop" ? "" : "hidden"}" id="trailField">
        <label>Trail %</label>
        <input class="input num" id="trail" inputmode="decimal" placeholder="5" value="${state.form.trail}"></div>
      <div class="preview" id="preview"></div>
      <button class="submit ${state.form.side}" id="submitBtn"></button>
      <div class="note" id="note"></div>
    </div>`;
  wireTicket();
  updatePreview();
}
function wireTicket() {
  document.querySelectorAll("[data-side]").forEach((b) => b.onclick = () => {
    state.form.side = b.dataset.side;
    renderTicketBody();
  });
  const typeSel = document.getElementById("typeSel");
  if (typeSel) typeSel.onchange = () => {
    state.form.type = typeSel.value;
    renderTicketBody();
  };
  for (const id of ["qty", "limit", "stop", "trail"]) {
    const e = document.getElementById(id);
    if (e) e.oninput = () => {
      state.form[id] = e.value;
      updatePreview();
    };
  }
  const btn = document.getElementById("submitBtn");
  if (btn) btn.onclick = doSubmit;
}
function orderReqFromForm() {
  const qty2 = parseFloat(state.form.qty);
  const mark = W().market.spotMark(sym(), W().now)?.toNumber();
  if (!qty2 || qty2 <= 0) return { req: null, estPrice: mark };
  const req = {
    target: { kind: "spot", symbol: sym() },
    side: state.form.side,
    qty: qty2,
    type: state.form.type,
    tif: state.form.type === "market" ? "DAY" : "GTC"
  };
  if (["limit", "stop-limit"].includes(state.form.type)) req.limitPrice = parseFloat(state.form.limit) || void 0;
  if (["stop", "stop-limit"].includes(state.form.type)) req.stopPrice = parseFloat(state.form.stop) || void 0;
  if (state.form.type === "trailing-stop") req.trailPercent = (parseFloat(state.form.trail) || 5) / 100;
  return { req, estPrice: mark };
}
function updatePreview() {
  const { estPrice } = orderReqFromForm();
  const qty2 = parseFloat(state.form.qty) || 0;
  const notional = (estPrice ?? 0) * qty2;
  const fee = inst().fees.takerBps / 1e4 * notional;
  const cash = W().portfolio.cash.toNumber();
  const after = state.form.side === "buy" ? cash - notional - fee : cash + notional - fee;
  const preview = document.getElementById("preview");
  if (preview) preview.innerHTML = `
    <div class="row"><span class="k">Est. price</span><span class="num">${estPrice ? priceFmt(estPrice) : "\u2014"}</span></div>
    <div class="row"><span class="k">Notional</span><span class="num">${money(notional)}</span></div>
    <div class="row"><span class="k">Fee</span><span class="num">${money(fee)}</span></div>
    <div class="row"><span class="k">Cash after</span><span class="num ${after < 0 ? "loss" : ""}">${money(after)}</span></div>`;
  const btn = document.getElementById("submitBtn");
  if (btn) {
    btn.className = `submit ${state.form.side}`;
    btn.textContent = `${state.form.side === "buy" ? "Buy" : "Sell"} ${qty2 ? qty(qty2) : ""} ${sym().replace("-USD", "")}`.trim();
    btn.disabled = !qty2;
  }
}
function doSubmit() {
  const { req } = orderReqFromForm();
  const note = document.getElementById("note");
  if (!req) {
    note.textContent = "Enter a quantity.";
    return;
  }
  const res = store.submit(req);
  if (!res.ok) {
    note.textContent = res.reason ?? "Rejected.";
    return;
  }
  note.textContent = "";
  state.form.qty = "";
  closeTicket();
  if (W().mode === "live") toast("Order filled", "gain");
  else toast(req.type === "market" ? "Order placed \u2014 fills next bar" : "Order working");
  refresh();
  if (state.screen === "book") renderBookScreen();
}
function renderBookScreen() {
  const overlay = overlayEl();
  const resolve = W().markResolver();
  const positions = [...W().portfolio.positions.values()];
  const wo = W().workingOrders();
  const fills = W().fills.slice(-12).reverse();
  const posHTML = positions.length === 0 ? `<div class="empty">No open positions.</div>` : positions.map((p) => {
    const mark = resolve(p)?.toNumber() ?? 0;
    const upnl2 = W().portfolio.unrealized(p, resolve).toNumber();
    const isOpt = p.target.kind === "option" && p.option;
    const label = isOpt ? `${p.option.underlying.replace("-USD", "")} ${p.option.strike}${p.option.right[0].toUpperCase()} ${dayLabel(p.option.expiry)}` : p.target.symbol.replace("-USD", "");
    const subLabel = isOpt ? `${p.qty > 0 ? "Long" : "Short"} ${Math.abs(p.qty)} contract${Math.abs(p.qty) !== 1 ? "s" : ""}` : `${qty(p.qty)} @ ${priceFmt(p.avgCost.toNumber())}`;
    return `<div class="book-row">
          <div class="book-row-info">
            <div class="book-sym">${label}</div>
            <div class="sub-text">${subLabel}</div>
          </div>
          <div class="book-row-pnl">
            <div class="book-mark">${priceFmt(mark)}</div>
            <div class="pnl ${pnlClass(upnl2)}">${glyph(upnl2)} ${money(upnl2, { sign: true })}</div>
          </div>
          <div class="book-row-actions">
            <button class="action-btn close-btn" data-close="${p.key}">Close</button>
          </div>
        </div>`;
  }).join("");
  const ordersHTML = wo.length === 0 ? `<div class="empty">No working orders.</div>` : wo.map((o) => `<div class="book-row">
        <div class="book-row-info">
          <div class="book-sym">${o.side.toUpperCase()} ${qty(o.qty - o.filledQty)} ${(o.target.option?.underlying ?? o.target.symbol).replace("-USD", "")}</div>
          <div class="sub-text">${o.type}${o.limitPrice ? " @ " + priceFmt(o.limitPrice) : ""}${o.stopPrice ? " stop " + priceFmt(o.stopPrice) : ""}</div>
        </div>
        <div class="book-row-actions">
          <button class="action-btn cancel-btn" data-cancel="${o.id}">Cancel</button>
        </div>
      </div>`).join("");
  const blotterHTML = fills.length === 0 ? `<div class="empty">No fills yet.</div>` : fills.map((f) => `<div class="book-row">
        <div class="book-row-info">
          <div class="book-sym">${f.side.toUpperCase()} ${qty(f.qty)} ${(f.target.option?.underlying ?? f.target.symbol).replace("-USD", "")}</div>
          <div class="sub-text">${dateLabel(f.at)}</div>
        </div>
        <div class="book-row-pnl">
          <div class="book-mark">${priceFmt(f.price.toNumber())}</div>
          ${!f.realized.isZero() ? `<div class="pnl ${pnlClass(f.realized.toNumber())}">${money(f.realized.toNumber(), { sign: true })}</div>` : `<div class="pnl dim">fee ${money(f.fee.toNumber())}</div>`}
        </div>
      </div>`).join("");
  const eq = W().equity().toNumber();
  const cash = W().portfolio.cash.toNumber();
  const upnl = W().unrealized().toNumber();
  const totalPnl = eq - W().settings.startingCash;
  const summaryHTML = `
    <div class="port-summary">
      <div class="port-stat">
        <div class="ps-k">Equity</div>
        <div class="ps-v num">${money(eq)}</div>
      </div>
      <div class="port-stat">
        <div class="ps-k">Cash</div>
        <div class="ps-v num">${money(cash)}</div>
      </div>
      <div class="port-stat">
        <div class="ps-k">Unrealized</div>
        <div class="ps-v num ${pnlClass(upnl)}">${money(upnl, { sign: true })}</div>
      </div>
      <div class="port-stat">
        <div class="ps-k">Total P&amp;L</div>
        <div class="ps-v num ${pnlClass(totalPnl)}">${money(totalPnl, { sign: true })}</div>
      </div>
    </div>`;
  const body = `
    ${summaryHTML}
    <div class="book-section">
      <div class="book-head">Positions <span class="count-badge">${positions.length}</span></div>
      <div id="positions">${posHTML}</div>
    </div>
    <div class="book-section">
      <div class="book-head">Working Orders <span class="count-badge">${wo.length}</span></div>
      <div id="orders">${ordersHTML}</div>
    </div>
    <div class="book-section">
      <div class="book-head">Recent Fills</div>
      <div id="blotter">${blotterHTML}</div>
    </div>`;
  overlay.innerHTML = screenShell("Portfolio", body);
  document.getElementById("backBtn").onclick = closeScreen;
  overlay.querySelectorAll("[data-close]").forEach((b) => b.onclick = () => {
    closePosition(b.dataset.close);
    renderBookScreen();
  });
  overlay.querySelectorAll("[data-cancel]").forEach((b) => b.onclick = () => {
    store.cancel(b.dataset.cancel);
    refresh();
    renderBookScreen();
  });
}
function closePosition(key) {
  const p = W().portfolio.get(key);
  if (!p) return;
  const side = p.qty > 0 ? "sell" : "buy";
  store.submit({ target: p.target, side, qty: Math.abs(p.qty), type: "market", tif: "DAY" });
  if (W().mode === "live") toast("Position closed", "gain");
  else toast("Close order placed \u2014 fills next bar");
  refresh();
}
function wireTime() {
  document.querySelectorAll("[data-adv]").forEach((b) => b.onclick = () => {
    if (state.scrubbing || store.live) return;
    const kind = b.dataset.adv;
    const from = W().now;
    let target = from;
    if (kind === "h") target = ceilTo(from + 36e5, 36e5);
    else if (kind === "d") target = from + 864e5;
    else target = from + 30 * 864e5;
    animateAdvance(from, target);
  });
}
function animateAdvance(from, target) {
  state.scrubbing = true;
  app.classList.add("scrubbing");
  setAdvButtons(false);
  const span = target - from;
  const stepRes = span > 2 * 864e5 ? "1h" : "1m";
  const barMs = stepRes === "1h" ? 36e5 : 6e4;
  const maxBarsPerFrame = 24;
  const dur = 800;
  const t0 = performance.now();
  const ease = (k) => k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
  function frame(now) {
    const k = Math.min(1, (now - t0) / dur);
    let want = from + span * ease(k);
    const cap = W().now + maxBarsPerFrame * barMs;
    if (want > cap) want = cap;
    if (want > W().now) W().advanceTo(want, { stepRes });
    chart?.setData(visibleBars());
    updateHeader();
    if (W().now < target) requestAnimationFrame(frame);
    else finishAdvance(target);
  }
  requestAnimationFrame(frame);
}
function finishAdvance(target) {
  if (target > W().now) W().advanceTo(target);
  store.noteAdvance(target);
  state.scrubbing = false;
  app.classList.remove("scrubbing");
  setAdvButtons(true);
  chart?.setData(visibleBars());
  refresh();
  toast(`Advanced to ${dayLabel(W().now)}`);
}
function setAdvButtons(on) {
  document.querySelectorAll("[data-adv]").forEach((b) => b.disabled = !on);
}
function updateHeader() {
  const priceEl = document.getElementById("topbarPrice");
  const bars = visibleBars();
  if (priceEl && bars.length) {
    const last = bars[bars.length - 1];
    const prev = bars.length > 1 ? bars[bars.length - 2].c : last.o;
    const chg = (last.c - prev) / prev;
    priceEl.innerHTML = `
      <div class="px num">${priceFmt(last.c)}</div>
      <div class="chg num ${pnlClass(chg)}">${glyph(chg)} ${pct(chg)}</div>`;
  }
  const cash = W().portfolio.cash.toNumber();
  const eq = W().equity().toNumber();
  const qbBp = document.getElementById("qbBp");
  if (qbBp) qbBp.textContent = money(cash);
  const qbEq = document.getElementById("qbEq");
  if (qbEq) qbEq.textContent = money(eq);
  const acctEl = document.getElementById("topbarAcct");
  if (acctEl) {
    const totalPnl = eq - W().settings.startingCash;
    acctEl.innerHTML = `
      <div class="acct-item"><span class="k">Cash</span><span class="v num">${money(cash)}</span></div>
      <div class="acct-item"><span class="k">Equity</span><span class="v num">${money(eq)}</span></div>
      <div class="acct-item"><span class="k">P&amp;L</span><span class="v num ${pnlClass(totalPnl)}">${money(totalPnl, { sign: true })}</span></div>`;
  }
  const tl = document.getElementById("timeLabel");
  if (tl) tl.textContent = `\u25F7 ${dateLabel(W().now)}`;
  const mp = document.getElementById("modePill");
  if (mp) {
    if (store.live) {
      mp.textContent = "\u25CF LIVE";
      mp.className = "mode-pill live";
      mp.style.display = "";
    } else {
      mp.textContent = "";
      mp.className = "mode-pill";
      mp.style.display = "none";
    }
  }
}
function refresh() {
  updateHeader();
  renderSymbolTabs();
  if (state.screen === "book") renderBookScreen();
}
function openProfile() {
  state.profileOpen = true;
  const panel = document.getElementById("profilePanel");
  const backdrop = document.getElementById("panelBackdrop");
  renderProfilePanel();
  panel.classList.add("open");
  backdrop.classList.add("show");
}
function closeAllPanels() {
  state.profileOpen = false;
  document.getElementById("profilePanel")?.classList.remove("open");
  document.getElementById("panelBackdrop")?.classList.remove("show");
}
function renderProfilePanel() {
  const panel = document.getElementById("profilePanel");
  const profiles = Store.listProfiles();
  const activeId = store.profileId;
  panel.innerHTML = `
    <div class="pp-header">
      <span class="pp-title">Profiles</span>
      <button class="icon-btn" id="ppClose">\u2715</button>
    </div>
    <div class="pp-list">
      ${profiles.map((p) => `
        <div class="pp-item ${p.id === activeId ? "active" : ""}">
          <div class="pp-avatar">${p.name[0]?.toUpperCase()}</div>
          <div class="pp-info">
            <div class="pp-name">${p.name}</div>
            ${p.id === activeId ? `<div class="pp-sub">Active</div>` : ""}
          </div>
          ${p.id !== activeId ? `<button class="pp-switch" data-switch="${p.id}">Switch</button>` : ""}
          ${profiles.length > 1 ? `<button class="pp-del" data-del="${p.id}" title="Delete">\u2715</button>` : ""}
        </div>`).join("")}
    </div>
    <button class="pp-create" id="ppCreate">+ New Profile</button>`;
  document.getElementById("ppClose").onclick = closeAllPanels;
  panel.querySelectorAll("[data-switch]").forEach((b) => b.onclick = () => {
    Store.switchProfile(b.dataset.switch);
    window.location.reload();
  });
  panel.querySelectorAll("[data-del]").forEach((b) => b.onclick = () => {
    if (confirm("Delete this profile? All its data will be lost.")) {
      Store.deleteProfile(b.dataset.del);
      if (b.dataset.del === activeId) {
        window.location.reload();
        return;
      }
      renderProfilePanel();
    }
  });
  document.getElementById("ppCreate").onclick = () => {
    const name = prompt("Profile name:", "New Profile");
    if (name) {
      Store.createProfile(name);
      window.location.reload();
    }
  };
}
function chainParams() {
  const spot = W().market.spotMark(sym(), W().now).toNumber();
  return {
    underlyingSymbol: sym(),
    assetClass: inst().assetClass,
    spot,
    now: W().now,
    r: W().settings.riskFreeRate,
    q: inst().assetClass === "equity" ? W().settings.dividendYield : 0,
    surface: W().market.volSurface(sym(), W().now),
    multiplier: inst().multiplier,
    expiries: standardExpiries(W().now, inst().assetClass)
  };
}
function renderOptionsScreen() {
  const overlay = overlayEl();
  const p = chainParams();
  const chain = buildChain(p, { strikes: 7 });
  state.optExpiryIdx = Math.min(state.optExpiryIdx, chain.expiries.length - 1);
  const exp = chain.expiries[state.optExpiryIdx];
  const positions = [...W().portfolio.positions.values()].filter(
    (pos) => pos.target.kind === "option" && pos.option?.underlying === sym()
  );
  const rows = (() => {
    const strikes = exp.calls.map((c) => c.spec.strike);
    return strikes.map((k) => {
      const c = exp.calls.find((x) => x.spec.strike === k);
      const pu = exp.puts.find((x) => x.spec.strike === k);
      const isAtm = k === exp.atmStrike;
      const cItm = p.spot > k, pItm = p.spot < k;
      return `<tr class="${isAtm ? "atm" : ""}">
        <td class="${cItm ? "itm" : ""} buyc" data-opt="call:${k}">${c.bid.toFixed(2)} / ${c.ask.toFixed(2)}</td>
        <td class="${cItm ? "itm" : ""}">${c.greeks.delta.toFixed(2)}</td>
        <td class="${cItm ? "itm" : ""} dim">${(c.iv * 100).toFixed(0)}%</td>
        <td class="strike">${priceFmt(k)}</td>
        <td class="${pItm ? "itm" : ""} dim">${(pu.iv * 100).toFixed(0)}%</td>
        <td class="${pItm ? "itm" : ""}">${pu.greeks.delta.toFixed(2)}</td>
        <td class="${pItm ? "itm" : ""} buyc" data-opt="put:${k}">${pu.bid.toFixed(2)} / ${pu.ask.toFixed(2)}</td>
      </tr>`;
    }).join("");
  })();
  const resolve = W().markResolver();
  const openPositionsHTML = positions.length === 0 ? "" : `
    <h3 class="section-head">Open Option Positions</h3>
    ${positions.map((pos) => {
    const mark = resolve(pos)?.toNumber() ?? 0;
    const upnl = W().portfolio.unrealized(pos, resolve).toNumber();
    const opt = pos.option;
    return `<div class="book-row" style="margin-bottom:6px">
        <div class="book-row-info">
          <div class="book-sym">${opt.underlying.replace("-USD", "")} ${opt.strike}${opt.right[0].toUpperCase()} ${dayLabel(opt.expiry)}</div>
          <div class="sub-text">${pos.qty > 0 ? "Long" : "Short"} ${Math.abs(pos.qty)} \xD7 avg ${money(pos.avgCost.toNumber())}</div>
        </div>
        <div class="book-row-pnl">
          <div class="book-mark">${priceFmt(mark)}</div>
          <div class="pnl ${pnlClass(upnl)}">${money(upnl, { sign: true })}</div>
        </div>
        <div class="book-row-actions">
          <button class="action-btn close-btn" data-close="${pos.key}">Close</button>
        </div>
      </div>`;
  }).join("")}`;
  const body = `
    <div class="card">
      <div class="row-between">
        <div>
          <div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.06em">${sym()} Spot</div>
          <div class="num" style="font-size:28px;font-weight:700;margin-top:2px">${priceFmt(p.spot)}</div>
        </div>
        <div class="dim" style="font-size:11px;text-align:right">
          ${inst().assetClass === "equity" ? "American \xB7 physically settled" : "European \xB7 cash settled"}<br>
          Tap bid/ask to buy 1 contract
        </div>
      </div>
    </div>
    ${openPositionsHTML}
    <div class="chain-tabs">${chain.expiries.map(
    (e, i) => `<button class="chip ${i === state.optExpiryIdx ? "active" : ""}" data-exp="${i}">${dayLabel(e.expiry)}</button>`
  ).join("")}</div>
    <table class="chain">
      <thead><tr><th>Call b/a</th><th>\u0394</th><th>IV</th><th>Strike</th><th>IV</th><th>\u0394</th><th>Put b/a</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <h3 class="section-head" style="margin-top:20px">Strategy Builder</h3>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
      ${["Long Straddle", "Strangle", "Bull Call Spread", "Iron Condor"].map(
    (s) => `<button class="chip" data-strat="${s}">${s}</button>`
  ).join("")}
    </div>
    <div id="stratOut"></div>`;
  overlay.innerHTML = screenShell(`Options \u2014 ${sym()}`, body);
  document.getElementById("backBtn").onclick = closeScreen;
  overlay.querySelectorAll("[data-exp]").forEach((b) => b.onclick = () => {
    state.optExpiryIdx = +b.dataset.exp;
    renderOptionsScreen();
  });
  overlay.querySelectorAll("[data-opt]").forEach((b) => b.onclick = () => {
    const [right, k] = b.dataset.opt.split(":");
    const q = (right === "call" ? exp.calls : exp.puts).find((x) => x.spec.strike === +k);
    tradeOption(q);
  });
  overlay.querySelectorAll("[data-strat]").forEach((b) => b.onclick = () => buildStrategy(b.dataset.strat, exp, p.spot));
  overlay.querySelectorAll("[data-close]").forEach((b) => b.onclick = () => {
    closePosition(b.dataset.close);
    renderOptionsScreen();
  });
}
function tradeOption(q) {
  const res = store.submit({ target: { kind: "option", symbol: q.spec.underlying, option: q.spec }, side: "buy", qty: 1, type: "market", tif: "DAY" });
  if (!res.ok) {
    toast(res.reason ?? "Rejected", "loss");
    return;
  }
  toast(W().mode === "live" ? "Option filled" : "Option order \u2014 fills next bar", "gain");
  refresh();
  renderOptionsScreen();
}
function buildStrategy(name, exp, spot) {
  const calls = exp.calls, puts = exp.puts;
  const atm = exp.atmStrike;
  const callAtm = calls.find((c) => c.spec.strike === atm);
  const putAtm = puts.find((c) => c.spec.strike === atm);
  const ks = calls.map((c) => c.spec.strike).sort((a2, b) => a2 - b);
  const above = ks.find((k) => k > atm) ?? atm;
  const below = [...ks].reverse().find((k) => k < atm) ?? atm;
  let strat;
  if (name === "Long Straddle") strat = straddle(callAtm, putAtm);
  else if (name === "Strangle") strat = strangle(calls.find((c) => c.spec.strike === above), puts.find((c) => c.spec.strike === below));
  else if (name === "Bull Call Spread") strat = verticalSpread(callAtm, calls.find((c) => c.spec.strike === above));
  else strat = ironCondor(
    puts.find((c) => c.spec.strike === ks[Math.max(0, ks.indexOf(below) - 1)]),
    puts.find((c) => c.spec.strike === below),
    calls.find((c) => c.spec.strike === above),
    calls.find((c) => c.spec.strike === ks[Math.min(ks.length - 1, ks.indexOf(above) + 1)])
  );
  const a = analyzeStrategy(strat, spot);
  const out = document.getElementById("stratOut");
  out.innerHTML = `<div class="card">
    <div class="row-between">
      <strong>${strat.name}</strong>
      <span class="num ${a.netCost > 0 ? "loss" : "gain"}">${a.netCost > 0 ? "Debit" : "Credit"} ${money(Math.abs(a.netCost))}</span>
    </div>
    <canvas id="payoff" style="width:100%;height:160px;margin-top:14px;display:block"></canvas>
    <div class="stat-grid" style="margin-top:14px">
      <div class="stat"><div class="k">Max Profit</div><div class="v num gain">${a.maxProfit === Infinity ? "\u221E" : money(a.maxProfit)}</div></div>
      <div class="stat"><div class="k">Max Loss</div><div class="v num loss">${a.maxLoss === -Infinity ? "\u221E" : money(a.maxLoss)}</div></div>
    </div>
    <div class="muted mt" style="font-size:12px">Breakevens: ${a.breakevens.map((b) => priceFmt(b)).join(", ") || "\u2014"}</div>
    <button class="submit buy mt" id="execStrat">Execute ${strat.legs.length}-leg strategy</button>
  </div>`;
  requestAnimationFrame(() => drawPayoff(document.getElementById("payoff"), a.payoff, spot, a.breakevens));
  document.getElementById("execStrat").onclick = () => {
    for (const leg of strat.legs) {
      if (leg.kind !== "option" || !leg.spec) continue;
      store.submit({ target: { kind: "option", symbol: leg.spec.underlying, option: leg.spec }, side: leg.side > 0 ? "buy" : "sell", qty: leg.qty, type: "market", tif: "DAY" });
    }
    toast(`${strat.name} submitted`, "gain");
    refresh();
  };
}
function renderStatsScreen() {
  const overlay = overlayEl();
  const r = analytics(W());
  const totalPnl = Number(r.totalPnl);
  const body = `
    <div class="card">
      <div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.06em">Total Equity</div>
      <div class="num" style="font-size:32px;font-weight:700;margin-top:4px">${money(r.equity)}</div>
      <div class="num ${pnlClass(totalPnl)}" style="margin-top:4px">${glyph(totalPnl)} ${money(totalPnl, { sign: true })} total P&amp;L</div>
      <canvas id="eqCurve" style="width:100%;height:140px;margin-top:16px;display:block"></canvas>
    </div>
    <div class="stat-grid">
      ${stat("Realized P&L", money(Number(r.totalRealized)), pnlClass(Number(r.totalRealized)))}
      ${stat("Unrealized P&L", money(Number(r.totalUnrealized)), pnlClass(Number(r.totalUnrealized)))}
      ${stat("Win Rate", (r.trade.winRate * 100).toFixed(0) + "%")}
      ${stat("Profit Factor", isFinite(r.trade.profitFactor) ? r.trade.profitFactor.toFixed(2) : "\u221E")}
      ${stat("Expectancy", money(Number(r.trade.expectancy)))}
      ${stat("Trades", String(r.trade.trades))}
      ${stat("Avg Win", money(Number(r.trade.avgWin)), "gain")}
      ${stat("Avg Loss", money(Number(r.trade.avgLoss)), "loss")}
      ${stat("Max Drawdown", money(Number(r.drawdown.maxDrawdown)) + ` (${(r.drawdown.maxDrawdownPct * 100).toFixed(1)}%)`, "loss")}
      ${stat("Avg Hold", r.trade.avgHoldHours.toFixed(1) + "h")}
    </div>`;
  overlay.innerHTML = screenShell("Statistics", body);
  document.getElementById("backBtn").onclick = closeScreen;
  requestAnimationFrame(() => drawEquityCurve(
    document.getElementById("eqCurve"),
    r.equityCurve.map((p) => ({ t: p.t, equity: Number(p.equity) })),
    W().settings.startingCash
  ));
}
function stat(k, v, cls = "") {
  return `<div class="stat"><div class="k">${k}</div><div class="v num ${cls}">${v}</div></div>`;
}
function renderLearnScreen() {
  const overlay = overlayEl();
  if (!getCurriculum(W())) {
    overlay.innerHTML = screenShell("Learn", `<div class="empty" style="padding:24px">Help is disabled. Enable Help in Settings to access the learning track.</div>`);
    document.getElementById("backBtn").onclick = closeScreen;
    return;
  }
  if (state.learnModule) return renderModule(state.learnModule);
  const map = store.progress.completionMap();
  const body = `
    <div class="muted" style="margin-bottom:16px;font-size:13px">Options, end to end \u2014 ${(store.progress.overallProgress() * 100).toFixed(0)}% complete.</div>
    ${CURRICULUM.map((m, i) => {
    const st = map[i];
    return `<div class="module ${st.unlocked ? "" : "locked"}" ${st.unlocked ? `data-mod="${m.id}"` : ""}>
        <div class="mhead">
          <span>${m.index}. ${m.title}</span>
          ${st.passed ? `<span class="badge done">\u2713 ${(st.bestScore * 100).toFixed(0)}%</span>` : ""}
          ${!st.unlocked ? `<span class="badge">Locked</span>` : ""}
        </div>
        <div class="lesson-body">${m.summary}</div>
      </div>`;
  }).join("")}`;
  overlay.innerHTML = screenShell("Learn Options", body);
  document.getElementById("backBtn").onclick = closeScreen;
  overlay.querySelectorAll("[data-mod]").forEach((b) => b.onclick = () => {
    state.learnModule = b.dataset.mod;
    renderModule(b.dataset.mod);
  });
}
function renderModule(id) {
  const overlay = overlayEl();
  const m = CURRICULUM.find((x) => x.id === id);
  const answers = {};
  const body = `
    ${m.lessons.map((l) => `
      <div class="card"><strong>${l.title}</strong>
        <div class="lesson-body">${l.body}</div>
      </div>`).join("")}
    <h3 style="margin:16px 0 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-3)">Quiz \u2014 pass \u2265 ${(m.passThreshold * 100).toFixed(0)}%</h3>
    <div id="quiz">
      ${m.quiz.map((q) => `
        <div class="card" data-q="${q.id}">
          <strong>${q.prompt}</strong>
          ${q.options.map((o, i) => `<button class="quiz-opt" data-pick="${q.id}:${i}">${o}</button>`).join("")}
        </div>`).join("")}
    </div>
    <button class="submit buy" id="grade" style="max-width:280px">Submit Quiz</button>
    <div class="note" id="quizNote"></div>`;
  overlay.innerHTML = screenShell(`${m.index}. ${m.title}`, body);
  document.getElementById("backBtn").onclick = () => {
    state.learnModule = null;
    renderLearnScreen();
  };
  overlay.querySelectorAll("[data-pick]").forEach((b) => b.onclick = () => {
    const [qid, i] = b.dataset.pick.split(":");
    answers[qid] = +i;
    overlay.querySelectorAll(`[data-pick^="${qid}:"]`).forEach((x) => x.classList.remove("sel"));
    b.classList.add("sel");
  });
  document.getElementById("grade").onclick = () => {
    const res = store.progress.grade(m.id, answers);
    store.save();
    m.quiz.forEach((q) => overlay.querySelectorAll(`[data-pick^="${q.id}:"]`).forEach((x) => {
      const i = +x.dataset.pick.split(":")[1];
      if (i === q.answer) x.classList.add("correct");
      else if (answers[q.id] === i) x.classList.add("wrong");
    }));
    const note = document.getElementById("quizNote");
    note.style.color = res.passed ? "var(--gain)" : "var(--loss)";
    note.textContent = `${(res.bestScore * 100).toFixed(0)}% \u2014 ${res.passed ? "Passed \u2713" : "Keep going \u2014 review and retake."}`;
    renderNav();
  };
}
function renderSettingsScreen() {
  const overlay = overlayEl();
  const s = W().settings;
  const body = `
    <div class="card">
      ${toggleRow("Live market prices", "Crypto prices update from Coinbase in real time. Off = historical simulation.", store.live, "liveMode")}
      ${toggleRow("Help & Learning", "Enable the options learning track and terminal commentary.", s.helpEnabled, "helpEnabled")}
      ${toggleRow("Fee & spread realism", "Model bid/ask spread, slippage and fees on fills.", s.feeRealism, "feeRealism")}
      ${toggleRow("Light theme", "Switch to the light appearance.", store.ui.theme === "light", "theme")}
    </div>
    <div class="card">
      <div class="set-row">
        <div class="label"><div>Add funds</div><div class="sub">Current cash: ${money(W().portfolio.cash.toNumber())}</div></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <input class="input num" id="depAmt" inputmode="decimal" placeholder="500" style="max-width:140px">
        <button class="adv-btn" id="depBtn">Deposit</button>
      </div>
    </div>
    <div class="card">
      <div class="set-row">
        <div class="label"><div>Risk-free rate</div><div class="sub">Used for option pricing (BSM/BAW)</div></div>
        <input class="input num" id="rfr" style="width:72px" value="${(s.riskFreeRate * 100).toFixed(1)}">
      </div>
    </div>
    <div class="card">
      <div class="set-row" style="border-bottom:none;padding-bottom:6px">
        <div class="label"><div>Reset account</div><div class="sub">Wipe portfolio, orders and clock to a fresh start.</div></div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <input class="input num" id="resetCash" style="max-width:140px" value="${Math.round(W().settings.startingCash)}" placeholder="1000">
        <button class="adv-btn" id="resetBtn" style="color:var(--loss);border-color:var(--loss);margin-left:auto">Reset</button>
      </div>
    </div>
    <div class="card">
      <strong>About ORION</strong>
      <div class="lesson-body">
        ORION uses historical and/or delayed market data for trading practice.
        It holds no real funds and places no real orders. All prices, fills, options and
        Greeks are modeled \u2014 not financial advice.
      </div>
    </div>`;
  overlay.innerHTML = screenShell("Settings", body);
  document.getElementById("backBtn").onclick = closeScreen;
  overlay.querySelectorAll("[data-toggle]").forEach((b) => b.onclick = () => onToggle(b.dataset.toggle));
  document.getElementById("depBtn").onclick = () => {
    const v = parseFloat(document.getElementById("depAmt").value);
    if (v > 0) {
      store.deposit(v);
      toast(`Deposited ${money(v)}`, "gain");
      renderSettingsScreen();
      refresh();
    }
  };
  document.getElementById("rfr").addEventListener("change", (e) => {
    store.updateSettings({ riskFreeRate: (parseFloat(e.target.value) || 4) / 100 });
  });
  document.getElementById("resetBtn").onclick = () => {
    const cash = Math.max(0, parseFloat(document.getElementById("resetCash").value) || W().settings.startingCash);
    if (confirm(`Reset account to ${money(cash)} bankroll? This wipes all positions, orders and history.`)) {
      store.reset(cash);
      state.screen = "trade";
      renderShell();
      toast(`Account reset \u2014 ${money(cash)} bankroll`);
    }
  };
}
function toggleRow(label, sub, on, key) {
  return `<div class="set-row">
    <div class="label"><div>${label}</div><div class="sub">${sub}</div></div>
    <div class="toggle ${on ? "on" : ""}" data-toggle="${key}"><div class="knob"></div></div>
  </div>`;
}
function onToggle(key) {
  if (key === "helpEnabled") {
    store.updateSettings({ helpEnabled: !W().settings.helpEnabled });
    renderNav();
  } else if (key === "feeRealism") store.updateSettings({ feeRealism: !W().settings.feeRealism });
  else if (key === "liveMode") {
    if (store.live) {
      store.ui.livePref = false;
      store.saveUi();
      store.disableLive();
      toast("Simulation mode");
    } else {
      store.ui.livePref = true;
      store.saveUi();
      void store.enableLive().then(() => {
        if (store.live) {
          toast("Live prices active", "gain");
        } else {
          toast("Could not connect \u2014 staying in simulation");
        }
        renderNav();
        renderSettingsScreen();
        refresh();
      });
      return;
    }
  } else if (key === "theme") {
    store.ui.theme = store.ui.theme === "light" ? "dark" : "light";
    store.saveUi();
    document.documentElement.setAttribute("data-theme", store.ui.theme);
    chart?.setData(visibleBars());
  }
  renderSettingsScreen();
  renderNav();
  refresh();
}
function toast(msg, cls = "") {
  const t = document.getElementById("toast");
  t.className = `toast show ${cls}`;
  t.textContent = msg;
  setTimeout(() => t.className = "toast", 2500);
}
function ceilTo(t, step) {
  return Math.ceil(t / step) * step;
}
function brandLogoLarge() {
  return `<svg class="splash-logo" width="64" height="64" viewBox="0 0 24 24" fill="none">
    <circle cx="5" cy="17" r="2" fill="var(--accent)"/>
    <circle cx="12" cy="11" r="2" fill="var(--accent)" opacity="0.8"/>
    <circle cx="19" cy="5" r="2" fill="var(--accent)" opacity="0.6"/>
    <path d="M5 17L12 11L19 5" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" opacity="0.4"/>
  </svg>`;
}
function brandMark() {
  return `<div class="brand-inner">
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="5" cy="17" r="2" fill="var(--accent)"/>
      <circle cx="12" cy="11" r="2" fill="var(--accent)" opacity="0.75"/>
      <circle cx="19" cy="5" r="2" fill="var(--accent)" opacity="0.5"/>
      <path d="M5 17L12 11L19 5" stroke="var(--accent)" stroke-width="1.3" stroke-linecap="round" opacity="0.35"/>
    </svg>
    <span class="wordmark">ORION</span>
  </div>`;
}
function tradeIcon() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
    <polyline points="3,17 7,11 11,14 15,7 21,7"/>
    <polyline points="17,7 21,7 21,11"/>
  </svg>`;
}
function bookIcon() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <line x1="3" y1="9" x2="21" y2="9"/>
    <line x1="3" y1="15" x2="21" y2="15"/>
    <line x1="9" y1="9" x2="9" y2="21"/>
  </svg>`;
}
function optionsIcon() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
    <path d="M4.9 4.9l2.1 2.1M16.9 16.9l2.1 2.1M19.1 4.9l-2.1 2.1M7.1 16.9l-2.1 2.1"/>
  </svg>`;
}
function statsIcon() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/>
  </svg>`;
}
function learnIcon() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
  </svg>`;
}
function settingsIcon() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06-.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>`;
}
boot();
//# sourceMappingURL=bundle.js.map
