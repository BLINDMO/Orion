// App store: owns the World and persists the session as a deterministic action
// log. Because the engine is deterministic (sim §13.2), replaying the same start
// config + ordered actions perfectly reconstructs state across reloads.
import {
  World,
  universe,
  buildSeedData,
  type AccountSettings,
  type OrderRequest,
  LearningProgress,
} from "../../sim/src/index.ts";

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

const KEY = "orion.session.v2";
const START = Date.UTC(2023, 0, 2);
const DAYS = 60;
// Begin the clock well into the dataset so there is real chart history to read
// (and enough closed bars for SMA/EMA/Bollinger to compute) while leaving a
// long unknown future to trade into.
const HISTORY_DAYS = 25;

export class Store {
  world!: World;
  actions: Action[] = [];
  progress = new LearningProgress();
  ui = { symbol: "BTC-USD", theme: "dark" as "dark" | "light", onboarded: false };
  private settings: Partial<AccountSettings>;

  constructor() {
    const saved = this.load();
    this.settings = saved?.settings ?? { startingCash: 25_000 };
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
  submit(req: OrderRequest) { const r = this.world.submit(req); if (r.ok) { this.actions.push({ k: "submit", req }); this.save(); } return r; }
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

  private record(a: Action) { this.actions.push(a); this.save(); }

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
