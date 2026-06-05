# @orion/app — ORION web client

A working, single-page ORION client that renders over `@orion/sim`. It is a thin
view layer: all prices, fills, P&L, Greeks and analytics come from the engine, so
the chart and the book can never disagree and no UI path can introduce look-ahead.

![Trade](../docs/screenshots/trade.png)

## What's here

- **Trading terminal** — GPU canvas candlestick chart (pan/zoom, crosshair OHLC,
  SMA/EMA/Bollinger/VWAP overlays, volume), live price tag, account header
  (equity/cash/buying power/P&L), and an institutional order ticket
  (market/limit/stop/stop-limit/trailing) with a cost + buying-power preview.
- **Player-controlled time** — `+1H / +1D / +30D` with animated "scrubbing": the
  clock advances over `requestAnimationFrame` while candles stream in and numbers
  tick. Driven by `world.advanceTo(...)` — full bar-by-bar event processing.
- **Terminal scanner** — trend/momentum/volatility + indicator readings, with
  plain-English teaching callouts **gated behind the Help setting** (off ⇒ pure
  simulation, no teaching anywhere; the Learn tab disappears too).
- **Options** — full chain (calls/puts, bid/ask, IV, Δ, ITM/ATM highlighting),
  one-tap trading, and a strategy builder (straddle/strangle/vertical/condor)
  with a live payoff diagram, max P/L and breakevens.
- **Stats** — equity curve + win rate, profit factor, expectancy, drawdown,
  hold time, turnover, and options metrics (entry IV, theta, assignments).
- **Learn** — the 9-module options curriculum with quizzes, scoring, retries and
  checkpoint unlocks (available only when Help is on).
- **Settings** — bankroll top-up, reset, Live/Historical mode, fee realism,
  theme, risk-free rate, margin, and the required legal disclosure.
- **Onboarding** — first-run disclosure that ORION is an educational simulation,
  not a brokerage.

Sessions persist as a **deterministic action log** in `localStorage` and replay
on reload (leveraging the engine's determinism) — your portfolio survives
restarts; Reset wipes cleanly.

## Run

```bash
cd app
npm run build          # bundle engine + UI -> public/ (uses esbuild)
npm run serve          # static server on http://localhost:5173
# or live-reload dev:
npm run dev            # esbuild watch + serve

npx tsc --noEmit       # strict typecheck
node smoke.mjs         # headless Puppeteer smoke test (drives the app, screenshots)
```

`npm run build`/`dev`/`smoke` need `esbuild` and (for smoke) `puppeteer`
installed in the repo (`npm i -D esbuild puppeteer`). The engine itself needs
nothing.

## Architecture

```
src/
  store.ts        owns the World; persists as a replayable action log
  main.ts         shell, screens, order ticket, time scrubbing, routing
  ui/chart.ts     canvas candlestick + indicators + crosshair
  ui/canvas.ts    equity curve + strategy payoff renderers
  ui/format.ts    tabular money/number formatting
index.html · styles.css   premium dark-first theme (design/tokens.ts mirrored)
build.mjs · serve.mjs     esbuild bundle + static server
```
