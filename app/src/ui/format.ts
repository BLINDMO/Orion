// Formatting helpers — tabular money/number presentation.
export function money(v: number | string, opts: { sign?: boolean } = {}): string {
  const n = typeof v === "string" ? Number(v) : v;
  const s = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = n < 0 ? "−" : opts.sign ? "+" : "";
  return `${sign}$${s}`;
}

export function compact(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(2) + "B";
  if (a >= 1e6) return (v / 1e6).toFixed(2) + "M";
  if (a >= 1e3) return (v / 1e3).toFixed(1) + "K";
  return v.toFixed(0);
}

export function qty(v: number): string {
  if (Number.isInteger(v)) return v.toString();
  return v.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

export function pct(v: number, digits = 2): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(digits)}%`;
}

export function pnlClass(v: number): string {
  return v > 0 ? "gain" : v < 0 ? "loss" : "muted";
}

export function glyph(v: number): string {
  return v > 0 ? "▲" : v < 0 ? "▼" : "—";
}

export function dateLabel(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

export function dayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function priceFmt(p: number): string {
  if (p >= 1000) return p.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(4);
}
