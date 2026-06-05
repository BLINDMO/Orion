/**
 * Options learning track. Spec §10.
 *
 * Progressive modules (basics → advanced), each ending in a quiz with a pass
 * threshold and retries; checkpoint modules gate the advanced track. Lessons can
 * reference live engine data so concepts are shown on real instruments.
 *
 * HELP GATING: the entire track is available only when `helpEnabled` is true.
 * `getCurriculum(world)` returns null when help is off — there is no learning
 * surface anywhere, matching the "pure simulation" mode the user asked for.
 */

import type { World } from "../engine/world.ts";

export type QuestionKind = "multiple-choice" | "scenario";

export interface Question {
  id: string;
  kind: QuestionKind;
  prompt: string;
  options: string[];
  /** Index into `options`. */
  answer: number;
  explanation: string;
}

export interface Lesson {
  id: string;
  title: string;
  body: string;
  /** Optional interactive demo descriptor the UI can render against live data. */
  demo?: LessonDemo;
}

export interface LessonDemo {
  kind: "greeks-slider" | "chain" | "payoff" | "iv-surface";
  underlying: string;
  note: string;
}

export interface Module {
  id: string;
  index: number;
  title: string;
  summary: string;
  lessons: Lesson[];
  quiz: Question[];
  passThreshold: number; // fraction correct required to pass
  /** If true, must be passed to unlock later (advanced) modules. */
  checkpoint: boolean;
}

export const CURRICULUM: Module[] = [
  {
    id: "basics",
    index: 1,
    title: "What an Option Is",
    summary: "Calls, puts, the contract, and the chain.",
    checkpoint: false,
    passThreshold: 0.7,
    lessons: [
      {
        id: "calls-puts",
        title: "Calls and Puts",
        body: "A call gives the right (not obligation) to BUY 100 shares at the strike before expiry. A put gives the right to SELL at the strike. You pay a premium for that right. Sellers (writers) collect the premium and take on the obligation.",
      },
      {
        id: "the-chain",
        title: "Reading the Chain",
        body: "The option chain lists every strike and expiry with bid/ask, last, volume, open interest, IV and Greeks. Calls sit on one side, puts on the other, organized by expiration date.",
        demo: { kind: "chain", underlying: "BTC-USD", note: "Open the live chain and find the at-the-money strike." },
      },
    ],
    quiz: [
      {
        id: "q-call",
        kind: "multiple-choice",
        prompt: "A call option gives the holder the right to…",
        options: ["Sell the underlying at the strike", "Buy the underlying at the strike", "Collect a dividend", "Short the stock for free"],
        answer: 1,
        explanation: "A call is the right to BUY at the strike price.",
      },
      {
        id: "q-premium",
        kind: "multiple-choice",
        prompt: "Who receives the premium?",
        options: ["The buyer", "The exchange only", "The seller/writer", "Nobody"],
        answer: 2,
        explanation: "The option seller collects the premium in exchange for taking on the obligation.",
      },
    ],
  },
  {
    id: "moneyness",
    index: 2,
    title: "Moneyness & Value",
    summary: "Intrinsic vs. extrinsic value; ITM/ATM/OTM.",
    checkpoint: false,
    passThreshold: 0.7,
    lessons: [
      {
        id: "intrinsic-extrinsic",
        title: "Intrinsic vs Extrinsic",
        body: "Intrinsic value is what the option is worth if exercised now (max(0, spot−strike) for a call). Extrinsic (time) value is everything above intrinsic — it reflects time and volatility, and decays to zero at expiry.",
      },
    ],
    quiz: [
      {
        id: "q-itm",
        kind: "scenario",
        prompt: "Spot is $105, you hold a $100 call. Its intrinsic value is…",
        options: ["$0", "$5", "$100", "$105"],
        answer: 1,
        explanation: "max(0, 105 − 100) = $5 of intrinsic value.",
      },
    ],
  },
  {
    id: "greeks",
    index: 3,
    title: "The Greeks",
    summary: "Delta, gamma, theta, vega, rho — one at a time.",
    checkpoint: true,
    passThreshold: 0.75,
    lessons: [
      {
        id: "delta",
        title: "Delta",
        body: "Delta is how much the option price moves per $1 move in the underlying. Calls: 0→1, puts: −1→0. ATM ≈ ±0.5. Delta also approximates the probability of finishing in the money.",
        demo: { kind: "greeks-slider", underlying: "ACME", note: "Drag spot and watch delta change." },
      },
      {
        id: "gamma",
        title: "Gamma",
        body: "Gamma is the rate of change of delta. It's highest at-the-money and near expiry. High gamma means delta — and your directional exposure — shifts quickly.",
      },
      {
        id: "theta",
        title: "Theta",
        body: "Theta is time decay: how much value the option loses per day, all else equal. Long options pay theta; short options collect it. Decay accelerates into expiry for ATM options.",
      },
      {
        id: "vega",
        title: "Vega",
        body: "Vega is sensitivity to implied volatility. When IV rises, long options gain; when IV falls (e.g., after an event), they lose — the 'vol crush'.",
      },
      {
        id: "rho",
        title: "Rho",
        body: "Rho is sensitivity to interest rates — usually the smallest Greek for short-dated options, more relevant for LEAPS.",
      },
    ],
    quiz: [
      {
        id: "q-theta",
        kind: "multiple-choice",
        prompt: "All else equal, as time passes a long option's extrinsic value…",
        options: ["Increases", "Stays flat", "Decays toward zero", "Becomes negative"],
        answer: 2,
        explanation: "Theta decay erodes extrinsic value to zero at expiry.",
      },
      {
        id: "q-delta",
        kind: "multiple-choice",
        prompt: "An at-the-money call has a delta closest to…",
        options: ["0.0", "0.5", "1.0", "-0.5"],
        answer: 1,
        explanation: "ATM options have delta near ±0.5.",
      },
      {
        id: "q-vega",
        kind: "scenario",
        prompt: "Implied volatility collapses after an earnings report. Your long straddle…",
        options: ["Gains from vega", "Loses from vega (vol crush)", "Is unaffected", "Doubles"],
        answer: 1,
        explanation: "Long options are long vega; falling IV hurts them — the classic post-event vol crush.",
      },
    ],
  },
  {
    id: "iv",
    index: 4,
    title: "Implied Volatility",
    summary: "IV, skew, and term structure.",
    checkpoint: false,
    passThreshold: 0.7,
    lessons: [
      {
        id: "what-is-iv",
        title: "What IV Means",
        body: "Implied volatility is the volatility the market is pricing into an option. Higher IV = richer premiums. It is forward-looking and often differs from realized (historical) volatility.",
        demo: { kind: "iv-surface", underlying: "ETH-USD", note: "Compare IV across strikes and expiries." },
      },
      {
        id: "skew-term",
        title: "Skew & Term Structure",
        body: "Skew: OTM puts often carry higher IV than OTM calls (crash insurance demand). Term structure: IV varies by expiry, frequently elevated around known events.",
      },
    ],
    quiz: [
      {
        id: "q-skew",
        kind: "multiple-choice",
        prompt: "In equity index options, 'skew' typically means…",
        options: ["Calls cost more than puts", "OTM puts have higher IV than OTM calls", "IV is flat across strikes", "Rho dominates"],
        answer: 1,
        explanation: "Downside puts are bid up for protection, lifting their IV — the equity skew.",
      },
    ],
  },
  {
    id: "single-leg",
    index: 5,
    title: "Single-Leg Strategies",
    summary: "Long calls/puts, covered calls, cash-secured puts.",
    checkpoint: false,
    passThreshold: 0.7,
    lessons: [
      {
        id: "long-call-put",
        title: "Long Call / Long Put",
        body: "Defined risk (premium paid), leveraged directional exposure. Long call profits if price rises enough to overcome premium + theta; long put profits if it falls.",
        demo: { kind: "payoff", underlying: "ACME", note: "Plot a long call payoff at expiry." },
      },
      {
        id: "covered-cash",
        title: "Covered Call & Cash-Secured Put",
        body: "A covered call sells a call against 100 owned shares to collect income, capping upside. A cash-secured put sells a put while holding cash to buy if assigned — income with a willingness to own lower.",
      },
    ],
    quiz: [
      {
        id: "q-cc",
        kind: "scenario",
        prompt: "You own 100 shares and sell a covered call. Your upside above the strike is…",
        options: ["Unlimited", "Capped at the strike (plus premium)", "Zero", "Doubled"],
        answer: 1,
        explanation: "Above the strike the shares get called away; gains are capped at strike + premium.",
      },
    ],
  },
  {
    id: "verticals",
    index: 6,
    title: "Vertical Spreads",
    summary: "Defined-risk debit and credit spreads.",
    checkpoint: false,
    passThreshold: 0.7,
    lessons: [
      {
        id: "verticals",
        title: "Bull/Bear Verticals",
        body: "Buy one option and sell another of the same type/expiry at a different strike. This caps both cost and payoff, defining your risk. Debit spreads pay to open; credit spreads collect.",
        demo: { kind: "payoff", underlying: "NOVA", note: "Build a bull call spread and read max profit/loss." },
      },
    ],
    quiz: [
      {
        id: "q-vert",
        kind: "multiple-choice",
        prompt: "A bull call (debit) vertical's maximum loss is…",
        options: ["Unlimited", "The net debit paid", "The strike width", "Zero"],
        answer: 1,
        explanation: "Most you can lose is the premium paid to open the spread.",
      },
    ],
  },
  {
    id: "volatility",
    index: 7,
    title: "Volatility Strategies",
    summary: "Straddles and strangles.",
    checkpoint: false,
    passThreshold: 0.7,
    lessons: [
      {
        id: "straddle-strangle",
        title: "Straddles & Strangles",
        body: "Buy a call and a put to profit from a big move in EITHER direction (long straddle = same strike, strangle = different strikes). You're long vega and pay theta — you need movement, and soon.",
        demo: { kind: "payoff", underlying: "BTC-USD", note: "Plot a long straddle; find the two breakevens." },
      },
    ],
    quiz: [
      {
        id: "q-straddle",
        kind: "multiple-choice",
        prompt: "A long straddle profits most when…",
        options: ["Price stays pinned", "Price makes a large move either way", "IV collapses", "Time passes quickly"],
        answer: 1,
        explanation: "It needs a large directional move to overcome the combined premium and decay.",
      },
    ],
  },
  {
    id: "advanced",
    index: 8,
    title: "Advanced Multi-Leg",
    summary: "Condors, butterflies, calendars.",
    checkpoint: true,
    passThreshold: 0.75,
    lessons: [
      {
        id: "condor-fly",
        title: "Iron Condors & Butterflies",
        body: "Range-bound, defined-risk income trades. An iron condor sells an OTM put spread and an OTM call spread to collect premium if price stays in a band. A butterfly concentrates the profit zone around one strike.",
      },
      {
        id: "calendars",
        title: "Calendar Spreads",
        body: "Sell a near-dated option and buy a longer-dated one at the same strike to harvest faster near-term theta. They're long vega and benefit from rising IV and a pinned underlying.",
      },
    ],
    quiz: [
      {
        id: "q-condor",
        kind: "scenario",
        prompt: "An iron condor reaches max profit when, at expiry, price is…",
        options: ["Far above the call spread", "Between the short strikes", "Far below the put spread", "Exactly at a long strike"],
        answer: 1,
        explanation: "Max profit is the net credit, kept when price expires between the two short strikes.",
      },
    ],
  },
  {
    id: "risk",
    index: 9,
    title: "Risk Management & Sizing",
    summary: "Position sizing, defined risk, and discipline.",
    checkpoint: false,
    passThreshold: 0.8,
    lessons: [
      {
        id: "sizing",
        title: "Position Sizing",
        body: "Risk a small, fixed fraction of equity per trade so no single loss is catastrophic. Prefer defined-risk structures, know your max loss before entering, and let expectancy — not any one trade — compound the account.",
      },
    ],
    quiz: [
      {
        id: "q-size",
        kind: "multiple-choice",
        prompt: "A sound rule of thumb is to risk per trade no more than…",
        options: ["50% of equity", "A small fixed % (e.g., 1–2%)", "All buying power", "Whatever feels right"],
        answer: 1,
        explanation: "Small fixed fractional risk keeps any single loss survivable.",
      },
    ],
  },
];

export interface ModuleResult {
  moduleId: string;
  bestScore: number; // fraction correct
  attempts: number;
  passed: boolean;
}

/** Serializable progress tracker with scoring, retries and unlock logic. */
export class LearningProgress {
  results: Record<string, ModuleResult> = {};

  static fromJSON(json: { results?: Record<string, ModuleResult> }): LearningProgress {
    const p = new LearningProgress();
    p.results = json.results ?? {};
    return p;
  }

  /** Grade an attempt. `answers` maps question id → selected option index. */
  grade(moduleId: string, answers: Record<string, number>): ModuleResult {
    const mod = CURRICULUM.find((m) => m.id === moduleId);
    if (!mod) throw new Error(`Unknown module ${moduleId}`);
    let correct = 0;
    for (const q of mod.quiz) if (answers[q.id] === q.answer) correct++;
    const score = mod.quiz.length ? correct / mod.quiz.length : 0;
    const prev = this.results[moduleId];
    const result: ModuleResult = {
      moduleId,
      bestScore: Math.max(score, prev?.bestScore ?? 0),
      attempts: (prev?.attempts ?? 0) + 1,
      passed: (prev?.passed ?? false) || score >= mod.passThreshold,
    };
    this.results[moduleId] = result;
    return result;
  }

  isPassed(moduleId: string): boolean {
    return this.results[moduleId]?.passed ?? false;
  }

  /**
   * A module is unlocked if all earlier CHECKPOINT modules are passed.
   * (Non-checkpoint modules never block progression.)
   */
  isUnlocked(moduleId: string): boolean {
    const mod = CURRICULUM.find((m) => m.id === moduleId);
    if (!mod) return false;
    for (const m of CURRICULUM) {
      if (m.index >= mod.index) break;
      if (m.checkpoint && !this.isPassed(m.id)) return false;
    }
    return true;
  }

  /** Completion map for the UI: per-module status. */
  completionMap(): { id: string; title: string; passed: boolean; unlocked: boolean; bestScore: number }[] {
    return CURRICULUM.map((m) => ({
      id: m.id,
      title: m.title,
      passed: this.isPassed(m.id),
      unlocked: this.isUnlocked(m.id),
      bestScore: this.results[m.id]?.bestScore ?? 0,
    }));
  }

  overallProgress(): number {
    const passed = CURRICULUM.filter((m) => this.isPassed(m.id)).length;
    return passed / CURRICULUM.length;
  }

  toJSON() {
    return { results: this.results };
  }
}

/** The learning track is only available when help is enabled (user requirement). */
export function getCurriculum(world: World): Module[] | null {
  return world.settings.helpEnabled ? CURRICULUM : null;
}
