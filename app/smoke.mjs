// Headless smoke test: drive the real app, assert no console errors, screenshot.
import puppeteer from "puppeteer";

const URL = "http://localhost:5173/";
const errors = [];
const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 860, deviceScaleFactor: 2 });
// Ignore environmental resource failures (e.g. Google Fonts blocked in sandbox).
const envNoise = (t) => /Failed to load resource|ERR_CERT|net::ERR|fonts\.g/.test(t);
page.on("console", (m) => { if (m.type() === "error" && !envNoise(m.text())) errors.push("console.error: " + m.text()); });
page.on("pageerror", (e) => { if (!envNoise(e.message)) errors.push("pageerror: " + e.message); });

await page.goto(URL, { waitUntil: "networkidle0" });

// Onboarding → enter
await page.waitForSelector("#begin", { timeout: 5000 });
await page.click("#begin");
await page.waitForSelector("#chart", { timeout: 5000 });

// Place a market buy: type qty and submit
await page.waitForSelector("#qty");
await page.type("#qty", "0.5");
await page.click("#submitBtn");

// Advance time a few times
for (const sel of ['[data-adv="h"]', '[data-adv="d"]', '[data-adv="d"]']) {
  await page.click(sel);
  await new Promise((r) => setTimeout(r, 850));
}

// Open Options screen, build a strategy
await page.click('[data-nav="options"]');
await page.waitForSelector("[data-strat]", { timeout: 5000 });
await page.click('[data-strat="Long Straddle"]');
await page.waitForSelector("#payoff", { timeout: 3000 });
await page.screenshot({ path: "public/shot-options.png" });

// Stats screen
await page.click("#backBtn");
await page.click('[data-nav="stats"]');
await page.waitForSelector("#eqCurve", { timeout: 3000 });
await page.screenshot({ path: "public/shot-stats.png" });

// Back to trade for the hero shot
await page.click("#backBtn");
await new Promise((r) => setTimeout(r, 300));
await page.screenshot({ path: "public/shot-trade.png" });

// Read out some on-screen state
const equity = await page.$eval(".acct", (e) => e.textContent?.replace(/\s+/g, " ").trim());
const positions = await page.$$eval("#positions .li", (els) => els.length);
const fills = await page.$$eval("#blotter .li", (els) => els.length);

await browser.close();

console.log("Account header:", equity);
console.log("Positions:", positions, "| Blotter rows:", fills);
if (errors.length) { console.error("\nERRORS:\n" + errors.join("\n")); process.exit(1); }
console.log("\nSMOKE TEST PASSED — no console/page errors.");
