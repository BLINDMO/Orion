# ORION architecture

## Layering

```
┌────────────────────────────────────────────────────────────┐
│  Client (React Native New Arch · Reanimated 3 · Skia)        │  ← thin renderer
│  charts · order ticket · chain · strategy builder · stats    │
│  Settings → Learn · Terminal · time-advance scrubbing        │
├────────────────────────────────────────────────────────────┤
│  @orion/sim  (this repo's `sim/`)                            │  ← all logic
│  World · Market · Portfolio · Options · Indicators · Stats   │
│  Terminal scanner · Learning track · global clock            │
├────────────────────────────────────────────────────────────┤
│  Data: bundled seed packs + downloadable OHLCV + live feeds  │
└────────────────────────────────────────────────────────────┘
```

The client never computes prices, P&L, fills or Greeks itself. It reads `World`
state and calls `submit` / `cancel` / `advanceHour|Day|Month` / `setMode` /
`updateSettings`, then renders `analytics(world)`, `scan(world, symbol)`,
`buildChain(...)`, and `analyzeStrategy(...)`. This guarantees the chart and the
book can never disagree (§13.3) and that no UI path can introduce look-ahead.

## The advance loop (spec §5)

`World.advanceTo(target)` walks the global clock bar-by-bar at a stepping
resolution (1m for +1h/+1d, 1h for +30d so a month resolves quickly while still
processing every intervening bar). Each step, in order:

1. **marks** — `clock.now` moves; all marks recompute from the newly-closed bar.
2. **resting orders** — limit/stop/stop-limit/trailing checked against the bar's
   OHLC; market orders fill at the next bar; spread + size-slippage + partial
   fills applied; buying-power gated at fill time.
3. **option decay** — open options reprice from the new underlying, shorter
   time-to-expiry and current IV; realized theta accrued for stats.
4. **expiry/assignment** — ITM auto-settles (cash for crypto, share delivery for
   equity), OTM expires worthless, short assignments handled.
5. **borrow** — short positions accrue borrow cost pro-rata.
6. **DAY orders** — expire once their session closes.
7. **stats** — equity-curve sampled (≤ daily to bound memory).

`advance({ onTick })` emits a snapshot per step so the client can animate the
time-lapse "scrub" (candles streaming in, numbers ticking) instead of a hard cut.

## Live mode (spec §5)

`setMode("live")` switches the clock to real time; crypto market orders fill
immediately against the current quote (`fillLiveMarket`). The same `Market`
interface backs both modes; wiring a Coinbase/Binance/Kraken WebSocket means
feeding live bars/quotes into the existing `InstrumentData` — no engine changes.
Equities have no free real-time tier, so in Live mode they honor closed-market
state and use the most recent (delayed) bars — modeled honestly, not faked.

## Pluggable IV surface (spec §8)

`VolSurface` is an interface. `ModeledVolSurface` seeds base vol from realized
volatility and shapes it with per-expiry term structure and per-strike skew
(equity put-skew vs. crypto smile). A licensed historical surface (ORATS / CBOE /
IVolatility) implements the same `iv(query)` and drops in unchanged.

## Persistence (spec §3, §11)

All of `World` (clock, cash, positions, orders, fills, settings, equity curve)
plus `LearningProgress` is plain serializable data → MMKV/SQLite on device.
`world.reset()` returns to a clean start state; `deposit()` tops up the bankroll.

## Correctness constraints (spec §13) — where each lives

| Constraint | Enforcement |
|---|---|
| No look-ahead | `data/series.ts` `LookaheadError`; next-bar fills in `world.ts` |
| Determinism | `money/random.ts` seeded; no `Date.now()` in the core |
| Chart ⇆ portfolio parity | `markResolver()` uses the same close the chart prints; `test/world.test.ts` |
| Full event processing | `world.ts` `processStep` runs every step, never batched |
| Exact money math | `money/decimal.ts` `Dec` everywhere for cash/P&L |
| Offline-correct | seed data in `data/universe.ts`; no network in the core |
| Engine unit-tested | 100 tests in `sim/test/` |
```
