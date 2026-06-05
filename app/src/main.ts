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
import { Chart } from "./ui/chart.ts";
import { drawEquityCurve, drawPayoff } from "./ui/canvas.ts";
import * as F from "./ui/format.ts";

const store = new Store();
const app = document.getElementById("app")!;
let chart: Chart;

type Screen = "trade" | "options" | "stats" | "learn" | "settings";

const state = {
  screen: "trade" as Screen,
  tf: "1h" as Resolution,
  form: { side: "buy" as Side, type: "market" as OrderType, qty: "", limit: "", stop: "", trail: "" },
  optExpiryIdx: 0,
  drawerTab: "trade" as "trade" | "scan" | "book",
  drawerOpen: false,
  scrubbing: false,
  learnModule: null as string | null,
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

// ─── Boot ───────────────────────────────────────────
function boot() {
  document.documentElement.setAttribute("data-theme", store.ui.theme);
  if (!store.ui.onboarded) { renderSplash(); return; }
  renderShell();
}

function renderSplash() {
  app.innerHTML = `
    <div class="splash">
      <div class="splash-inner">
        ${brandLogoLarge()}
        <h1>ORION</h1>
        <div class="splash-sub">Real charts. Your clock. An unknown future.</div>
        <button class="cta" id="begin">Enter ORION</button>
        <div class="legal-mini">
          Uses historical and/or delayed market data for practice trading.<br>
          Not a brokerage. Not financial advice.
        </div>
      </div>
    </div>`;
  document.getElementById("begin")!.onclick = () => {
    store.ui.onboarded = true;
    store.saveUi();
    renderShell();
  };
}

// The shell is persistent: topbar + sidebar never unmount. Only #content swaps,
// and overlay screens cover the content region only — the nav stays put.
function renderShell() {
  app.innerHTML = `
    <div class="topbar">
      <div class="topbar-brand">${brandMark()}</div>
      <div class="topbar-syms" id="topbarSyms"></div>
      <div class="topbar-price" id="topbarPrice"></div>
      <div class="topbar-acct" id="topbarAcct"></div>
    </div>
    <div class="workspace">
      <nav class="sidebar" id="sidebar"></nav>
      <main class="content">
        <div class="trade-view">
          <div class="chart-area">
            <div class="chart-toolbar" id="chartToolbar"></div>
            <div class="chart-wrap"><canvas id="chart"></canvas></div>
            <div class="timebar">
              <span class="time-label" id="timeLabel"></span>
              <span class="mode-pill" id="modePill"></span>
              <button class="adv-btn" data-adv="h">+1H</button>
              <button class="adv-btn" data-adv="d">+1D</button>
              <button class="adv-btn" data-adv="m">+30D</button>
            </div>
          </div>
          <aside class="drawer" id="drawer">
            <div class="drawer-header">
              <div class="drawer-tabs" id="drawerTabs"></div>
              <button class="drawer-close" id="drawerClose">✕</button>
            </div>
            <div class="drawer-body" id="drawerBody"></div>
          </aside>
        </div>
        <div id="overlay"></div>
      </main>
    </div>
    <div class="toast" id="toast"></div>`;

  chart = new Chart(document.getElementById("chart") as HTMLCanvasElement);
  chart.setData(visibleBars(), { resetView: true });
  applyIndicators();

  renderSidebar();
  renderSymbolTabs();
  renderChartToolbar();
  renderDrawerTabs();
  renderDrawerBody();
  wireTime();
  wireDrawerClose();
  // Restore the active screen overlay if not on trade.
  if (state.screen !== "trade") mountScreen(state.screen);
  refresh();
}

// ─── Sidebar Navigation ─────────────────────────────
function renderSidebar() {
  const sidebar = document.getElementById("sidebar")!;
  const showLearn = W().settings.helpEnabled;
  const items: [Screen, string, string][] = [
    ["trade", "Trade", tradeIcon()],
    ["options", "Options", optionsIcon()],
    ["stats", "Statistics", statsIcon()],
  ];
  if (showLearn) items.push(["learn", "Learn", learnIcon()]);

  sidebar.innerHTML = `
    ${items.map(([s, tip, icon]) => `
      <button class="nav-btn ${state.screen === s ? "active" : ""}" data-nav="${s}" aria-label="${tip}">
        ${icon}
        <span class="nav-tip">${tip}</span>
      </button>`).join("")}
    <div class="sidebar-sep"></div>
    <div class="sidebar-spacer"></div>
    <button class="nav-btn ${state.screen === "settings" ? "active" : ""}" data-nav="settings" aria-label="Settings">
      ${settingsIcon()}
      <span class="nav-tip">Settings</span>
    </button>`;

  sidebar.querySelectorAll<HTMLElement>("[data-nav]").forEach((b) =>
    b.onclick = () => navigate(b.dataset.nav as Screen));
}

// ─── Symbol Tabs ────────────────────────────────────
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
    refresh();
  });
}

// ─── Chart Toolbar ───────────────────────────────────
function renderChartToolbar() {
  const toolbar = document.getElementById("chartToolbar");
  if (!toolbar) return;
  const tfs: Resolution[] = ["1m", "1h", "1d"];
  const inds: [keyof typeof ind, string][] = [["bb", "BB"], ["sma", "SMA 50"], ["ema", "EMA 20"], ["vwap", "VWAP"]];

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
  document.getElementById("termBtn")!.onclick = openScanTab;
}

function applyIndicators() {
  if (!chart) return;
  chart.setConfig({ sma: ind.sma ? [50] : [], ema: ind.ema ? [20] : [], bollinger: ind.bb, vwap: ind.vwap });
}

// ─── Drawer ──────────────────────────────────────────
function renderDrawerTabs() {
  const tabs = document.getElementById("drawerTabs");
  if (!tabs) return;
  const list = [
    { id: "trade", label: "Trade" },
    { id: "scan", label: "◈ Scan" },
    { id: "book", label: "Book" },
  ];
  tabs.innerHTML = list.map((t) =>
    `<button class="drawer-tab ${state.drawerTab === t.id ? "active" : ""}" data-tab="${t.id}">${t.label}</button>`
  ).join("");
  tabs.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) => b.onclick = () => {
    state.drawerTab = b.dataset.tab as typeof state.drawerTab;
    renderDrawerTabs();
    renderDrawerBody();
  });
}

function renderDrawerBody() {
  const body = document.getElementById("drawerBody");
  if (!body) return;
  if (state.drawerTab === "trade") {
    body.innerHTML = ticketHTML();
    wireTicket();
    updatePreview();
  } else if (state.drawerTab === "scan") {
    body.innerHTML = scanHTML();
  } else {
    body.innerHTML = bookHTML();
    wireBook();
  }
}

function openScanTab() {
  state.drawerTab = "scan";
  state.drawerOpen = true;
  document.getElementById("drawer")!.classList.add("open");
  renderDrawerTabs();
  renderDrawerBody();
}

function wireDrawerClose() {
  document.getElementById("drawerClose")!.onclick = () => {
    state.drawerOpen = false;
    document.getElementById("drawer")!.classList.remove("open");
  };
}

// ─── Order Ticket ────────────────────────────────────
function ticketHTML(): string {
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

function wireTicket() {
  document.querySelectorAll<HTMLElement>("[data-side]").forEach((b) => b.onclick = () => {
    state.form.side = b.dataset.side as Side;
    renderDrawerBody();
  });
  const typeSel = document.getElementById("typeSel") as HTMLSelectElement | null;
  if (typeSel) typeSel.onchange = () => { state.form.type = typeSel.value as OrderType; renderDrawerBody(); };
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
  const bp = W().buyingPower().toNumber();
  const after = state.form.side === "buy" ? bp - notional - fee : bp;
  const preview = document.getElementById("preview");
  if (preview) preview.innerHTML = `
    <div class="row"><span class="k">Est. price</span><span class="num">${estPrice ? F.priceFmt(estPrice) : "—"}</span></div>
    <div class="row"><span class="k">Notional</span><span class="num">${F.money(notional)}</span></div>
    <div class="row"><span class="k">Est. fee</span><span class="num">${F.money(fee)}</span></div>
    <div class="row"><span class="k">Buying power</span><span class="num">${F.money(bp)}</span></div>
    <div class="row"><span class="k">After trade</span><span class="num ${after < 0 ? "loss" : ""}">${F.money(after)}</span></div>`;
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
  if (W().mode === "live") toast("Order filled", "gain");
  else toast(req.type === "market" ? "Market order placed — fills next bar" : "Order working");
  renderDrawerBody();
  refresh();
}

// ─── Scan Panel ──────────────────────────────────────
function scanHTML(): string {
  const s = scan(W(), sym(), state.tf);
  const help = W().settings.helpEnabled;
  return `<div class="scan-panel">
    <div class="scan-head">◈ TERMINAL — ${sym()} ${s.timeframe}</div>
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
    ${help
      ? s.callouts.slice(0, 4).map((c) => `
        <div class="callout ${c.severity}">
          <div class="t">${c.title}</div>
          <div class="d">${c.detail}</div>
          <div class="lesson">↪ Lesson: ${c.lessonId}</div>
        </div>`).join("")
      : `<div class="empty mt">Help is off — pure analysis mode. Enable Help in Settings for plain-English commentary.</div>`}
  </div>`;
}

// ─── Book ────────────────────────────────────────────
function bookHTML(): string {
  const resolve = W().markResolver();
  const pos = [...W().portfolio.positions.values()];
  const wo = W().workingOrders();
  const fills = W().fills.slice(-8).reverse();

  const posHTML = pos.length === 0
    ? `<div class="empty">No open positions.</div>`
    : pos.map((p) => {
        const mark = resolve(p)?.toNumber() ?? 0;
        const upnl = W().portfolio.unrealized(p, resolve).toNumber();
        const label = p.target.kind === "option" && p.option
          ? `${p.option.underlying.replace("-USD", "")} ${p.option.strike}${p.option.right[0]!.toUpperCase()}`
          : p.target.symbol.replace("-USD", "");
        return `<div class="li">
          <div>
            <div class="sym">${label}</div>
            <div class="sub-text">${F.qty(p.qty)} @ ${F.priceFmt(p.avgCost.toNumber())}</div>
          </div>
          <div class="right">
            <div class="price">${F.priceFmt(mark)}</div>
            <div class="pnl ${F.pnlClass(upnl)}">${F.glyph(upnl)} ${F.money(upnl, { sign: true })}</div>
          </div>
          <button class="x" data-close="${p.key}">⊗</button>
        </div>`;
      }).join("");

  const ordersHTML = wo.length === 0
    ? `<div class="empty">No working orders.</div>`
    : wo.map((o) => `<div class="li">
        <div>
          <div class="sym">${o.side.toUpperCase()} ${F.qty(o.qty - o.filledQty)} ${(o.target.option?.underlying ?? o.target.symbol).replace("-USD", "")}</div>
          <div class="sub-text">${o.type}${o.limitPrice ? " @ " + F.priceFmt(o.limitPrice) : ""}${o.stopPrice ? " stop " + F.priceFmt(o.stopPrice) : ""}</div>
        </div>
        <button class="x" data-cancel="${o.id}">✕</button>
      </div>`).join("");

  const blotterHTML = fills.length === 0
    ? `<div class="empty">No fills yet.</div>`
    : fills.map((f) => `<div class="li">
        <div>
          <div class="sym">${f.side.toUpperCase()} ${F.qty(f.qty)} ${(f.target.option?.underlying ?? f.target.symbol).replace("-USD", "")}</div>
          <div class="sub-text num">${F.dateLabel(f.at)}</div>
        </div>
        <div class="right">
          <div class="price">${F.priceFmt(f.price.toNumber())}</div>
          ${!f.realized.isZero()
            ? `<div class="pnl ${F.pnlClass(f.realized.toNumber())}">${F.money(f.realized.toNumber(), { sign: true })}</div>`
            : `<div class="pnl dim">fee ${F.money(f.fee.toNumber())}</div>`}
        </div>
      </div>`).join("");

  return `
    <div class="book-section">
      <div class="book-head">Positions</div>
      <div id="positions">${posHTML}</div>
    </div>
    <div class="book-section">
      <div class="book-head">Working Orders</div>
      <div id="orders">${ordersHTML}</div>
    </div>
    <div class="book-section">
      <div class="book-head">Recent Fills</div>
      <div id="blotter">${blotterHTML}</div>
    </div>`;
}

function wireBook() {
  document.querySelectorAll<HTMLElement>("[data-close]").forEach((b) => b.onclick = () => closePosition(b.dataset.close!));
  document.querySelectorAll<HTMLElement>("[data-cancel]").forEach((b) => b.onclick = () => { store.cancel(b.dataset.cancel!); refresh(); });
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

// ─── Time Controls ───────────────────────────────────
function wireTime() {
  document.querySelectorAll<HTMLElement>("[data-adv]").forEach((b) => b.onclick = () => {
    if (state.scrubbing) return;
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
  const dur = 650;
  const t0 = performance.now();
  const ease = (k: number) => 1 - Math.pow(1 - k, 3);
  function frame(now: number) {
    const k = Math.min(1, (now - t0) / dur);
    const inter = Math.round(from + (target - from) * ease(k));
    if (inter > W().now) W().advanceTo(inter, { stepRes: target - from > 2 * 86400_000 ? "1h" : "1m" });
    chart.setData(visibleBars());
    updateHeader();
    if (k < 1) requestAnimationFrame(frame);
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
  chart.setData(visibleBars());
  refresh();
  toast(`Advanced to ${F.dayLabel(W().now)}`);
}

function setAdvButtons(on: boolean) {
  document.querySelectorAll<HTMLButtonElement>("[data-adv]").forEach((b) => (b.disabled = !on));
}

// ─── Header update ───────────────────────────────────
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

  const acctEl = document.getElementById("topbarAcct");
  if (acctEl) {
    const eq = W().equity().toNumber();
    const bp = W().buyingPower().toNumber();
    const upnl = W().unrealized().toNumber();
    const totalPnl = eq - W().settings.startingCash;
    acctEl.innerHTML = `
      <div class="acct-item"><span class="k">Equity</span><span class="v num">${F.money(eq)}</span></div>
      <div class="acct-item"><span class="k">Buying Power</span><span class="v num">${F.money(bp)}</span></div>
      <div class="acct-item"><span class="k">Unrealized</span><span class="v num ${F.pnlClass(upnl)}">${F.money(upnl, { sign: true })}</span></div>
      <div class="acct-item"><span class="k">Total P&amp;L</span><span class="v num ${F.pnlClass(totalPnl)}">${F.money(totalPnl, { sign: true })}</span></div>`;
  }

  const tl = document.getElementById("timeLabel");
  if (tl) tl.textContent = `◷ ${F.dateLabel(W().now)}`;
  const mp = document.getElementById("modePill");
  if (mp) {
    mp.textContent = W().mode === "live" ? "LIVE" : "";
    mp.className = `mode-pill ${W().mode === "live" ? "live" : ""}`;
    mp.style.display = W().mode === "live" ? "" : "none";
  }
}

function refresh() {
  updateHeader();
  renderSymbolTabs();
  if (state.drawerTab === "scan") {
    const body = document.getElementById("drawerBody");
    if (body) body.innerHTML = scanHTML();
  } else if (state.drawerTab === "book") {
    const body = document.getElementById("drawerBody");
    if (body) { body.innerHTML = bookHTML(); wireBook(); }
  } else {
    updatePreview();
  }
}

// ─── Navigation: screens mount into the content overlay only ──
function navigate(s: Screen) {
  state.screen = s;
  if (s === "trade") {
    document.getElementById("overlay")!.innerHTML = "";
    if (window.innerWidth <= 900) {
      state.drawerOpen = true;
      document.getElementById("drawer")!.classList.add("open");
    }
    chart.setData(visibleBars());
    renderSidebar();
    refresh();
    return;
  }
  mountScreen(s);
  renderSidebar();
}

function mountScreen(s: Screen) {
  if (s === "options") renderOptionsScreen();
  else if (s === "stats") renderStatsScreen();
  else if (s === "learn") renderLearnScreen();
  else if (s === "settings") renderSettingsScreen();
}

function closeScreen() { navigate("trade"); }

function screenShell(title: string, body: string): string {
  return `<div class="screen">
    <div class="shead">
      <button class="back" id="backBtn">‹ Back</button>
      <h2>${title}</h2>
    </div>
    <div class="sbody">${body}</div>
  </div>`;
}

function overlayEl() { return document.getElementById("overlay")!; }

// ─── Options Screen ───────────────────────────────────
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

  const body = `
    <div class="card">
      <div class="row-between">
        <div>
          <div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.06em">${sym()} Spot</div>
          <div class="num" style="font-size:28px;font-weight:700;margin-top:2px">${F.priceFmt(p.spot)}</div>
        </div>
        <div class="dim" style="font-size:11px;text-align:right">
          ${inst().assetClass === "equity" ? "American · physically settled" : "European · cash settled"}<br>
          Tap bid/ask to trade 1 contract
        </div>
      </div>
    </div>
    <div class="chain-tabs">${chain.expiries.map((e, i) =>
      `<button class="chip ${i === state.optExpiryIdx ? "active" : ""}" data-exp="${i}">${F.dayLabel(e.expiry)}</button>`
    ).join("")}</div>
    <table class="chain">
      <thead><tr><th>Call b/a</th><th>Δ</th><th>IV</th><th>Strike</th><th>IV</th><th>Δ</th><th>Put b/a</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <h3 style="margin:24px 0 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-3)">Strategy Builder</h3>
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
  overlay.querySelectorAll<HTMLElement>("[data-strat]").forEach((b) => b.onclick = () => buildStrategy(b.dataset.strat!, exp, p.spot));
}

function tradeOption(q: OptionQuote) {
  const res = store.submit({ target: { kind: "option", symbol: q.spec.underlying, option: q.spec }, side: "buy", qty: 1, type: "market", tif: "DAY" });
  if (!res.ok) { toast(res.reason ?? "Rejected", "loss"); return; }
  toast(W().mode === "live" ? "Option filled" : "Option order — fills next bar", "gain");
  refresh();
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

// ─── Stats Screen ─────────────────────────────────────
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
      ${stat("Turnover", r.turnover.toFixed(2) + "x")}
      ${stat("Peak Equity", F.money(Number(r.drawdown.peakEquity)))}
    </div>
    ${r.options.assignments + r.options.exercised + r.options.expiredWorthless > 0 || r.options.avgEntryIv > 0 ? `
    <h3 style="margin:4px 0 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-3)">Options</h3>
    <div class="stat-grid">
      ${stat("Avg Entry IV", (r.options.avgEntryIv * 100).toFixed(0) + "%")}
      ${stat("Theta P&L", F.money(Number(r.options.thetaCapturedOrPaid)), F.pnlClass(Number(r.options.thetaCapturedOrPaid)))}
      ${stat("Exercised", String(r.options.exercised))}
      ${stat("Assigned", String(r.options.assignments))}
    </div>` : ""}
    ${r.byAssetClass.length ? `
    <h3 style="margin:4px 0 10px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--text-3)">By Asset Class</h3>
    <div class="card">${r.byAssetClass.map((b) =>
      `<div class="row-between" style="padding:7px 0;border-bottom:1px solid var(--hairline-2)">
        <span>${b.key}</span>
        <span class="num ${F.pnlClass(Number(b.realized))}">${F.money(Number(b.realized), { sign: true })} <span class="dim">${b.trades} trades</span></span>
      </div>`).join("")}
    </div>` : ""}`;

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

// ─── Learn Screen ─────────────────────────────────────
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
          ${m.checkpoint ? `<span class="badge" style="font-size:10px">Checkpoint</span>` : ""}
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
      <div class="card">
        <strong>${l.title}</strong>
        <div class="lesson-body">${l.body}</div>
        ${l.demo ? `<div class="dim mt" style="font-size:12px">⚡ Interactive: ${l.demo.note} (${l.demo.underlying})</div>` : ""}
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
    renderSidebar();
  };
}

// ─── Settings Screen ──────────────────────────────────
function renderSettingsScreen() {
  const overlay = overlayEl();
  const s = W().settings;
  const body = `
    <div class="card">
      ${toggleRow("Help & Learning", "Terminal teaching notes and the options learning track. Off = pure analytical mode.", s.helpEnabled, "helpEnabled")}
      ${toggleRow("Fee & spread realism", "Model bid/ask spread, slippage and fees on fills.", s.feeRealism, "feeRealism")}
      ${toggleRow("Live crypto mode", "Crypto follows real-time price; orders fill immediately.", W().mode === "live", "liveMode")}
      ${toggleRow("Light theme", "Switch to the light appearance.", store.ui.theme === "light", "theme")}
    </div>
    <div class="card">
      <div class="set-row">
        <div class="label">
          <div>Add funds</div>
          <div class="sub">Current cash: ${F.money(W().portfolio.cash.toNumber())}</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-top:2px">
        <input class="input num" id="depAmt" inputmode="decimal" placeholder="10000" style="max-width:160px">
        <button class="adv-btn" id="depBtn">Deposit</button>
      </div>
    </div>
    <div class="card">
      <div class="set-row">
        <div class="label"><div>Risk-free rate</div><div class="sub">Used for option pricing (BSM/BAW)</div></div>
        <input class="input num" id="rfr" style="width:80px" value="${(s.riskFreeRate * 100).toFixed(1)}">
      </div>
      <div class="set-row">
        <div class="label"><div>Margin multiplier</div><div class="sub">Buying-power leverage</div></div>
        <input class="input num" id="marg" style="width:80px" value="${s.marginMultiplier}">
      </div>
    </div>
    <div class="card">
      <div class="set-row" style="border-bottom:none;padding-bottom:6px">
        <div class="label">
          <div>Reset account</div>
          <div class="sub">Wipe portfolio, orders and clock back to the start, and set a fresh starting bankroll.</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;align-items:center">
        <label class="dim" style="font-size:12px">Starting bankroll</label>
        <input class="input num" id="resetCash" style="max-width:160px" value="${Math.round(W().settings.startingCash)}">
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
  document.getElementById("marg")!.addEventListener("change", (e) => {
    store.updateSettings({ marginMultiplier: parseFloat((e.target as HTMLInputElement).value) || 1 });
    refresh();
  });
  document.getElementById("resetBtn")!.onclick = () => {
    const cash = Math.max(0, parseFloat((document.getElementById("resetCash") as HTMLInputElement).value) || W().settings.startingCash);
    if (confirm(`Reset your account to a ${F.money(cash)} bankroll? This wipes portfolio, orders and clock.`)) {
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
  if (key === "helpEnabled") { store.updateSettings({ helpEnabled: !W().settings.helpEnabled }); renderSidebar(); }
  else if (key === "feeRealism") store.updateSettings({ feeRealism: !W().settings.feeRealism });
  else if (key === "liveMode") store.setMode(W().mode === "live" ? "historical" : "live");
  else if (key === "theme") {
    store.ui.theme = store.ui.theme === "light" ? "dark" : "light";
    store.saveUi();
    document.documentElement.setAttribute("data-theme", store.ui.theme);
    chart.setData(visibleBars()); // repaint with new palette
  }
  renderSettingsScreen();
  refresh();
}

// ─── Helpers ─────────────────────────────────────────
function toast(msg: string, cls = "") {
  const t = document.getElementById("toast")!;
  t.className = `toast show ${cls}`;
  t.textContent = msg;
  setTimeout(() => (t.className = "toast"), 2000);
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
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">
    <line x1="7" y1="4" x2="7" y2="6.5"/>
    <rect x="4.5" y="6.5" width="5" height="7" rx="0.75"/>
    <line x1="7" y1="13.5" x2="7" y2="16"/>
    <line x1="15" y1="7" x2="15" y2="9.5"/>
    <rect x="12.5" y="9.5" width="5" height="6" rx="0.75"/>
    <line x1="15" y1="15.5" x2="15" y2="18"/>
  </svg>`;
}

function optionsIcon() {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M9 19H5a2 2 0 0 1-2-2v-4c0-1.1.9-2 2-2h4"/>
    <path d="M15 5h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-4"/>
    <line x1="12" y1="5" x2="12" y2="19"/>
  </svg>`;
}

function statsIcon() {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="22,12 18,12 15,21 9,3 6,12 2,12"/>
  </svg>`;
}

function learnIcon() {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
  </svg>`;
}

function settingsIcon() {
  return `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="3"/>
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
  </svg>`;
}

boot();
