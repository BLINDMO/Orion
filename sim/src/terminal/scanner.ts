/**
 * The Terminal indicator scanner. Spec §9.
 *
 * Reads the current setup (only data ≤ clock.now) and returns indicator states
 * plus a plain-English, educational interpretation tied to the learning track.
 *
 * HELP GATING (user requirement): the *teaching* layer — callouts that explain
 * what a reading implies and link to a lesson — is produced ONLY when
 * `settings.helpEnabled` is true. With help disabled there is no instruction
 * anywhere: the scan returns bare analytical state (the numbers a real terminal
 * shows) and `callouts` is empty, so the app behaves as a pure simulation.
 */

import type { Resolution } from "../data/types.ts";
import type { World } from "../engine/world.ts";
import {
  sma,
  ema,
  rsi,
  macd,
  bollinger,
  atr,
  stochastic,
  vwap,
  obv,
  supportResistance,
  lastDefined,
  closes,
} from "../indicators/index.ts";

export type TrendState = "up" | "down" | "sideways";
export type MomentumState = "overbought" | "oversold" | "bullish" | "bearish" | "neutral";
export type VolState = "expanding" | "contracting" | "normal";

export interface IndicatorReading {
  indicator: string;
  value: number | undefined;
  /** Short machine-readable classification (always present). */
  state: string;
}

export interface TerminalCallout {
  title: string;
  /** Plain-English educational explanation (help only). */
  detail: string;
  /** Lesson in the learning track this ties to (help only). */
  lessonId: string;
  severity: "info" | "watch" | "alert";
}

export interface TerminalScan {
  symbol: string;
  timeframe: Resolution;
  asOf: number;
  price: number | undefined;
  trend: TrendState;
  momentum: MomentumState;
  volatility: VolState;
  readings: IndicatorReading[];
  levels: { price: number; kind: "support" | "resistance"; strength: number }[];
  /** Populated only when help is enabled. Empty otherwise. */
  callouts: TerminalCallout[];
  helpEnabled: boolean;
}

export function isHelpEnabled(world: World): boolean {
  return world.settings.helpEnabled;
}

export function scan(world: World, symbol: string, timeframe: Resolution = "1h"): TerminalScan {
  const id = world.data.get(symbol);
  if (!id) throw new Error(`No data for ${symbol}`);
  const res: Resolution = id.has(timeframe) ? timeframe : id.has("1h") ? "1h" : "1d";
  const bars = id.get(res).visible(world.now);
  const help = world.settings.helpEnabled;
  const price = bars.length ? bars[bars.length - 1]!.c : undefined;

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

  // --- Analytical state (always) ---
  let trend: TrendState = "sideways";
  if (price !== undefined && ema20 !== undefined) {
    if (sma50 !== undefined && sma200 !== undefined) {
      trend = sma50 > sma200 && price > sma50 ? "up" : sma50 < sma200 && price < sma50 ? "down" : "sideways";
    } else {
      trend = price > ema20 * 1.002 ? "up" : price < ema20 * 0.998 ? "down" : "sideways";
    }
  }

  let momentum: MomentumState = "neutral";
  if (rsiVal !== undefined) {
    if (rsiVal >= 70) momentum = "overbought";
    else if (rsiVal <= 30) momentum = "oversold";
    else if (histVal !== undefined) momentum = histVal > 0 ? "bullish" : histVal < 0 ? "bearish" : "neutral";
  }

  let volatility: VolState = "normal";
  if (bbWidth !== undefined) {
    if (bbWidth > 0.12) volatility = "expanding";
    else if (bbWidth < 0.04) volatility = "contracting";
  }

  const readings: IndicatorReading[] = [
    { indicator: "RSI(14)", value: rsiVal, state: momentum },
    {
      indicator: "MACD",
      value: macdVal,
      state: macdVal !== undefined && signalVal !== undefined ? (macdVal > signalVal ? "above-signal" : "below-signal") : "n/a",
    },
    { indicator: "SMA(50)", value: sma50, state: price !== undefined && sma50 !== undefined ? (price > sma50 ? "above" : "below") : "n/a" },
    { indicator: "SMA(200)", value: sma200, state: price !== undefined && sma200 !== undefined ? (price > sma200 ? "above" : "below") : "n/a" },
    { indicator: "EMA(20)", value: ema20, state: price !== undefined && ema20 !== undefined ? (price > ema20 ? "above" : "below") : "n/a" },
    { indicator: "Bollinger %width", value: bbWidth, state: volatility },
    { indicator: "ATR(14)", value: atrVal, state: "volatility" },
    { indicator: "Stoch %K", value: stochK, state: stochK !== undefined ? (stochK >= 80 ? "overbought" : stochK <= 20 ? "oversold" : "mid") : "n/a" },
    { indicator: "VWAP", value: vwapVal, state: price !== undefined && vwapVal !== undefined ? (price > vwapVal ? "above" : "below") : "n/a" },
    { indicator: "OBV", value: obvVal, state: "flow" },
  ];

  // --- Teaching layer (help only) ---
  const callouts: TerminalCallout[] = [];
  if (help) {
    if (rsiVal !== undefined && rsiVal >= 70) {
      callouts.push({
        title: `RSI ${rsiVal.toFixed(0)} — overbought`,
        detail:
          "RSI above 70 means recent gains have been large relative to losses. It often precedes a pause or mean-reversion — but a strong trend can stay overbought for a while. It is a condition, not a sell signal.",
        lessonId: "momentum-rsi",
        severity: "watch",
      });
    }
    if (rsiVal !== undefined && rsiVal <= 30) {
      callouts.push({
        title: `RSI ${rsiVal.toFixed(0)} — oversold`,
        detail:
          "RSI below 30 reflects heavy recent selling. Markets can bounce from here, but oversold can persist in a downtrend. Look for confirmation rather than catching a falling knife.",
        lessonId: "momentum-rsi",
        severity: "watch",
      });
    }
    if (price !== undefined && bbUpper !== undefined && price > bbUpper) {
      callouts.push({
        title: "Price above the upper Bollinger band",
        detail:
          "Price is stretched more than two standard deviations above its 20-period mean. This signals an extended move and elevated odds of reversion or consolidation — not a guarantee of a top.",
        lessonId: "volatility-bands",
        severity: "watch",
      });
    }
    if (price !== undefined && bbLower !== undefined && price < bbLower) {
      callouts.push({
        title: "Price below the lower Bollinger band",
        detail:
          "Price is stretched below its lower band — an extended down-move. Reversion is more likely, but in a strong downtrend bands can keep being pierced.",
        lessonId: "volatility-bands",
        severity: "watch",
      });
    }
    if (macdVal !== undefined && signalVal !== undefined && histVal !== undefined) {
      const cross = histVal > 0 ? "bullish" : "bearish";
      callouts.push({
        title: `MACD ${cross} (histogram ${histVal >= 0 ? "+" : ""}${histVal.toFixed(3)})`,
        detail:
          cross === "bullish"
            ? "The MACD line is above its signal line, indicating upward momentum is building. Watch for the histogram shrinking, which warns momentum is fading."
            : "The MACD line is below its signal line, indicating downward momentum. A rising histogram toward zero hints momentum may be turning.",
        lessonId: "momentum-macd",
        severity: "info",
      });
    }
    if (sma50 !== undefined && sma200 !== undefined) {
      const golden = sma50 > sma200;
      callouts.push({
        title: golden ? "50 above 200 — bullish regime" : "50 below 200 — bearish regime",
        detail: golden
          ? "The 50-period average sits above the 200-period (a 'golden cross' regime), a classic longer-term uptrend backdrop."
          : "The 50-period average sits below the 200-period (a 'death cross' regime), a longer-term downtrend backdrop.",
        lessonId: "trend-moving-averages",
        severity: "info",
      });
    }
    if (volatility === "contracting") {
      callouts.push({
        title: "Volatility squeeze",
        detail:
          "Bollinger bands have narrowed sharply. Low volatility tends to be followed by expansion — a 'squeeze' often precedes a larger directional move, though it does not tell you the direction.",
        lessonId: "volatility-bands",
        severity: "watch",
      });
    }
    if (vwapVal !== undefined && price !== undefined) {
      callouts.push({
        title: price > vwapVal ? "Trading above VWAP" : "Trading below VWAP",
        detail:
          "VWAP is the volume-weighted average price for the session. Trading above it means buyers have the edge intraday; below it favors sellers. Institutions often use it as a benchmark.",
        lessonId: "vwap",
        severity: "info",
      });
    }
    if (levels.length > 0) {
      const nearest = levels
        .map((l) => ({ ...l, dist: price !== undefined ? Math.abs(l.price - price) : Infinity }))
        .sort((a, b) => a.dist - b.dist)[0]!;
      callouts.push({
        title: `Nearby ${nearest.kind} ≈ ${nearest.price}`,
        detail:
          `A clustered ${nearest.kind} level sits close to price (strength ${nearest.strength}). Such levels often act as decision points — watch how price reacts there.`,
        lessonId: "support-resistance",
        severity: "info",
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
    helpEnabled: help,
  };
}
