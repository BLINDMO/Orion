/**
 * Fixed-point decimal arithmetic for ORION.
 *
 * Spec §13.5 — "Exact money math: use integer minor units or a decimal library;
 * never naive floats for cash/P&L." Every cash balance, fill price, fee and P&L
 * figure flows through this type. Internally a value is stored as a bigint number
 * of "units" where 1.0 === 10^SCALE units. SCALE = 8 covers crypto satoshi-level
 * precision and sub-cent equity pricing.
 */

export const SCALE = 8 as const;
const SCALE_FACTOR = 10n ** BigInt(SCALE);

export type DecInput = Dec | number | string | bigint;

/** Rounding modes for explicit quantization. */
export type RoundMode = "half-up" | "half-even" | "down" | "up" | "floor" | "ceil";

export class Dec {
  /** Raw scaled integer (value * 10^SCALE). */
  readonly units: bigint;

  private constructor(units: bigint) {
    this.units = units;
  }

  static readonly ZERO = new Dec(0n);
  static readonly ONE = new Dec(SCALE_FACTOR);

  static fromUnits(units: bigint): Dec {
    return new Dec(units);
  }

  static from(value: DecInput): Dec {
    if (value instanceof Dec) return value;
    if (typeof value === "bigint") return new Dec(value * SCALE_FACTOR);
    if (typeof value === "number") {
      if (!Number.isFinite(value)) {
        throw new RangeError(`Dec.from: non-finite number ${value}`);
      }
      // Route through string to avoid binary-float artifacts. 1e-8 precision.
      return Dec.parse(value.toFixed(SCALE));
    }
    return Dec.parse(value);
  }

  /** Parse a decimal string like "-1234.5678" with arbitrary precision input. */
  static parse(s: string): Dec {
    const str = s.trim();
    const m = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(str);
    if (!m || (m[2] === "" && (m[3] ?? "") === "")) {
      throw new SyntaxError(`Dec.parse: invalid decimal "${s}"`);
    }
    const sign = m[1] === "-" ? -1n : 1n;
    const intPart = m[2] ?? "";
    let fracPart = m[3] ?? "";
    // Round (half-up) any precision beyond SCALE.
    let roundUp = false;
    if (fracPart.length > SCALE) {
      const nextDigit = fracPart.charCodeAt(SCALE) - 48;
      roundUp = nextDigit >= 5;
      fracPart = fracPart.slice(0, SCALE);
    }
    fracPart = fracPart.padEnd(SCALE, "0");
    let units = BigInt(intPart === "" ? "0" : intPart) * SCALE_FACTOR + BigInt(fracPart);
    if (roundUp) units += 1n;
    return new Dec(sign * units);
  }

  add(o: DecInput): Dec {
    return new Dec(this.units + Dec.from(o).units);
  }

  sub(o: DecInput): Dec {
    return new Dec(this.units - Dec.from(o).units);
  }

  /** Multiply. Product has 2*SCALE units, so divide once by SCALE_FACTOR (round half-up). */
  mul(o: DecInput): Dec {
    const raw = this.units * Dec.from(o).units;
    return new Dec(divRoundHalfUp(raw, SCALE_FACTOR));
  }

  /** Divide. (a/b) where both scaled: (a*SCALE_FACTOR)/b, round half-up. */
  div(o: DecInput): Dec {
    const d = Dec.from(o).units;
    if (d === 0n) throw new RangeError("Dec.div: division by zero");
    return new Dec(divRoundHalfUp(this.units * SCALE_FACTOR, d));
  }

  neg(): Dec {
    return new Dec(-this.units);
  }

  abs(): Dec {
    return this.units < 0n ? new Dec(-this.units) : this;
  }

  min(o: DecInput): Dec {
    const b = Dec.from(o);
    return this.units <= b.units ? this : b;
  }

  max(o: DecInput): Dec {
    const b = Dec.from(o);
    return this.units >= b.units ? this : b;
  }

  cmp(o: DecInput): -1 | 0 | 1 {
    const b = Dec.from(o).units;
    return this.units < b ? -1 : this.units > b ? 1 : 0;
  }

  eq(o: DecInput): boolean {
    return this.units === Dec.from(o).units;
  }
  lt(o: DecInput): boolean {
    return this.units < Dec.from(o).units;
  }
  lte(o: DecInput): boolean {
    return this.units <= Dec.from(o).units;
  }
  gt(o: DecInput): boolean {
    return this.units > Dec.from(o).units;
  }
  gte(o: DecInput): boolean {
    return this.units >= Dec.from(o).units;
  }

  isZero(): boolean {
    return this.units === 0n;
  }
  isNeg(): boolean {
    return this.units < 0n;
  }
  isPos(): boolean {
    return this.units > 0n;
  }
  sign(): -1 | 0 | 1 {
    return this.units < 0n ? -1 : this.units > 0n ? 1 : 0;
  }

  /** Quantize to `places` decimal places using the given rounding mode. */
  round(places = 2, mode: RoundMode = "half-up"): Dec {
    if (places >= SCALE) return this;
    const factor = 10n ** BigInt(SCALE - places);
    return new Dec(roundDiv(this.units, factor, mode) * factor);
  }

  /** Round to whole cents (2 dp) — the canonical cash representation. */
  toCents(): Dec {
    return this.round(2, "half-even");
  }

  toNumber(): number {
    return Number(this.units) / Number(SCALE_FACTOR);
  }

  /** Full-precision decimal string, trailing zeros stripped. */
  toString(): string {
    const neg = this.units < 0n;
    const abs = neg ? -this.units : this.units;
    const intPart = abs / SCALE_FACTOR;
    const frac = (abs % SCALE_FACTOR).toString().padStart(SCALE, "0").replace(/0+$/, "");
    const body = frac === "" ? `${intPart}` : `${intPart}.${frac}`;
    return neg ? `-${body}` : body;
  }

  /** Fixed `places` string, e.g. "1234.50". */
  toFixed(places = 2): string {
    const r = this.round(places, "half-up");
    const neg = r.units < 0n;
    const abs = neg ? -r.units : r.units;
    const intPart = abs / SCALE_FACTOR;
    const fracAll = (abs % SCALE_FACTOR).toString().padStart(SCALE, "0");
    const frac = places === 0 ? "" : "." + fracAll.slice(0, places);
    return `${neg ? "-" : ""}${intPart}${frac}`;
  }

  toJSON(): string {
    return this.toString();
  }
}

function divRoundHalfUp(num: bigint, den: bigint): bigint {
  return roundDiv(num, den, "half-up");
}

function roundDiv(num: bigint, den: bigint, mode: RoundMode): bigint {
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
    case "down": // toward zero
      return q;
    case "up": // away from zero
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
      // exactly halfway -> round to even
      const even = q % 2n === 0n;
      if (even) return q;
      return neg ? q - 1n : q + 1n;
    }
  }
}

/** Convenience constructor. */
export function dec(value: DecInput): Dec {
  return Dec.from(value);
}

/** Sum a list of decimals. */
export function decSum(values: readonly DecInput[]): Dec {
  let acc = Dec.ZERO;
  for (const v of values) acc = acc.add(v);
  return acc;
}
