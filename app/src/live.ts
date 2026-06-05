// Live crypto market data via Coinbase Exchange's free, key-less public REST API,
// with Kraken as a fallback. Both are CORS-enabled so they work straight from the
// browser at no cost. Rows are mapped onto the engine's Bar shape.
import type { Bar, Resolution } from "../../sim/src/index.ts";

export const LIVE_SYMBOLS = ["BTC-USD", "ETH-USD", "SOL-USD"] as const;

const CB_GRAN: Record<Resolution, number> = { "1m": 60, "1h": 3600, "1d": 86400 };
const KR_INTERVAL: Record<Resolution, number> = { "1m": 1, "1h": 60, "1d": 1440 };
const KRAKEN_PAIR: Record<string, string> = { "BTC-USD": "XBTUSD", "ETH-USD": "ETHUSD", "SOL-USD": "SOLUSD" };

async function fromCoinbase(symbol: string, res: Resolution): Promise<Bar[]> {
  const url = `https://api.exchange.coinbase.com/products/${symbol}/candles?granularity=${CB_GRAN[res]}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`CB ${r.status}`);
  // [ time(sec), low, high, open, close, volume ], newest first
  const rows: number[][] = await r.json();
  const out = rows.map(([t, l, h, o, c, v]) => ({ t: t! * 1000, o: o!, h: h!, l: l!, c: c!, v: Math.max(0, v!) }));
  out.sort((a, b) => a.t - b.t);
  if (!out.length) throw new Error("empty CB");
  return out;
}

async function fromKraken(symbol: string, res: Resolution): Promise<Bar[]> {
  const pair = KRAKEN_PAIR[symbol] ?? symbol;
  const r = await fetch(`https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${KR_INTERVAL[res]}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`KR ${r.status}`);
  const json = await r.json();
  if (json.error?.length) throw new Error(json.error[0]);
  const key = Object.keys(json.result).find((k) => k !== "last")!;
  // [ time, open, high, low, close, vwap, volume, count ]
  const rows: (string | number)[][] = json.result[key];
  const out = rows.map((x) => ({ t: Number(x[0]) * 1000, o: +x[1]!, h: +x[2]!, l: +x[3]!, c: +x[4]!, v: Math.max(0, +x[6]!) }));
  out.sort((a, b) => a.t - b.t);
  if (!out.length) throw new Error("empty KR");
  return out;
}

/** Fetch recent OHLCV bars for a crypto symbol. Tries Coinbase, then Kraken. */
export async function fetchCandles(symbol: string, res: Resolution): Promise<Bar[]> {
  try {
    return await fromCoinbase(symbol, res);
  } catch {
    return fromKraken(symbol, res);
  }
}
