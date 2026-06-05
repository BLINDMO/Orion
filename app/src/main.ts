// ORION web client — a thin renderer over @orion/sim.
import {
  analytics,
  scan,
  buildChain,
  standardExpiries,
  getCurriculum,
  CURRICULUM,
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

const state = {
  screen: "trade" as "trade" | "options" | "stats" | "learn" | "settings",
  tf: "1h" as Resolution,
  form: { side: "buy" as Side, type: "market" as OrderType, qty: "", limit: "", stop: "", trail: "" },
  optExpiryIdx: 0,
  rightOpen: false,
  scrubbing: false,
  learnModule: null as string | null,
};

const W = () => store.world;
const sym = () => store.ui.symbol;
const inst = () => W().universe.get(sym());

function visibleBars() {
  const id = W().data.get(sym())!;
  const res: Resolution = id.has(state.tf) ? state.tf : "1h";
  return id.get(res).visible(W().now).slice();
}

// ---------------------------------------------------------------- bootstrap
function boot() {
  document.documentElement.setAttribute("data-theme", store.ui.theme);
  if (!store.ui.onboarded) { renderOnboarding(); return; }
  renderShell();
}

function renderOnboarding() {
  app.innerHTML = `
    <div class="screen"><div class="sbody" style="display:flex">
      <div class="onb">
        ${brandGlyph(64)}
        <h1>ORION</h1>
        <div class="tag">A high-fidelity market simulator. Real charts. Your clock. An unknown future.</div>
        <div class="disclosure">
          <strong>Educational simulation.</strong> ORION is a trading <em>simulator</em> using
          historical and/or delayed market data. It is <strong>not a brokerage</strong>, holds no
          real funds, and places no real orders. Nothing here is financial advice. Prices, fills and
          options are modeled for learning and practice only.
        </div>
        <button class="cta" id="begin">Enter ORION</button>
        <div class="dim mt" style="font-size:12px">You control the bankroll and the flow of time. There is no game over.</div>
      </div>
    </div></div>`;
  document.getElementById("begin")!.onclick = () => { store.ui.onboarded = true; store.saveUi(); renderShell(); };
}

function renderShell() {
  app.innerHTML = `
    <div class="topbar">
      <div class="brand">${brandGlyph(18)}<span>ORION</span></div>
      <div class="acct" id="acct"></div>
    </div>
    <div class="main">
      <div class="col left">
        <div class="chart-head">
          <div class="sym-pick" id="symPick"></div>
          <div class="price-tag" id="priceTag"></div>
        </div>
        <div class="chart-head" style="padding-top:0;gap:6px">
          <div class="sym-pick" id="tfPick"></div>
          <div class="sym-pick" id="indPick" style="margin-left:auto"></div>
        </div>
        <div class="chart-wrap">
          <button class="terminal-btn" id="termBtn">◈ TERMINAL</button>
          <canvas id="chart"></canvas>
        </div>
        <div class="timebar">
          <span class="now num" id="nowLabel"></span>
          <button class="tbtn" data-adv="h">+1H</button>
          <button class="tbtn" data-adv="d">+1D</button>
          <button class="tbtn" data-adv="m">+30D</button>
        </div>
      </div>
      <div class="col right ${state.rightOpen ? "open" : ""}" id="right"></div>
    </div>
    <div class="nav" id="nav"></div>
    <div class="toast" id="toast"></div>
    <div id="overlay"></div>`;

  chart = new Chart(document.getElementById("chart") as HTMLCanvasElement);
  chart.setData(visibleBars(), { resetView: true });

  renderSymbolPicker();
  renderTfPicker();
  renderIndicatorPicker();
  renderRight();
  renderNav();
  wireTime();
  document.getElementById("termBtn")!.onclick = () => { state.rightOpen = true; renderRight(); scrollToScan(); };
  refresh();
}

// ---------------------------------------------------------------- pickers
function renderSymbolPicker() {
  const wrap = document.getElementById("symPick")!;
  const syms = W().universe.list();
  wrap.innerHTML = syms.map((i) => `<button class="chip ${i.symbol === sym() ? "active" : ""}" data-sym="${i.symbol}">${i.symbol.replace("-USD", "")}</button>`).join("");
  wrap.querySelectorAll<HTMLElement>("[data-sym]").forEach((b) => b.onclick = () => {
    store.ui.symbol = b.dataset.sym!; store.saveUi();
    renderSymbolPicker(); chart.setData(visibleBars(), { resetView: true }); renderRight(); refresh();
  });
}
function renderTfPicker() {
  const wrap = document.getElementById("tfPick")!;
  const tfs: Resolution[] = ["1m", "1h", "1d"];
  wrap.innerHTML = tfs.map((t) => `<button class="chip tf ${t === state.tf ? "active" : ""}" data-tf="${t}">${t.toUpperCase()}</button>`).join("");
  wrap.querySelectorAll<HTMLElement>("[data-tf]").forEach((b) => b.onclick = () => {
    state.tf = b.dataset.tf as Resolution; renderTfPicker(); chart.setData(visibleBars(), { resetView: true }); refresh();
  });
}
let ind = { sma: true, ema: true, bb: true, vwap: false };
function renderIndicatorPicker() {
  const wrap = document.getElementById("indPick")!;
  const items: [keyof typeof ind, string][] = [["sma", "SMA"], ["ema", "EMA"], ["bb", "BB"], ["vwap", "VWAP"]];
  wrap.innerHTML = items.map(([k, l]) => `<button class="chip tf ${ind[k] ? "active" : ""}" data-ind="${k}">${l}</button>`).join("");
  wrap.querySelectorAll<HTMLElement>("[data-ind]").forEach((b) => b.onclick = () => {
    const k = b.dataset.ind as keyof typeof ind; ind[k] = !ind[k]; renderIndicatorPicker(); applyIndicators();
  });
  applyIndicators();
}
function applyIndicators() {
  chart.setConfig({ sma: ind.sma ? [50] : [], ema: ind.ema ? [20] : [], bollinger: ind.bb, vwap: ind.vwap });
}

// ---------------------------------------------------------------- right column (ticket + book + scan)
function renderRight() {
  const right = document.getElementById("right")!;
  right.className = `col right ${state.rightOpen ? "open" : ""}`;
  right.innerHTML = `
    <div class="panel">
      <div class="row-between"><h3 style="margin:0">Order Ticket — ${sym()}</h3>
        <button class="x" id="closeRight" style="display:none">✕</button></div>
      <div class="seg ${state.form.side}" id="sideSeg" style="margin-top:10px">
        <button data-side="buy" class="${state.form.side === "buy" ? "on" : ""}">Buy</button>
        <button data-side="sell" class="${state.form.side === "sell" ? "on" : ""}">Sell</button>
      </div>
      <div class="field"><label>Order type</label>
        <select class="input" id="typeSel">
          ${(["market", "limit", "stop", "stop-limit", "trailing-stop"] as OrderType[]).map((t) => `<option value="${t}" ${t === state.form.type ? "selected" : ""}>${t}</option>`).join("")}
        </select></div>
      <div class="field"><label>Quantity (${inst().assetClass === "crypto" ? "units" : "shares"})</label>
        <input class="input num" id="qty" inputmode="decimal" placeholder="0" value="${state.form.qty}"></div>
      <div class="field ${["limit", "stop-limit"].includes(state.form.type) ? "" : "hidden"}" id="limitField"><label>Limit price</label>
        <input class="input num" id="limit" inputmode="decimal" value="${state.form.limit}"></div>
      <div class="field ${["stop", "stop-limit"].includes(state.form.type) ? "" : "hidden"}" id="stopField"><label>Stop price</label>
        <input class="input num" id="stop" inputmode="decimal" value="${state.form.stop}"></div>
      <div class="field ${state.form.type === "trailing-stop" ? "" : "hidden"}" id="trailField"><label>Trail %</label>
        <input class="input num" id="trail" inputmode="decimal" placeholder="5" value="${state.form.trail}"></div>
      <div class="preview" id="preview"></div>
      <button class="submit ${state.form.side}" id="submitBtn"></button>
      <div class="note" id="note"></div>
    </div>
    <div class="panel" id="scanPanel"></div>
    <div class="panel"><h3>Positions</h3><div class="list" id="positions"></div></div>
    <div class="panel"><h3>Working Orders</h3><div class="list" id="orders"></div></div>
    <div class="panel"><h3>Blotter</h3><div class="list" id="blotter"></div></div>`;

  // wiring
  const close = document.getElementById("closeRight")!;
  if (window.innerWidth <= 920) { close.style.display = "block"; close.onclick = () => { state.rightOpen = false; renderRight(); }; }
  document.querySelectorAll<HTMLElement>("[data-side]").forEach((b) => b.onclick = () => { state.form.side = b.dataset.side as Side; renderRight(); });
  const typeSel = document.getElementById("typeSel") as HTMLSelectElement;
  typeSel.onchange = () => { state.form.type = typeSel.value as OrderType; renderRight(); };
  for (const id of ["qty", "limit", "stop", "trail"] as const) {
    const e = document.getElementById(id) as HTMLInputElement;
    if (e) e.oninput = () => { (state.form as never as Record<string, string>)[id] = e.value; updatePreview(); };
  }
  document.getElementById("submitBtn")!.onclick = doSubmit;
  renderScanPanel();
  updatePreview();
  updateBook();
}

function orderReqFromForm(): { req: import("../../sim/src/index.ts").OrderRequest | null; estPrice: number | undefined } {
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
  const preview = document.getElementById("preview");
  if (!preview) return;
  const after = state.form.side === "buy" ? bp - notional - fee : bp;
  preview.innerHTML = `
    <div class="row"><span class="k">Est. price</span><span class="num">${estPrice ? F.priceFmt(estPrice) : "—"}</span></div>
    <div class="row"><span class="k">Notional</span><span class="num">${F.money(notional)}</span></div>
    <div class="row"><span class="k">Est. fee</span><span class="num">${F.money(fee)}</span></div>
    <div class="row"><span class="k">Buying power</span><span class="num">${F.money(bp)}</span></div>
    <div class="row"><span class="k">After (buy)</span><span class="num ${after < 0 ? "loss" : ""}">${F.money(after)}</span></div>`;
  const btn = document.getElementById("submitBtn") as HTMLButtonElement;
  btn.className = `submit ${state.form.side}`;
  btn.textContent = `${state.form.side === "buy" ? "Buy" : "Sell"} ${qty ? F.qty(qty) : ""} ${sym().replace("-USD", "")}`.trim();
  btn.disabled = !qty;
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
  else toast(`${req.type === "market" ? "Market order placed — fills next bar" : "Order working"}`);
  renderRight(); refresh();
}

function renderScanPanel() {
  const panel = document.getElementById("scanPanel");
  if (!panel) return;
  const s = scan(W(), sym(), state.tf);
  const help = W().settings.helpEnabled;
  panel.innerHTML = `
    <div class="scan">
      <h3>◈ Terminal — ${sym()} ${s.timeframe}</h3>
      <div class="badges">
        <span class="badge ${s.trend === "up" ? "up" : s.trend === "down" ? "down" : ""}">Trend: ${s.trend}</span>
        <span class="badge">Momentum: ${s.momentum}</span>
        <span class="badge">Vol: ${s.volatility}</span>
      </div>
      ${s.readings.filter((r) => r.value !== undefined).slice(0, 6).map((r) => `
        <div class="reading"><span class="muted">${r.indicator}</span>
          <span class="num">${typeof r.value === "number" ? (Math.abs(r.value) > 100 ? F.compact(r.value) : r.value.toFixed(2)) : "—"} <span class="dim">${r.state}</span></span></div>`).join("")}
      ${help ? s.callouts.slice(0, 4).map((c) => `
        <div class="callout ${c.severity}">
          <div class="t">${c.title}</div><div class="d">${c.detail}</div>
          <div class="lesson">↪ Lesson: ${c.lessonId}</div>
        </div>`).join("") : `<div class="empty mt">Teaching is off (pure simulation). Enable Help in Settings to see plain-English reads.</div>`}
    </div>`;
}

function updateBook() {
  const resolve = W().markResolver();
  const pos = [...W().portfolio.positions.values()];
  const positions = document.getElementById("positions");
  if (positions) positions.innerHTML = pos.length === 0 ? `<div class="empty">No open positions.</div>` :
    pos.map((p) => {
      const mark = resolve(p)?.toNumber() ?? 0;
      const upnl = W().portfolio.unrealized(p, resolve).toNumber();
      const label = p.target.kind === "option" && p.option ? `${p.option.underlying.replace("-USD", "")} ${p.option.strike}${p.option.right[0]!.toUpperCase()}` : p.target.symbol.replace("-USD", "");
      return `<div class="li"><div><div class="sym">${label}</div><div class="dim num">${F.qty(p.qty)} @ ${F.priceFmt(p.avgCost.toNumber())}</div></div>
        <div class="right"><div class="num">${F.priceFmt(mark)}</div><div class="num ${F.pnlClass(upnl)}">${F.glyph(upnl)} ${F.money(upnl, { sign: true })}</div></div>
        <button class="x" data-close="${p.key}" title="Close">⊗</button></div>`;
    }).join("");
  positions?.querySelectorAll<HTMLElement>("[data-close]").forEach((b) => b.onclick = () => closePosition(b.dataset.close!));

  const orders = document.getElementById("orders");
  const wo = W().workingOrders();
  if (orders) orders.innerHTML = wo.length === 0 ? `<div class="empty">No working orders.</div>` :
    wo.map((o) => `<div class="li"><div><div class="sym">${o.side.toUpperCase()} ${F.qty(o.qty - o.filledQty)} ${(o.target.option?.underlying ?? o.target.symbol).replace("-USD", "")}</div>
      <div class="dim">${o.type}${o.limitPrice ? " @ " + F.priceFmt(o.limitPrice) : ""}${o.stopPrice ? " stop " + F.priceFmt(o.stopPrice) : ""}</div></div>
      <button class="x" data-cancel="${o.id}">✕</button></div>`).join("");
  orders?.querySelectorAll<HTMLElement>("[data-cancel]").forEach((b) => b.onclick = () => { store.cancel(b.dataset.cancel!); refresh(); });

  const blotter = document.getElementById("blotter");
  const fills = W().fills.slice(-8).reverse();
  if (blotter) blotter.innerHTML = fills.length === 0 ? `<div class="empty">No fills yet.</div>` :
    fills.map((f) => `<div class="li"><div><div class="sym">${f.side.toUpperCase()} ${F.qty(f.qty)} ${(f.target.option?.underlying ?? f.target.symbol).replace("-USD", "")}</div>
      <div class="dim num">${F.dateLabel(f.at)}</div></div>
      <div class="right"><div class="num">${F.priceFmt(f.price.toNumber())}</div>${!f.realized.isZero() ? `<div class="num ${F.pnlClass(f.realized.toNumber())}">${F.money(f.realized.toNumber(), { sign: true })}</div>` : `<div class="dim num">fee ${F.money(f.fee.toNumber())}</div>`}</div></div>`).join("");
}

function closePosition(key: string) {
  const p = W().portfolio.get(key);
  if (!p) return;
  const side: Side = p.qty > 0 ? "sell" : "buy";
  const target = p.target;
  store.submit({ target, side, qty: Math.abs(p.qty), type: "market", tif: "DAY" });
  if (W().mode === "live") toast("Position closed", "gain");
  else toast("Closing order placed — fills next bar");
  refresh();
}

// ---------------------------------------------------------------- time controls (animated scrubbing)
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
  document.getElementById("app")!.classList.add("scrubbing");
  setTimeButtons(false);
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
  // record the advance for persistence (single deterministic step)
  store.noteAdvance(target);
  state.scrubbing = false;
  document.getElementById("app")!.classList.remove("scrubbing");
  setTimeButtons(true);
  chart.setData(visibleBars());
  refresh();
  toast(`Advanced to ${F.dayLabel(W().now)}`);
}

function setTimeButtons(on: boolean) {
  document.querySelectorAll<HTMLButtonElement>("[data-adv]").forEach((b) => (b.disabled = !on));
}

// ---------------------------------------------------------------- header + refresh
function updateHeader() {
  const acct = document.getElementById("acct");
  if (acct) {
    const eq = W().equity().toNumber();
    const cash = W().portfolio.cash.toNumber();
    const bp = W().buyingPower().toNumber();
    const upnl = W().unrealized().toNumber();
    const dayBase = store.world.settings.startingCash;
    const totalPnl = eq - dayBase;
    acct.innerHTML = `
      <div class="kv"><span class="k">Equity</span><span class="v num">${F.money(eq)}</span></div>
      <div class="kv"><span class="k">Cash</span><span class="v num">${F.money(cash)}</span></div>
      <div class="kv"><span class="k">Buying Pwr</span><span class="v num">${F.money(bp)}</span></div>
      <div class="kv"><span class="k">Total P&L</span><span class="v num ${F.pnlClass(totalPnl)}">${F.glyph(totalPnl)} ${F.money(totalPnl, { sign: true })}</span></div>`;
  }
  const now = document.getElementById("nowLabel");
  if (now) now.textContent = `◷ ${F.dateLabel(W().now)} · ${W().mode === "live" ? "LIVE" : "SIM"}`;
  // price tag
  const tag = document.getElementById("priceTag");
  const bars = visibleBars();
  if (tag && bars.length) {
    const last = bars[bars.length - 1]!;
    const prev = bars.length > 1 ? bars[bars.length - 2]!.c : last.o;
    const chg = (last.c - prev) / prev;
    tag.innerHTML = `<div class="px num">${F.priceFmt(last.c)}</div><div class="chg num ${F.pnlClass(chg)}">${F.glyph(chg)} ${F.pct(chg)}</div>`;
  }
}

function refresh() {
  updateHeader();
  renderScanPanel();
  updatePreview();
  updateBook();
}

// ---------------------------------------------------------------- nav + screens
function renderNav() {
  const nav = document.getElementById("nav")!;
  const items: [typeof state.screen, string, string][] = [
    ["trade", "Trade", "▤"], ["options", "Options", "⛓"], ["stats", "Stats", "📊"], ["learn", "Learn", "🎓"], ["settings", "Settings", "⚙"],
  ];
  const showLearn = W().settings.helpEnabled;
  nav.innerHTML = items.filter(([k]) => k !== "learn" || showLearn).map(([k, l, ic]) =>
    `<button class="${state.screen === k ? "on" : ""}" data-nav="${k}"><span class="ic">${ic}</span>${l}</button>`).join("");
  nav.querySelectorAll<HTMLElement>("[data-nav]").forEach((b) => b.onclick = () => openScreen(b.dataset.nav as typeof state.screen));
}

function openScreen(s: typeof state.screen) {
  const overlay = document.getElementById("overlay")!;
  if (s === "trade") { state.screen = "trade"; overlay.innerHTML = ""; if (window.innerWidth <= 920) { state.rightOpen = true; renderRight(); } renderNav(); return; }
  state.screen = s;
  if (s === "options") renderOptionsScreen();
  else if (s === "stats") renderStatsScreen();
  else if (s === "learn") renderLearnScreen();
  else if (s === "settings") renderSettingsScreen();
  renderNav();
}
function closeScreen() { state.screen = "trade"; document.getElementById("overlay")!.innerHTML = ""; renderNav(); refresh(); }

function screenShell(title: string, body: string): string {
  return `<div class="screen"><div class="shead"><button class="back" id="backBtn">‹</button><h2>${title}</h2></div><div class="sbody">${body}</div></div>`;
}

// ----- Options screen
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
  const overlay = document.getElementById("overlay")!;
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
    <div class="card"><div class="row-between"><div><div class="muted">${sym()} spot</div><div class="num" style="font-size:22px;font-weight:700">${F.priceFmt(p.spot)}</div></div>
      <div class="dim" style="font-size:12px;text-align:right">${inst().assetClass === "equity" ? "American · physically settled" : "European · cash settled"}<br>tap a bid/ask to trade 1 contract</div></div>
    <div class="chain-tabs">${chain.expiries.map((e, i) => `<button class="chip ${i === state.optExpiryIdx ? "active" : ""}" data-exp="${i}">${F.dayLabel(e.expiry)}</button>`).join("")}</div>
    <table class="chain"><thead><tr><th>Call b/a</th><th>Δ</th><th>IV</th><th>Strike</th><th>IV</th><th>Δ</th><th>Put b/a</th></tr></thead><tbody>${rows}</tbody></table>
    <h3 style="margin-top:24px;color:var(--text-3);font-size:11px;letter-spacing:.1em;text-transform:uppercase">Strategy Builder</h3>
    <div class="sym-pick" style="margin-top:8px">
      ${["Long Straddle", "Strangle", "Bull Call Spread", "Iron Condor"].map((s) => `<button class="chip" data-strat="${s}">${s}</button>`).join("")}
    </div>
    <div id="stratOut"></div>`;
  overlay.innerHTML = screenShell("Options — " + sym(), body);
  document.getElementById("backBtn")!.onclick = closeScreen;
  overlay.querySelectorAll<HTMLElement>("[data-exp]").forEach((b) => b.onclick = () => { state.optExpiryIdx = +b.dataset.exp!; renderOptionsScreen(); });
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
  const above = ks.find((k) => k > atm) ?? atm, below = [...ks].reverse().find((k) => k < atm) ?? atm;
  let strat;
  if (name === "Long Straddle") strat = straddle(callAtm, putAtm);
  else if (name === "Strangle") strat = strangle(calls.find((c) => c.spec.strike === above)!, puts.find((c) => c.spec.strike === below)!);
  else if (name === "Bull Call Spread") strat = verticalSpread(callAtm, calls.find((c) => c.spec.strike === above)!);
  else strat = ironCondor(puts.find((c) => c.spec.strike === ks[Math.max(0, ks.indexOf(below) - 1)])!, puts.find((c) => c.spec.strike === below)!, calls.find((c) => c.spec.strike === above)!, calls.find((c) => c.spec.strike === ks[Math.min(ks.length - 1, ks.indexOf(above) + 1)])!);
  const a = analyzeStrategy(strat, spot);
  const out = document.getElementById("stratOut")!;
  out.innerHTML = `
    <div class="card">
      <div class="row-between"><strong>${strat.name}</strong><span class="num ${a.netCost > 0 ? "loss" : "gain"}">${a.netCost > 0 ? "Debit" : "Credit"} ${F.money(Math.abs(a.netCost))}</span></div>
      <canvas id="payoff" style="width:100%;height:160px;margin-top:12px"></canvas>
      <div class="stat-grid mt">
        <div class="stat"><div class="k">Max profit</div><div class="v num gain">${a.maxProfit === Infinity ? "∞" : F.money(a.maxProfit)}</div></div>
        <div class="stat"><div class="k">Max loss</div><div class="v num loss">${a.maxLoss === -Infinity ? "∞" : F.money(a.maxLoss)}</div></div>
      </div>
      <div class="muted mt" style="font-size:13px">Breakevens: ${a.breakevens.map((b) => F.priceFmt(b)).join(", ") || "—"}</div>
      <button class="submit buy mt" id="execStrat">Execute ${strat.legs.length}-leg order</button>
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

// ----- Stats screen
function renderStatsScreen() {
  const overlay = document.getElementById("overlay")!;
  const r = analytics(W());
  const totalPnl = Number(r.totalPnl);
  const body = `
    <div class="card"><div class="muted">Total equity</div><div class="num" style="font-size:30px;font-weight:700">${F.money(r.equity)}</div>
      <div class="num ${F.pnlClass(totalPnl)}">${F.glyph(totalPnl)} ${F.money(totalPnl, { sign: true })} total P&L</div>
      <canvas id="eqCurve" style="width:100%;height:140px;margin-top:12px"></canvas></div>
    <div class="stat-grid">
      ${stat("Realized P&L", F.money(Number(r.totalRealized)), F.pnlClass(Number(r.totalRealized)))}
      ${stat("Unrealized P&L", F.money(Number(r.totalUnrealized)), F.pnlClass(Number(r.totalUnrealized)))}
      ${stat("Win rate", (r.trade.winRate * 100).toFixed(0) + "%")}
      ${stat("Profit factor", isFinite(r.trade.profitFactor) ? r.trade.profitFactor.toFixed(2) : "∞")}
      ${stat("Expectancy", F.money(Number(r.trade.expectancy)))}
      ${stat("Trades", String(r.trade.trades))}
      ${stat("Avg win", F.money(Number(r.trade.avgWin)), "gain")}
      ${stat("Avg loss", F.money(Number(r.trade.avgLoss)), "loss")}
      ${stat("Max drawdown", F.money(Number(r.drawdown.maxDrawdown)) + ` (${(r.drawdown.maxDrawdownPct * 100).toFixed(1)}%)`, "loss")}
      ${stat("Avg hold", r.trade.avgHoldHours.toFixed(1) + "h")}
      ${stat("Turnover", r.turnover.toFixed(2) + "x")}
      ${stat("Peak equity", F.money(Number(r.drawdown.peakEquity)))}
    </div>
    ${r.options.assignments + r.options.exercised + r.options.expiredWorthless > 0 || r.options.avgEntryIv > 0 ? `
    <h3 style="margin:20px 0 8px;color:var(--text-3);font-size:11px;letter-spacing:.1em;text-transform:uppercase">Options</h3>
    <div class="stat-grid">
      ${stat("Avg entry IV", (r.options.avgEntryIv * 100).toFixed(0) + "%")}
      ${stat("Theta captured/paid", F.money(Number(r.options.thetaCapturedOrPaid)), F.pnlClass(Number(r.options.thetaCapturedOrPaid)))}
      ${stat("Exercised", String(r.options.exercised))}
      ${stat("Assigned", String(r.options.assignments))}
    </div>` : ""}
    ${r.byAssetClass.length ? `<h3 style="margin:20px 0 8px;color:var(--text-3);font-size:11px;letter-spacing:.1em;text-transform:uppercase">By asset class</h3>
      <div class="card">${r.byAssetClass.map((b) => `<div class="row-between" style="padding:6px 0"><span>${b.key}</span><span class="num ${F.pnlClass(Number(b.realized))}">${F.money(Number(b.realized), { sign: true })} <span class="dim">${b.trades} trades</span></span></div>`).join("")}</div>` : ""}`;
  overlay.innerHTML = screenShell("Statistics", body);
  document.getElementById("backBtn")!.onclick = closeScreen;
  requestAnimationFrame(() => drawEquityCurve(document.getElementById("eqCurve") as HTMLCanvasElement,
    r.equityCurve.map((p) => ({ t: p.t, equity: Number(p.equity) })), W().settings.startingCash));
}
function stat(k: string, v: string, cls = "") { return `<div class="stat"><div class="k">${k}</div><div class="v num ${cls}">${v}</div></div>`; }

// ----- Learn screen
function renderLearnScreen() {
  const overlay = document.getElementById("overlay")!;
  if (!getCurriculum(W())) { overlay.innerHTML = screenShell("Learn", `<div class="empty">Help is disabled. Enable Help in Settings to access the learning track.</div>`); document.getElementById("backBtn")!.onclick = closeScreen; return; }
  if (state.learnModule) return renderModule(state.learnModule);
  const map = store.progress.completionMap();
  const body = `<div class="muted" style="margin-bottom:16px">Options, end to end — ${(store.progress.overallProgress() * 100).toFixed(0)}% complete.</div>
    ${CURRICULUM.map((m, i) => {
      const st = map[i]!;
      return `<div class="module ${st.unlocked ? "" : "locked"}" ${st.unlocked ? `data-mod="${m.id}"` : ""}>
        <div class="mhead"><strong>${m.index}. ${m.title}</strong>
          ${st.passed ? `<span class="badge done">✓ ${(st.bestScore * 100).toFixed(0)}%</span>` : st.unlocked ? "" : `<span class="badge">🔒 locked</span>`}
          ${m.checkpoint ? `<span class="badge" style="font-size:10px">checkpoint</span>` : ""}</div>
        <div class="lesson-body">${m.summary}</div></div>`;
    }).join("")}`;
  overlay.innerHTML = screenShell("Learn Options", body);
  document.getElementById("backBtn")!.onclick = closeScreen;
  overlay.querySelectorAll<HTMLElement>("[data-mod]").forEach((b) => b.onclick = () => { state.learnModule = b.dataset.mod!; renderModule(b.dataset.mod!); });
}

function renderModule(id: string) {
  const overlay = document.getElementById("overlay")!;
  const m = CURRICULUM.find((x) => x.id === id)!;
  const answers: Record<string, number> = {};
  const body = `
    ${m.lessons.map((l) => `<div class="card"><strong>${l.title}</strong><div class="lesson-body">${l.body}</div>
      ${l.demo ? `<div class="dim" style="font-size:12px">⚡ Interactive: ${l.demo.note} (${l.demo.underlying})</div>` : ""}</div>`).join("")}
    <h3 style="margin:16px 0 8px;color:var(--text-3)">Quiz — pass ≥ ${(m.passThreshold * 100).toFixed(0)}%</h3>
    <div id="quiz">${m.quiz.map((q) => `<div class="card" data-q="${q.id}"><strong>${q.prompt}</strong>
      ${q.options.map((o, i) => `<button class="quiz-opt" data-pick="${q.id}:${i}">${o}</button>`).join("")}</div>`).join("")}</div>
    <button class="submit buy" id="grade">Submit quiz</button>
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
    note.textContent = `${(res.bestScore * 100).toFixed(0)}% — ${res.passed ? "Passed! ✓" : "Keep trying — review and retake."}`;
    renderNav();
  };
}

// ----- Settings screen
function renderSettingsScreen() {
  const overlay = document.getElementById("overlay")!;
  const s = W().settings;
  const body = `
    <div class="card">
      ${toggleRow("Help & Learning", "Terminal teaching notes and the options learning track. Off = pure simulation.", s.helpEnabled, "helpEnabled")}
      ${toggleRow("Fee & spread realism", "Model bid/ask spread, slippage and fees on fills.", s.feeRealism, "feeRealism")}
      ${toggleRow("Live crypto mode", "Crypto follows real-time price; orders fill immediately.", W().mode === "live", "liveMode")}
      ${toggleRow("Light theme", "Switch to the light appearance.", store.ui.theme === "light", "theme")}
    </div>
    <div class="card">
      <div class="set-row"><div class="label"><div>Bankroll top-up</div><div class="sub">Add simulated cash. Current: ${F.money(W().portfolio.cash.toNumber())}</div></div></div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <input class="input num" id="depAmt" inputmode="decimal" placeholder="10000">
        <button class="tbtn" id="depBtn">Deposit</button>
      </div>
    </div>
    <div class="card">
      <div class="set-row"><div class="label"><div>Risk-free rate</div><div class="sub">Used for option pricing</div></div>
        <input class="input num" id="rfr" style="width:90px" value="${(s.riskFreeRate * 100).toFixed(1)}"></div>
      <div class="set-row"><div class="label"><div>Margin multiplier</div><div class="sub">Buying-power leverage</div></div>
        <input class="input num" id="marg" style="width:90px" value="${s.marginMultiplier}"></div>
    </div>
    <div class="card">
      <div class="set-row"><div class="label"><div>Reset simulator</div><div class="sub">Wipe portfolio, orders and clock back to start.</div></div>
        <button class="tbtn" id="resetBtn" style="color:var(--loss);border-color:var(--loss)">Reset</button></div>
    </div>
    <div class="card">
      <strong>About ORION</strong>
      <div class="lesson-body">ORION is an educational trading simulation using historical and/or delayed market data.
      It is not a brokerage, holds no real funds, and executes no real trades. All prices, fills, options and
      Greeks are modeled for learning and practice. Not financial advice.</div>
    </div>`;
  overlay.innerHTML = screenShell("Settings", body);
  document.getElementById("backBtn")!.onclick = closeScreen;
  overlay.querySelectorAll<HTMLElement>("[data-toggle]").forEach((b) => b.onclick = () => onToggle(b.dataset.toggle!));
  document.getElementById("depBtn")!.onclick = () => { const v = parseFloat((document.getElementById("depAmt") as HTMLInputElement).value); if (v > 0) { store.deposit(v); toast(`Deposited ${F.money(v)}`, "gain"); renderSettingsScreen(); refresh(); } };
  document.getElementById("rfr")!.addEventListener("change", (e) => store.updateSettings({ riskFreeRate: (parseFloat((e.target as HTMLInputElement).value) || 4) / 100 }));
  document.getElementById("marg")!.addEventListener("change", (e) => { store.updateSettings({ marginMultiplier: parseFloat((e.target as HTMLInputElement).value) || 1 }); refresh(); });
  document.getElementById("resetBtn")!.onclick = () => { if (confirm("Reset the simulator? This wipes your portfolio, orders and clock.")) { store.reset(); state.screen = "trade"; renderShell(); toast("Simulator reset"); } };
}

function toggleRow(label: string, sub: string, on: boolean, key: string) {
  return `<div class="set-row"><div class="label"><div>${label}</div><div class="sub">${sub}</div></div>
    <div class="toggle ${on ? "on" : ""}" data-toggle="${key}"><div class="knob"></div></div></div>`;
}

function onToggle(key: string) {
  if (key === "helpEnabled") { store.updateSettings({ helpEnabled: !W().settings.helpEnabled }); renderNav(); }
  else if (key === "feeRealism") store.updateSettings({ feeRealism: !W().settings.feeRealism });
  else if (key === "liveMode") store.setMode(W().mode === "live" ? "historical" : "live");
  else if (key === "theme") { store.ui.theme = store.ui.theme === "light" ? "dark" : "light"; store.saveUi(); document.documentElement.setAttribute("data-theme", store.ui.theme); }
  renderSettingsScreen();
  refresh();
}

// ---------------------------------------------------------------- helpers
function toast(msg: string, cls = "") {
  const t = document.getElementById("toast")!;
  t.className = `toast show ${cls}`;
  t.textContent = msg;
  setTimeout(() => (t.className = "toast"), 1900);
}
function scrollToScan() { document.getElementById("scanPanel")?.scrollIntoView({ behavior: "smooth" }); }
function ceilTo(t: number, step: number) { return Math.ceil(t / step) * step; }
function brandGlyph(size: number) {
  return `<svg class="glyph" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none">
    <circle cx="5" cy="17" r="1.6" fill="var(--accent)"/><circle cx="12" cy="11" r="1.6" fill="var(--accent)"/><circle cx="19" cy="5" r="1.6" fill="var(--accent)"/>
    <path d="M5 17L12 11L19 5" stroke="var(--accent)" stroke-width="1.3" stroke-linecap="round" opacity="0.5"/></svg>`;
}

boot();
