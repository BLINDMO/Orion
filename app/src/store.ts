// App store: owns the World and persists the session as a deterministic action
// log. Because the engine is deterministic (sim §13.2), replaying the same start
// config + ordered actions perfectly reconstructs state across reloads.
import {
  World,
  universe,
  buildSeedData,
  InstrumentData,
  BarSeries,
  type AccountSettings,
  type OrderRequest,
  type Bar,
  type Resolution,
  LearningProgress,
} from "../../sim/src/index.ts";
import { LIVE_SYMBOLS, fetchSymbol, type Fetcher } from "./live.ts";

const RES_MS: Record<Resolution, number> = { "1m": 60_000, "1h": 3_600_000, "1d": 86_400_000 };

type Action =
  | { k: "submit"; req: OrderRequest }
  | { k: "cancel"; id: string }
  | { k: "advance"; to: number }
  | { k: "deposit"; amt: number }
  | { k: "mode"; mode: "historical" | "live" }
  | { k: "settings"; patch: Partial<AccountSettings> }
  | { k: "reset"; startingCash?: number };

interface Persisted {
  start: number;
  days: number;
  settings: Partial<AccountSettings>;
  actions: Action[];
  ui: { symbol: string; theme: "dark" | "light"; onboarded: boolean };
  progress: Record<string, unknown>;
}

const KEY = "orion.session.v3";
const DAYS = 60;
// Begin the clock well into the dataset so there is real chart history to read
// (and enough closed bars for SMA/EMA/Bollinger to compute) while leaving a
// long unknown future to trade into.
const HISTORY_DAYS = 25;
// Anchor the dataset to the present: the data window starts HISTORY_DAYS before
// "now" (rounded to a UTC day), so the simulated clock opens at today's date
// with realistic, current-feeling price levels rather than a stale historical
// year. A returning session keeps its own persisted `start`.
const START = (() => {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - HISTORY_DAYS * 24 * 3600_000;
})();

export class Store {
  world!: World;
  actions: Action[] = [];
  progress = new LearningProgress();
  ui = { symbol: "BTC-USD", theme: "dark" as "dark" | "light", onboarded: false };
  private settings: Partial<AccountSettings>;

  // Live market-data session (real Coinbase prices). Kept separate from the
  // deterministic historical world so toggling Live never corrupts the replay.
  live = false;
  onLiveTick: (() => void) | null = null;
  private histWorld: World | null = null;
  private liveTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    const saved = this.load();
    this.settings = saved?.settings ?? { startingCash: 1_000 };
    if (saved) {
      this.ui = saved.ui;
      this.progress = LearningProgress.fromJSON(saved.progress as { results?: never });
    }
    this.build(saved);
  }

  private build(saved: Persisted | null) {
    const data = buildSeedData(saved?.start ?? START, saved?.days ?? DAYS);
    this.world = new World({
      universe,
      data,
      startNow: (saved?.start ?? START) + HISTORY_DAYS * 24 * 3600_000,
      settings: this.settings,
    });
    if (saved) {
      try {
        for (const a of saved.actions) this.apply(a, false);
        this.actions = saved.actions;
      } catch (e) {
        console.warn("Replay failed; starting fresh.", e);
        this.actions = [];
      }
    }
  }

  private apply(a: Action, record: boolean) {
    const w = this.world;
    switch (a.k) {
      case "submit": w.submit(a.req); break;
      case "cancel": w.cancel(a.id); break;
      case "advance": w.advanceTo(a.to, { stepRes: a.to - w.now > 2 * 86400_000 ? "1h" : "1m" }); break;
      case "deposit": w.deposit(a.amt); break;
      case "mode": w.setMode(a.mode); break;
      case "settings": w.updateSettings(a.patch); break;
      case "reset": w.reset(a.startingCash !== undefined ? { startingCash: a.startingCash } : undefined); break;
    }
    if (record) { this.actions.push(a); this.save(); }
  }

  // Public mutators (record + persist) -------------------------------------
  submit(req: OrderRequest) { const r = this.world.submit(req); if (r.ok && !this.live) { this.actions.push({ k: "submit", req }); this.save(); } return r; }
  cancel(id: string) { const ok = this.world.cancel(id); if (ok) this.record({ k: "cancel", id }); return ok; }
  advanceTo(to: number) { this.world.advanceTo(to, { stepRes: to - this.world.now > 2 * 86400_000 ? "1h" : "1m" }); this.record({ k: "advance", to }); }
  deposit(amt: number) { this.world.deposit(amt); this.record({ k: "deposit", amt }); }
  setMode(mode: "historical" | "live") { this.world.setMode(mode); this.record({ k: "mode", mode }); }
  updateSettings(patch: Partial<AccountSettings>) { this.world.updateSettings(patch); this.settings = { ...this.settings, ...patch }; this.record({ k: "settings", patch }); }
  reset(startingCash?: number) {
    this.world.reset(startingCash !== undefined ? { startingCash } : undefined);
    this.actions = []; this.record({ k: "reset", startingCash });
  }

  /** Record an advance the UI already applied to the world (animated scrubbing). */
  noteAdvance(to: number) { this.record({ k: "advance", to }); }

  // ── Live market data ────────────────────────────────────────────────────
  /**
   * Switch to a live world driven by real crypto prices. Fetches recent candles
   * for each live symbol, builds a fresh world anchored at the real last close,
   * and starts polling. Throws (leaving the historical world intact) on failure.
   */
  async enableLive(fetcher?: Fetcher): Promise<void> {
    if (this.live) return;
    const data = buildSeedData(START, DAYS); // equities stay synthetic
    let now = 0;
    for (const sym of LIVE_SYMBOLS) {
      const snap = await fetchSymbol(sym, fetcher);
      const series: Partial<Record<Resolution, BarSeries>> = {};
      for (const res of ["1h", "1d"] as Resolution[]) {
        const bars = snap.bars[res];
        if (bars && bars.length) {
          series[res] = new BarSeries(res, bars);
          const last = bars[bars.length - 1]!;
          now = Math.max(now, last.t + RES_MS[res]);
        }
      }
      if (Object.keys(series).length) data.set(sym, new InstrumentData(sym, series));
    }
    if (!now) throw new Error("No live data returned");

    this.histWorld = this.world;
    this.world = new World({ universe, data, startNow: now, settings: { ...this.world.settings } });
    this.world.setMode("live");
    this.live = true;
    this.liveTimer = setInterval(() => { void this.pollLive(fetcher); }, 30_000);
  }

  private async pollLive(fetcher?: Fetcher): Promise<void> {
    if (!this.live) return;
    let now = this.world.now;
    for (const sym of LIVE_SYMBOLS) {
      try {
        const snap = await fetchSymbol(sym, fetcher);
        const id = this.world.data.get(sym);
        if (!id) continue;
        for (const res of ["1h", "1d"] as Resolution[]) {
          const bars = snap.bars[res];
          if (bars && bars.length) {
            id.appendLive(res, bars);
            now = Math.max(now, bars[bars.length - 1]!.t + RES_MS[res]);
          }
        }
      } catch { /* transient network error — keep last good prices */ }
    }
    if (now > this.world.now) this.world.advanceTo(now, { stepRes: "1h" });
    this.onLiveTick?.();
  }

  /** Return to the deterministic historical world. */
  disableLive(): void {
    if (!this.live) return;
    if (this.liveTimer) { clearInterval(this.liveTimer); this.liveTimer = null; }
    if (this.histWorld) this.world = this.histWorld;
    this.histWorld = null;
    this.live = false;
  }

  private record(a: Action) { if (this.live) return; this.actions.push(a); this.save(); }

  save() {
    const p: Persisted = {
      start: START, days: DAYS, settings: this.world.settings,
      actions: this.actions, ui: this.ui, progress: this.progress.toJSON() as never,
    };
    try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {}
  }
  saveUi() { this.save(); }

  private load(): Persisted | null {
    try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
  }
}
