// Small standalone canvas drawings: equity curve + strategy payoff diagram.
const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

function setup(canvas: HTMLCanvasElement) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const r = canvas.getBoundingClientRect();
  canvas.width = Math.round(r.width * dpr);
  canvas.height = Math.round(r.height * dpr);
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, W: r.width, H: r.height };
}

export function drawEquityCurve(canvas: HTMLCanvasElement, points: { t: number; equity: number }[], baseline: number) {
  const { ctx, W, H } = setup(canvas);
  ctx.clearRect(0, 0, W, H);
  if (points.length < 2) return;
  const pad = 8;
  let lo = Infinity, hi = -Infinity;
  for (const p of points) { lo = Math.min(lo, p.equity); hi = Math.max(hi, p.equity); }
  lo = Math.min(lo, baseline); hi = Math.max(hi, baseline);
  const span = hi - lo || 1;
  const xOf = (i: number) => pad + (i / (points.length - 1)) * (W - pad * 2);
  const yOf = (v: number) => pad + (1 - (v - lo) / span) * (H - pad * 2);

  // baseline
  ctx.strokeStyle = css("--hairline"); ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad, yOf(baseline)); ctx.lineTo(W - pad, yOf(baseline)); ctx.stroke();
  ctx.setLineDash([]);

  const last = points[points.length - 1]!.equity;
  const color = last >= baseline ? css("--gain") : css("--loss");
  // area fill
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, color + "33"); grad.addColorStop(1, color + "00");
  ctx.beginPath(); ctx.moveTo(xOf(0), yOf(points[0]!.equity));
  points.forEach((p, i) => ctx.lineTo(xOf(i), yOf(p.equity)));
  ctx.lineTo(xOf(points.length - 1), H - pad); ctx.lineTo(xOf(0), H - pad); ctx.closePath();
  ctx.fillStyle = grad; ctx.fill();
  // line
  ctx.beginPath(); ctx.moveTo(xOf(0), yOf(points[0]!.equity));
  points.forEach((p, i) => ctx.lineTo(xOf(i), yOf(p.equity)));
  ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
}

export function drawPayoff(canvas: HTMLCanvasElement, payoff: { price: number; pnl: number }[], spot: number, breakevens: number[]) {
  const { ctx, W, H } = setup(canvas);
  ctx.clearRect(0, 0, W, H);
  if (payoff.length < 2) return;
  const pad = 10;
  let loP = Infinity, hiP = -Infinity, loX = Infinity, hiX = -Infinity;
  for (const p of payoff) { loP = Math.min(loP, p.pnl); hiP = Math.max(hiP, p.pnl); loX = Math.min(loX, p.price); hiX = Math.max(hiX, p.price); }
  const spanP = hiP - loP || 1, spanX = hiX - loX || 1;
  const xOf = (px: number) => pad + ((px - loX) / spanX) * (W - pad * 2);
  const yOf = (v: number) => pad + (1 - (v - loP) / spanP) * (H - pad * 2);

  // zero line
  ctx.strokeStyle = css("--hairline"); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(pad, yOf(0)); ctx.lineTo(W - pad, yOf(0)); ctx.stroke();

  // profit/loss split fill
  for (const sign of [1, -1]) {
    ctx.beginPath();
    let started = false;
    ctx.moveTo(xOf(payoff[0]!.price), yOf(0));
    for (const p of payoff) {
      const v = sign > 0 ? Math.max(0, p.pnl) : Math.min(0, p.pnl);
      ctx.lineTo(xOf(p.price), yOf(v));
      started = true;
    }
    ctx.lineTo(xOf(payoff[payoff.length - 1]!.price), yOf(0));
    ctx.closePath();
    ctx.fillStyle = (sign > 0 ? css("--gain") : css("--loss")) + "22";
    ctx.fill();
  }
  // payoff line
  ctx.beginPath(); ctx.moveTo(xOf(payoff[0]!.price), yOf(payoff[0]!.pnl));
  payoff.forEach((p) => ctx.lineTo(xOf(p.price), yOf(p.pnl)));
  ctx.strokeStyle = css("--accent"); ctx.lineWidth = 2; ctx.stroke();

  // spot marker
  ctx.strokeStyle = css("--text-2"); ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.moveTo(xOf(spot), pad); ctx.lineTo(xOf(spot), H - pad); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = css("--text-3"); ctx.font = "10px 'Roboto Mono', monospace"; ctx.textAlign = "center";
  ctx.fillText("spot", xOf(spot), H - 2);
  // breakevens
  ctx.fillStyle = css("--warn");
  for (const be of breakevens) if (be >= loX && be <= hiX) ctx.fillRect(xOf(be) - 1, yOf(0) - 3, 2, 6);
}
