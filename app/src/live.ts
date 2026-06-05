// Fetch real-time OHLCV from Coinbase Exchange (free, no API key) with
// Kraken as fallback. Both endpoints are CORS-accessible from the browser.
import type { Bar, Resolution } from "../../sim/src/index.ts";

const CB = "https://api.exchange.coinbase.com";
const KR = "https://api.kraken.com";

const KRAKEN_PAIR: Record<string, string> = {
  "BTC-USD": "XBTUSD",
  "ETH-USD": "ETHUSD",
  "SOL-USD": "SOLUSD",
};

function resToSec(res: Resolution): number {
  return res === "1m" ? 60 : res === "1h" ? 3600 : 86400;
}

async function fromCoinbase(symbol: string, res: Resolution, count: number): Promise<Bar[]> {
  const gran = resToSec(res);
  const end = Math.floor(Date.now() / 1000);
  const start = end - gran * count;
  const url = `${CB}/products/${symbol}/candles?granularity=${gran}&start=${start}&end=${end}`;
  const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`CB ${r.status}`);
  // [[time, low, high, open, close, volume], ...] newest first
  const data: [number, number, number, number, number, number][] = await r.json();
  return data.reverse().map(([t, l, h, o, c, v]) => ({ t: t * 1000, o, h, l, c, v }));
}

async function fromKraken(symbol: string, res: Resolution, count: number): Promise<Bar[]> {
  const interval = res === "1m" ? 1 : res === "1h" ? 60 : 1440;
  const pair = KRAKEN_PAIR[symbol] ?? symbol;
  const r = await fetch(`${KR}/0/public/OHLC?pair=${pair}&interval=${interval}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`KR ${r.status}`);
  const json = await r.json();
  if (json.error?.length) throw new Error(json.error[0]);
  const key = Object.keys(json.result).find((k) => k !== "last")!;
  // [time, open, high, low, close, vwap, volume, count]
  const data: [number, string, string, string, string, string, string, number][] = json.result[key];
  return data.slice(-count).map(([t, o, h, l, c, , v]) => ({
    t: t * 1000, o: +o, h: +h, l: +l, c: +c, v: +v,
  }));
}

/** Fetch OHLCV bars for a crypto symbol. Tries Coinbase then Kraken. */
export async function fetchCandles(symbol: string, res: Resolution, count = 300): Promise<Bar[]> {
  try {
    return await fromCoinbase(symbol, res, count);
  } catch {
    return fromKraken(symbol, res, count);
  }
}

/** Symbols that have live data available. */
export const LIVE_SYMBOLS = ["BTC-USD", "ETH-USD", "SOL-USD"] as const;
