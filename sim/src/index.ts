/**
 * @orion/sim — public API of the ORION simulation core.
 *
 * Framework-agnostic and deterministic (spec §3). A UI (React Native/Skia per
 * §3, or anything else) is a thin renderer over this engine: read `World` state,
 * call `submit`/`cancel`/`advance*`, and render `analytics`, `scan`, chains, etc.
 */

// Money & math
export { Dec, dec, decSum, SCALE } from "./money/decimal.ts";
export { Rng } from "./money/random.ts";

// Data
export * from "./data/types.ts";
export { BarSeries, InstrumentData, LookaheadError, setLookaheadGuard, lookaheadGuardEnabled } from "./data/series.ts";
export { Universe, universe, INSTRUMENTS, buildSeedData, barsPerYear } from "./data/universe.ts";
export {
  generateMinuteBars,
  aggregate,
  buildSyntheticInstrument,
  type SyntheticSpec,
} from "./data/synthetic.ts";

// Time
export { getCalendar, type TradingCalendar, type CalendarId } from "./time/calendar.ts";

// Indicators
export * as indicators from "./indicators/index.ts";

// Options
export * from "./options/bsm.ts";
export { americanPrice, americanGreeks } from "./options/american.ts";
export {
  ModeledVolSurface,
  buildModeledSurface,
  realizedVol,
  DEFAULT_SKEW,
  type VolSurface,
  type VolQuery,
  type SkewParams,
} from "./options/volsurface.ts";
export {
  buildChain,
  quoteOption,
  strikeLadder,
  standardExpiries,
  thirdFridayUTC,
  yearsToExpiry,
  type OptionChain,
  type OptionQuote,
  type OptionSpec,
  type OptionStyle,
  type ChainParams,
} from "./options/chain.ts";
export * from "./options/strategies.ts";

// Engine
export * from "./engine/types.ts";
export { Market, type MarketConfig } from "./engine/market.ts";
export { Portfolio, bookFill, type MarkResolver } from "./engine/portfolio.ts";
export { World, optionKey, type AdvanceOptions, type SubmitResult, type ClosedTrade } from "./engine/world.ts";
export { analytics, type AnalyticsReport } from "./engine/stats.ts";

// Terminal scanner
export { scan, isHelpEnabled, type TerminalScan, type TerminalCallout } from "./terminal/scanner.ts";

// Learning track
export {
  CURRICULUM,
  getCurriculum,
  LearningProgress,
  type Module,
  type Lesson,
  type Question,
  type ModuleResult,
} from "./learn/curriculum.ts";

import { universe, buildSeedData } from "./data/universe.ts";
import { World } from "./engine/world.ts";
import type { AccountSettings } from "./engine/types.ts";

/**
 * Convenience factory: a ready-to-use world on the bundled seed dataset.
 * The UI typically calls this on first launch, then persists/restores `World`.
 */
export function createDemoWorld(opts: { start?: number; days?: number; settings?: Partial<AccountSettings>; seed?: number } = {}): World {
  const start = opts.start ?? Date.UTC(2024, 0, 1);
  const days = opts.days ?? 30;
  const data = buildSeedData(start, days);
  // Begin a few hours in so there is visible history to analyze from bar one.
  const startNow = start + 12 * 3600_000;
  return new World({ universe, data, startNow, settings: opts.settings, seed: opts.seed });
}
