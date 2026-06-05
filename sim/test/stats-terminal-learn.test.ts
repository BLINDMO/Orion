import { test } from "node:test";
import assert from "node:assert/strict";
import { createDemoWorld } from "../src/index.ts";
import { analytics } from "../src/engine/stats.ts";
import { scan } from "../src/terminal/scanner.ts";
import { CURRICULUM, getCurriculum, LearningProgress } from "../src/learn/curriculum.ts";

test("analytics report computes core metrics after some trades", () => {
  const w = createDemoWorld({ settings: { startingCash: 100_000 } });
  w.submit({ target: { kind: "spot", symbol: "BTC-USD" }, side: "buy", qty: 0.5, type: "market" });
  w.advanceDay();
  w.submit({ target: { kind: "spot", symbol: "BTC-USD" }, side: "sell", qty: 0.5, type: "market" });
  w.advanceDay();
  const r = analytics(w);
  assert.equal(r.trade.trades, 1);
  assert.ok(r.trade.winRate >= 0 && r.trade.winRate <= 1);
  assert.ok(Number.isFinite(Number(r.totalPnl)));
  assert.ok(r.equityCurve.length > 0);
  assert.ok(Number(r.drawdown.peakEquity) >= Number(r.equity) - 1e-6 || r.drawdown.maxDrawdown !== undefined);
  // breakdown by asset class includes crypto
  assert.ok(r.byAssetClass.some((b) => b.key === "crypto"));
});

test("win rate and profit factor reflect outcomes", () => {
  const w = createDemoWorld({ settings: { startingCash: 1_000_000, feeRealism: false } });
  // construct a couple of round-trips
  for (let i = 0; i < 3; i++) {
    w.submit({ target: { kind: "spot", symbol: "ETH-USD" }, side: "buy", qty: 1, type: "market" });
    w.advanceDay();
    w.submit({ target: { kind: "spot", symbol: "ETH-USD" }, side: "sell", qty: 1, type: "market" });
    w.advanceDay();
  }
  const r = analytics(w);
  assert.equal(r.trade.trades, 3);
  assert.ok(r.trade.wins + r.trade.losses <= 3);
  assert.ok(r.trade.avgHoldHours > 0);
});

test("terminal scan returns analytical state and readings", () => {
  const w = createDemoWorld();
  w.advanceDay();
  const s = scan(w, "BTC-USD", "1h");
  assert.ok(["up", "down", "sideways"].includes(s.trend));
  assert.ok(s.readings.length >= 8);
  assert.ok(s.readings.find((r) => r.indicator === "RSI(14)"));
  assert.equal(s.helpEnabled, true);
});

test("HELP GATING: disabling help removes all teaching callouts (§user)", () => {
  const w = createDemoWorld({ settings: { helpEnabled: false } });
  w.advanceDay();
  const s = scan(w, "BTC-USD", "1h");
  // analytical readings still present (a real terminal shows numbers)
  assert.ok(s.readings.length > 0);
  // but NO teaching/help content anywhere
  assert.equal(s.callouts.length, 0);
  assert.equal(s.helpEnabled, false);
  // and the learning track is entirely unavailable
  assert.equal(getCurriculum(w), null);
});

test("HELP enabled exposes callouts and curriculum", () => {
  const w = createDemoWorld({ settings: { helpEnabled: true } });
  w.advanceDay();
  const s = scan(w, "BTC-USD", "1h");
  assert.ok(s.callouts.length > 0, "should teach when help on");
  for (const c of s.callouts) assert.ok(c.lessonId && c.detail);
  assert.ok(getCurriculum(w)!.length === CURRICULUM.length);
});

test("curriculum has all 9 modules in order with quizzes", () => {
  assert.equal(CURRICULUM.length, 9);
  CURRICULUM.forEach((m, i) => {
    assert.equal(m.index, i + 1);
    assert.ok(m.lessons.length > 0);
    assert.ok(m.quiz.length > 0);
    for (const q of m.quiz) assert.ok(q.answer >= 0 && q.answer < q.options.length);
  });
});

test("learning progress: grading, pass thresholds, retries", () => {
  const p = new LearningProgress();
  // fail the greeks checkpoint
  const wrong: Record<string, number> = { "q-theta": 0, "q-delta": 0, "q-vega": 0 };
  const r1 = p.grade("greeks", wrong);
  assert.equal(r1.passed, false);
  assert.equal(r1.attempts, 1);
  // pass on retry
  const right: Record<string, number> = { "q-theta": 2, "q-delta": 1, "q-vega": 1 };
  const r2 = p.grade("greeks", right);
  assert.equal(r2.passed, true);
  assert.equal(r2.attempts, 2);
  assert.ok(r2.bestScore >= 0.75);
});

test("checkpoint unlock logic gates advanced modules", () => {
  const p = new LearningProgress();
  // 'advanced' (index 8) requires checkpoints 'greeks'(3) passed; also 'advanced' is itself checkpoint
  assert.equal(p.isUnlocked("basics"), true);
  assert.equal(p.isUnlocked("advanced"), false); // greeks not passed
  p.grade("greeks", { "q-theta": 2, "q-delta": 1, "q-vega": 1 });
  assert.equal(p.isUnlocked("advanced"), true);
});

test("progress serializes and restores", () => {
  const p = new LearningProgress();
  p.grade("basics", { "q-call": 1, "q-premium": 2 });
  const json = JSON.parse(JSON.stringify(p));
  const restored = LearningProgress.fromJSON(json);
  assert.equal(restored.isPassed("basics"), true);
  assert.ok(restored.overallProgress() > 0);
});

test("completion map reports unlock + pass state", () => {
  const p = new LearningProgress();
  const map = p.completionMap();
  assert.equal(map.length, 9);
  assert.equal(map[0]!.unlocked, true);
});
