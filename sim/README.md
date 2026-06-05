# @orion/sim — simulation core

Pure, framework-agnostic, deterministic TypeScript engine. No UI dependencies.
Runs on Node 22+ with **zero install** (native TS type-stripping + built-in test
runner).

```
src/
  money/      decimal.ts (exact fixed-point bigint), random.ts (seeded PRNG)
  time/       calendar.ts (US-equity + crypto trading calendars)
  data/       types.ts, series.ts (no-look-ahead OHLCV), synthetic.ts, universe.ts
  indicators/ index.ts (SMA/EMA/VWAP/Bollinger/RSI/MACD/Stochastic/ATR/OBV/S-R)
  options/    bsm.ts, american.ts (BAW), volsurface.ts, chain.ts, strategies.ts
  engine/     market.ts, portfolio.ts, world.ts (clock+exec+settlement), stats.ts
  terminal/   scanner.ts (analytics + help-gated teaching)
  learn/      curriculum.ts (modules, quizzes, progress, checkpoints)
  index.ts    public API
examples/     demo.ts (end-to-end session)
test/         100 unit tests
```

## Design notes

- **No look-ahead is structural.** `BarSeries.visible(now)` / `lastClosed(now)`
  only return fully-closed bars. `atGuarded(i, now)` throws `LookaheadError` in
  dev. Toggle with `setLookaheadGuard(false)` for production speed.
- **Money is never a float.** `Dec` is a fixed-point bigint (scale 1e8). All cash,
  fills, fees and P&L flow through it. Greeks/IV use floats (inherently
  approximate) but settlement quantizes back through `Dec`.
- **Determinism.** Same dataset + start state + actions ⇒ identical results.
  Synthetic data and any slippage noise are seeded.
- **The clock is global.** One `clock.now` values the entire world. `advance*()`
  steps bar-by-bar; on every step it updates marks → triggers/fills resting
  orders → reprices & decays options → settles expiries/assignments → accrues
  borrow → expires DAY orders → samples stats. Multi-day jumps never batch-skip.
- **Options.** Crypto = European cash-settled (BSM); equities = American
  physically-settled (BAW with early-exercise premium). IV comes from a
  **pluggable** `VolSurface` — swap the modeled surface for a licensed historical
  one without touching anything downstream.

## Accounting model (documented simplifications)

- `equity = cash + Σ signed position value`. Marks are 1:1 with the price
  resolver (the chart's last close, or the option's repriced theo).
- `buyingPower = max(0, equity × marginMultiplier − grossExposure)`. Opening or
  increasing a position requires `notional ≤ buyingPower`; closing is always
  allowed (bankruptcy blocks new risk, never management — §7).
- Average cost handles adds, partial closes and flips; realized P&L is booked on
  the closed portion. Option exercise rolls premium into the resulting stock
  basis (cash moves by strike notional only) — verified equity-continuous.
- Equity settlement is immediate (T+0) and documented as a simplification; crypto
  settles immediately by nature.

## Verification

`npm test` runs 100 tests including: BSM vs. textbook values, put-call parity,
finite-difference Greek checks, IV round-trip, BAW vs. a 2000-step binomial tree,
calendar/holiday/DST handling, accounting flips and shorts, chart⇆portfolio
parity at random clock positions, determinism, option expiry/assignment equity
continuity, and the help-gating contract.
