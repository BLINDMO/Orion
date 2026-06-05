// ORION web client — thin renderer over @orion/sim.
import {
  analytics,
  scan,
  buildChain,
  standardExpiries,
  getCurriculum,
  CURRICULUM,
  type OptionQuote,
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
import { isLiveSymbol } from "./live.ts";
import { Chart } from "./ui/chart.ts";
import { drawEquityCurve, drawPayoff } from "./ui/canvas.ts";
import * as F from "./ui/format.ts";

const store = new Store();
const app = document.getElementById("app")!;
let chart: Chart;

// Screens: trade=chart view, book=portfolio, options, stats, learn, settings
type Screen = "trade" | "book" | "options" | "stats" | "learn" | "settings";

const state = {
  screen: "trade" as Screen,
  tf: "1h" as Resolution,
  form: { side: "buy" as Side, type: "market" as OrderType, qty: "", limit: "", stop: "", trail: "" },
  optExpiryIdx: 0,
  ticketOpen: false,
  scanOpen: false,
  scrubbing: false,
  learnModule: null as string | null,
  profileOpen: false,
};

let ind = { sma: true, ema: true, bb: true, vwap: false };

const W = () => store.world;
const sym = () => store.ui.symbol;
const inst = () => W().universe.get(sym());

function visibleBars() {
  const id = W().data.get(sym())!;
  const res: Resolution = id.has(state.tf) ? state.tf : "1h";
  return id.get(res).visible(W().now).slice();
}

// ─── Boot ────────────────────────────────────────────────────────────────────
function boot() {
  document.documentElement.setAttribute("data-theme", store.ui.theme);
  if (!store.ui.onboarded) { renderSplash(); return; }
  renderShell();
  // Auto-enable live on launch if preferred (default true)
  if (store.ui.livePref !== false) {
    void store.enableLive().then(() => {
      if (store.live) {
        store.onLiveTick = () => { chart?.setData(visibleBars()); updateHeader(); };
        updateHeader();
        renderNav();
        toast("Live prices active", "gain");
      }
    }).catch(() => {
      // Silently stay in historical mode
    });
  }
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
    if (store.ui.livePref !== false) {
      void store.enableLive().then(() => {
        if (store.live) {
          store.onLiveTick = () => { chart?.setData(visibleBars()); updateHeader(); };
          updateHeader(); renderNav(); toast("Live prices active", "gain");
        }
      }).catch(() => {});
    }
  };
}

// ─── Shell ───────────────────────────────────────────────────────────────────
function renderShell() {
  app.innerHTML = `
    <div class="topbar">
      <div class="topbar-brand">${brandMark()}</div>
      <div class="topbar-syms" id="topbarSyms"></div>
      <div class="topbar-price" id="topbarPrice"></div>
      <div class="topbar-right">
        <div class="topbar-acct" id="topbarAcct"></div>
        <button class="profile-btn" id="profileBtn" aria-label="Profile">
          <div class="profile-avatar" id="profileAvatar">${store.getProfileName()[0]?.toUpperCase() ?? "P"}</div>
        </button>
      </div>
    </div>
    <div class="workspace">
      <nav class="sidebar" id="sidebar"></nav>
      <main class="content" id="content">
        ${tradeViewHTML()}
        <div class="screen-overlay" id="overlay"></div>
      </main>
    </div>
    <div class="bottom-nav" id="bottomNav"></div>
    <div class="profile-panel" id="profilePanel"></div>
    <div class="panel-backdrop" id="panelBackdrop"></div>
    <div class="toast" id="toast"></div>`;

  chart = new Chart(document.getElementById("chart") as HTMLCanvasElement);
  chart.setData(visibleBars(), { resetView: true });
  applyIndicators();

  renderNav();
  renderSymbolTabs();
  renderChartToolbar();
  wireTime();

  document.getElementById("qbBuy")!.onclick = () => openTicket("buy");
  document.getElementById("qbSell")!.onclick = () => openTicket("sell");
  document.getElementById("termBtn")?.addEventListener("click", toggleScan);
  document.getElementById("scanClose")?.addEventListener("click", toggleScan);
  document.getElementById("ticketClose")!.onclick = closeTicket;
  document.getElementById("profileBtn")!.onclick = openProfile;
  document.getElementById("panelBackdrop")!.onclick = closeAllPanels;

  store.onLiveTick = () => { chart?.setData(visibleBars()); updateHeader(); };

  if (state.screen !== "trade") mountScreen(state.screen);
  refresh();
}

function tradeViewHTML(): string {
  return `<div class="trade-view" id="tradeView">
    <div class="chart-area">
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
        <button class="adv-btn" data-adv="h">+1H</button>
        <button class="adv-btn" data-adv="d">+1D</button>
        <button class="adv-btn" data-adv="m">+30D</button>
      </div>
    </div>
    <!-- Scan panel: slides in from right on desktop, up from bottom on mobile -->
    <div class="scan-panel-wrap" id="scanWrap">
      <div class="scan-panel-inner">
        <div class="scan-panel-head">
          <span>◈ TERMINAL</span>
          <button class="icon-btn" id="scanClose">✕</button>
        </div>
        <div class="scan-panel-body" id="scanBody"></div>
      </div>
    </div>
  </div>
  <!-- Order ticket: full-screen sheet on mobile, sidebar on desktop -->
  <div class="ticket-sheet" id="ticketSheet">
    <div class="ticket-head">
      <span class="ticket-title">Order — <span id="ticketSym"></span></span>
      <button class="icon-btn" id="ticketClose">✕</button>
    </div>
    <div class="ticket-body" id="ticketBody"></div>
  </div>`;
}

// ─── Navigation ──────────────────────────────────────────────────────────────
function navItems(): [Screen, string, () => string][] {
  const showLearn = W().settings.helpEnabled;
  const items: [Screen, string, () => string][] = [
    ["trade", "Chart", tradeIcon],
    ["book", "Book", bookIcon],
    ["options", "Options", optionsIcon],
    ["stats", "Stats", statsIcon],
  ];
  if (showLearn) items.push(["learn", "Learn", learnIcon]);
  items.push(["settings", "Settings", settingsIcon]);
  return items;
}

function renderNav() {
  renderSidebar();
  renderBottomNav();
}

function renderSidebar() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  const items = navItems();
  sidebar.innerHTML = items.map(([s, tip, icon]) => `
    <button class="nav-btn ${state.screen === s ? "active" : ""}" data-nav="${s}" aria-label="${tip}">
      ${icon()}
      <span class="nav-tip">${tip}</span>
    </button>`).join("") + `<div class="sidebar-spacer"></div>`;
  sidebar.querySelectorAll<HTMLElement>("[data-nav]").forEach((b) =>
    b.onclick = () => navigate(b.dataset.nav as Screen));
}

function renderBottomNav() {
  const bn = document.getElementById("bottomNav");
  if (!bn) return;
  // Show at most 5 items on mobile bottom nav
  const items = navItems().slice(0, 5);
  bn.innerHTML = items.map(([s, tip, icon]) => `
    <button class="bn-btn ${state.screen === s ? "active" : ""}" data-nav="${s}">
      ${icon()}
      <span class="bn-label">${tip}</span>
    </button>`).join("");
  bn.querySelectorAll<HTMLElement>("[data-nav]").forEach((b) =>
    b.onclick = () => navigate(b.dataset.nav as Screen));
}

function navigate(s: Screen) {
  // Close ticket/scan when switching screens
  if (s !== "trade") { closeTicket(); closeScan(); }
  state.screen = s;
  if (s === "trade") {
    document.getElementById("overlay")!.innerHTML = "";
    chart?.setData(visibleBars());
    renderNav();
    refresh();
    return;
  }
  renderNav();
  mountScreen(s);
}

function mountScreen(s: Screen) {
  if (s === "book") renderBookScreen();
  else if (s === "options") renderOptionsScreen();
  else if (s === "stats") renderStatsScreen();
  else if (s === "learn") renderLearnScreen();
  else if (s === "settings") renderSettingsScreen();
}

function closeScreen() { navigate("trade"); }

function screenShell(title: string, body: string, extraHead = ""): string {
  return `<div class="screen">
    <div class="shead">
      <button class="back" id="backBtn">‹</button>
      <h2>${title}</h2>
      ${extraHead}
    </div>
    <div class="sbody" id="sbody">${body}</div>
  </div>`;
}

function overlayEl() { return document.getElementById("overlay")!; }

// ─── Symbol Tabs ─────────────────────────────────────────────────────────────
function renderSymbolTabs() {
  const wrap = document.getElementById("topbarSyms");
  if (!wrap) return;
  const bars = visibleBars();
  const last = bars[bars.length - 1];
  const prev = bars.length > 1 ? bars[bars.length - 2]!.c : last?.o ?? 0;
  const chg = last && prev ? (last.c - prev) / prev : 0;

  wrap.innerHTML = W().universe.list().map((i) => {
    const isSel = i.symbol === sym();
    return `<button class="sym-tab ${isSel ? "active" : ""}" data-sym="${i.symbol}">
      <span class="sym-name">${i.symbol.replace("-USD", "")}</span>
      ${isSel && last ? `<span class="sym-chg ${F.pnlClass(chg)}">${F.pct(chg, 1)}</span>` : ""}
    </button>`;
  }).join("");

  wrap.querySelectorAll<HTMLElement>("[data-sym]").forEach((b) => b.onclick = () => {
    store.ui.symbol = b.dataset.sym!;
    store.saveUi();
    renderSymbolTabs();
    renderChartToolbar();
    chart.setData(visibleBars(), { resetView: true });
    document.getElementById("ticketSym")!.textContent = sym().replace("-USD", "");
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
  document.getElementById("termBtn")?.addEventListener("click", toggleScan);
}

function applyIndicators() {
  if (!chart) return;
  chart.setConfig({ sma: ind.sma ? [50] : [], ema: ind.ema ? [20] : [], bollinger: ind.bb, vwap: ind.vwap });
}

// ─── Scan Panel ──────────────────────────────────────────────────────────────
function toggleScan() {
  state.scanOpen = !state.scanOpen;
  const wrap = document.getElementById("scanWrap")!;
  if (state.scanOpen) {
    wrap.classList.add("open");
    renderScanBody();
  } else {
    wrap.classList.remove("open");
  }
}

function closeScan() {
  state.scanOpen = false;
  document.getElementById("scanWrap")?.classList.remove("open");
}

function renderScanBody() {
  const body = document.getElementById("scanBody");
  if (!body) return;
  const s = scan(W(), sym(), state.tf);
  const help = W().settings.helpEnabled;
  body.innerHTML = `
    <div class="scan-meta">◈ ${sym()} · ${s.timeframe}</div>
    <div class="badges">
      <span class="badge ${s.trend === "up" ? "up" : s.trend === "down" ? "down" : ""}">Trend: ${s.trend}</span>
      <span class="badge">Momentum: ${s.momentum}</span>
      <span class="badge">Vol: ${s.volatility}</span>
    </div>
    ${s.readings.filter((r) => r.value !== undefined).slice(0, 7).map((r) => `
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

// ─── Order Ticket ────────────────────────────────────────────────────────────
function openTicket(side: Side) {
  if (state.screen !== "trade") { navigate("trade"); }
  state.form.side = side;
  state.ticketOpen = true;
  const sheet = document.getElementById("ticketSheet")!;
  sheet.classList.add("open");
  document.getElementById("ticketSym")!.textContent = sym().replace("-USD", "");
  renderTicketBody();
  setTimeout(() => {
    const q = document.getElementById("qty") as HTMLInputElement | null;
    if (q) { q.focus(); q.select(); }
  }, 50);
}

function closeTicket() {
  state.ticketOpen = false;
  document.getElementById("ticketSheet")?.classList.remove("open");
}

function renderTicketBody() {
  const body = document.getElementById("ticketBody");
  if (!body) return;
  const i = inst();
  body.innerHTML = `
    <div class="ticket">
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
      <div class="field"><label>Qty (${i.assetClass === "crypto" ? "units" : "shares"})</label>
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
  wireTicket();
  updatePreview();
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
  const btn = document.getElementById("submitBtn");
  if (btn) btn.onclick = doSubmit;
}

function orderReqFromForm() {
  const qty = parseFloat(state.form.qty);
  const mark = W().market.spotMark(sym(), W().now)?.toNumber();
  if (!qty || qty <= 0) return { req: null, estPrice: mark };
  const req: import("../../sim/src/index.ts").OrderRequest = {
    target: { kind: "spot", symbol: sym() }, side: state.form.side, qty, type: state.form.type,
    tif: state.form.type === "market" ? "DAY" : "GTC",
  };
  if (["limit", "stop-limit"].includes(state.form.type)) req.limitPrice = parseFloat(state.form.limit) || undefined;
  if (["stop", "stop-limit"].includes(state.form.type)) req.stopPrice = parseFloat(state.form.stop) || undefined;
  if (state.form.type === "trailing-stop") req.trailPercent = (parseFloat(state.form.trail) || 5) / 100;
  return { req, estPrice: mark };
}

function updatePreview() {
  const { estPrice } = orderReqFromForm();
  const qty = parseFloat(state.form.qty) || 0;
  const notional = (estPrice ?? 0) * qty;
  const fee = inst().fees.takerBps / 10000 * notional;
  const cash = W().portfolio.cash.toNumber();
  const after = state.form.side === "buy" ? cash - notional - fee : cash + notional - fee;
  const preview = document.getElementById("preview");
  if (preview) preview.innerHTML = `
    <div class="row"><span class="k">Est. price</span><span class="num">${estPrice ? F.priceFmt(estPrice) : "—"}</span></div>
    <div class="row"><span class="k">Notional</span><span class="num">${F.money(notional)}</span></div>
    <div class="row"><span class="k">Fee</span><span class="num">${F.money(fee)}</span></div>
    <div class="row"><span class="k">Cash after</span><span class="num ${after < 0 ? "loss" : ""}">${F.money(after)}</span></div>`;
  const btn = document.getElementById("submitBtn") as HTMLButtonElement | null;
  if (btn) {
    btn.className = `submit ${state.form.side}`;
    btn.textContent = `${state.form.side === "buy" ? "Buy" : "Sell"} ${qty ? F.qty(qty) : ""} ${sym().replace("-USD", "")}`.trim();
    btn.disabled = !qty;
  }
}

function doSubmit() {
  const { req } = orderReqFromForm();
  const note = document.getElementById("note")!;
  if (!req) { note.textContent = "Enter a quantity."; return; }
  const res = store.submit(req);
  if (!res.ok) { note.textContent = res.reason ?? "Rejected."; return; }
  note.textContent = "";
  state.form.qty = "";
  closeTicket();
  if (W().mode === "live") toast("Order filled", "gain");
  else toast(req.type === "market" ? "Order placed — fills next bar" : "Order working");
  refresh();
  // Refresh book if it's open
  if (state.screen === "book") renderBookScreen();
}

// ─── Book Screen (main navigation item) ──────────────────────────────────────
function renderBookScreen() {
  const overlay = overlayEl();
  const resolve = W().markResolver();
  const positions = [...W().portfolio.positions.values()];
  const wo = W().workingOrders();
  const fills = W().fills.slice(-12).reverse();

  const posHTML = positions.length === 0
    ? `<div class="empty">No open positions.</div>`
    : positions.map((p) => {
        const mark = resolve(p)?.toNumber() ?? 0;
        const upnl = W().portfolio.unrealized(p, resolve).toNumber();
        const isOpt = p.target.kind === "option" && p.option;
        const label = isOpt
          ? `${p.option!.underlying.replace("-USD", "")} ${p.option!.strike}${p.option!.right[0]!.toUpperCase()} ${F.dayLabel(p.option!.expiry)}`
          : p.target.symbol.replace("-USD", "");
        const subLabel = isOpt
          ? `${p.qty > 0 ? "Long" : "Short"} ${Math.abs(p.qty)} contract${Math.abs(p.qty) !== 1 ? "s" : ""}`
          : `${F.qty(p.qty)} @ ${F.priceFmt(p.avgCost.toNumber())}`;
        return `<div class="book-row">
          <div class="book-row-info">
            <div class="book-sym">${label}</div>
            <div class="sub-text">${subLabel}</div>
          </div>
          <div class="book-row-pnl">
            <div class="book-mark">${F.priceFmt(mark)}</div>
            <div class="pnl ${F.pnlClass(upnl)}">${F.glyph(upnl)} ${F.money(upnl, { sign: true })}</div>
          </div>
          <div class="book-row-actions">
            <button class="action-btn close-btn" data-close="${p.key}">Close</button>
          </div>
        </div>`;
      }).join("");

  const ordersHTML = wo.length === 0
    ? `<div class="empty">No working orders.</div>`
    : wo.map((o) => `<div class="book-row">
        <div class="book-row-info">
          <div class="book-sym">${o.side.toUpperCase()} ${F.qty(o.qty - o.filledQty)} ${(o.target.option?.underlying ?? o.target.symbol).replace("-USD", "")}</div>
          <div class="sub-text">${o.type}${o.limitPrice ? " @ " + F.priceFmt(o.limitPrice) : ""}${o.stopPrice ? " stop " + F.priceFmt(o.stopPrice) : ""}</div>
        </div>
        <div class="book-row-actions">
          <button class="action-btn cancel-btn" data-cancel="${o.id}">Cancel</button>
        </div>
      </div>`).join("");

  const blotterHTML = fills.length === 0
    ? `<div class="empty">No fills yet.</div>`
    : fills.map((f) => `<div class="book-row">
        <div class="book-row-info">
          <div class="book-sym">${f.side.toUpperCase()} ${F.qty(f.qty)} ${(f.target.option?.underlying ?? f.target.symbol).replace("-USD", "")}</div>
          <div class="sub-text">${F.dateLabel(f.at)}</div>
        </div>
        <div class="book-row-pnl">
          <div class="book-mark">${F.priceFmt(f.price.toNumber())}</div>
          ${!f.realized.isZero()
            ? `<div class="pnl ${F.pnlClass(f.realized.toNumber())}">${F.money(f.realized.toNumber(), { sign: true })}</div>`
            : `<div class="pnl dim">fee ${F.money(f.fee.toNumber())}</div>`}
        </div>
      </div>`).join("");

  // Portfolio summary card
  const eq = W().equity().toNumber();
  const cash = W().portfolio.cash.toNumber();
  const upnl = W().unrealized().toNumber();
  const totalPnl = eq - W().settings.startingCash;

  const summaryHTML = `
    <div class="port-summary">
      <div class="port-stat">
        <div class="ps-k">Equity</div>
        <div class="ps-v num">${F.money(eq)}</div>
      </div>
      <div class="port-stat">
        <div class="ps-k">Cash</div>
        <div class="ps-v num">${F.money(cash)}</div>
      </div>
      <div class="port-stat">
        <div class="ps-k">Unrealized</div>
        <div class="ps-v num ${F.pnlClass(upnl)}">${F.money(upnl, { sign: true })}</div>
      </div>
      <div class="port-stat">
        <div class="ps-k">Total P&amp;L</div>
        <div class="ps-v num ${F.pnlClass(totalPnl)}">${F.money(totalPnl, { sign: true })}</div>
      </div>
    </div>`;

  const body = `
    ${summaryHTML}
    <div class="book-section">
      <div class="book-head">Positions <span class="count-badge">${positions.length}</span></div>
      <div id="positions">${posHTML}</div>
    </div>
    <div class="book-section">
      <div class="book-head">Working Orders <span class="count-badge">${wo.length}</span></div>
      <div id="orders">${ordersHTML}</div>
    </div>
    <div class="book-section">
      <div class="book-head">Recent Fills</div>
      <div id="blotter">${blotterHTML}</div>
    </div>`;

  overlay.innerHTML = screenShell("Portfolio", body);
  document.getElementById("backBtn")!.onclick = closeScreen;

  overlay.querySelectorAll<HTMLElement>("[data-close]").forEach((b) => b.onclick = () => {
    closePosition(b.dataset.close!);
    renderBookScreen();
  });
  overlay.querySelectorAll<HTMLElement>("[data-cancel]").forEach((b) => b.onclick = () => {
    store.cancel(b.dataset.cancel!);
    refresh();
    renderBookScreen();
  });
}

function closePosition(key: string) {
  const p = W().portfolio.get(key);
  if (!p) return;
  const side: Side = p.qty > 0 ? "sell" : "buy";
  store.submit({ target: p.target, side, qty: Math.abs(p.qty), type: "market", tif: "DAY" });
  if (W().mode === "live") toast("Position closed", "gain");
  else toast("Close order placed — fills next bar");
  refresh();
}

// ─── Time Controls ────────────────────────────────────────────────────────────
function wireTime() {
  // In live mode the real clock drives the world — manual advance is disabled.
  if (store.live) { setAdvButtons(false); return; }
  document.querySelectorAll<HTMLElement>("[data-adv]").forEach((b) => b.onclick = () => {
    if (state.scrubbing || store.live) return;
    const kind = b.dataset.adv!;
    const from = W().now;
    let target = from;
    if (kind === "h") target = ceilTo(from + 3600_000, 3600_000);
    else if (kind === "d") target = from + 86400_000;
    else target = from + 30 * 86400_000;
    animateAdvance(from, target);
  });
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
  const priceEl = document.getElementById("topbarPrice");
  const bars = visibleBars();
  if (priceEl && bars.length) {
    const last = bars[bars.length - 1]!;
    const prev = bars.length > 1 ? bars[bars.length - 2]!.c : last.o;
    const chg = (last.c - prev) / prev;
    priceEl.innerHTML = `
      <div class="px num">${F.priceFmt(last.c)}</div>
      <div class="chg num ${F.pnlClass(chg)}">${F.glyph(chg)} ${F.pct(chg)}</div>`;
  }

  const cash = W().portfolio.cash.toNumber();
  const eq = W().equity().toNumber();
  const qbBp = document.getElementById("qbBp");
  if (qbBp) qbBp.textContent = F.money(cash);
  const qbEq = document.getElementById("qbEq");
  if (qbEq) qbEq.textContent = F.money(eq);

  const acctEl = document.getElementById("topbarAcct");
  if (acctEl) {
    const totalPnl = eq - W().settings.startingCash;
    acctEl.innerHTML = `
      <div class="acct-item"><span class="k">Cash</span><span class="v num">${F.money(cash)}</span></div>
      <div class="acct-item"><span class="k">Equity</span><span class="v num">${F.money(eq)}</span></div>
      <div class="acct-item"><span class="k">P&amp;L</span><span class="v num ${F.pnlClass(totalPnl)}">${F.money(totalPnl, { sign: true })}</span></div>`;
  }

  const tl = document.getElementById("timeLabel");
  if (tl) tl.textContent = store.live ? `◷ ${F.dateLabel(W().now)} · streaming` : `◷ ${F.dateLabel(W().now)}`;
  const mp = document.getElementById("modePill");
  if (mp) {
    if (store.live) {
      mp.textContent = "● LIVE";
      mp.className = "mode-pill live";
      mp.style.display = "";
    } else {
      mp.textContent = "";
      mp.className = "mode-pill";
      mp.style.display = "none";
    }
  }
}

function refresh() {
  updateHeader();
  renderSymbolTabs();
  if (state.screen === "book") renderBookScreen();
}

// ─── Profile Panel ────────────────────────────────────────────────────────────
function openProfile() {
  state.profileOpen = true;
  const panel = document.getElementById("profilePanel")!;
  const backdrop = document.getElementById("panelBackdrop")!;
  renderProfilePanel();
  panel.classList.add("open");
  backdrop.classList.add("show");
}

function closeAllPanels() {
  state.profileOpen = false;
  document.getElementById("profilePanel")?.classList.remove("open");
  document.getElementById("panelBackdrop")?.classList.remove("show");
}

function renderProfilePanel() {
  const panel = document.getElementById("profilePanel")!;
  const profiles = Store.listProfiles();
  const activeId = store.profileId;

  panel.innerHTML = `
    <div class="pp-header">
      <span class="pp-title">Profiles</span>
      <button class="icon-btn" id="ppClose">✕</button>
    </div>
    <div class="pp-list">
      ${profiles.map((p) => `
        <div class="pp-item ${p.id === activeId ? "active" : ""}">
          <div class="pp-avatar">${p.name[0]?.toUpperCase()}</div>
          <div class="pp-info">
            <div class="pp-name">${p.name}</div>
            ${p.id === activeId ? `<div class="pp-sub">Active</div>` : ""}
          </div>
          ${p.id !== activeId ? `<button class="pp-switch" data-switch="${p.id}">Switch</button>` : ""}
          ${profiles.length > 1 ? `<button class="pp-del" data-del="${p.id}" title="Delete">✕</button>` : ""}
        </div>`).join("")}
    </div>
    <button class="pp-create" id="ppCreate">+ New Profile</button>`;

  document.getElementById("ppClose")!.onclick = closeAllPanels;
  panel.querySelectorAll<HTMLElement>("[data-switch]").forEach((b) => b.onclick = () => {
    Store.switchProfile(b.dataset.switch!);
    window.location.reload();
  });
  panel.querySelectorAll<HTMLElement>("[data-del]").forEach((b) => b.onclick = () => {
    if (confirm("Delete this profile? All its data will be lost.")) {
      Store.deleteProfile(b.dataset.del!);
      if (b.dataset.del === activeId) { window.location.reload(); return; }
      renderProfilePanel();
    }
  });
  document.getElementById("ppCreate")!.onclick = () => {
    const name = prompt("Profile name:", "New Profile");
    if (name) { Store.createProfile(name); window.location.reload(); }
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

  // Open option positions for this underlying
  const positions = [...W().portfolio.positions.values()].filter(
    (pos) => pos.target.kind === "option" && pos.option?.underlying === sym()
  );

  const rows = (() => {
    const strikes = exp.calls.map((c) => c.spec.strike);
    return strikes.map((k) => {
      const c = exp.calls.find((x) => x.spec.strike === k)!;
      const pu = exp.puts.find((x) => x.spec.strike === k)!;
      const isAtm = k === exp.atmStrike;
      const cItm = p.spot > k, pItm = p.spot < k;
      return `<tr class="${isAtm ? "atm" : ""}">
        <td class="${cItm ? "itm" : ""} buyc" data-opt="call:${k}">${c.bid.toFixed(2)} / ${c.ask.toFixed(2)}</td>
        <td class="${cItm ? "itm" : ""}">${c.greeks.delta.toFixed(2)}</td>
        <td class="${cItm ? "itm" : ""} dim">${(c.iv * 100).toFixed(0)}%</td>
        <td class="strike">${F.priceFmt(k)}</td>
        <td class="${pItm ? "itm" : ""} dim">${(pu.iv * 100).toFixed(0)}%</td>
        <td class="${pItm ? "itm" : ""}">${pu.greeks.delta.toFixed(2)}</td>
        <td class="${pItm ? "itm" : ""} buyc" data-opt="put:${k}">${pu.bid.toFixed(2)} / ${pu.ask.toFixed(2)}</td>
      </tr>`;
    }).join("");
  })();

  const resolve = W().markResolver();
  const openPositionsHTML = positions.length === 0 ? "" : `
    <h3 class="section-head">Open Option Positions</h3>
    ${positions.map((pos) => {
      const mark = resolve(pos)?.toNumber() ?? 0;
      const upnl = W().portfolio.unrealized(pos, resolve).toNumber();
      const opt = pos.option!;
      return `<div class="book-row" style="margin-bottom:6px">
        <div class="book-row-info">
          <div class="book-sym">${opt.underlying.replace("-USD", "")} ${opt.strike}${opt.right[0]!.toUpperCase()} ${F.dayLabel(opt.expiry)}</div>
          <div class="sub-text">${pos.qty > 0 ? "Long" : "Short"} ${Math.abs(pos.qty)} × avg ${F.money(pos.avgCost.toNumber())}</div>
        </div>
        <div class="book-row-pnl">
          <div class="book-mark">${F.priceFmt(mark)}</div>
          <div class="pnl ${F.pnlClass(upnl)}">${F.money(upnl, { sign: true })}</div>
        </div>
        <div class="book-row-actions">
          <button class="action-btn close-btn" data-close="${pos.key}">Close</button>
        </div>
      </div>`;
    }).join("")}`;

  const body = `
    <div class="card">
      <div class="row-between">
        <div>
          <div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.06em">${sym()} Spot</div>
          <div class="num" style="font-size:28px;font-weight:700;margin-top:2px">${F.priceFmt(p.spot)}</div>
        </div>
        <div class="dim" style="font-size:11px;text-align:right">
          ${inst().assetClass === "equity" ? "American · physically settled" : "European · cash settled"}<br>
          Tap bid/ask to buy 1 contract
        </div>
      </div>
    </div>
    ${openPositionsHTML}
    <div class="chain-tabs">${chain.expiries.map((e, i) =>
      `<button class="chip ${i === state.optExpiryIdx ? "active" : ""}" data-exp="${i}">${F.dayLabel(e.expiry)}</button>`
    ).join("")}</div>
    <table class="chain">
      <thead><tr><th>Call b/a</th><th>Δ</th><th>IV</th><th>Strike</th><th>IV</th><th>Δ</th><th>Put b/a</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <h3 class="section-head" style="margin-top:20px">Strategy Builder</h3>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
      ${["Long Straddle", "Strangle", "Bull Call Spread", "Iron Condor"].map(
        (s) => `<button class="chip" data-strat="${s}">${s}</button>`
      ).join("")}
    </div>
    <div id="stratOut"></div>`;

  overlay.innerHTML = screenShell(`Options — ${sym()}`, body);
  document.getElementById("backBtn")!.onclick = closeScreen;

  overlay.querySelectorAll<HTMLElement>("[data-exp]").forEach((b) => b.onclick = () => {
    state.optExpiryIdx = +b.dataset.exp!;
    renderOptionsScreen();
  });
  overlay.querySelectorAll<HTMLElement>("[data-opt]").forEach((b) => b.onclick = () => {
    const [right, k] = b.dataset.opt!.split(":");
    const q = (right === "call" ? exp.calls : exp.puts).find((x) => x.spec.strike === +k!)!;
    tradeOption(q);
  });
  overlay.querySelectorAll<HTMLElement>("[data-strat]").forEach((b) =>
    b.onclick = () => buildStrategy(b.dataset.strat!, exp, p.spot));
  overlay.querySelectorAll<HTMLElement>("[data-close]").forEach((b) => b.onclick = () => {
    closePosition(b.dataset.close!);
    renderOptionsScreen();
  });
}

function tradeOption(q: OptionQuote) {
  const res = store.submit({ target: { kind: "option", symbol: q.spec.underlying, option: q.spec }, side: "buy", qty: 1, type: "market", tif: "DAY" });
  if (!res.ok) { toast(res.reason ?? "Rejected", "loss"); return; }
  toast(W().mode === "live" ? "Option filled" : "Option order — fills next bar", "gain");
  refresh();
  renderOptionsScreen();
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
  };
}

// ─── Stats Screen ─────────────────────────────────────────────────────────────
function renderStatsScreen() {
  const overlay = overlayEl();
  const r = analytics(W());
  const totalPnl = Number(r.totalPnl);
  const body = `
    <div class="card">
      <div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.06em">Total Equity</div>
      <div class="num" style="font-size:32px;font-weight:700;margin-top:4px">${F.money(r.equity)}</div>
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
      ${stat("Max Drawdown", F.money(Number(r.drawdown.maxDrawdown)) + ` (${(r.drawdown.maxDrawdownPct * 100).toFixed(1)}%)`, "loss")}
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

// ─── Learn Screen ─────────────────────────────────────────────────────────────
function renderLearnScreen() {
  const overlay = overlayEl();
  if (!getCurriculum(W())) {
    overlay.innerHTML = screenShell("Learn", `<div class="empty" style="padding:24px">Help is disabled. Enable Help in Settings to access the learning track.</div>`);
    document.getElementById("backBtn")!.onclick = closeScreen;
    return;
  }
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
  document.getElementById("backBtn")!.onclick = closeScreen;
  overlay.querySelectorAll<HTMLElement>("[data-mod]").forEach((b) => b.onclick = () => {
    state.learnModule = b.dataset.mod!;
    renderModule(b.dataset.mod!);
  });
}

function renderModule(id: string) {
  const overlay = overlayEl();
  const m = CURRICULUM.find((x) => x.id === id)!;
  const answers: Record<string, number> = {};
  const body = `
    ${m.lessons.map((l) => `
      <div class="card"><strong>${l.title}</strong>
        <div class="lesson-body">${l.body}</div>
      </div>`).join("")}
    <h3 style="margin:16px 0 10px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-3)">Quiz — pass ≥ ${(m.passThreshold * 100).toFixed(0)}%</h3>
    <div id="quiz">
      ${m.quiz.map((q) => `
        <div class="card" data-q="${q.id}">
          <strong>${q.prompt}</strong>
          ${q.options.map((o, i) => `<button class="quiz-opt" data-pick="${q.id}:${i}">${o}</button>`).join("")}
        </div>`).join("")}
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
    renderNav();
  };
}

// ─── Settings Screen ──────────────────────────────────────────────────────────
function renderSettingsScreen() {
  const overlay = overlayEl();
  const s = W().settings;
  const body = `
    <div class="card">
      ${toggleRow("Live market prices", "Crypto prices update from Coinbase in real time. Off = historical simulation.", store.live, "liveMode")}
      ${toggleRow("Help & Learning", "Enable the options learning track and terminal commentary.", s.helpEnabled, "helpEnabled")}
      ${toggleRow("Fee & spread realism", "Model bid/ask spread, slippage and fees on fills.", s.feeRealism, "feeRealism")}
      ${toggleRow("Light theme", "Switch to the light appearance.", store.ui.theme === "light", "theme")}
    </div>
    <div class="card">
      <div class="set-row">
        <div class="label"><div>Add funds</div><div class="sub">Current cash: ${F.money(W().portfolio.cash.toNumber())}</div></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:4px">
        <input class="input num" id="depAmt" inputmode="decimal" placeholder="500" style="max-width:140px">
        <button class="adv-btn" id="depBtn">Deposit</button>
      </div>
    </div>
    <div class="card">
      <div class="set-row">
        <div class="label"><div>Risk-free rate</div><div class="sub">Used for option pricing (BSM/BAW)</div></div>
        <input class="input num" id="rfr" style="width:72px" value="${(s.riskFreeRate * 100).toFixed(1)}">
      </div>
    </div>
    <div class="card">
      <div class="set-row" style="border-bottom:none;padding-bottom:6px">
        <div class="label"><div>Reset account</div><div class="sub">Wipe portfolio, orders and clock to a fresh start.</div></div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <input class="input num" id="resetCash" style="max-width:140px" value="${Math.round(W().settings.startingCash)}" placeholder="1000">
        <button class="adv-btn" id="resetBtn" style="color:var(--loss);border-color:var(--loss);margin-left:auto">Reset</button>
      </div>
    </div>
    <div class="card">
      <strong>About ORION</strong>
      <div class="lesson-body">
        ORION uses historical and/or delayed market data for trading practice.
        It holds no real funds and places no real orders. All prices, fills, options and
        Greeks are modeled — not financial advice.
      </div>
    </div>`;

  overlay.innerHTML = screenShell("Settings", body);
  document.getElementById("backBtn")!.onclick = closeScreen;
  overlay.querySelectorAll<HTMLElement>("[data-toggle]").forEach((b) => b.onclick = () => onToggle(b.dataset.toggle!));
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
  if (key === "helpEnabled") { store.updateSettings({ helpEnabled: !W().settings.helpEnabled }); renderNav(); }
  else if (key === "feeRealism") store.updateSettings({ feeRealism: !W().settings.feeRealism });
  else if (key === "liveMode") {
    if (store.live) {
      store.ui.livePref = false;
      store.saveUi();
      store.disableLive();
      toast("Simulation mode");
    } else {
      store.ui.livePref = true;
      store.saveUi();
      void store.enableLive().then(() => {
        if (store.live) { toast("Live prices active", "gain"); }
        else { toast("Could not connect — staying in simulation"); }
        renderNav();
        renderSettingsScreen();
        refresh();
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
  renderNav();
  refresh();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function toast(msg: string, cls = "") {
  const t = document.getElementById("toast")!;
  t.className = `toast show ${cls}`;
  t.textContent = msg;
  setTimeout(() => (t.className = "toast"), 2500);
}

function ceilTo(t: number, step: number) { return Math.ceil(t / step) * step; }

// Toggle the live Coinbase feed. On enable, fetch real prices, rebuild the
// world, and re-render the trade surface; on failure, surface the reason and
// stay in the simulator.
async function toggleLive() {
  if (store.live) {
    store.disableLive();
    store.onLiveTick = null;
    toast("Live data off — back to simulator");
    if (store.ui.symbol && !W().universe.has(store.ui.symbol)) store.ui.symbol = "BTC-USD";
    renderShell();
    return;
  }
  // Live streams crypto — focus a crypto symbol so the chart shows live bars.
  if (!isLiveSymbol(store.ui.symbol)) { store.ui.symbol = "BTC-USD"; store.saveUi(); }
  toast("Connecting to live market data…");
  try {
    await store.enableLive();
    store.onLiveTick = onLiveTick;
    renderShell();
    toast("Live market data on", "gain");
  } catch (e) {
    toast("Couldn't reach live data — staying in simulator", "loss");
    console.warn("Live data failed:", e);
    renderSettingsScreen();
  }
}

function onLiveTick() {
  if (state.screen === "trade") chart.setData(visibleBars());
  refresh();
}

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
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="5" cy="17" r="2" fill="var(--accent)"/>
      <circle cx="12" cy="11" r="2" fill="var(--accent)" opacity="0.75"/>
      <circle cx="19" cy="5" r="2" fill="var(--accent)" opacity="0.5"/>
      <path d="M5 17L12 11L19 5" stroke="var(--accent)" stroke-width="1.3" stroke-linecap="round" opacity="0.35"/>
    </svg>
    <span class="wordmark">ORION</span>
  </div>`;
}

function tradeIcon() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">
    <polyline points="3,17 7,11 11,14 15,7 21,7"/>
    <polyline points="17,7 21,7 21,11"/>
  </svg>`;
}

function bookIcon() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2"/>
    <line x1="3" y1="9" x2="21" y2="9"/>
    <line x1="3" y1="15" x2="21" y2="15"/>
    <line x1="9" y1="9" x2="9" y2="21"/>
  </svg>`;
}

function optionsIcon() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
    <path d="M4.9 4.9l2.1 2.1M16.9 16.9l2.1 2.1M19.1 4.9l-2.1 2.1M7.1 16.9l-2.1 2.1"/>
  </svg>`;
}

function statsIcon() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/>
  </svg>`;
}

function learnIcon() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
  </svg>`;
}

function settingsIcon() {
  return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06-.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>`;
}

boot();
