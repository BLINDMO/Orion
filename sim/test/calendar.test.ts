import { test } from "node:test";
import assert from "node:assert/strict";
import { getCalendar, __testing } from "../src/time/calendar.ts";

const eq = getCalendar("us-equity");
const crypto = getCalendar("24x7");

// Helper: build a UTC instant from ET wall-clock by trial (we just use known UTC values).
test("crypto is always open", () => {
  assert.equal(crypto.isOpen(Date.UTC(2023, 0, 1, 3, 0)), true); // Sunday 3am
  assert.equal(crypto.isTradingDay(Date.UTC(2023, 0, 1)), true);
});

test("equity closed on weekends", () => {
  // 2023-01-07 is a Saturday
  assert.equal(eq.isTradingDay(Date.UTC(2023, 0, 7, 16, 0)), false);
  // 2023-01-08 Sunday
  assert.equal(eq.isTradingDay(Date.UTC(2023, 0, 8, 16, 0)), false);
});

test("equity open during RTH on a weekday", () => {
  // 2023-06-15 Thursday. 14:30 UTC = 10:30 EDT -> open.
  assert.equal(eq.isOpen(Date.UTC(2023, 5, 15, 14, 30)), true);
  // 13:00 UTC = 09:00 EDT -> pre-open, closed.
  assert.equal(eq.isOpen(Date.UTC(2023, 5, 15, 13, 0)), false);
  // 20:30 UTC = 16:30 EDT -> after close.
  assert.equal(eq.isOpen(Date.UTC(2023, 5, 15, 20, 30)), false);
});

test("DST offset transitions", () => {
  // January -> EST (-5h)
  assert.equal(__testing.easternOffsetMs(Date.UTC(2023, 0, 15)), -5 * 3600_000);
  // July -> EDT (-4h)
  assert.equal(__testing.easternOffsetMs(Date.UTC(2023, 6, 15)), -4 * 3600_000);
});

test("equity closed on Christmas and July 4", () => {
  // 2023-12-25 Monday
  assert.equal(eq.isTradingDay(Date.UTC(2023, 11, 25, 16, 0)), false);
  // 2023-07-04 Tuesday
  assert.equal(eq.isTradingDay(Date.UTC(2023, 6, 4, 16, 0)), false);
});

test("July 4 2021 observed on Monday July 5", () => {
  const h2021 = __testing.usEquityHolidaysET(2021);
  // July 4 2021 is Sunday -> observed Monday July 5 (month index 6, day 5)
  assert.equal(h2021.has("2021-6-5"), true);
});

test("Good Friday 2023 is April 7", () => {
  const gf = __testing.goodFridayUTC(2023);
  const d = new Date(gf);
  assert.equal(d.getUTCMonth(), 3); // April
  assert.equal(d.getUTCDate(), 7);
});

test("nextOpen from a closed Saturday lands on Monday 09:30 ET", () => {
  // Saturday 2023-06-10 12:00 UTC (following Monday Jun 12 is a normal session)
  const sat = Date.UTC(2023, 5, 10, 12, 0);
  const open = eq.nextOpen(sat);
  assert.equal(eq.isOpen(open), true);
  // Monday 2023-06-12 13:30 UTC = 09:30 EDT
  assert.equal(open, Date.UTC(2023, 5, 12, 13, 30));
});

test("nextOpen skips a holiday (Juneteenth Mon 2023-06-19) to Tuesday", () => {
  const sat = Date.UTC(2023, 5, 17, 12, 0); // Sat before Juneteenth Monday
  const open = eq.nextOpen(sat);
  assert.equal(open, Date.UTC(2023, 5, 20, 13, 30)); // Tue Jun 20 09:30 EDT
});

test("nextTradingDayOpen skips weekend", () => {
  // Friday 2023-06-09 18:00 UTC (after close)
  const fri = Date.UTC(2023, 5, 9, 18, 0);
  const nextOpen = eq.nextTradingDayOpen(fri);
  // Monday 2023-06-12 13:30 UTC
  assert.equal(nextOpen, Date.UTC(2023, 5, 12, 13, 30));
});

test("nextClose during session is today's 16:00 ET", () => {
  const t = Date.UTC(2023, 5, 15, 14, 30); // Thu 10:30 EDT
  const close = eq.nextClose(t);
  assert.equal(close, Date.UTC(2023, 5, 15, 20, 0)); // 16:00 EDT
});
