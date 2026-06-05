// Canvas candlestick chart — bounded plot area, price/time axes, indicator
// legend, crosshair, contained pan/zoom. Renders only clock-visible bars.
import type { Bar } from "../../../sim/src/index.ts";
import { indicators } from "../../../sim/src/index.ts";

export interface ChartConfig {
  sma: number[];
  ema: number[];
  bollinger: boolean;
  vwap: boolean;
}

const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

const MA_COLORS = ["#4c8dff", "#f5a623", "#22c97a"];
const AX_R = 62;   // right price-axis gutter
const AX_B = 22;   // bottom time-axis gutter
const PAD_T = 10;  // top padding

export class Chart {
  private ctx: CanvasRenderingContext2D;
  private bars: Bar[] = [];
  private cfg: ChartConfig = { sma: [50], ema: [20], bollinger: true, vwap: false };
  private view = 90;
  private offset = 0;
  private crosshair: { x: number; y: number } | null = null;
  private W = 0;
  private H = 0;
  private dpr = 1;
  private dragging = false;
  private lastX = 0;
  private ro: ResizeObserver;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.bindEvents();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas);
    this.resize();
  }

  destroy() { this.ro.disconnect(); }

  setConfig(cfg: Partial<ChartConfig>) {
    this.cfg = { ...this.cfg, ...cfg };
    this.render();
  }

  setData(bars: Bar[], opts: { resetView?: boolean } = {}) {
    this.bars = bars;
    if (opts.resetView) { this.offset = 0; this.view = Math.min(90, Math.max(40, bars.length)); }
    this.render();
  }

  private resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const r = this.canvas.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    this.W = r.width;
    this.H = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.render();
  }

  private bindEvents() {
    const c = this.canvas;
    c.style.touchAction = "none";
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.12 : 0.89;
      this.view = Math.max(25, Math.min(this.bars.length || 600, Math.round(this.view * factor)));
      this.render();
    }, { passive: false });

    c.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      c.setPointerCapture(e.pointerId);
    });
    c.addEventListener("pointermove", (e) => {
      const rect = c.getBoundingClientRect();
      this.crosshair = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      if (this.dragging) {
        const dx = e.clientX - this.lastX;
        const barW = (this.W - AX_R) / this.view;
        const step = Math.round(dx / barW);
        if (step !== 0) {
          this.offset = Math.max(0, Math.min(Math.max(0, this.bars.length - 10), this.offset + step));
          this.lastX = e.clientX;
        }
      }
      this.render();
    });
    const release = (e: PointerEvent) => {
      this.dragging = false;
      try { c.releasePointerCapture(e.pointerId); } catch { /* noop */ }
    };
    c.addEventListener("pointerup", release);
    c.addEventListener("pointercancel", release);
    c.addEventListener("pointerleave", () => { if (!this.dragging) { this.crosshair = null; this.render(); } });
  }

  private visibleSlice(): { slice: Bar[]; startIdx: number } {
    const end = this.bars.length - this.offset;
    const start = Math.max(0, end - this.view);
    return { slice: this.bars.slice(start, end), startIdx: start };
  }

  render() {
    const ctx = this.ctx;
    if (this.W === 0 || this.H === 0) return;
    ctx.clearRect(0, 0, this.W, this.H);
    ctx.fillStyle = css("--ink");
    ctx.fillRect(0, 0, this.W, this.H);

    if (this.bars.length < 2) {
      ctx.fillStyle = css("--text-3");
      ctx.font = "13px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Awaiting market data…", this.W / 2, this.H / 2);
      return;
    }

    const { slice, startIdx } = this.visibleSlice();
    if (slice.length < 1) return;

    const plotW = this.W - AX_R;
    const plotH = this.H - AX_B - PAD_T;
    const volH = plotH * 0.18;
    const priceH = plotH - volH - 6;

    let hi = -Infinity, lo = Infinity, maxVol = 0;
    for (const b of slice) { hi = Math.max(hi, b.h); lo = Math.min(lo, b.l); maxVol = Math.max(maxVol, b.v); }
    // include visible indicator extents so lines never clip
    const closesAll = this.bars.map((b) => b.c);
    const considerLine = (s: readonly (number | undefined)[]) => {
      for (let i = 0; i < slice.length; i++) {
        const v = s[startIdx + i];
        if (v !== undefined) { hi = Math.max(hi, v); lo = Math.min(lo, v); }
      }
    };
    let bb: ReturnType<typeof indicators.bollinger> | null = null;
    if (this.cfg.bollinger) { bb = indicators.bollinger(closesAll, 20, 2); considerLine(bb.upper); considerLine(bb.lower); }

    const padV = (hi - lo) * 0.06 || hi * 0.01 || 1;
    hi += padV; lo -= padV;
    const span = hi - lo || 1;
    const yOf = (p: number) => PAD_T + ((hi - p) / span) * priceH;
    const colW = plotW / slice.length;
    const xOf = (i: number) => (i + 0.5) * colW;
    const barW = Math.max(1, colW * 0.62);

    // ── grid + price axis ──
    ctx.strokeStyle = css("--hairline");
    ctx.fillStyle = css("--text-3");
    ctx.lineWidth = 1;
    ctx.font = "10px 'Roboto Mono', monospace";
    ctx.textAlign = "left";
    const rows = 5;
    for (let i = 0; i <= rows; i++) {
      const p = hi - (span * i) / rows;
      const y = yOf(p);
      ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillText(fmtAxis(p), plotW + 6, y + 3);
    }

    // ── indicator lines ──
    const drawLine = (series: readonly (number | undefined)[], color: string, width = 1.4) => {
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath();
      let started = false;
      for (let i = 0; i < slice.length; i++) {
        const v = series[startIdx + i];
        if (v === undefined) { started = false; continue; }
        const x = xOf(i), y = yOf(v);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke();
    };

    if (bb) {
      drawLine(bb.upper, "rgba(124,139,160,0.5)", 1);
      drawLine(bb.lower, "rgba(124,139,160,0.5)", 1);
      drawLine(bb.middle, "rgba(124,139,160,0.7)", 1);
    }
    if (this.cfg.vwap) drawLine(indicators.vwap(this.bars), "#c98bff", 1.4);
    const smaSeries = this.cfg.sma.map((p, i) => ({ p, s: indicators.sma(closesAll, p), color: MA_COLORS[i % MA_COLORS.length]! }));
    const emaSeries = this.cfg.ema.map((p, i) => ({ p, s: indicators.ema(closesAll, p), color: MA_COLORS[(i + 1) % MA_COLORS.length]! }));
    smaSeries.forEach((m) => drawLine(m.s, m.color, 1.5));
    emaSeries.forEach((m) => drawLine(m.s, m.color, 1.2));

    // ── volume ──
    const volTop = PAD_T + priceH + 6;
    for (let i = 0; i < slice.length; i++) {
      const b = slice[i]!;
      const h = (b.v / (maxVol || 1)) * volH;
      ctx.fillStyle = b.c >= b.o ? "rgba(34,201,122,0.30)" : "rgba(255,77,94,0.30)";
      ctx.fillRect(xOf(i) - barW / 2, volTop + (volH - h), barW, h);
    }

    // ── candles ──
    for (let i = 0; i < slice.length; i++) {
      const b = slice[i]!;
      const up = b.c >= b.o;
      const color = up ? css("--gain") : css("--loss");
      const x = xOf(i);
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, yOf(b.h)); ctx.lineTo(x, yOf(b.l)); ctx.stroke();
      const yO = yOf(b.o), yC = yOf(b.c);
      ctx.fillRect(x - barW / 2, Math.min(yO, yC), barW, Math.max(1, Math.abs(yC - yO)));
    }

    // ── last price tag ──
    const last = slice[slice.length - 1]!;
    const yLast = yOf(last.c);
    const lastColor = last.c >= last.o ? css("--gain") : css("--loss");
    ctx.strokeStyle = lastColor; ctx.globalAlpha = 0.4; ctx.setLineDash([2, 3]);
    ctx.beginPath(); ctx.moveTo(0, yLast); ctx.lineTo(plotW, yLast); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.fillStyle = lastColor;
    ctx.fillRect(plotW, yLast - 8, AX_R, 16);
    ctx.fillStyle = "#fff"; ctx.textAlign = "left"; ctx.font = "10px 'Roboto Mono', monospace";
    ctx.fillText(fmtAxis(last.c), plotW + 5, yLast + 3);

    // ── time axis ──
    ctx.fillStyle = css("--text-3"); ctx.font = "10px 'Roboto Mono', monospace"; ctx.textAlign = "center";
    const ticks = Math.min(6, slice.length);
    for (let t = 0; t < ticks; t++) {
      const i = Math.floor((t / (ticks - 1 || 1)) * (slice.length - 1));
      const b = slice[i]!;
      const x = Math.max(20, Math.min(plotW - 20, xOf(i)));
      ctx.fillText(fmtTime(b.t), x, this.H - 7);
    }

    // ── legend ──
    const legend: { label: string; color: string }[] = [];
    if (bb) legend.push({ label: "BB(20,2)", color: "rgba(124,139,160,0.9)" });
    smaSeries.forEach((m) => legend.push({ label: `SMA${m.p} ${maybe(m.s[this.bars.length - 1 - this.offset])}`, color: m.color }));
    emaSeries.forEach((m) => legend.push({ label: `EMA${m.p} ${maybe(m.s[this.bars.length - 1 - this.offset])}`, color: m.color }));
    if (this.cfg.vwap) legend.push({ label: `VWAP ${maybe(indicators.vwap(this.bars)[this.bars.length - 1 - this.offset])}`, color: "#c98bff" });
    ctx.textAlign = "left"; ctx.font = "10px 'Roboto Mono', monospace";
    let lx = 10;
    for (const item of legend) {
      ctx.fillStyle = item.color;
      ctx.fillRect(lx, 4, 8, 8);
      ctx.fillStyle = css("--text-2");
      ctx.fillText(item.label, lx + 12, 12);
      lx += ctx.measureText(item.label).width + 28;
    }

    // ── crosshair + OHLC readout ──
    if (this.crosshair && this.crosshair.x < plotW && this.crosshair.y < PAD_T + plotH) {
      const idx = Math.max(0, Math.min(slice.length - 1, Math.round(this.crosshair.x / colW - 0.5)));
      const b = slice[idx]!;
      const x = xOf(idx);
      ctx.strokeStyle = "rgba(124,139,160,0.45)"; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, PAD_T); ctx.lineTo(x, PAD_T + plotH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, this.crosshair.y); ctx.lineTo(plotW, this.crosshair.y); ctx.stroke();
      ctx.setLineDash([]);
      // price label on axis
      const pAtY = hi - ((this.crosshair.y - PAD_T) / priceH) * span;
      if (this.crosshair.y <= PAD_T + priceH) {
        ctx.fillStyle = css("--surface-2");
        ctx.fillRect(plotW, this.crosshair.y - 8, AX_R, 16);
        ctx.fillStyle = css("--text-1"); ctx.textAlign = "left";
        ctx.fillText(fmtAxis(pAtY), plotW + 5, this.crosshair.y + 3);
      }
      // OHLC chip
      const chg = (b.c - b.o) / b.o;
      const cc = b.c >= b.o ? css("--gain") : css("--loss");
      ctx.fillStyle = css("--surface-2");
      ctx.fillRect(8, 18, 282, 20);
      ctx.font = "11px 'Roboto Mono', monospace"; ctx.textAlign = "left";
      ctx.fillStyle = css("--text-2");
      const txt = `O ${fmtAxis(b.o)}  H ${fmtAxis(b.h)}  L ${fmtAxis(b.l)}  C `;
      ctx.fillText(txt, 14, 32);
      const w = ctx.measureText(txt).width;
      ctx.fillStyle = cc;
      ctx.fillText(`${fmtAxis(b.c)} (${(chg * 100).toFixed(2)}%)`, 14 + w, 32);
    }
  }
}

function maybe(v: number | undefined): string { return v === undefined ? "—" : fmtAxis(v); }

function fmtAxis(p: number): string {
  if (p >= 1000) return p.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(4);
}

function fmtTime(t: number): string {
  const d = new Date(t);
  return d.toLocaleString("en-US", { month: "short", day: "numeric" });
}
