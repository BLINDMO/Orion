// ORION web client — thin renderer over @orion/sim.
import {
  analytics,
  scan,
  buildChain,
  standardExpiries,
  CURRICULUM,
  type InstrumentData,
  type OptionQuote,
  type OptionSpec,
  type Resolution,
  type Side,
  type OrderType,
} from "../../sim/src/index.ts";
import {
  analyzeStrategy,
  straddle,
  strangle,
  verticalSpread,
  ironCondor,
} from "../../sim/src/options/strategies.ts";
import { Store } from "./store.ts";
import { Chart } from "./ui/chart.ts";
import { drawEquityCurve, drawPayoff } from "./ui/canvas.ts";
import * as F from "./ui/format.ts";

const store = new Store();
const app = document.getElementById("app")!;
let chart: Chart;

type Screen = "trade" | "book" | "options" | "stats" | "settings";

interface OptionTicket { spec: OptionSpec; bid: number; ask: number; mid: number; }

const state = {
  screen: "trade" as Screen,
  tf: "1h" as Resolution,
  form: {
    side: "buy" as Side,
    type: "market" as OrderType,
    qty: "",
    limit: "",
    stop: "",
    trail: "",
    option: null as OptionTicket | null,
  },
  optExpiryIdx: 0,
  learnModule: null as string | null,
  scrubbing: false,
};

let ind = { sma: true, ema: true, bb: true, vwap: false };

const W = () => store.world;
const sym = () => store.ui.symbol;
const inst = () => W().universe.get(sym());

// Cap the bars handed to the chart so the long (540-day) dataset stays smooth.
const CHART_MAX_BARS = 1500;

// Pick the resolution to actually draw. Fine-grained 1m only covers a near-term
// window; once the clock advances past it, fall back to 1h so the chart keeps
// moving instead of freezing on stale minute bars.
function effectiveRes(id: InstrumentData): Resolution {
  const want: Resolution = id.has(state.tf) ? state.tf : "1h";
  if (want === "1m") {
    const last = id.get("1m").lastClosed(W().now);
    if (!last || W().now - last.t > 3 * 3600_000) return "1h";
  }
  return want;
}

function visibleBars(s = sym()) {
  const id = W().data.get(s);
  if (!id) return [];
  const all = id.get(effectiveRes(id)).visible(W().now);
  return all.length > CHART_MAX_BARS ? all.slice(all.length - CHART_MAX_BARS) : all.slice();
}

function lastAndChange(s: string): { last: number | null; chg: number } {
  // Display the live MARK (freshest close across resolutions) — the same value
  // positions are marked at — so the quoted price and P&L never disagree.
  const markDec = W().market.spotMark(s, W().now);
  const bars = visibleBars(s);
  const fallback = bars.length ? bars[bars.length - 1]!.c : null;
  const last = markDec ? markDec.toNumber() : fallback;
  if (last === null || !bars.length) return { last, chg: 0 };
  const prev = bars.length > 1 ? bars[bars.length - 2]!.c : bars[bars.length - 1]!.o;
  return { last, chg: prev ? (last - prev) / prev : 0 };
}

// ─── Boot ────────────────────────────────────────────────────────────────────
function boot() {
  document.documentElement.setAttribute("data-theme", store.ui.theme);
  if (!store.ui.onboarded) { renderSplash(); return; }
  renderShell();
  maybeAutoLive();
}

// Live is opt-in: only auto-connect if the user previously enabled it.
function maybeAutoLive() {
  if (store.ui.livePref !== true) return;
  void store.enableLive().then(() => {
    if (store.live) {
      store.onLiveTick = onLiveTick;
      refresh();
      toast("Live prices active", "gain");
    }
  }).catch(() => {});
}

function onLiveTick() {
  chart?.setData(visibleBars());
  updateHeader();
  renderTicker();
}

function renderSplash() {
  app.innerHTML = `
    <div class="splash">
      <div class="splash-inner">
        ${brandLogoLarge()}
        <h1>ORION</h1>
        <div class="splash-sub">Real charts. Your clock. An unknown future.</div>
        <button class="cta" id="begin">Enter ORION</button>
        <div class="legal-mini">Uses historical and/or delayed market data for practice trading.<br>Not a brokerage. Not financial advice.</div>
      </div>
    </div>`;
  document.getElementById("begin")!.onclick = () => {
    store.ui.onboarded = true;
    store.saveUi();
    renderShell();
    maybeAutoLive();
  };
}

// ─── Shell ───────────────────────────────────────────────────────────────────
function renderShell() {
  app.innerHTML = `
    <header class="topbar">
      <div class="tb-brand">${brandMark()}</div>
      <div class="tb-acct" id="tbAcct"></div>
      <button class="profile-btn" id="profileBtn" aria-label="Profile">
        <span class="profile-avatar" id="profileAvatar">${initial()}</span>
      </button>
    </header>

    <div class="ticker" id="ticker"></div>

    <div class="workspace">
      <nav class="sidebar" id="sidebar"></nav>
      <main class="content" id="content">
        ${tradeViewHTML()}
        <div class="screen-overlay" id="overlay"></div>
      </main>
    </div>

    <nav class="bottom-nav" id="bottomNav"></nav>

    <div class="sheet-backdrop" id="sheetBackdrop"></div>
    <section class="sheet ticket-sheet" id="ticketSheet" aria-hidden="true">
      <div class="sheet-grip"></div>
      <div class="sheet-head">
        <span class="sheet-title" id="ticketTitle">Order</span>
        <button class="icon-btn" id="ticketClose">✕</button>
      </div>
      <div class="sheet-body" id="ticketBody"></div>
    </section>

    <section class="sheet scan-sheet" id="scanSheet" aria-hidden="true">
      <div class="sheet-grip"></div>
      <div class="sheet-head">
        <span class="sheet-title">◈ Terminal Scan</span>
        <button class="icon-btn" id="scanClose">✕</button>
      </div>
      <div class="sheet-body" id="scanBody"></div>
    </section>

    <section class="sheet profile-sheet" id="profileSheet" aria-hidden="true">
      <div class="sheet-grip"></div>
      <div class="sheet-head">
        <span class="sheet-title">Profiles</span>
        <button class="icon-btn" id="profileClose">✕</button>
      </div>
      <div class="sheet-body" id="profileBody"></div>
    </section>

    <div class="toast" id="toast"></div>`;

  chart = new Chart(document.getElementById("chart") as HTMLCanvasElement);
  chart.setData(visibleBars(), { resetView: true });
  applyIndicators();

  renderNav();
  renderTicker();
  renderChartToolbar();
  wireTime();

  document.getElementById("qbBuy")!.onclick = () => openSpotTicket("buy");
  document.getElementById("qbSell")!.onclick = () => openSpotTicket("sell");
  document.getElementById("ticketClose")!.onclick = closeSheets;
  document.getElementById("scanClose")!.onclick = closeSheets;
  document.getElementById("profileClose")!.onclick = closeSheets;
  document.getElementById("profileBtn")!.onclick = openProfile;
  document.getElementById("sheetBackdrop")!.onclick = closeSheets;

  store.onLiveTick = onLiveTick;

  if (state.screen !== "trade") mountScreen(state.screen);
  refresh();
}

function tradeViewHTML(): string {
  return `<div class="trade-view">
    <div class="chart-toolbar" id="chartToolbar"></div>
    <div class="quickbar">
      <div class="qb-funds">
        <span class="qb-k">Cash</span>
        <span class="qb-v num" id="qbBp">—</span>
      </div>
      <div class="qb-funds qb-eq">
        <span class="qb-k">Equity</span>
        <span class="qb-v num" id="qbEq">—</span>
      </div>
      <div class="qb-actions">
        <button class="qb-btn buy" id="qbBuy">Buy</button>
        <button class="qb-btn sell" id="qbSell">Sell</button>
      </div>
    </div>
    <div class="chart-wrap"><canvas id="chart"></canvas></div>
    <div class="timebar">
      <span class="time-label" id="timeLabel"></span>
      <span class="mode-pill" id="modePill"></span>
      <span class="warp-rate hidden" id="warpRate">6h/s</span>
      <button class="warp-btn" id="warpBtn" title="Time warp — 6 simulated hours/sec. Tap again to stop.">+</button>
    </div>
  </div>`;
}

function initial() { return (store.getProfileName()[0] ?? "P").toUpperCase(); }

// ─── Navigation ──────────────────────────────────────────────────────────────
function navItems(): [Screen, string, () => string][] {
  return [
    ["trade", "Chart", iChart],
    ["book", "Book", iBook],
    ["options", "Options", iOptions],
    ["stats", "Stats", iStats],
    ["settings", "Settings", iSettings],
  ];
}

function renderNav() {
  const items = navItems();
  const side = document.getElementById("sidebar");
  if (side) {
    side.innerHTML = items.map(([s, tip, icon]) => `
      <button class="nav-btn ${state.screen === s ? "active" : ""}" data-nav="${s}" aria-label="${tip}">
        ${icon()}<span class="nav-tip">${tip}</span>
      </button>`).join("") + `<div class="sidebar-spacer"></div>`;
    side.querySelectorAll<HTMLElement>("[data-nav]").forEach((b) => b.onclick = () => navigate(b.dataset.nav as Screen));
  }
  const bn = document.getElementById("bottomNav");
  if (bn) {
    bn.innerHTML = items.map(([s, tip, icon]) => `
      <button class="bn-btn ${state.screen === s ? "active" : ""}" data-nav="${s}">
        <span class="bn-icon">${icon()}</span>
        <span class="bn-label">${tip}</span>
      </button>`).join("");
    bn.querySelectorAll<HTMLElement>("[data-nav]").forEach((b) => b.onclick = () => navigate(b.dataset.nav as Screen));
  }
}

function navigate(s: Screen) {
  stopWarp();
  closeSheets();
  state.screen = s;
  if (s === "trade") {
    document.getElementById("overlay")!.innerHTML = "";
    chart?.setData(visibleBars());
  } else {
    mountScreen(s);
  }
  renderNav();
  refresh();
}

function mountScreen(s: Screen) {
  if (s === "book") renderBookScreen();
  else if (s === "options") renderOptionsScreen();
  else if (s === "stats") renderStatsScreen();
  else if (s === "settings") renderSettingsScreen();
}

function closeScreen() { navigate("trade"); }

function screenShell(title: string, body: string): string {
  return `<div class="screen">
    <div class="shead">
      <button class="back" id="backBtn" aria-label="Back">‹</button>
      <h2>${title}</h2>
    </div>
    <div class="sbody">${body}</div>
  </div>`;
}

function overlayEl() { return document.getElementById("overlay")!; }

// ─── Ticker Strip (symbol switcher + prices) ─────────────────────────────────
function renderTicker() {
  const wrap = document.getElementById("ticker");
  if (!wrap) return;
  wrap.innerHTML = W().universe.list().map((i) => {
    const { last, chg } = lastAndChange(i.symbol);
    const isSel = i.symbol === sym();
    return `<button class="ticker-item ${isSel ? "active" : ""}" data-sym="${i.symbol}">
      <span class="ti-sym">${i.symbol.replace("-USD", "")}</span>
      <span class="ti-px num">${last !== null ? F.priceFmt(last) : "—"}</span>
      <span class="ti-chg num ${F.pnlClass(chg)}">${F.pct(chg, 1)}</span>
    </button>`;
  }).join("");
  wrap.querySelectorAll<HTMLElement>("[data-sym]").forEach((b) => b.onclick = () => {
    store.ui.symbol = b.dataset.sym!;
    store.saveUi();
    renderTicker();
    renderChartToolbar();
    chart.setData(visibleBars(), { resetView: true });
    if (state.screen === "options") renderOptionsScreen();
    refresh();
  });
}

// ─── Chart Toolbar ───────────────────────────────────────────────────────────
function renderChartToolbar() {
  const toolbar = document.getElementById("chartToolbar");
  if (!toolbar) return;
  const tfs: Resolution[] = ["1m", "1h", "1d"];
  const inds: [keyof typeof ind, string][] = [["bb", "BB"], ["sma", "SMA"], ["ema", "EMA"], ["vwap", "VWAP"]];
  toolbar.innerHTML = `
    <div class="toolbar-group">
      ${tfs.map((t) => `<button class="toolbar-btn ${state.tf === t ? "active" : ""}" data-tf="${t}">${t.toUpperCase()}</button>`).join("")}
    </div>
    <div class="toolbar-sep"></div>
    <div class="toolbar-group">
      ${inds.map(([k, l]) => `<button class="toolbar-btn ${ind[k] ? "active" : ""}" data-ind="${k}">${l}</button>`).join("")}
    </div>
    <button class="terminal-btn" id="termBtn">◈ SCAN</button>`;
  toolbar.querySelectorAll<HTMLElement>("[data-tf]").forEach((b) => b.onclick = () => {
    state.tf = b.dataset.tf as Resolution;
    renderChartToolbar();
    chart.setData(visibleBars(), { resetView: true });
    refresh();
  });
  toolbar.querySelectorAll<HTMLElement>("[data-ind]").forEach((b) => b.onclick = () => {
    const k = b.dataset.ind as keyof typeof ind;
    ind[k] = !ind[k];
    renderChartToolbar();
    applyIndicators();
  });
  document.getElementById("termBtn")!.onclick = openScan;
}

function applyIndicators() {
  if (!chart) return;
  chart.setConfig({ sma: ind.sma ? [50] : [], ema: ind.ema ? [20] : [], bollinger: ind.bb, vwap: ind.vwap });
}

// ─── Sheet machinery ─────────────────────────────────────────────────────────
function openSheet(id: string) {
  document.querySelectorAll<HTMLElement>(".sheet").forEach((s) => { s.classList.remove("open"); s.setAttribute("aria-hidden", "true"); });
  const sheet = document.getElementById(id)!;
  sheet.classList.add("open");
  sheet.setAttribute("aria-hidden", "false");
  document.getElementById("sheetBackdrop")!.classList.add("show");
}

function closeSheets() {
  document.querySelectorAll<HTMLElement>(".sheet").forEach((s) => { s.classList.remove("open"); s.setAttribute("aria-hidden", "true"); });
  document.getElementById("sheetBackdrop")!.classList.remove("show");
}

// ─── Scan Sheet ──────────────────────────────────────────────────────────────
function openScan() {
  renderScanBody();
  openSheet("scanSheet");
}

function renderScanBody() {
  const body = document.getElementById("scanBody");
  if (!body) return;
  const s = scan(W(), sym(), state.tf);
  const help = W().settings.helpEnabled;
  body.innerHTML = `
    <div class="scan-meta">${sym()} · ${s.timeframe}</div>
    <div class="badges">
      <span class="badge ${s.trend === "up" ? "up" : s.trend === "down" ? "down" : ""}">Trend ${s.trend}</span>
      <span class="badge">Momentum ${s.momentum}</span>
      <span class="badge">Vol ${s.volatility}</span>
    </div>
    ${s.readings.filter((r) => r.value !== undefined).slice(0, 8).map((r) => `
      <div class="reading">
        <span class="muted">${r.indicator}</span>
        <span class="num">${typeof r.value === "number" ? (Math.abs(r.value) > 100 ? F.compact(r.value) : r.value.toFixed(2)) : "—"} <span class="dim">${r.state}</span></span>
      </div>`).join("")}
    ${help ? s.callouts.slice(0, 4).map((c) => `
      <div class="callout ${c.severity}">
        <div class="t">${c.title}</div>
        <div class="d">${c.detail}</div>
      </div>`).join("") : ""}`;
}

// ─── Order Ticket (spot + options) ───────────────────────────────────────────
function openSpotTicket(side: Side) {
  if (state.screen !== "trade") navigate("trade");
  state.form.option = null;
  state.form.side = side;
  state.form.type = "market";
  state.form.qty = "";
  document.getElementById("ticketTitle")!.textContent = `${sym().replace("-USD", "")} Order`;
  renderTicketBody();
  openSheet("ticketSheet");
  focusQty();
}

function openOptionTicket(q: OptionQuote) {
  const mid = (q.bid + q.ask) / 2;
  state.form.option = { spec: q.spec, bid: q.bid, ask: q.ask, mid };
  state.form.side = "buy";
  state.form.type = "market";
  // Default to a size the account can actually afford (one contract if it fits,
  // otherwise a sensible fraction) so small bankrolls can still practice options.
  const perContract = q.ask * q.spec.multiplier;
  const bp = W().buyingPower().toNumber();
  let defaultQty = 1;
  if (perContract > bp && perContract > 0) {
    defaultQty = Math.max(0.01, Math.floor((bp / perContract) * 100) / 100);
  }
  state.form.qty = String(defaultQty);
  const label = `${q.spec.underlying.replace("-USD", "")} ${F.priceFmt(q.spec.strike)}${q.spec.right[0]!.toUpperCase()}`;
  document.getElementById("ticketTitle")!.textContent = label;
  renderTicketBody();
  openSheet("ticketSheet");
  focusQty();
}

// Quick-size chips for the option ticket: fractions of the max affordable size.
function renderOptChips(perContract: number, bp: number): void {
  const wrap = document.getElementById("optChips");
  if (!wrap) return;
  const max = perContract > 0 ? (bp / perContract) : 0;
  const sizes: [string, number][] = [
    ["0.1", 0.1],
    ["0.25", 0.25],
    ["0.5", 0.5],
    ["1", 1],
    ["Max", Math.floor(max * 100) / 100],
  ];
  wrap.innerHTML = sizes
    .filter(([, v]) => v > 0 && v <= Math.max(1, max) + 1e-9)
    .map(([label, v]) => `<button class="qty-chip" data-qty="${v}">${label}</button>`)
    .join("");
  wrap.querySelectorAll<HTMLElement>("[data-qty]").forEach((b) => b.onclick = () => {
    state.form.qty = b.dataset.qty!;
    const input = document.getElementById("qty") as HTMLInputElement | null;
    if (input) input.value = state.form.qty;
    updatePreview();
  });
}

function focusQty() {
  setTimeout(() => {
    const q = document.getElementById("qty") as HTMLInputElement | null;
    if (q) { q.focus(); q.select(); }
  }, 60);
}

function renderTicketBody() {
  const body = document.getElementById("ticketBody");
  if (!body) return;
  body.innerHTML = state.form.option ? optionTicketHTML() : spotTicketHTML();
  wireTicket();
  updatePreview();
}

function spotTicketHTML(): string {
  const i = inst();
  return `<div class="ticket">
    <div class="seg ${state.form.side}" id="sideSeg">
      <button data-side="buy" class="${state.form.side === "buy" ? "on" : ""}">Buy</button>
      <button data-side="sell" class="${state.form.side === "sell" ? "on" : ""}">Sell</button>
    </div>
    <div class="field"><label>Order type</label>
      <select class="input" id="typeSel">
        ${(["market", "limit", "stop", "stop-limit", "trailing-stop"] as OrderType[]).map(
          (t) => `<option value="${t}" ${t === state.form.type ? "selected" : ""}>${t}</option>`
        ).join("")}
      </select></div>
    <div class="field"><label>Quantity (${i.assetClass === "crypto" ? "units" : "shares"})</label>
      <input class="input num" id="qty" inputmode="decimal" placeholder="0" value="${state.form.qty}"></div>
    <div class="field ${["limit", "stop-limit"].includes(state.form.type) ? "" : "hidden"}" id="limitField">
      <label>Limit price</label>
      <input class="input num" id="limit" inputmode="decimal" value="${state.form.limit}"></div>
    <div class="field ${["stop", "stop-limit"].includes(state.form.type) ? "" : "hidden"}" id="stopField">
      <label>Stop price</label>
      <input class="input num" id="stop" inputmode="decimal" value="${state.form.stop}"></div>
    <div class="field ${state.form.type === "trailing-stop" ? "" : "hidden"}" id="trailField">
      <label>Trail %</label>
      <input class="input num" id="trail" inputmode="decimal" placeholder="5" value="${state.form.trail}"></div>
    <div class="preview" id="preview"></div>
    <button class="submit ${state.form.side}" id="submitBtn"></button>
    <div class="note" id="note"></div>
  </div>`;
}

function optionTicketHTML(): string {
  const o = state.form.option!;
  const s = o.spec;
  return `<div class="ticket">
    <div class="opt-card">
      <div class="opt-row"><span class="opt-k">Contract</span><span class="opt-v">${s.underlying.replace("-USD", "")} ${F.priceFmt(s.strike)} ${s.right.toUpperCase()}</span></div>
      <div class="opt-row"><span class="opt-k">Expiry</span><span class="opt-v num">${F.dayLabel(s.expiry)}</span></div>
      <div class="opt-row"><span class="opt-k">Bid / Ask</span><span class="opt-v num">${o.bid.toFixed(2)} / ${o.ask.toFixed(2)}</span></div>
      <div class="opt-row"><span class="opt-k">Contract size</span><span class="opt-v num">×${s.multiplier} ${s.underlying.replace("-USD", "")}</span></div>
    </div>
    <div class="seg ${state.form.side}" id="sideSeg">
      <button data-side="buy" class="${state.form.side === "buy" ? "on" : ""}">Buy to open</button>
      <button data-side="sell" class="${state.form.side === "sell" ? "on" : ""}">Sell to open</button>
    </div>
    <div class="field"><label>Contracts (fractional allowed)</label>
      <input class="input num" id="qty" inputmode="decimal" placeholder="0.1" value="${state.form.qty}"></div>
    <div class="qty-chips" id="optChips"></div>
    <div class="preview" id="preview"></div>
    <button class="submit ${state.form.side}" id="submitBtn"></button>
    <div class="note" id="note"></div>
  </div>`;
}

function wireTicket() {
  document.querySelectorAll<HTMLElement>("[data-side]").forEach((b) => b.onclick = () => {
    state.form.side = b.dataset.side as Side;
    renderTicketBody();
  });
  const typeSel = document.getElementById("typeSel") as HTMLSelectElement | null;
  if (typeSel) typeSel.onchange = () => { state.form.type = typeSel.value as OrderType; renderTicketBody(); };
  for (const id of ["qty", "limit", "stop", "trail"] as const) {
    const e = document.getElementById(id) as HTMLInputElement | null;
    if (e) e.oninput = () => { (state.form as never as Record<string, string>)[id] = e.value; updatePreview(); };
  }
  document.getElementById("submitBtn")!.onclick = doSubmit;
}

function updatePreview() {
  const preview = document.getElementById("preview");
  const btn = document.getElementById("submitBtn") as HTMLButtonElement | null;
  if (!preview || !btn) return;

  if (state.form.option) {
    const o = state.form.option;
    const qty = parseFloat(state.form.qty) || 0;
    const px = state.form.side === "buy" ? o.ask : o.bid;
    const perContract = px * o.spec.multiplier;
    const cost = perContract * qty;
    const cash = W().portfolio.cash.toNumber();
    const bp = W().buyingPower().toNumber();
    const buying = state.form.side === "buy";
    // How many contracts the account can actually afford (drives small-account practice).
    const maxAffordable = perContract > 0 ? Math.floor((bp / perContract) * 100) / 100 : 0;
    const overBudget = buying && cost > bp + 0.005;
    renderOptChips(perContract, bp);
    preview.innerHTML = `
      <div class="row"><span class="k">Est. ${buying ? "debit" : "credit"}</span><span class="num ${overBudget ? "loss" : ""}">${F.money(cost)}</span></div>
      <div class="row"><span class="k">Price / contract</span><span class="num">${px.toFixed(2)} × ${o.spec.multiplier} = ${F.money(perContract)}</span></div>
      <div class="row"><span class="k">Max you can afford</span><span class="num">${maxAffordable > 0 ? maxAffordable.toFixed(2) : "0"}</span></div>
      <div class="row"><span class="k">Cash after</span><span class="num ${buying && cash - cost < 0 ? "loss" : ""}">${F.money(buying ? cash - cost : cash + cost)}</span></div>`;
    btn.className = `submit ${state.form.side}`;
    btn.textContent = overBudget
      ? "Insufficient buying power"
      : `${buying ? "Buy" : "Sell"} ${qty ? F.qty(qty) : ""} ${qty === 1 ? "contract" : "contracts"}`.replace(/\s+/g, " ").trim();
    btn.disabled = !qty || overBudget;
    return;
  }

  const mark = W().market.spotMark(sym(), W().now)?.toNumber();
  const qty = parseFloat(state.form.qty) || 0;
  const notional = (mark ?? 0) * qty;
  const fee = inst().fees.takerBps / 10000 * notional;
  const cash = W().portfolio.cash.toNumber();
  const after = state.form.side === "buy" ? cash - notional - fee : cash + notional - fee;
  preview.innerHTML = `
    <div class="row"><span class="k">Est. price</span><span class="num">${mark ? F.priceFmt(mark) : "—"}</span></div>
    <div class="row"><span class="k">Notional</span><span class="num">${F.money(notional)}</span></div>
    <div class="row"><span class="k">Fee</span><span class="num">${F.money(fee)}</span></div>
    <div class="row"><span class="k">Cash after</span><span class="num ${after < 0 ? "loss" : ""}">${F.money(after)}</span></div>`;
  btn.className = `submit ${state.form.side}`;
  btn.textContent = `${state.form.side === "buy" ? "Buy" : "Sell"} ${qty ? F.qty(qty) : ""} ${sym().replace("-USD", "")}`.trim();
  btn.disabled = !qty;
}

function doSubmit() {
  const note = document.getElementById("note")!;
  const qty = parseFloat(state.form.qty);
  if (!qty || qty <= 0) { note.textContent = "Enter a quantity."; return; }

  let req: import("../../sim/src/index.ts").OrderRequest;
  if (state.form.option) {
    const s = state.form.option.spec;
    req = { target: { kind: "option", symbol: s.underlying, option: s }, side: state.form.side, qty, type: "market", tif: "DAY" };
  } else {
    req = {
      target: { kind: "spot", symbol: sym() }, side: state.form.side, qty, type: state.form.type,
      tif: state.form.type === "market" ? "DAY" : "GTC",
    };
    if (["limit", "stop-limit"].includes(state.form.type)) req.limitPrice = parseFloat(state.form.limit) || undefined;
    if (["stop", "stop-limit"].includes(state.form.type)) req.stopPrice = parseFloat(state.form.stop) || undefined;
    if (state.form.type === "trailing-stop") req.trailPercent = (parseFloat(state.form.trail) || 5) / 100;
  }

  const res = store.submit(req);
  if (!res.ok) { note.textContent = res.reason ?? "Rejected."; return; }
  note.textContent = "";
  state.form.qty = "";
  closeSheets();
  // Market orders fill instantly; resting orders (limit/stop/…) work until hit.
  if (req.type === "market") toast(res.order?.status === "filled" ? "Order filled" : "Order placed", "gain");
  else toast("Order working — fills when price is reached");
  refresh();
  if (state.screen === "book") renderBookScreen();
  if (state.screen === "options") renderOptionsScreen();
}

// ─── Book / Portfolio Screen ─────────────────────────────────────────────────
function renderBookScreen() {
  const overlay = overlayEl();
  const resolve = W().markResolver();
  const positions = [...W().portfolio.positions.values()];
  const wo = W().workingOrders();
  const fills = W().fills.slice(-12).reverse();

  const posHTML = positions.length === 0
    ? `<div class="empty"><svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="6" width="18" height="15" rx="2"/><path d="M3 10h18M8 6V4a2 2 0 014 0v2"/></svg>No open positions.</div>`
    : positions.map((p) => {
        const mark = resolve(p)?.toNumber() ?? 0;
        const upnl = W().portfolio.unrealized(p, resolve).toNumber();
        const isOpt = p.target.kind === "option" && p.option;
        const label = isOpt
          ? `${p.option!.underlying.replace("-USD", "")} ${F.priceFmt(p.option!.strike)}${p.option!.right[0]!.toUpperCase()}`
          : p.target.symbol.replace("-USD", "");
        const subLabel = isOpt
          ? `${p.qty > 0 ? "Long" : "Short"} ${Math.abs(p.qty)} · exp ${F.dayLabel(p.option!.expiry)}`
          : `${F.qty(p.qty)} @ ${F.priceFmt(p.avgCost.toNumber())}`;
        return `<div class="book-row">
          <div class="book-info">
            <div class="book-sym">${label}</div>
            <div class="sub-text">${subLabel}</div>
          </div>
          <div class="book-pnl">
            <div class="book-mark num">${F.priceFmt(mark)}</div>
            <div class="pnl num ${F.pnlClass(upnl)}">${F.money(upnl, { sign: true })}</div>
          </div>
          ${isOpt
            ? `<button class="exec-btn" data-close="${p.key}">Execute</button>`
            : `<button class="action-btn close-btn" data-close="${p.key}">Close</button>`}
        </div>`;
      }).join("");

  const ordersHTML = wo.length === 0
    ? `<div class="empty"><svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>No working orders.</div>`
    : wo.map((o) => `<div class="book-row">
        <div class="book-info">
          <div class="book-sym">${o.side.toUpperCase()} ${F.qty(o.qty - o.filledQty)} ${(o.target.option?.underlying ?? o.target.symbol).replace("-USD", "")}</div>
          <div class="sub-text">${o.type}${o.limitPrice ? " @ " + F.priceFmt(o.limitPrice) : ""}${o.stopPrice ? " stop " + F.priceFmt(o.stopPrice) : ""}</div>
        </div>
        <button class="action-btn cancel-btn" data-cancel="${o.id}">Cancel</button>
      </div>`).join("");

  const blotterHTML = fills.length === 0
    ? `<div class="empty"><svg class="empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/></svg>No fills yet.</div>`
    : fills.map((f) => `<div class="book-row">
        <div class="book-info">
          <div class="book-sym">${f.side.toUpperCase()} ${F.qty(f.qty)} ${(f.target.option?.underlying ?? f.target.symbol).replace("-USD", "")}</div>
          <div class="sub-text">${F.dateLabel(f.at)}</div>
        </div>
        <div class="book-pnl">
          <div class="book-mark num">${F.priceFmt(f.price.toNumber())}</div>
          ${!f.realized.isZero()
            ? `<div class="pnl num ${F.pnlClass(f.realized.toNumber())}">${F.money(f.realized.toNumber(), { sign: true })}</div>`
            : `<div class="pnl num dim">fee ${F.money(f.fee.toNumber())}</div>`}
        </div>
      </div>`).join("");

  const eq = W().equity().toNumber();
  const cash = W().portfolio.cash.toNumber();
  const upnl = W().unrealized().toNumber();
  const totalPnl = eq - W().settings.startingCash;

  const body = `
    <div class="port-hero">
      <div class="ph-k">Total Equity</div>
      <div class="ph-v num">${F.money(eq)}</div>
      <div class="ph-chg num ${F.pnlClass(totalPnl)}">${F.glyph(totalPnl)} ${F.money(totalPnl, { sign: true })} all-time</div>
    </div>
    <div class="port-grid">
      <div class="pg-stat"><div class="pg-k">Cash</div><div class="pg-v num">${F.money(cash)}</div></div>
      <div class="pg-stat"><div class="pg-k">Unrealized</div><div class="pg-v num ${F.pnlClass(upnl)}">${F.money(upnl, { sign: true })}</div></div>
    </div>
    <div class="book-section">
      <div class="book-head">Positions <span class="count-badge">${positions.length}</span></div>
      ${posHTML}
    </div>
    <div class="book-section">
      <div class="book-head">Working Orders <span class="count-badge">${wo.length}</span></div>
      ${ordersHTML}
    </div>
    <div class="book-section">
      <div class="book-head">Recent Fills</div>
      ${blotterHTML}
    </div>`;

  overlay.innerHTML = screenShell("Portfolio", body);
  document.getElementById("backBtn")!.onclick = closeScreen;
  overlay.querySelectorAll<HTMLElement>("[data-close]").forEach((b) => b.onclick = () => { closePosition(b.dataset.close!); renderBookScreen(); });
  overlay.querySelectorAll<HTMLElement>("[data-cancel]").forEach((b) => b.onclick = () => { store.cancel(b.dataset.cancel!); refresh(); renderBookScreen(); });
}

function closePosition(key: string) {
  const p = W().portfolio.get(key);
  if (!p) return;
  const side: Side = p.qty > 0 ? "sell" : "buy";
  store.submit({ target: p.target, side, qty: Math.abs(p.qty), type: "market", tif: "DAY" });
  toast("Position closed", "gain");
  refresh();
}

// ─── Time Controls ────────────────────────────────────────────────────────────
// Warp state — continuous rAF loop advancing 6 sim-hours per real second.
const warp = { on: false, raf: 0, lastTs: 0 };
const WARP_HRS_PER_SEC = 6;

function toggleWarp() {
  if (warp.on) { stopWarp(); return; }
  if (store.live) { toast("Turn off live mode to use time warp"); return; }
  warp.on = true;
  warp.lastTs = performance.now();
  document.getElementById("warpBtn")?.classList.add("on");
  document.getElementById("warpRate")?.classList.remove("hidden");
  function frame(ts: number) {
    if (!warp.on) return;
    const dt = (ts - warp.lastTs) / 1000;
    warp.lastTs = ts;
    W().advanceTo(W().now + dt * WARP_HRS_PER_SEC * 3_600_000, { stepRes: "1h" });
    chart?.setData(visibleBars());
    updateHeader();
    warp.raf = requestAnimationFrame(frame);
  }
  warp.raf = requestAnimationFrame(frame);
}

function stopWarp() {
  if (!warp.on) return;
  cancelAnimationFrame(warp.raf);
  warp.on = false;
  document.getElementById("warpBtn")?.classList.remove("on");
  document.getElementById("warpRate")?.classList.add("hidden");
  store.noteAdvance(W().now);
  chart?.setData(visibleBars(), { resetView: false });
  refresh();
}

function wireTime() {
  document.getElementById("warpBtn")?.addEventListener("click", toggleWarp);
}

function animateAdvance(from: number, target: number) {
  state.scrubbing = true;
  app.classList.add("scrubbing");
  setAdvButtons(false);
  const span = target - from;
  const stepRes: Resolution = span > 2 * 86400_000 ? "1h" : "1m";
  const barMs = stepRes === "1h" ? 3600_000 : 60_000;
  const maxBarsPerFrame = 24;
  const dur = 800;
  const t0 = performance.now();
  const ease = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
  function frame(now: number) {
    const k = Math.min(1, (now - t0) / dur);
    let want = from + span * ease(k);
    const cap = W().now + maxBarsPerFrame * barMs;
    if (want > cap) want = cap;
    if (want > W().now) W().advanceTo(want, { stepRes });
    chart?.setData(visibleBars());
    updateHeader();
    if (W().now < target) requestAnimationFrame(frame);
    else finishAdvance(target);
  }
  requestAnimationFrame(frame);
}

function finishAdvance(target: number) {
  if (target > W().now) W().advanceTo(target);
  store.noteAdvance(target);
  state.scrubbing = false;
  app.classList.remove("scrubbing");
  setAdvButtons(true);
  chart?.setData(visibleBars());
  refresh();
  toast(`Advanced to ${F.dayLabel(W().now)}`);
}

function setAdvButtons(on: boolean) {
  document.querySelectorAll<HTMLButtonElement>("[data-adv]").forEach((b) => (b.disabled = !on));
}

// ─── Header ──────────────────────────────────────────────────────────────────
function updateHeader() {
  const cash = W().portfolio.cash.toNumber();
  const eq = W().equity().toNumber();
  const qbBp = document.getElementById("qbBp");
  if (qbBp) qbBp.textContent = F.money(cash);
  const qbEq = document.getElementById("qbEq");
  if (qbEq) qbEq.textContent = F.money(eq);

  const acctEl = document.getElementById("tbAcct");
  if (acctEl) {
    const totalPnl = eq - W().settings.startingCash;
    acctEl.innerHTML = `
      <div class="acct-item"><span class="k">Cash</span><span class="v num">${F.money(cash)}</span></div>
      <div class="acct-item"><span class="k">Equity</span><span class="v num">${F.money(eq)}</span></div>
      <div class="acct-item"><span class="k">P&amp;L</span><span class="v num ${F.pnlClass(totalPnl)}">${F.money(totalPnl, { sign: true })}</span></div>`;
  }

  const tl = document.getElementById("timeLabel");
  if (tl) tl.textContent = `◷ ${F.dateLabel(W().now)}`;
  const mp = document.getElementById("modePill");
  if (mp) {
    if (store.live) { mp.textContent = "● LIVE"; mp.className = "mode-pill live"; mp.style.display = ""; }
    else { mp.textContent = ""; mp.className = "mode-pill"; mp.style.display = "none"; }
  }
}

function refresh() {
  updateHeader();
  renderTicker();
  if (state.screen === "book") renderBookScreen();
}

// ─── Profile Sheet ───────────────────────────────────────────────────────────
function openProfile() {
  renderProfileBody();
  openSheet("profileSheet");
}

function renderProfileBody() {
  const body = document.getElementById("profileBody")!;
  const profiles = Store.listProfiles();
  const activeId = store.profileId;
  body.innerHTML = `
    <div class="pp-list">
      ${profiles.map((p) => `
        <div class="pp-item ${p.id === activeId ? "active" : ""}">
          <span class="pp-avatar">${(p.name[0] ?? "P").toUpperCase()}</span>
          <div class="pp-info">
            <div class="pp-name">${p.name}</div>
            ${p.id === activeId ? `<div class="pp-sub">Active</div>` : ""}
          </div>
          ${p.id !== activeId ? `<button class="pp-switch" data-switch="${p.id}">Switch</button>` : ""}
          ${profiles.length > 1 ? `<button class="pp-del" data-del="${p.id}" aria-label="Delete">✕</button>` : ""}
        </div>`).join("")}
    </div>
    <button class="pp-create" id="ppCreate">+ New Profile</button>`;
  body.querySelectorAll<HTMLElement>("[data-switch]").forEach((b) => b.onclick = () => { Store.switchProfile(b.dataset.switch!); location.reload(); });
  body.querySelectorAll<HTMLElement>("[data-del]").forEach((b) => b.onclick = () => {
    if (confirm("Delete this profile? All its data will be lost.")) {
      const wasActive = b.dataset.del === activeId;
      Store.deleteProfile(b.dataset.del!);
      if (wasActive) location.reload(); else renderProfileBody();
    }
  });
  document.getElementById("ppCreate")!.onclick = () => {
    const name = prompt("Profile name:", "New Profile");
    if (name) { Store.createProfile(name); location.reload(); }
  };
}

// ─── Options Screen ───────────────────────────────────────────────────────────
function chainParams() {
  const spot = W().market.spotMark(sym(), W().now)!.toNumber();
  return {
    underlyingSymbol: sym(), assetClass: inst().assetClass, spot, now: W().now,
    r: W().settings.riskFreeRate, q: inst().assetClass === "equity" ? W().settings.dividendYield : 0,
    surface: W().market.volSurface(sym(), W().now), multiplier: inst().multiplier,
    expiries: standardExpiries(W().now, inst().assetClass),
  };
}

function renderOptionsScreen() {
  const overlay = overlayEl();
  const p = chainParams();
  const chain = buildChain(p, { strikes: 7 });
  state.optExpiryIdx = Math.min(state.optExpiryIdx, chain.expiries.length - 1);
  const exp = chain.expiries[state.optExpiryIdx]!;

  const positions = [...W().portfolio.positions.values()].filter(
    (pos) => pos.target.kind === "option" && pos.option?.underlying === sym()
  );
  const resolve = W().markResolver();
  const openPositionsHTML = positions.length === 0 ? "" : `
    <h3 class="section-head">Your Option Positions</h3>
    ${positions.map((pos) => {
      const mark = resolve(pos)?.toNumber() ?? 0;
      const upnl = W().portfolio.unrealized(pos, resolve).toNumber();
      const opt = pos.option!;
      return `<div class="book-row">
        <div class="book-info">
          <div class="book-sym">${opt.underlying.replace("-USD", "")} ${F.priceFmt(opt.strike)}${opt.right[0]!.toUpperCase()}</div>
          <div class="sub-text">${pos.qty > 0 ? "Long" : "Short"} ${Math.abs(pos.qty)} · exp ${F.dayLabel(opt.expiry)}</div>
        </div>
        <div class="book-pnl">
          <div class="book-mark num">${F.priceFmt(mark)}</div>
          <div class="pnl num ${F.pnlClass(upnl)}">${F.money(upnl, { sign: true })}</div>
        </div>
        <button class="exec-btn" data-close="${pos.key}">Execute</button>
      </div>`;
    }).join("")}`;

  const rows = exp.calls.map((c) => c.spec.strike).map((k) => {
    const c = exp.calls.find((x) => x.spec.strike === k)!;
    const pu = exp.puts.find((x) => x.spec.strike === k)!;
    const isAtm = k === exp.atmStrike;
    const cItm = p.spot > k, pItm = p.spot < k;
    return `<tr class="${isAtm ? "atm" : ""}">
      <td class="${cItm ? "itm" : ""} buyc" data-opt="call:${k}">${c.bid.toFixed(2)} / ${c.ask.toFixed(2)}</td>
      <td class="${cItm ? "itm" : ""}">${c.greeks.delta.toFixed(2)}</td>
      <td class="strike">${F.priceFmt(k)}</td>
      <td class="${pItm ? "itm" : ""}">${pu.greeks.delta.toFixed(2)}</td>
      <td class="${pItm ? "itm" : ""} buyc" data-opt="put:${k}">${pu.bid.toFixed(2)} / ${pu.ask.toFixed(2)}</td>
    </tr>`;
  }).join("");

  const body = `
    <div class="card opt-spot">
      <div>
        <div class="muted spot-k">${sym()} Spot</div>
        <div class="num spot-v">${F.priceFmt(p.spot)}</div>
      </div>
      <div class="dim spot-note">Tap a bid/ask<br>to open an order</div>
    </div>
    ${openPositionsHTML}
    <div class="chain-tabs">${chain.expiries.map((e, i) =>
      `<button class="chip ${i === state.optExpiryIdx ? "active" : ""}" data-exp="${i}">${F.dayLabel(e.expiry)}</button>`
    ).join("")}</div>
    <table class="chain">
      <thead><tr><th>Call b/a</th><th>Δ</th><th>Strike</th><th>Δ</th><th>Put b/a</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <h3 class="section-head">Strategy Builder</h3>
    <div class="strat-chips">
      ${["Long Straddle", "Strangle", "Bull Call Spread", "Iron Condor"].map(
        (s) => `<button class="chip" data-strat="${s}">${s}</button>`
      ).join("")}
    </div>
    <div id="stratOut"></div>`;

  overlay.innerHTML = screenShell(`Options — ${sym().replace("-USD", "")}`, body);
  document.getElementById("backBtn")!.onclick = closeScreen;
  overlay.querySelectorAll<HTMLElement>("[data-exp]").forEach((b) => b.onclick = () => { state.optExpiryIdx = +b.dataset.exp!; renderOptionsScreen(); });
  overlay.querySelectorAll<HTMLElement>("[data-opt]").forEach((b) => b.onclick = () => {
    const [right, k] = b.dataset.opt!.split(":");
    const q = (right === "call" ? exp.calls : exp.puts).find((x) => x.spec.strike === +k!)!;
    openOptionTicket(q);
  });
  overlay.querySelectorAll<HTMLElement>("[data-strat]").forEach((b) => b.onclick = () => buildStrategy(b.dataset.strat!, exp, p.spot));
  overlay.querySelectorAll<HTMLElement>("[data-close]").forEach((b) => b.onclick = () => { closePosition(b.dataset.close!); renderOptionsScreen(); });
}

function buildStrategy(name: string, exp: ReturnType<typeof buildChain>["expiries"][number], spot: number) {
  const calls = exp.calls, puts = exp.puts;
  const atm = exp.atmStrike;
  const callAtm = calls.find((c) => c.spec.strike === atm)!;
  const putAtm = puts.find((c) => c.spec.strike === atm)!;
  const ks = calls.map((c) => c.spec.strike).sort((a, b) => a - b);
  const above = ks.find((k) => k > atm) ?? atm;
  const below = [...ks].reverse().find((k) => k < atm) ?? atm;
  let strat;
  if (name === "Long Straddle") strat = straddle(callAtm, putAtm);
  else if (name === "Strangle") strat = strangle(calls.find((c) => c.spec.strike === above)!, puts.find((c) => c.spec.strike === below)!);
  else if (name === "Bull Call Spread") strat = verticalSpread(callAtm, calls.find((c) => c.spec.strike === above)!);
  else strat = ironCondor(
    puts.find((c) => c.spec.strike === ks[Math.max(0, ks.indexOf(below) - 1)])!,
    puts.find((c) => c.spec.strike === below)!,
    calls.find((c) => c.spec.strike === above)!,
    calls.find((c) => c.spec.strike === ks[Math.min(ks.length - 1, ks.indexOf(above) + 1)])!
  );
  const a = analyzeStrategy(strat, spot);
  const out = document.getElementById("stratOut")!;
  out.innerHTML = `<div class="card">
    <div class="row-between">
      <strong>${strat.name}</strong>
      <span class="num ${a.netCost > 0 ? "loss" : "gain"}">${a.netCost > 0 ? "Debit" : "Credit"} ${F.money(Math.abs(a.netCost))}</span>
    </div>
    <canvas id="payoff" style="width:100%;height:160px;margin-top:14px;display:block"></canvas>
    <div class="stat-grid" style="margin-top:14px">
      <div class="stat"><div class="k">Max Profit</div><div class="v num gain">${a.maxProfit === Infinity ? "∞" : F.money(a.maxProfit)}</div></div>
      <div class="stat"><div class="k">Max Loss</div><div class="v num loss">${a.maxLoss === -Infinity ? "∞" : F.money(a.maxLoss)}</div></div>
    </div>
    <div class="muted mt" style="font-size:12px">Breakevens: ${a.breakevens.map((b) => F.priceFmt(b)).join(", ") || "—"}</div>
    <button class="submit buy mt" id="execStrat">Execute ${strat.legs.length}-leg strategy</button>
  </div>`;
  requestAnimationFrame(() => drawPayoff(document.getElementById("payoff") as HTMLCanvasElement, a.payoff, spot, a.breakevens));
  document.getElementById("execStrat")!.onclick = () => {
    for (const leg of strat.legs) {
      if (leg.kind !== "option" || !leg.spec) continue;
      store.submit({ target: { kind: "option", symbol: leg.spec.underlying, option: leg.spec }, side: leg.side > 0 ? "buy" : "sell", qty: leg.qty, type: "market", tif: "DAY" });
    }
    toast(`${strat.name} submitted`, "gain");
    refresh();
    renderOptionsScreen();
  };
}

// ─── Stats Screen ─────────────────────────────────────────────────────────────
function renderStatsScreen() {
  const overlay = overlayEl();
  const r = analytics(W());
  const totalPnl = Number(r.totalPnl);
  const body = `
    <div class="card">
      <div class="muted spot-k">Total Equity</div>
      <div class="num stats-hero">${F.money(r.equity)}</div>
      <div class="num ${F.pnlClass(totalPnl)}" style="margin-top:4px">${F.glyph(totalPnl)} ${F.money(totalPnl, { sign: true })} total P&amp;L</div>
      <canvas id="eqCurve" style="width:100%;height:140px;margin-top:16px;display:block"></canvas>
    </div>
    <div class="stat-grid">
      ${stat("Realized P&L", F.money(Number(r.totalRealized)), F.pnlClass(Number(r.totalRealized)))}
      ${stat("Unrealized P&L", F.money(Number(r.totalUnrealized)), F.pnlClass(Number(r.totalUnrealized)))}
      ${stat("Win Rate", (r.trade.winRate * 100).toFixed(0) + "%")}
      ${stat("Profit Factor", isFinite(r.trade.profitFactor) ? r.trade.profitFactor.toFixed(2) : "∞")}
      ${stat("Expectancy", F.money(Number(r.trade.expectancy)))}
      ${stat("Trades", String(r.trade.trades))}
      ${stat("Avg Win", F.money(Number(r.trade.avgWin)), "gain")}
      ${stat("Avg Loss", F.money(Number(r.trade.avgLoss)), "loss")}
      ${stat("Max Drawdown", (r.drawdown.maxDrawdownPct * 100).toFixed(1) + "%", "loss")}
      ${stat("Avg Hold", r.trade.avgHoldHours.toFixed(1) + "h")}
    </div>`;
  overlay.innerHTML = screenShell("Statistics", body);
  document.getElementById("backBtn")!.onclick = closeScreen;
  requestAnimationFrame(() => drawEquityCurve(
    document.getElementById("eqCurve") as HTMLCanvasElement,
    r.equityCurve.map((p) => ({ t: p.t, equity: Number(p.equity) })),
    W().settings.startingCash
  ));
}

function stat(k: string, v: string, cls = "") {
  return `<div class="stat"><div class="k">${k}</div><div class="v num ${cls}">${v}</div></div>`;
}

// ─── Learn (inside Settings) ─────────────────────────────────────────────────
function renderLearnScreen() {
  const overlay = overlayEl();
  if (state.learnModule) return renderModule(state.learnModule);
  const map = store.progress.completionMap();
  const body = `
    <div class="muted" style="margin-bottom:16px;font-size:13px">Options, end to end — ${(store.progress.overallProgress() * 100).toFixed(0)}% complete.</div>
    ${CURRICULUM.map((m, i) => {
      const st = map[i]!;
      return `<div class="module ${st.unlocked ? "" : "locked"}" ${st.unlocked ? `data-mod="${m.id}"` : ""}>
        <div class="mhead">
          <span>${m.index}. ${m.title}</span>
          ${st.passed ? `<span class="badge done">✓ ${(st.bestScore * 100).toFixed(0)}%</span>` : ""}
          ${!st.unlocked ? `<span class="badge">Locked</span>` : ""}
        </div>
        <div class="lesson-body">${m.summary}</div>
      </div>`;
    }).join("")}`;
  overlay.innerHTML = screenShell("Learn Options", body);
  document.getElementById("backBtn")!.onclick = renderSettingsScreen;
  overlay.querySelectorAll<HTMLElement>("[data-mod]").forEach((b) => b.onclick = () => { state.learnModule = b.dataset.mod!; renderModule(b.dataset.mod!); });
}

function renderModule(id: string) {
  const overlay = overlayEl();
  const m = CURRICULUM.find((x) => x.id === id)!;
  const answers: Record<string, number> = {};
  const body = `
    ${m.lessons.map((l) => `<div class="card"><strong>${l.title}</strong><div class="lesson-body">${l.body}</div></div>`).join("")}
    <h3 style="margin:16px 0 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-3)">Quiz — pass ≥ ${(m.passThreshold * 100).toFixed(0)}%</h3>
    <div id="quiz">
      ${m.quiz.map((q) => `<div class="card" data-q="${q.id}"><strong>${q.prompt}</strong>
        ${q.options.map((o, i) => `<button class="quiz-opt" data-pick="${q.id}:${i}">${o}</button>`).join("")}</div>`).join("")}
    </div>
    <button class="submit buy" id="grade" style="max-width:280px">Submit Quiz</button>
    <div class="note" id="quizNote"></div>`;
  overlay.innerHTML = screenShell(`${m.index}. ${m.title}`, body);
  document.getElementById("backBtn")!.onclick = () => { state.learnModule = null; renderLearnScreen(); };
  overlay.querySelectorAll<HTMLElement>("[data-pick]").forEach((b) => b.onclick = () => {
    const [qid, i] = b.dataset.pick!.split(":");
    answers[qid!] = +i!;
    overlay.querySelectorAll<HTMLElement>(`[data-pick^="${qid}:"]`).forEach((x) => x.classList.remove("sel"));
    b.classList.add("sel");
  });
  document.getElementById("grade")!.onclick = () => {
    const res = store.progress.grade(m.id, answers);
    store.save();
    m.quiz.forEach((q) => overlay.querySelectorAll<HTMLElement>(`[data-pick^="${q.id}:"]`).forEach((x) => {
      const i = +x.dataset.pick!.split(":")[1]!;
      if (i === q.answer) x.classList.add("correct");
      else if (answers[q.id] === i) x.classList.add("wrong");
    }));
    const note = document.getElementById("quizNote")!;
    note.style.color = res.passed ? "var(--gain)" : "var(--loss)";
    note.textContent = `${(res.bestScore * 100).toFixed(0)}% — ${res.passed ? "Passed ✓" : "Keep going — review and retake."}`;
  };
}

// ─── Settings Screen ──────────────────────────────────────────────────────────
function renderSettingsScreen() {
  const overlay = overlayEl();
  const s = W().settings;
  const learnRow = s.helpEnabled
    ? `<button class="link-row" id="openLearn">
        <div class="label"><div>Learning track</div><div class="sub">Options curriculum — ${(store.progress.overallProgress() * 100).toFixed(0)}% complete</div></div>
        <span class="link-arrow">›</span>
      </button>`
    : "";
  const body = `
    <div class="card">
      ${toggleRow("Live market prices", "Crypto prices update from Coinbase in real time. Off = deterministic practice mode.", store.live, "liveMode")}
      ${toggleRow("Help & Learning", "Enable the options learning track and terminal commentary.", s.helpEnabled, "helpEnabled")}
      ${toggleRow("Fee & spread realism", "Model bid/ask spread, slippage and fees on fills.", s.feeRealism, "feeRealism")}
      ${toggleRow("Light theme", "Switch to the light appearance.", store.ui.theme === "light", "theme")}
    </div>
    ${learnRow ? `<div class="card" style="padding:0">${learnRow}</div>` : ""}
    <div class="card">
      <div class="set-row"><div class="label"><div>Add funds</div><div class="sub">Current cash: ${F.money(W().portfolio.cash.toNumber())}</div></div></div>
      <div class="inline-row">
        <input class="input num" id="depAmt" inputmode="decimal" placeholder="500">
        <button class="adv-btn" id="depBtn">Deposit</button>
      </div>
    </div>
    <div class="card">
      <div class="set-row"><div class="label"><div>Risk-free rate</div><div class="sub">Used for option pricing (BSM/BAW)</div></div>
        <input class="input num" id="rfr" style="width:72px" value="${(s.riskFreeRate * 100).toFixed(1)}"></div>
    </div>
    <div class="card">
      <div class="set-row" style="border-bottom:none;padding-bottom:6px">
        <div class="label"><div>Reset account</div><div class="sub">Wipe positions, orders and clock to a fresh start.</div></div>
      </div>
      <div class="inline-row">
        <input class="input num" id="resetCash" value="${Math.round(W().settings.startingCash)}" placeholder="1000">
        <button class="adv-btn danger" id="resetBtn">Reset</button>
      </div>
    </div>
    <div class="card">
      <strong>About ORION</strong>
      <div class="lesson-body">ORION uses historical and/or delayed market data for trading practice. It holds no real funds and places no real orders. All prices, fills, options and Greeks are modeled — not financial advice.</div>
    </div>`;
  overlay.innerHTML = screenShell("Settings", body);
  document.getElementById("backBtn")!.onclick = closeScreen;
  overlay.querySelectorAll<HTMLElement>("[data-toggle]").forEach((b) => b.onclick = () => onToggle(b.dataset.toggle!));
  const ol = document.getElementById("openLearn");
  if (ol) ol.onclick = () => { state.learnModule = null; renderLearnScreen(); };
  document.getElementById("depBtn")!.onclick = () => {
    const v = parseFloat((document.getElementById("depAmt") as HTMLInputElement).value);
    if (v > 0) { store.deposit(v); toast(`Deposited ${F.money(v)}`, "gain"); renderSettingsScreen(); refresh(); }
  };
  document.getElementById("rfr")!.addEventListener("change", (e) => {
    store.updateSettings({ riskFreeRate: (parseFloat((e.target as HTMLInputElement).value) || 4) / 100 });
  });
  document.getElementById("resetBtn")!.onclick = () => {
    const cash = Math.max(0, parseFloat((document.getElementById("resetCash") as HTMLInputElement).value) || W().settings.startingCash);
    if (confirm(`Reset account to ${F.money(cash)} bankroll? This wipes all positions, orders and history.`)) {
      store.reset(cash);
      state.screen = "trade";
      renderShell();
      maybeAutoLive();
      toast(`Account reset — ${F.money(cash)} bankroll`);
    }
  };
}

function toggleRow(label: string, sub: string, on: boolean, key: string) {
  return `<div class="set-row">
    <div class="label"><div>${label}</div><div class="sub">${sub}</div></div>
    <div class="toggle ${on ? "on" : ""}" data-toggle="${key}"><div class="knob"></div></div>
  </div>`;
}

function onToggle(key: string) {
  if (key === "helpEnabled") store.updateSettings({ helpEnabled: !W().settings.helpEnabled });
  else if (key === "feeRealism") store.updateSettings({ feeRealism: !W().settings.feeRealism });
  else if (key === "liveMode") {
    if (store.live) {
      store.ui.livePref = false; store.saveUi(); store.disableLive(); toast("Practice mode");
    } else {
      store.ui.livePref = true; store.saveUi();
      toast("Connecting to live prices…");
      void store.enableLive().then(() => {
        toast(store.live ? "Live prices active" : "Could not connect — staying in practice", store.live ? "gain" : "");
        renderSettingsScreen(); refresh();
      });
      return;
    }
  } else if (key === "theme") {
    store.ui.theme = store.ui.theme === "light" ? "dark" : "light";
    store.saveUi();
    document.documentElement.setAttribute("data-theme", store.ui.theme);
    chart?.setData(visibleBars());
  }
  renderSettingsScreen();
  refresh();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function toast(msg: string, cls = "") {
  const t = document.getElementById("toast")!;
  t.className = `toast show ${cls}`;
  t.textContent = msg;
  setTimeout(() => (t.className = "toast"), 2400);
}

function ceilTo(t: number, step: number) { return Math.ceil(t / step) * step; }

function brandLogoLarge(): string {
  return `<svg class="splash-logo" width="64" height="64" viewBox="0 0 24 24" fill="none">
    <circle cx="5" cy="17" r="2" fill="var(--accent)"/>
    <circle cx="12" cy="11" r="2" fill="var(--accent)" opacity="0.8"/>
    <circle cx="19" cy="5" r="2" fill="var(--accent)" opacity="0.6"/>
    <path d="M5 17L12 11L19 5" stroke="var(--accent)" stroke-width="1.5" stroke-linecap="round" opacity="0.4"/>
  </svg>`;
}

function brandMark(): string {
  return `<div class="brand-inner">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <circle cx="5" cy="17" r="2" fill="var(--accent)"/>
      <circle cx="12" cy="11" r="2" fill="var(--accent)" opacity="0.75"/>
      <circle cx="19" cy="5" r="2" fill="var(--accent)" opacity="0.5"/>
      <path d="M5 17L12 11L19 5" stroke="var(--accent)" stroke-width="1.3" stroke-linecap="round" opacity="0.35"/>
    </svg>
    <span class="wordmark">ORION</span>
  </div>`;
}

function iChart() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3,16 8,10 12,13 17,6 21,9"/><polyline points="17,6 21,6 21,10"/></svg>`;
}
function iBook() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="4" width="17" height="16" rx="2.5"/><line x1="3.5" y1="9.5" x2="20.5" y2="9.5"/><line x1="9" y1="9.5" x2="9" y2="20"/></svg>`;
}
function iOptions() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3"/></svg>`;
}
function iStats() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="20" x2="6" y2="12"/><line x1="12" y1="20" x2="12" y2="5"/><line x1="18" y1="20" x2="18" y2="9"/></svg>`;
}
function iSettings() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>`;
}

boot();
