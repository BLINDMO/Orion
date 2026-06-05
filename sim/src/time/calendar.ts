/**
 * Trading calendars. Spec §5 — equities skip weekends/holidays; crypto is 24/7.
 *
 * All reasoning is in UTC. The US-equity session is modeled in US/Eastern
 * (09:30–16:00 ET) and converted to UTC. We implement a self-contained
 * Eastern-time offset (no external tz database) using the standard US DST rule
 * in effect since 2007: DST runs from the 2nd Sunday of March 02:00 local to
 * the 1st Sunday of November 02:00 local.
 */

import type { Millis } from "../data/types.ts";

export type CalendarId = "24x7" | "us-equity";

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;

/** Day-of-week in UTC: 0=Sun..6=Sat. */
function utcDow(t: Millis): number {
  return new Date(t).getUTCDay();
}

/** Midnight UTC at or before t. */
function utcMidnight(t: Millis): Millis {
  return Math.floor(t / DAY_MS) * DAY_MS;
}

/** Nth given weekday (0=Sun) of a month, returns its UTC midnight timestamp. */
function nthWeekdayOfMonthUTC(year: number, month0: number, weekday: number, n: number): Millis {
  const first = Date.UTC(year, month0, 1);
  const firstDow = new Date(first).getUTCDay();
  let day = 1 + ((weekday - firstDow + 7) % 7) + (n - 1) * 7;
  return Date.UTC(year, month0, day);
}

/** Last given weekday of a month (UTC midnight). */
function lastWeekdayOfMonthUTC(year: number, month0: number, weekday: number): Millis {
  const lastDay = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  const last = Date.UTC(year, month0, lastDay);
  const lastDow = new Date(last).getUTCDay();
  const day = lastDay - ((lastDow - weekday + 7) % 7);
  return Date.UTC(year, month0, day);
}

/**
 * Eastern Time UTC offset in ms for a given instant.
 * EST = UTC-5, EDT = UTC-4. DST: 2nd Sun Mar 07:00 UTC → 1st Sun Nov 06:00 UTC.
 * (02:00 local switch; 07:00/06:00 UTC because the transition happens at the
 * pre-transition local offset.)
 */
function easternOffsetMs(t: Millis): number {
  const year = new Date(t).getUTCFullYear();
  const dstStart = nthWeekdayOfMonthUTC(year, 2, 0, 2) + 7 * HOUR_MS; // Mar, 2nd Sun, 02:00 EST(UTC-5)
  const dstEnd = nthWeekdayOfMonthUTC(year, 10, 0, 1) + 6 * HOUR_MS; // Nov, 1st Sun, 02:00 EDT(UTC-4)
  const isDst = t >= dstStart && t < dstEnd;
  return isDst ? -4 * HOUR_MS : -5 * HOUR_MS;
}

/** Convert a UTC instant to Eastern local civil fields. */
function toEastern(t: Millis): { y: number; mo: number; d: number; dow: number; minOfDay: number } {
  const off = easternOffsetMs(t);
  const local = new Date(t + off);
  return {
    y: local.getUTCFullYear(),
    mo: local.getUTCMonth(),
    d: local.getUTCDate(),
    dow: local.getUTCDay(),
    minOfDay: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

/** US market holidays (full closures) computed by rule for any year. Returns set of ET civil dates as "y-mo-d". */
function usEquityHolidaysET(year: number): Set<string> {
  const key = (ms: Millis) => {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
  };
  const observed = (ms: Millis): Millis => {
    // If holiday falls on Saturday -> observed Friday; Sunday -> observed Monday.
    const dow = new Date(ms).getUTCDay();
    if (dow === 6) return ms - DAY_MS;
    if (dow === 0) return ms + DAY_MS;
    return ms;
  };
  const out = new Set<string>();
  out.add(key(observed(Date.UTC(year, 0, 1)))); // New Year's Day
  out.add(key(nthWeekdayOfMonthUTC(year, 0, 1, 3))); // MLK — 3rd Mon Jan
  out.add(key(nthWeekdayOfMonthUTC(year, 1, 1, 3))); // Presidents — 3rd Mon Feb
  out.add(key(goodFridayUTC(year))); // Good Friday
  out.add(key(lastWeekdayOfMonthUTC(year, 4, 1))); // Memorial — last Mon May
  out.add(key(observed(Date.UTC(year, 5, 19)))); // Juneteenth
  out.add(key(observed(Date.UTC(year, 6, 4)))); // Independence Day
  out.add(key(nthWeekdayOfMonthUTC(year, 8, 1, 1))); // Labor — 1st Mon Sep
  out.add(key(nthWeekdayOfMonthUTC(year, 10, 4, 4))); // Thanksgiving — 4th Thu Nov
  out.add(key(observed(Date.UTC(year, 11, 25)))); // Christmas
  return out;
}

/** Good Friday (2 days before Easter Sunday) via the anonymous Gregorian algorithm. */
function goodFridayUTC(year: number): Millis {
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
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=March,4=April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  const easter = Date.UTC(year, month - 1, day);
  return easter - 2 * DAY_MS; // Good Friday
}

const EQUITY_OPEN_MIN = 9 * 60 + 30; // 09:30 ET
const EQUITY_CLOSE_MIN = 16 * 60; // 16:00 ET

export interface TradingCalendar {
  readonly id: CalendarId;
  /** Is the market open (accepting fills) at instant t? */
  isOpen(t: Millis): boolean;
  /** Is the ET/UTC civil day of t a trading day (ignores intraday hours)? */
  isTradingDay(t: Millis): boolean;
  /** First open instant strictly after t (or t if t opens a session and includeNow). */
  nextOpen(t: Millis): Millis;
  /** The next session's close at/after t. */
  nextClose(t: Millis): Millis;
  /** UTC instant of the next trading day's open, strictly after the session containing t. */
  nextTradingDayOpen(t: Millis): Millis;
}

class CryptoCalendar implements TradingCalendar {
  readonly id = "24x7" as const;
  isOpen(): boolean {
    return true;
  }
  isTradingDay(): boolean {
    return true;
  }
  nextOpen(t: Millis): Millis {
    return t;
  }
  nextClose(t: Millis): Millis {
    return Number.POSITIVE_INFINITY;
  }
  nextTradingDayOpen(t: Millis): Millis {
    return utcMidnight(t) + DAY_MS;
  }
}

class UsEquityCalendar implements TradingCalendar {
  readonly id = "us-equity" as const;
  private holidayCache = new Map<number, Set<string>>();

  private holidays(year: number): Set<string> {
    let h = this.holidayCache.get(year);
    if (!h) {
      h = usEquityHolidaysET(year);
      this.holidayCache.set(year, h);
    }
    return h;
  }

  isTradingDay(t: Millis): boolean {
    const e = toEastern(t);
    if (e.dow === 0 || e.dow === 6) return false;
    return !this.holidays(e.y).has(`${e.y}-${e.mo}-${e.d}`);
  }

  isOpen(t: Millis): boolean {
    if (!this.isTradingDay(t)) return false;
    const min = toEastern(t).minOfDay;
    return min >= EQUITY_OPEN_MIN && min < EQUITY_CLOSE_MIN;
  }

  /** ET civil-midnight instant for the day containing t, expressed in UTC. */
  private etDayStartUTC(t: Millis): Millis {
    const off = easternOffsetMs(t);
    const local = new Date(t + off);
    const localMidnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
    return localMidnight - off;
  }

  private sessionOpenUTC(t: Millis): Millis {
    return this.etDayStartUTC(t) + EQUITY_OPEN_MIN * MIN_MS;
  }
  private sessionCloseUTC(t: Millis): Millis {
    return this.etDayStartUTC(t) + EQUITY_CLOSE_MIN * MIN_MS;
  }

  nextOpen(t: Millis): Millis {
    let cur = t;
    for (let guard = 0; guard < 4000; guard++) {
      if (this.isTradingDay(cur)) {
        const open = this.sessionOpenUTC(cur);
        const close = this.sessionCloseUTC(cur);
        if (t < open) return open;
        if (t < close && t >= open) return t; // already inside session
      }
      // advance to next ET midnight
      cur = this.etDayStartUTC(cur) + DAY_MS + HOUR_MS; // +1h cushions DST shifts
    }
    throw new Error("nextOpen: no trading day found within horizon");
  }

  nextClose(t: Millis): Millis {
    let cur = t;
    for (let guard = 0; guard < 4000; guard++) {
      if (this.isTradingDay(cur)) {
        const close = this.sessionCloseUTC(cur);
        if (t < close) return close;
      }
      cur = this.etDayStartUTC(cur) + DAY_MS + HOUR_MS;
    }
    throw new Error("nextClose: no trading day found within horizon");
  }

  nextTradingDayOpen(t: Millis): Millis {
    // Move to the day strictly after t's ET day, then find next open.
    const nextDay = this.etDayStartUTC(t) + DAY_MS + HOUR_MS;
    return this.nextOpen(nextDay);
  }
}

const CRYPTO = new CryptoCalendar();
const US_EQUITY = new UsEquityCalendar();

export function getCalendar(id: CalendarId): TradingCalendar {
  return id === "24x7" ? CRYPTO : US_EQUITY;
}

export const __testing = {
  easternOffsetMs,
  usEquityHolidaysET,
  goodFridayUTC,
  toEastern,
};
