// Canvas candlestick chart with indicator overlays, volume, and crosshair.
// Renders only the clock-visible bars handed to it — never future data.
import type { Bar } from "../../../sim/src/index.ts";
import { indicators } from "../../../sim/src/index.ts";

export interface ChartConfig {
  sma: number[]; // periods
  ema: number[];
  bollinger: boolean;
  vwap: boolean;
}

const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export class Chart {
  private ctx: CanvasRenderingContext2D;
  private bars: Bar[] = [];
  private cfg: ChartConfig = { sma: [50], ema: [20], bollinger: true, vwap: false };
  private view = 120; // number of bars visible
  private offset = 0; // bars scrolled from the right
  private crosshair: { x: number; y: number } | null = null;
  private W = 0;
  private H = 0;
  private dpr = 1;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
    this.bindEvents();
    new ResizeObserver(() => this.resize()).observe(canvas);
  }

  setConfig(cfg: Partial<ChartConfig>) {
    this.cfg = { ...this.cfg, ...cfg };
    this.render();
  }

  setData(bars: Bar[], opts: { resetView?: boolean } = {}) {
    this.bars = bars;
    if (opts.resetView) this.offset = 0;
    this.render();
  }

  private resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const r = this.canvas.getBoundingClientRect();
    this.W = r.width;
    this.H = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.render();
  }

  private bindEvents() {
    this.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.1 : 0.9;
      this.view = Math.max(20, Math.min(600, Math.round(this.view * factor)));
      this.render();
    }, { passive: false });
    let dragging = false;
    let lastX = 0;
    const start = (x: number) => { dragging = true; lastX = x; };
    const move = (x: number, y: number, rect: DOMRect) => {
      this.crosshair = { x: x - rect.left, y: y - rect.top };
      if (dragging) {
        const dx = x - lastX;
        const barW = this.W / this.view;
        this.offset = Math.max(0, Math.min(this.bars.length - 10, this.offset + Math.round(dx / barW)));
        lastX = x;
      }
      this.render();
    };
    const end = () => { dragging = false; };
    this.canvas.addEventListener("mousedown", (e) => start(e.clientX));
    window.addEventListener("mousemove", (e) => move(e.clientX, e.clientY, this.canvas.getBoundingClientRect()));
    window.addEventListener("mouseup", end);
    this.canvas.addEventListener("mouseleave", () => { this.crosshair = null; this.render(); });
    this.canvas.addEventListener("touchstart", (e) => start(e.touches[0]!.clientX), { passive: true });
    this.canvas.addEventListener("touchmove", (e) => { const t = e.touches[0]!; move(t.clientX, t.clientY, this.canvas.getBoundingClientRect()); }, { passive: true });
    this.canvas.addEventListener("touchend", end);
  }

  private visibleSlice(): { slice: Bar[]; startIdx: number } {
    const end = this.bars.length - this.offset;
    const start = Math.max(0, end - this.view);
    return { slice: this.bars.slice(start, end), startIdx: start };
  }

  render() {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    if (this.bars.length < 2 || this.W === 0) {
      ctx.fillStyle = css("--text-3");
      ctx.font = "13px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Awaiting market data…", this.W / 2, this.H / 2);
      return;
    }
    const { slice, startIdx } = this.visibleSlice();
    const padR = 58;
    const volH = this.H * 0.16;
    const priceH = this.H - volH - 8;
    const plotW = this.W - padR;

    let hi = -Infinity, lo = Infinity, maxVol = 0;
    for (const b of slice) { hi = Math.max(hi, b.h); lo = Math.min(lo, b.l); maxVol = Math.max(maxVol, b.v); }
    const padV = (hi - lo) * 0.08 || hi * 0.01;
    hi += padV; lo -= padV;
    const yOf = (p: number) => ((hi - p) / (hi - lo)) * priceH;
    const xOf = (i: number) => (i + 0.5) * (plotW / slice.length);
    const barW = Math.max(1, (plotW / slice.length) * 0.66);

    // grid + price axis
    ctx.strokeStyle = css("--hairline");
    ctx.fillStyle = css("--text-3");
    ctx.lineWidth = 1;
    ctx.font = "11px 'Roboto Mono', monospace";
    ctx.textAlign = "left";
    const lines = 5;
    for (let i = 0; i <= lines; i++) {
      const p = hi - ((hi - lo) * i) / lines;
      const y = yOf(p);
      ctx.globalAlpha = 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(plotW, y); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillText(fmtAxis(p), plotW + 6, y + 4);
    }

    // indicators (computed over the FULL bar history for correctness, then sliced)
    const closes = this.bars.map((b) => b.c);
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

    if (this.cfg.bollinger) {
      const bb = indicators.bollinger(closes, 20, 2);
      drawLine(bb.upper, "rgba(154,166,182,0.45)", 1);
      drawLine(bb.lower, "rgba(154,166,182,0.45)", 1);
      drawLine(bb.middle, "rgba(154,166,182,0.6)", 1);
    }
    if (this.cfg.vwap) drawLine(indicators.vwap(this.bars), "#c98bff", 1.4);
    const maColors = ["#4c8dff", "#f5b83d", "#2ecc8f"];
    this.cfg.sma.forEach((p, i) => drawLine(indicators.sma(closes, p), maColors[i % maColors.length]!, 1.5));
    this.cfg.ema.forEach((p, i) => drawLine(indicators.ema(closes, p), maColors[(i + 1) % maColors.length]! + "cc", 1.2));

    // volume
    const volTop = priceH + 8;
    for (let i = 0; i < slice.length; i++) {
      const b = slice[i]!;
      const h = (b.v / maxVol) * volH;
      ctx.fillStyle = b.c >= b.o ? "rgba(46,204,143,0.35)" : "rgba(255,92,108,0.35)";
      ctx.fillRect(xOf(i) - barW / 2, volTop + (volH - h), barW, h);
    }

    // candles
    for (let i = 0; i < slice.length; i++) {
      const b = slice[i]!;
      const up = b.c >= b.o;
      const color = up ? css("--gain") : css("--loss");
      const x = xOf(i);
      ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, yOf(b.h)); ctx.lineTo(x, yOf(b.l)); ctx.stroke();
      const yO = yOf(b.o), yC = yOf(b.c);
      const top = Math.min(yO, yC);
      ctx.fillRect(x - barW / 2, top, barW, Math.max(1, Math.abs(yC - yO)));
    }

    // last price marker
    const last = slice[slice.length - 1]!;
    const yLast = yOf(last.c);
    ctx.fillStyle = last.c >= last.o ? css("--gain") : css("--loss");
    ctx.fillRect(plotW, yLast - 9, padR, 18);
    ctx.fillStyle = "#0a0c10"; ctx.textAlign = "left"; ctx.font = "11px 'Roboto Mono', monospace";
    ctx.fillText(fmtAxis(last.c), plotW + 5, yLast + 4);

    // crosshair + OHLC readout
    if (this.crosshair && this.crosshair.x < plotW) {
      const idx = Math.max(0, Math.min(slice.length - 1, Math.round(this.crosshair.x / (plotW / slice.length) - 0.5)));
      const b = slice[idx]!;
      const x = xOf(idx);
      ctx.strokeStyle = "rgba(154,166,182,0.4)"; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, priceH); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, this.crosshair.y); ctx.lineTo(plotW, this.crosshair.y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = css("--surface-2");
      ctx.fillRect(8, 8, 230, 22);
      ctx.fillStyle = css("--text-2"); ctx.font = "11px 'Roboto Mono', monospace"; ctx.textAlign = "left";
      const c = b.c >= b.o ? css("--gain") : css("--loss");
      ctx.fillText(`O ${fmtAxis(b.o)}  H ${fmtAxis(b.h)}  L ${fmtAxis(b.l)}  `, 14, 23);
      const w = ctx.measureText(`O ${fmtAxis(b.o)}  H ${fmtAxis(b.h)}  L ${fmtAxis(b.l)}  `).width;
      ctx.fillStyle = c; ctx.fillText(`C ${fmtAxis(b.c)}`, 14 + w, 23);
    }
  }
}

function fmtAxis(p: number): string {
  if (p >= 1000) return p.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(4);
}
