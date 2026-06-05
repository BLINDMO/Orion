// App store: owns the World and persists the session as a deterministic action log.
// Multiple profiles each get their own isolated session key.
import {
  World,
  universe,
  buildSeedData,
  type AccountSettings,
  type OrderRequest,
  LearningProgress,
} from "../../sim/src/index.ts";
import { fetchCandles, LIVE_SYMBOLS } from "./live.ts";

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
  ui: { symbol: string; theme: "dark" | "light"; onboarded: boolean; livePref?: boolean };
  progress: Record<string, unknown>;
}

// ── Profile system ────────────────────────────────────────────────────────────
export interface ProfileMeta {
  id: string;
  name: string;
  createdAt: number;
}

interface ProfileList {
  active: string;
  list: ProfileMeta[];
}

const PROFILES_KEY = "orion.profiles";

function makeId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function loadPL(): ProfileList {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  const id = makeId();
  const pl: ProfileList = { active: id, list: [{ id, name: "Default", createdAt: Date.now() }] };
  try { localStorage.setItem(PROFILES_KEY, JSON.stringify(pl)); } catch {}
  return pl;
}

function savePL(pl: ProfileList) {
  try { localStorage.setItem(PROFILES_KEY, JSON.stringify(pl)); } catch {}
}

// ── Sim constants ─────────────────────────────────────────────────────────────
// Long horizon so the clock never runs out of future to trade into. The full
// span is generated cheaply at hourly/daily resolution; only a near-term window
// is refined to 1-minute granularity (see buildSeedData).
const DAYS = 540;
const HISTORY_DAYS = 25;
const START = (() => {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - HISTORY_DAYS * 24 * 3600_000;
})();

export class Store {
  world!: World;
  actions: Action[] = [];
  progress = new LearningProgress();
  // Live is OFF by default — the app opens in deterministic practice mode.
  ui = { symbol: "BTC-USD", theme: "dark" as "dark" | "light", onboarded: false, livePref: false };
  private settings: Partial<AccountSettings>;
  readonly profileId: string;

  live = false;
  onLiveTick: (() => void) | null = null;
  private histWorld: World | null = null;
  private liveTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    const pl = loadPL();
    this.profileId = pl.active;
    const saved = this.load();
    this.settings = saved?.settings ?? { startingCash: 1_000 };
    if (saved) {
      this.ui = { livePref: false, ...saved.ui };
      this.progress = LearningProgress.fromJSON(saved.progress as { results?: never });
    }
    this.build(saved);
  }

  private get key() { return `orion.session.v4.${this.profileId}`; }

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

  // ── Public mutators ───────────────────────────────────────────────────────
  submit(req: OrderRequest) {
    const r = this.world.submit(req);
    if (r.ok && !this.live) { this.actions.push({ k: "submit", req }); this.save(); }
    return r;
  }
  cancel(id: string) {
    const ok = this.world.cancel(id);
    if (ok && !this.live) this.record({ k: "cancel", id });
    return ok;
  }
  advanceTo(to: number) {
    this.world.advanceTo(to, { stepRes: to - this.world.now > 2 * 86400_000 ? "1h" : "1m" });
    if (!this.live) this.record({ k: "advance", to });
  }
  deposit(amt: number) { this.world.deposit(amt); this.record({ k: "deposit", amt }); }
  setMode(mode: "historical" | "live") { this.world.setMode(mode); this.record({ k: "mode", mode }); }
  updateSettings(patch: Partial<AccountSettings>) {
    this.world.updateSettings(patch);
    this.settings = { ...this.settings, ...patch };
    this.record({ k: "settings", patch });
  }
  reset(startingCash?: number) {
    this.disableLive();
    this.world.reset(startingCash !== undefined ? { startingCash } : undefined);
    this.actions = [];
    this.record({ k: "reset", startingCash });
  }

  noteAdvance(to: number) { if (!this.live) this.record({ k: "advance", to }); }

  private record(a: Action) { if (this.live) return; this.actions.push(a); this.save(); }

  // ── Live mode ─────────────────────────────────────────────────────────────
  // Build a fresh live world anchored to real current time — always works
  // regardless of where the practice clock is positioned.
  async enableLive(): Promise<void> {
    if (this.live) return;
    const now = Date.now();
    const liveSeedStart = now - HISTORY_DAYS * 24 * 3600_000;
    const liveData = buildSeedData(liveSeedStart, DAYS);

    await Promise.allSettled(
      LIVE_SYMBOLS.map(async (sym) => {
        try {
          const bars = await fetchCandles(sym, "1h");
          if (bars.length) liveData.get(sym)?.appendLive("1h", bars);
        } catch {}
      })
    );

    this.histWorld = this.world;
    this.world = new World({ universe, data: liveData, startNow: now, settings: this.settings });
    this.world.setMode("live");
    this.live = true;
    this.liveTimer = setInterval(() => { void this.pollLive(); }, 30_000);
  }

  disableLive() {
    if (!this.live) return;
    if (this.liveTimer) { clearInterval(this.liveTimer); this.liveTimer = null; }
    if (this.histWorld) { this.world = this.histWorld; this.histWorld = null; }
    this.live = false;
  }

  private async pollLive() {
    if (!this.live) return;
    await Promise.allSettled(
      LIVE_SYMBOLS.map(async (sym) => {
        try {
          const bars = await fetchCandles(sym, "1h");
          if (bars.length) this.world.data.get(sym)?.appendLive("1h", bars);
        } catch {}
      })
    );
    this.world.advanceTo(Date.now(), { stepRes: "1h" });
    this.onLiveTick?.();
  }

  // ── Persistence ───────────────────────────────────────────────────────────
  save() {
    const p: Persisted = {
      start: START, days: DAYS, settings: this.world.settings,
      actions: this.actions, ui: this.ui, progress: this.progress.toJSON() as never,
    };
    try { localStorage.setItem(this.key, JSON.stringify(p)); } catch {}
  }
  saveUi() { this.save(); }

  private load(): Persisted | null {
    try {
      const raw = localStorage.getItem(this.key);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  // ── Profile management ────────────────────────────────────────────────────
  getProfileName(): string {
    return loadPL().list.find((p) => p.id === this.profileId)?.name ?? "Profile";
  }

  static listProfiles(): ProfileMeta[] { return loadPL().list; }
  static activeProfileId(): string { return loadPL().active; }

  static createProfile(name: string): string {
    const pl = loadPL();
    const id = makeId();
    pl.list.push({ id, name: name.trim() || "Profile", createdAt: Date.now() });
    pl.active = id;
    savePL(pl);
    return id;
  }

  static switchProfile(id: string): void {
    const pl = loadPL();
    if (pl.list.find((p) => p.id === id)) { pl.active = id; savePL(pl); }
  }

  static deleteProfile(id: string): boolean {
    const pl = loadPL();
    if (pl.list.length <= 1) return false;
    pl.list = pl.list.filter((p) => p.id !== id);
    if (pl.active === id) pl.active = pl.list[0]!.id;
    savePL(pl);
    try { localStorage.removeItem(`orion.session.v4.${id}`); } catch {}
    return true;
  }

  static renameProfile(id: string, name: string): void {
    const pl = loadPL();
    const p = pl.list.find((x) => x.id === id);
    if (p) { p.name = name.trim() || p.name; savePL(pl); }
  }
}
