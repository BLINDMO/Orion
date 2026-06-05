// Live crypto market data via Coinbase's free, key-less public REST API.
// Free, no account, no spend. The exchange "candles" endpoint returns OHLCV
// rows that we map straight onto the engine's Bar shape so the chart and the
// portfolio stay consistent with the same real prices.
//
// Endpoint:  https://api.exchange.coinbase.com/products/{id}/candles?granularity={sec}
// Row shape: [ time(sec), low, high, open, close, volume ]  (newest first)
import type { Bar, Resolution } from "../../sim/src/index.ts";

/** Crypto products we can stream live (Coinbase product ids match our symbols). */
export const LIVE_SYMBOLS = ["BTC-USD", "ETH-USD", "SOL-USD"] as const;

export function isLiveSymbol(symbol: string): boolean {
  return (LIVE_SYMBOLS as readonly string[]).includes(symbol);
}

const CB_GRAN: Record<Resolution, number> = { "1m": 60, "1h": 3600, "1d": 86400 };
const KR_INTERVAL: Record<Resolution, number> = { "1m": 1, "1h": 60, "1d": 1440 };
const KRAKEN_PAIR: Record<string, string> = { "BTC-USD": "XBTUSD", "ETH-USD": "ETHUSD", "SOL-USD": "SOLUSD" };

/** Injectable for tests; defaults to the browser's fetch. */
export type Fetcher = (url: string) => Promise<unknown>;
const defaultFetcher: Fetcher = async (url) => {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

// Coinbase Exchange: [ time(sec), low, high, open, close, volume ], newest first.
function mapCoinbase(rows: unknown): Bar[] {
  if (!Array.isArray(rows)) throw new Error("Unexpected Coinbase payload");
  const out: Bar[] = [];
  for (const r of rows as number[][]) {
    if (!Array.isArray(r) || r.length < 6) continue;
    const [time, low, high, open, close, volume] = r;
    out.push({ t: time! * 1000, o: open!, h: high!, l: low!, c: close!, v: Math.max(0, volume!) });
  }
  out.sort((a, b) => a.t - b.t);
  if (!out.length) throw new Error("Empty Coinbase payload");
  return out;
}

// Kraken: result.{PAIR} = [ time(sec), open, high, low, close, vwap, volume, count ].
function mapKraken(json: unknown): Bar[] {
  const result = (json as { result?: Record<string, unknown> })?.result;
  if (!result) throw new Error("Unexpected Kraken payload");
  const key = Object.keys(result).find((k) => k !== "last");
  const rows = key ? (result[key] as (string | number)[][]) : undefined;
  if (!Array.isArray(rows)) throw new Error("Empty Kraken payload");
  const out: Bar[] = rows.map((r) => ({
    t: Number(r[0]) * 1000, o: +r[1]!, h: +r[2]!, l: +r[3]!, c: +r[4]!, v: Math.max(0, +r[6]!),
  }));
  out.sort((a, b) => a.t - b.t);
  if (!out.length) throw new Error("Empty Kraken payload");
  return out;
}

/**
 * Fetch ~recent candles for one product at one resolution. Tries Coinbase first,
 * then falls back to Kraken — both are free, key-less, and CORS-enabled so they
 * work straight from the browser at no cost.
 */
export async function fetchCandles(
  symbol: string,
  res: Resolution,
  fetcher: Fetcher = defaultFetcher,
): Promise<Bar[]> {
  try {
    const url = `https://api.exchange.coinbase.com/products/${symbol}/candles?granularity=${CB_GRAN[res]}`;
    return mapCoinbase(await fetcher(url));
  } catch (cbErr) {
    const pair = KRAKEN_PAIR[symbol];
    if (!pair) throw cbErr;
    const url = `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${KR_INTERVAL[res]}`;
    return mapKraken(await fetcher(url));
  }
}

export interface LiveSnapshot {
  bars: Partial<Record<Resolution, Bar[]>>;
}

/** Fetch the resolutions we chart for a single symbol. */
export async function fetchSymbol(symbol: string, fetcher: Fetcher = defaultFetcher): Promise<LiveSnapshot> {
  const [h1, d1] = await Promise.all([
    fetchCandles(symbol, "1h", fetcher),
    fetchCandles(symbol, "1d", fetcher),
  ]);
  return { bars: { "1h": h1, "1d": d1 } };
}
