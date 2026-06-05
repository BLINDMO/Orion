/**
 * Instrument universe + bundled seed dataset. Spec §4.
 *
 * Metadata (tick/lot/multiplier/calendar/fees/microstructure) per instrument,
 * and a deterministic seed of OHLCV so the app is fully runnable offline. Real
 * downloadable packs replace `buildSeedData` output with no other change.
 */

import type { AssetClass, Instrument } from "./types.ts";
import { InstrumentData } from "./series.ts";
import { buildSyntheticInstrument, type SyntheticSpec } from "./synthetic.ts";

const cryptoFees = { takerBps: 40, makerBps: 20, perOrder: 0, minFee: 0 };
const equityFees = { takerBps: 0, makerBps: 0, perOrder: 0, minFee: 0 };
const cryptoMicro = { halfSpreadBps: 5, slippageK: 80, maxParticipation: 0.25 };
const equityMicro = { halfSpreadBps: 2, slippageK: 40, maxParticipation: 0.1 };

function crypto(symbol: string, name: string, tickSize: number, lotSize: number): Instrument {
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
    borrowBps: 1500,
  };
}

function equity(symbol: string, name: string): Instrument {
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
    borrowBps: 300,
  };
}

export const INSTRUMENTS: Instrument[] = [
  crypto("BTC-USD", "Bitcoin", 0.01, 0.00000001),
  crypto("ETH-USD", "Ethereum", 0.01, 0.0001),
  crypto("SOL-USD", "Solana", 0.001, 0.001),
  equity("ACME", "Acme Corp"),
  equity("NOVA", "Nova Industries"),
  equity("ORN", "Orion Labs"),
];

export class Universe {
  private readonly map = new Map<string, Instrument>();
  constructor(instruments: Instrument[]) {
    for (const i of instruments) this.map.set(i.symbol, i);
  }
  get(symbol: string): Instrument {
    const i = this.map.get(symbol);
    if (!i) throw new Error(`Unknown instrument: ${symbol}`);
    return i;
  }
  has(symbol: string): boolean {
    return this.map.has(symbol);
  }
  list(assetClass?: AssetClass): Instrument[] {
    const all = [...this.map.values()];
    return assetClass ? all.filter((i) => i.assetClass === assetClass) : all;
  }
}

export const universe = new Universe(INSTRUMENTS);

/** Bars-per-year for vol annualization, by calendar. */
export function barsPerYear(calendar: "24x7" | "us-equity", resolutionMinutes: number): number {
  if (calendar === "24x7") return (365 * 24 * 60) / resolutionMinutes;
  // ~252 trading days * 6.5h * 60m
  return (252 * 6.5 * 60) / resolutionMinutes;
}

const SEED_SPECS: Record<string, Partial<SyntheticSpec>> = {
  "BTC-USD": { seed: 1001, startPrice: 96000, driftAnnual: 0.35, volAnnual: 0.55 },
  "ETH-USD": { seed: 1002, startPrice: 3400, driftAnnual: 0.3, volAnnual: 0.7 },
  "SOL-USD": { seed: 1003, startPrice: 165, driftAnnual: 0.5, volAnnual: 0.95 },
  ACME: { seed: 2001, startPrice: 240, driftAnnual: 0.1, volAnnual: 0.28 },
  NOVA: { seed: 2002, startPrice: 420, driftAnnual: 0.12, volAnnual: 0.35 },
  ORN: { seed: 2003, startPrice: 130, driftAnnual: 0.18, volAnnual: 0.45 },
};

/**
 * Build the bundled seed dataset: `days` of 1-minute data per instrument,
 * starting at `start`. Crypto runs 24/7; equities honor the calendar.
 */
export function buildSeedData(start: number, days = 30): Map<string, InstrumentData> {
  const out = new Map<string, InstrumentData>();
  for (const inst of INSTRUMENTS) {
    const base = SEED_SPECS[inst.symbol]!;
    const minutes = inst.calendar === "24x7" ? days * 24 * 60 : days * 24 * 60; // generator skips closed bars
    const spec: SyntheticSpec = {
      symbol: inst.symbol,
      seed: base.seed!,
      startPrice: base.startPrice!,
      driftAnnual: base.driftAnnual!,
      volAnnual: base.volAnnual!,
      calendar: inst.calendar,
      minutes,
      start,
      baseVolume: inst.assetClass === "crypto" ? 50 : 5000,
      tickSize: inst.tickSize,
    };
    out.set(inst.symbol, buildSyntheticInstrument(spec));
  }
  return out;
}
